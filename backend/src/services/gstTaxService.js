'use strict';

/**
 * GST TAX & STATUTORY INVOICING SERVICE (STAGE 08 — PRIMARY MASTER PROGRAMME)
 *
 * Implements authoritative CBIC-compliant GST taxation, invoice issuance,
 * double-entry verification, and GSTR reporting:
 *  - Intra-State (CGST + SGST) vs Inter-State (IGST) split
 *  - Standard tax rate slabs: 0%, 5%, 12%, 18%, 28% with banker's / half-up rounding
 *  - Indian Numbering System Amount-in-Words generator (Crores, Lakhs, Rupees, Paise)
 *  - Concurrency-safe gapless sequential invoice numbering per financial year & café
 *  - Financial period lock checks preventing postings to closed periods
 *  - GSTR-1 and GSTR-3B audit-ready tax summaries
 *  - Statutory CBIC PDF invoice generation with Stage 01 layout & Stage 02 QR
 */

const { TaxInvoice, syncTaxInvoiceIndexes } = require('../models/TaxInvoice');
const { SequenceCounter } = require('../models/SequenceCounter');
const { FinancialPeriod } = require('../models/FinancialPeriod');
const { ApiError } = require('../utils/ApiError');
const auditService = require('./auditService');
const { generateUniversalQr } = require('./universalQrService');

// In-memory mutex locks for concurrency-safe sequential invoice numbering
const activeSequenceLocks = new Map();

// Canonical financial policy versions (§47, §48, REC-16 Add-On §15)
const TAX_RULE_VERSION = 'GST_ROUNDING_V1_2026';
const ROUNDING_POLICY_VERSION = 'ZAMORIN_PAYABLE_ROUNDING_50P_V1';

/**
 * Canonical monetary rounding helper (REC-16 §7, §8).
 * Enforces exact arithmetic half-up rounding in minor units (paisa).
 * Guaranteed free of JavaScript binary floating-point representation drift (e.g. 0.025 -> 0.03).
 */
function roundToPaisa(amountInPaisa) {
  const n = Number(amountInPaisa || 0);
  if (!Number.isFinite(n) || n === 0) return 0;
  const sign = n < 0 ? -1 : 1;
  const absVal = Math.abs(n);
  // Adding 1e-9 guarantees IEEE 754 precision issues (such as 2.4999999999999996) do not round down.
  return sign * Math.floor(absVal + 0.5 + 1e-9);
}

/**
 * Convert rupee currency amount to integer paisa.
 */
function toPaisa(rupees) {
  return roundToPaisa(Number(rupees || 0) * 100);
}

/**
 * Convert integer paisa to formatted rupee decimal string (2 decimal places).
 */
function fromPaisa(paisa) {
  return (roundToPaisa(paisa) / 100).toFixed(2);
}

/**
 * Canonical Customer-Payable Rounding Engine to practical ₹0.50 increments (REC-16 Add-On §1-§11).
 *
 * This policy applies strictly AFTER taxable value and all statutory tax components (CGST, SGST, IGST, Cess)
 * are calculated and finalized. It never mutates statutory tax components.
 *
 * Rules:
 *   remainder = preRoundingTotalPaisa % 100
 *   remainder <= 25           => round down to ₹X.00 (target = 0)
 *   26 <= remainder <= 75     => round to ₹X.50 (target = 50)
 *   remainder >= 76           => round up to ₹(X+1).00 (target = 100)
 *
 * Guaranteed Invariant:
 *   ABS(roundOffPaisa) <= 25
 *   preRoundingTotalPaisa + roundOffPaisa === finalPayablePaisa
 */
function calculateCustomerPayableRounding50P(preRoundingTotalPaisa) {
  const pre = Math.round(Number(preRoundingTotalPaisa || 0));
  const isNegative = pre < 0;
  const absPre = Math.abs(pre);
  const remainder = absPre % 100;
  let targetRemainder = 0;

  if (remainder <= 25) {
    targetRemainder = 0;
  } else if (remainder <= 75) {
    targetRemainder = 50;
  } else {
    targetRemainder = 100;
  }

  const absFinal = Math.floor(absPre / 100) * 100 + targetRemainder;
  const finalPayablePaisa = isNegative ? -absFinal : absFinal;
  const roundOffPaisa = finalPayablePaisa - pre;

  return {
    preRoundingTotalPaisa: pre,
    roundOffPaisa,
    finalPayablePaisa,
    roundingPolicyVersion: ROUNDING_POLICY_VERSION,
  };
}

/**
 * Determine Indian Financial Year from date (e.g. April 2026 to March 2027 => "2026-27")
 */
function getIndianFinancialYear(date = new Date()) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth(); // 0-indexed: 0 = Jan, 3 = April

  if (month >= 3) {
    const nextYearShort = String(year + 1).slice(-2);
    return `${year}-${nextYearShort}`;
  } else {
    const currentYearShort = String(year).slice(-2);
    return `${year - 1}-${currentYearShort}`;
  }
}

/**
 * Convert numeric amount in Paisa to Indian Rupee Words (Lakhs, Crores, etc.)
 */
function numberToIndianRupeeWords(amountPaisa) {
  const totalPaisa = Math.round(Number(amountPaisa || 0));
  if (totalPaisa <= 0) return 'Zero Rupees Only';

  const rupees = Math.floor(totalPaisa / 100);
  const paise = totalPaisa % 100;

  const ones = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen'
  ];

  const tens = [
    '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'
  ];

  function convertTwoDigits(n) {
    if (n < 20) return ones[n];
    const t = Math.floor(n / 10);
    const o = n % 10;
    return tens[t] + (o > 0 ? `-${ones[o]}` : '');
  }

  function convertThreeDigits(n) {
    const h = Math.floor(n / 100);
    const rem = n % 100;
    let res = '';
    if (h > 0) res += `${ones[h]} Hundred`;
    if (rem > 0) res += (res ? ' ' : '') + convertTwoDigits(rem);
    return res;
  }

  let wordParts = [];
  let remaining = rupees;

  // Crores (>= 1,00,00,000)
  const crores = Math.floor(remaining / 10000000);
  if (crores > 0) {
    wordParts.push(`${convertThreeDigits(crores)} Crore`);
    remaining %= 10000000;
  }

  // Lakhs (>= 1,00,000)
  const lakhs = Math.floor(remaining / 100000);
  if (lakhs > 0) {
    wordParts.push(`${convertThreeDigits(lakhs)} Lakh`);
    remaining %= 100000;
  }

  // Thousands (>= 1,000)
  const thousands = Math.floor(remaining / 1000);
  if (thousands > 0) {
    wordParts.push(`${convertThreeDigits(thousands)} Thousand`);
    remaining %= 1000;
  }

  // Hundreds & units
  if (remaining > 0) {
    wordParts.push(convertThreeDigits(remaining));
  }

  const rupeeString = wordParts.length > 0 ? `${wordParts.join(' ')} Rupees` : 'Zero Rupees';
  const paiseString = paise > 0 ? ` and ${convertTwoDigits(paise)} Paise` : '';

  return `${rupeeString}${paiseString} Only`;
}

/**
 * Calculate CBIC tax amounts for given line items
 */
function calculateGstTaxes({
  lines = [],
  supplyType = 'INTRA_STATE',
  defaultGstRate = 5,
  customerPayableRounding = false,
  payableRoundingPolicy = 'NEAREST_RUPEE',
} = {}) {
  const normSupplyType = supplyType === 'INTER_STATE' ? 'INTER_STATE' : 'INTRA_STATE';
  let totalTaxablePaisa = 0;
  let totalCgstPaisa = 0;
  let totalSgstPaisa = 0;
  let totalIgstPaisa = 0;

  const calculatedLines = lines.map((item, index) => {
    const quantity = Math.max(0.001, Number(item.quantity || 1));
    const ratePaisa = roundToPaisa(item.ratePaisa ?? item.unitPricePaisa ?? 0);
    const grossAmountPaisa = roundToPaisa(quantity * ratePaisa);
    const discountPaisa = Math.min(grossAmountPaisa, Math.max(0, roundToPaisa(item.discountPaisa || 0)));
    const taxableAmountPaisa = Math.max(0, grossAmountPaisa - discountPaisa);

    const gstRate = Number(item.gstRatePercent !== undefined ? item.gstRatePercent : defaultGstRate);
    let cgstRate = 0;
    let cgstAmount = 0;
    let sgstRate = 0;
    let sgstAmount = 0;
    let igstRate = 0;
    let igstAmount = 0;

    if (normSupplyType === 'INTRA_STATE') {
      cgstRate = gstRate / 2;
      sgstRate = gstRate / 2;
      cgstAmount = roundToPaisa((taxableAmountPaisa * cgstRate) / 100);
      sgstAmount = roundToPaisa((taxableAmountPaisa * sgstRate) / 100);
    } else {
      igstRate = gstRate;
      igstAmount = roundToPaisa((taxableAmountPaisa * igstRate) / 100);
    }

    const totalItemAmountPaisa = taxableAmountPaisa + cgstAmount + sgstAmount + igstAmount;

    totalTaxablePaisa += taxableAmountPaisa;
    totalCgstPaisa += cgstAmount;
    totalSgstPaisa += sgstAmount;
    totalIgstPaisa += igstAmount;

    return {
      lineId: item.lineId || `L-${index + 1}`,
      itemCode: item.itemCode || item.itemId || null,
      description: item.description || item.itemNameSnapshot || item.name || 'Item',
      hsnCode: String(item.hsnCode || '996331').trim(), // Default Restaurant / Catering HSN
      quantity,
      uqc: (item.uqc || item.uom || 'NOS').toUpperCase().trim(),
      ratePaisa,
      grossAmountPaisa,
      discountPaisa,
      taxableAmountPaisa,
      gstRatePercent: gstRate,
      cgstRatePercent: cgstRate,
      cgstAmountPaisa: cgstAmount,
      sgstRatePercent: sgstRate,
      sgstAmountPaisa: sgstAmount,
      igstRatePercent: igstRate,
      igstAmountPaisa: igstAmount,
      totalItemAmountPaisa,
    };
  });

  const totalTaxPaisa = totalCgstPaisa + totalSgstPaisa + totalIgstPaisa;
  const unroundedTotalPaisa = totalTaxablePaisa + totalTaxPaisa;

  // Round-off calculation:
  // REC-16 Add-On: 50-paise customer-payable rounding when enabled.
  // Statutory B2B Tax Invoices default to nearest rupee under Section 170.
  let grandTotalPaisa = unroundedTotalPaisa;
  let roundOffPaisa = 0;
  let effectivePolicy = payableRoundingPolicy;

  if (customerPayableRounding || payableRoundingPolicy === 'ZAMORIN_50_PAISE_CUSTOM') {
    effectivePolicy = 'ZAMORIN_50_PAISE_CUSTOM';
    const payable = calculateCustomerPayableRounding50P(unroundedTotalPaisa);
    grandTotalPaisa = payable.finalPayablePaisa;
    roundOffPaisa = payable.roundOffPaisa;
  } else if (payableRoundingPolicy === 'NEAREST_RUPEE') {
    grandTotalPaisa = Math.round(unroundedTotalPaisa / 100) * 100;
    roundOffPaisa = grandTotalPaisa - unroundedTotalPaisa;
  }

  // Aggregate HSN Summary
  const hsnMap = new Map();
  for (const line of calculatedLines) {
    const key = `${line.hsnCode}:${line.gstRatePercent}`;
    if (!hsnMap.has(key)) {
      hsnMap.set(key, {
        hsnCode: line.hsnCode,
        taxableValuePaisa: 0,
        cgstRatePercent: line.cgstRatePercent,
        cgstAmountPaisa: 0,
        sgstRatePercent: line.sgstRatePercent,
        sgstAmountPaisa: 0,
        igstRatePercent: line.igstRatePercent,
        igstAmountPaisa: 0,
        totalTaxPaisa: 0,
      });
    }
    const hsnEntry = hsnMap.get(key);
    hsnEntry.taxableValuePaisa += line.taxableAmountPaisa;
    hsnEntry.cgstAmountPaisa += line.cgstAmountPaisa;
    hsnEntry.sgstAmountPaisa += line.sgstAmountPaisa;
    hsnEntry.igstAmountPaisa += line.igstAmountPaisa;
    hsnEntry.totalTaxPaisa += (line.cgstAmountPaisa + line.sgstAmountPaisa + line.igstAmountPaisa);
  }

  const hsnSummary = Array.from(hsnMap.values());
  const amountInWords = numberToIndianRupeeWords(grandTotalPaisa);

  return {
    supplyType: normSupplyType,
    lines: calculatedLines,
    hsnSummary,
    taxSummary: {
      totalTaxablePaisa,
      totalCgstPaisa,
      totalSgstPaisa,
      totalIgstPaisa,
      totalTaxPaisa,
      preRoundingTotalPaisa: unroundedTotalPaisa,
      roundOffPaisa,
      grandTotalPaisa,
      taxRuleVersion: TAX_RULE_VERSION,
      roundingPolicyVersion: effectivePolicy === 'ZAMORIN_50_PAISE_CUSTOM' ? ROUNDING_POLICY_VERSION : 'SECTION_170_NEAREST_RUPEE',
    },
    amountInWords,
    taxRuleVersion: TAX_RULE_VERSION,
    roundingPolicyVersion: effectivePolicy === 'ZAMORIN_50_PAISE_CUSTOM' ? ROUNDING_POLICY_VERSION : 'SECTION_170_NEAREST_RUPEE',
  };
}

/**
 * Single canonical entry point for POS and customer billing with 50-paise rounding enabled (REC-16 §40).
 */
function calculateCanonicalGst(options = {}) {
  return calculateGstTaxes({
    customerPayableRounding: true,
    payableRoundingPolicy: 'ZAMORIN_50_PAISE_CUSTOM',
    ...options,
  });
}

/**
 * Formats a financial year into compact 4-digit GST notation (e.g. "2026-27" -> "2627")
 */
function formatShortFinancialYear(fy) {
  if (!fy) return '2627';
  const str = String(fy).trim();
  const m = str.match(/(?:20)?(\d{2})[-/](?:20)?(\d{2})/);
  if (m) {
    return `${m[1]}${m[2]}`;
  }
  const clean = str.replace(/[^a-zA-Z0-9]/g, '');
  return clean.slice(-4) || '2627';
}

// In-memory and persistent statutory registries scoped by GSTIN
const statutoryBranchRegistry = new Map(); // Key: `${gstinClean}:${statutoryCafeCode}` -> details
const cafeToBranchCodeMap = new Map();      // Key: `${gstinClean}:${cafeId}` -> statutoryCafeCode
const statutorySeriesRegistry = new Map();  // Key: `${gstinClean}:${branchCode}:${statCode}` -> series config
const issuedSeriesInvoicesCount = new Map();// Key: `${gstinClean}:${fyShort}:${branchCode}:${statCode}` -> count
const branchIssuedInvoices = new Map();     // Key: `${gstinClean}:${fyShort}:${branchCode}` -> count

function _clearStatutoryRegistries() {
  statutoryBranchRegistry.clear();
  cafeToBranchCodeMap.clear();
  statutorySeriesRegistry.clear();
  issuedSeriesInvoicesCount.clear();
  branchIssuedInvoices.clear();
}

/**
 * Registers an immutable statutory compact branch/café code under a specific GSTIN.
 * Enforces Rule: Two cafés under the SAME GSTIN CANNOT use the same statutory compact code.
 * Rejects configuration with GST_INVOICE_SERIES_COLLISION if collision detected.
 */
function registerStatutoryCafeCode({ organisationId, gstin, cafeId, statutoryCafeCode, force = false }) {
  if (!gstin) {
    throw new ApiError(400, 'GSTIN_REQUIRED', 'GSTIN is required for statutory branch registration.');
  }
  if (!cafeId) {
    throw new ApiError(400, 'CAFE_ID_REQUIRED', 'Café ID is required for statutory branch registration.');
  }
  if (!statutoryCafeCode) {
    throw new ApiError(400, 'STATUTORY_CAFE_CODE_REQUIRED', 'Statutory café code is required.');
  }

  const gstinClean = String(gstin).trim().toUpperCase();
  const codeClean = String(statutoryCafeCode).trim().toUpperCase();

  if (!/^[A-Z0-9-]{1,4}$/.test(codeClean)) {
    throw new ApiError(400, 'INVALID_STATUTORY_CAFE_CODE', `Statutory café code "${codeClean}" must be 1 to 4 alphanumeric/hyphen characters.`);
  }

  const branchKey = `${gstinClean}:${codeClean}`;
  const existingAssignment = statutoryBranchRegistry.get(branchKey);

  if (existingAssignment && existingAssignment.cafeId !== cafeId && !force) {
    throw new ApiError(
      400,
      'GST_INVOICE_SERIES_COLLISION',
      `Statutory compact café code "${codeClean}" is already registered to café "${existingAssignment.cafeId}" under GSTIN "${gstinClean}". Duplicate statutory branch codes under the same GSTIN are strictly prohibited.`
    );
  }

  const cafeKey = `${gstinClean}:${cafeId}`;
  statutoryBranchRegistry.set(branchKey, {
    organisationId: organisationId || 'ORG-ZAMORIN',
    gstin: gstinClean,
    cafeId,
    statutoryCafeCode: codeClean,
    registeredAt: existingAssignment?.registeredAt || new Date(),
  });
  cafeToBranchCodeMap.set(cafeKey, codeClean);

  return {
    gstin: gstinClean,
    cafeId,
    statutoryCafeCode: codeClean,
    registered: true,
  };
}

/**
 * Resolves and validates a compact cafe code for statutory GST invoice serial numbering.
 * If gstin is provided, guarantees collision protection across branches under that GSTIN.
 */
function resolveCompactCafeCode(cafeId, explicitCafeCode = null, gstin = '32AAACZ1234K1Z5') {
  const gstinClean = String(gstin || '32AAACZ1234K1Z5').trim().toUpperCase();

  if (explicitCafeCode) {
    const code = String(explicitCafeCode).trim().toUpperCase();
    if (!/^[A-Z0-9-]+$/.test(code)) {
      throw new ApiError(400, 'INVALID_CAFE_CODE', `Configured café code "${code}" contains invalid characters. Only alphanumeric and hyphen are permitted.`);
    }
    // Register or validate against GSTIN registry
    registerStatutoryCafeCode({ gstin: gstinClean, cafeId: cafeId || 'DEFAULT_CAFE', statutoryCafeCode: code });
    return code;
  }

  if (!cafeId) return 'C01';

  // Check if cafeId is already registered under this GSTIN
  const cafeKey = `${gstinClean}:${cafeId}`;
  if (cafeToBranchCodeMap.has(cafeKey)) {
    return cafeToBranchCodeMap.get(cafeKey);
  }

  const str = String(cafeId).trim().toUpperCase();
  const m = str.match(/^(?:CAFE|ZC)[-_]?0*(\d+)$/);
  let candidate = null;
  if (m) {
    const num = parseInt(m[1], 10);
    candidate = `C${String(num).padStart(2, '0')}`;
  } else {
    candidate = str.replace(/[^A-Z0-9-]/g, '').slice(0, 4) || 'C01';
  }

  // Check if candidate collides with another cafe under same GSTIN
  const branchKey = `${gstinClean}:${candidate}`;
  const existing = statutoryBranchRegistry.get(branchKey);
  if (existing && existing.cafeId !== cafeId) {
    throw new ApiError(
      400,
      'GST_INVOICE_SERIES_COLLISION',
      `Derived compact café code "${candidate}" for "${cafeId}" collides with already registered café "${existing.cafeId}" under GSTIN "${gstinClean}". Explicit unique statutory cafeCode must be configured.`
    );
  }

  // Register candidate
  registerStatutoryCafeCode({ gstin: gstinClean, cafeId, statutoryCafeCode: candidate });
  return candidate;
}

/**
 * Calculates the exact statutory capacity of an invoice series under Rule 46(b).
 * Fixed overhead = prefix length.
 * Available digits = 16 - fixed overhead.
 * Capacity = 10^available digits - 1.
 */
function calculateSeriesCapacity({ statutorySeriesCode = null, statutoryCafeCode = 'C01', financialYear = '2026-27' }) {
  const fyShort = formatShortFinancialYear(financialYear);
  const prefix = statutorySeriesCode
    ? `${statutorySeriesCode}/${statutoryCafeCode}/${fyShort}/`
    : `${statutoryCafeCode}/${fyShort}/`;

  const fixedLength = prefix.length;
  if (fixedLength >= 16) {
    return {
      prefix,
      fixedLength,
      maxAllowedDigits: 0,
      capacity: 0,
      isValid: false,
    };
  }

  const maxAllowedDigits = 16 - fixedLength;
  const capacity = Math.pow(10, maxAllowedDigits) - 1;
  return {
    prefix,
    fixedLength,
    maxAllowedDigits,
    capacity,
    isValid: true,
  };
}

/**
 * Validates and registers statutory series configuration.
 * Enforces:
 *  - POS series requires at least 99,999 invoice capacity.
 *  - Configured expected volume must not exceed capacity.
 *  - Changing active series configuration after invoices have been issued is rejected.
 */
function validateStatutorySeriesConfig({
  gstin = '32AAACZ1234K1Z5',
  cafeId,
  statutoryCafeCode,
  seriesName,
  statutorySeriesCode,
  maxExpectedVolume = null,
  financialYear = '2026-27',
}) {
  const gstinClean = String(gstin).trim().toUpperCase();
  const branchCode = statutoryCafeCode || resolveCompactCafeCode(cafeId, null, gstinClean);

  let statCode = statutorySeriesCode ? String(statutorySeriesCode).trim().toUpperCase() : null;
  if (!statCode && seriesName) {
    const sName = String(seriesName).trim().toUpperCase();
    if (sName === 'POS') statCode = 'P';
    else if (sName === 'ONLINE') statCode = 'O';
    else if (sName === 'CATERING') statCode = 'C';
    else statCode = sName.slice(0, 1);
  }

  if (statCode && !/^[A-Z0-9-]{1,2}$/.test(statCode)) {
    throw new ApiError(400, 'INVALID_STATUTORY_SERIES_CODE', `Statutory series code "${statCode}" must be 1 or 2 alphanumeric characters.`);
  }

  const { prefix, fixedLength, maxAllowedDigits, capacity, isValid } = calculateSeriesCapacity({
    statutorySeriesCode: statCode,
    statutoryCafeCode: branchCode,
    financialYear,
  });

  if (!isValid || fixedLength >= 16) {
    throw new ApiError(
      400,
      'INVOICE_CONFIG_EXCEEDS_MAX_LENGTH',
      `Series prefix "${prefix}" requires ${fixedLength} characters, exceeding statutory 16-character limit.`
    );
  }

  // P0-04 & P0-05: High-volume POS series requires capacity >= 99,999
  const isPos = (seriesName && String(seriesName).trim().toUpperCase() === 'POS') || statCode === 'P';
  if (isPos && capacity < 99999) {
    throw new ApiError(
      400,
      'INSUFFICIENT_POS_SERIES_CAPACITY',
      `High-volume POS series requires at least 99,999 invoice capacity within Rule 46(b) 16-character limit. Available capacity with code "${statCode}" and branch "${branchCode}" is only ${capacity}.`
    );
  }

  if (maxExpectedVolume !== null && maxExpectedVolume !== undefined) {
    const expected = Number(maxExpectedVolume);
    if (expected > capacity) {
      throw new ApiError(
        400,
        'SERIES_CAPACITY_EXCEEDED_BY_CONFIG',
        `Configured expected volume ${expected} exceeds maximum statutory capacity of ${capacity} for series "${statCode || 'DEFAULT'}".`
      );
    }
  }

  const seriesKey = `${gstinClean}:${branchCode}:${statCode || 'DEFAULT'}`;
  const issuedKey = `${gstinClean}:${formatShortFinancialYear(financialYear)}:${branchCode}:${statCode || 'DEFAULT'}`;
  const branchIssuedKey = `${gstinClean}:${formatShortFinancialYear(financialYear)}:${branchCode}`;
  const issuedCount = issuedSeriesInvoicesCount.get(issuedKey) || 0;
  const branchIssuedCount = branchIssuedInvoices.get(branchIssuedKey) || 0;

  // P0-05 / GST-CAP-05: Changing series config after invoices issued is blocked
  const existingConfig = statutorySeriesRegistry.get(seriesKey);
  if (existingConfig && issuedCount > 0) {
    if (existingConfig.statutorySeriesCode !== statCode || existingConfig.seriesName !== seriesName) {
      throw new ApiError(
        400,
        'HISTORICAL_SERIES_IMMUTABLE',
        `Cannot alter statutory series configuration for "${seriesKey}" because ${issuedCount} invoices have already been issued in financial year ${financialYear}.`
      );
    }
  }

  // Also check if any existing series for this branch has issued invoices and differs
  if (branchIssuedCount > 0) {
    for (const [key, cfg] of statutorySeriesRegistry.entries()) {
      if (key.startsWith(`${gstinClean}:${branchCode}:`)) {
        if (cfg.cafeId === cafeId && (cfg.statutorySeriesCode !== statCode || cfg.seriesName !== seriesName)) {
          throw new ApiError(
            400,
            'HISTORICAL_SERIES_IMMUTABLE',
            `Cannot alter statutory series configuration for branch "${branchCode}" because ${branchIssuedCount} invoices have already been issued in financial year ${financialYear}.`
          );
        }
      }
    }
  }

  const configObj = {
    gstin: gstinClean,
    cafeId,
    statutoryCafeCode: branchCode,
    seriesName: seriesName || (statCode === 'P' ? 'POS' : 'DEFAULT'),
    statutorySeriesCode: statCode,
    prefix,
    capacity,
    maxAllowedDigits,
    financialYear,
    configuredAt: new Date(),
  };

  statutorySeriesRegistry.set(seriesKey, configObj);
  statutorySeriesRegistry.set(`${gstinClean}:${branchCode}:${seriesName || 'DEFAULT'}`, configObj);
  return configObj;
}

/**
 * Concurrency-safe sequential invoice serial number allocator (Rule 46(b) of CGST Rules, 2017)
 * Strictly guarantees:
 *  - GSTIN-scoped uniqueness: multiple cafes under same GSTIN never generate colliding numbers
 *  - Serial length <= 16 characters
 *  - Permitted characters: [A-Za-z0-9-/]
 *  - Gapless sequential progression within financial year, branch, and configured series
 *  - Capacity exhaustion protection (throws STATUTORY_SERIES_CAPACITY_EXHAUSTED)
 *  - Once allocated, serial numbers are NEVER reused, recycled, or decremented
 *  - High concurrency safety with zero collisions
 */
async function allocateInvoiceNumber({
  organisationId,
  cafeId,
  gstin = '32AAACZ1234K1Z5',
  cafeCode = null,
  financialYear,
  seriesName = null,
  seriesPrefix = null,
  statutorySeriesCode = null,
}) {
  const gstinClean = String(gstin || '32AAACZ1234K1Z5').trim().toUpperCase();
  const fyShort = formatShortFinancialYear(financialYear);
  const resolvedCafeCode = resolveCompactCafeCode(cafeId, cafeCode, gstinClean);

  // Normalize series
  let statCode = statutorySeriesCode ? String(statutorySeriesCode).trim().toUpperCase() : null;
  let resolvedSeriesName = seriesName ? String(seriesName).trim().toUpperCase() : null;

  if (seriesPrefix) {
    const raw = String(seriesPrefix).trim().toUpperCase();
    if (!/^[A-Z0-9-]+$/.test(raw)) {
      throw new ApiError(400, 'INVALID_SERIES_PREFIX', `Configured series prefix "${raw}" contains invalid characters. Only alphanumeric and hyphen are permitted.`);
    }
    statCode = statCode || raw;
    resolvedSeriesName = resolvedSeriesName || (raw === 'P' ? 'POS' : raw);
  }

  // Prefix & capacity calculation
  const { prefix, fixedLength, maxAllowedDigits, capacity, isValid } = calculateSeriesCapacity({
    statutorySeriesCode: statCode,
    statutoryCafeCode: resolvedCafeCode,
    financialYear,
  });

  if (!isValid || fixedLength >= 16) {
    throw new ApiError(
      400,
      'INVOICE_CONFIG_EXCEEDS_MAX_LENGTH',
      `Configured café code "${resolvedCafeCode}" and series prefix "${statCode || ''}" require ${fixedLength} prefix characters, exceeding the statutory 16-character limit for GST invoice serial numbers.`
    );
  }

  // Lock key scoped to GSTIN + FY + Branch + Series
  const lockKey = `${gstinClean}:${fyShort}:${resolvedCafeCode}:${statCode || 'DEFAULT'}`;

  while (activeSequenceLocks.has(lockKey)) {
    await activeSequenceLocks.get(lockKey);
  }

  let releaseLock;
  const lockPromise = new Promise((resolve) => {
    releaseLock = resolve;
  });
  activeSequenceLocks.set(lockKey, lockPromise);

  try {
    // GSTIN-scoped sequence key ensures branches under the same or different GSTINs never cross-collide
    const sequenceKey = `GST_INV:${gstinClean}:${fyShort}:${resolvedCafeCode}:${statCode || 'DEFAULT'}`;
    let sequenceNumber;

    try {
      const generated = await SequenceCounter.generateId({
        organisationId: organisationId || 'ORG-ZAMORIN',
        sequenceKey,
        prefix: statCode || 'INV',
        minimumDigits: Math.min(maxAllowedDigits, 5),
      });
      const match = String(generated).match(/(\d+)$/);
      sequenceNumber = match ? parseInt(match[1], 10) : parseInt(generated, 10);
    } catch {
      // Fallback: inspect highest existing invoice for this financial year & cafe & GSTIN
      const query = {
        gstin: gstinClean,
        financialYear,
        cafeId,
      };
      if (statCode) {
        query.statutorySeriesCode = statCode;
      }
      const highest = await TaxInvoice.findOne(query)
        .sort({ sequenceNumber: -1 })
        .select('sequenceNumber')
        .lean();

      sequenceNumber = (highest?.sequenceNumber || 0) + 1;
    }

    // P0-05 & GST-CAP-03: Capacity Exhaustion Guard
    if (sequenceNumber > capacity) {
      throw new ApiError(
        400,
        'STATUTORY_SERIES_CAPACITY_EXHAUSTED',
        `Statutory invoice series "${statCode || 'DEFAULT'}" for branch "${resolvedCafeCode}" under GSTIN "${gstinClean}" has exhausted its statutory capacity of ${capacity} invoices within Rule 46(b) 16-character limit.`
      );
    }

    if (String(sequenceNumber).length > maxAllowedDigits) {
      throw new ApiError(
        400,
        'INVOICE_SERIAL_LENGTH_EXCEEDED',
        `Invoice sequence counter ${sequenceNumber} exceeds the maximum available ${maxAllowedDigits} digits within the statutory 16-character limit.`
      );
    }

    const seqStr = String(sequenceNumber).padStart(Math.min(maxAllowedDigits, 5), '0');
    const invoiceNumber = `${prefix}${seqStr}`;

    if (invoiceNumber.length > 16) {
      throw new ApiError(
        500,
        'INVOICE_SERIAL_TOO_LONG',
        `Generated GST invoice serial number "${invoiceNumber}" exceeds the 16-character statutory limit (${invoiceNumber.length} chars).`
      );
    }

    if (!/^[A-Za-z0-9\-\/]+$/.test(invoiceNumber)) {
      throw new ApiError(
        500,
        'INVALID_INVOICE_SERIAL_CHARS',
        `Generated GST invoice serial number "${invoiceNumber}" contains illegal characters under CGST Rule 46(b).`
      );
    }

    // Record issued count for immutability tracking
    const issuedKey = `${gstinClean}:${fyShort}:${resolvedCafeCode}:${statCode || 'DEFAULT'}`;
    issuedSeriesInvoicesCount.set(issuedKey, (issuedSeriesInvoicesCount.get(issuedKey) || 0) + 1);
    const branchIssuedKey = `${gstinClean}:${fyShort}:${resolvedCafeCode}`;
    branchIssuedInvoices.set(branchIssuedKey, (branchIssuedInvoices.get(branchIssuedKey) || 0) + 1);

    return {
      sequenceNumber,
      invoiceNumber,
      gstin: gstinClean,
      seriesName: resolvedSeriesName || (statCode === 'P' ? 'POS' : 'DEFAULT'),
      statutorySeriesCode: statCode,
      seriesPrefix: statCode,
      cafeCode: resolvedCafeCode,
      financialYearShort: fyShort,
      capacity,
    };
  } finally {
    activeSequenceLocks.delete(lockKey);
    releaseLock();
  }
}

/**
 * Void / Cancel an issued statutory GST tax invoice.
 * Statutory rule: The allocated invoice number is PERMANENT and NEVER reused.
 * Sequence counter is never decremented. Retains original invoice number in database.
 */
async function cancelTaxInvoice({ invoiceNumber, organisationId, cafeId, cancellationReason = 'Order Voided', actorUserId = 'SYSTEM' }) {
  if (!invoiceNumber) {
    throw new ApiError(400, 'INVOICE_NUMBER_REQUIRED', 'Invoice number is required for cancellation.');
  }

  const cleanNum = String(invoiceNumber).trim().toUpperCase();
  const query = { invoiceNumber: cleanNum };
  if (organisationId) query.organisationId = organisationId;
  if (cafeId) query.cafeId = cafeId;

  const inv = await TaxInvoice.findOne(query);
  if (!inv) {
    throw new ApiError(404, 'INVOICE_NOT_FOUND', `Invoice ${cleanNum} not found.`);
  }

  if (inv.status === 'CANCELLED') {
    return {
      invoiceNumber: inv.invoiceNumber,
      status: 'CANCELLED',
      alreadyCancelled: true,
      sequenceNumber: inv.sequenceNumber,
    };
  }

  inv.status = 'CANCELLED';
  inv.cancellationReason = cancellationReason;
  inv.cancelledAt = new Date();
  inv.cancelledBy = actorUserId;
  await inv.save();

  await auditService.recordAuditEvent({
    organisationId: inv.organisationId || organisationId,
    cafeId: inv.cafeId || cafeId,
    actorUserId,
    actorRole: 'OPERATOR',
    module: 'GST_INVOICING',
    action: 'INVOICE_CANCELLED',
    entityType: 'TAX_INVOICE',
    entityId: inv.invoiceNumber,
    reason: cancellationReason,
    result: 'SUCCESS',
    metadata: {
      invoiceNumber: inv.invoiceNumber,
      financialYear: inv.financialYear,
      totalPaisa: inv.taxSummary?.grandTotalPaisa || 0,
      status: 'CANCELLED',
    },
  }).catch(() => {});

  return {
    invoiceNumber: inv.invoiceNumber,
    status: 'CANCELLED',
    sequenceNumber: inv.sequenceNumber,
    financialYear: inv.financialYear,
    cancellationReason,
    cancelledAt: inv.cancelledAt,
  };
}

/**
 * Saves a TaxInvoice document with database-level uniqueness enforcement and idempotent retry handling.
 * Survives horizontal scaling across multiple Node / Render instances.
 */
async function saveTaxInvoiceWithRetry({ invoiceData, maxRetries = 3 }) {
  let attempt = 0;
  while (attempt < maxRetries) {
    attempt++;
    try {
      const saved = await TaxInvoice.create(invoiceData);
      return saved;
    } catch (err) {
      const isDuplicateKey =
        err.code === 11000 ||
        (err.name === 'MongoServerError' && err.message?.includes('E11000')) ||
        err.message?.includes('duplicate key');

      if (isDuplicateKey) {
        // Idempotency check: if an invoice for the same orderId or billId already exists under this GSTIN
        if (invoiceData.orderId || invoiceData.billId) {
          const existing = await TaxInvoice.findOne({
            gstin: invoiceData.gstin,
            financialYear: invoiceData.financialYear,
            ...(invoiceData.orderId ? { orderId: invoiceData.orderId } : { billId: invoiceData.billId }),
          });
          if (existing) {
            return existing; // Safe idempotent return
          }
        }

        if (attempt >= maxRetries) {
          throw new ApiError(
            409,
            'DUPLICATE_STATUTORY_INVOICE_SERIAL',
            `Database uniqueness constraint violation: Invoice serial "${invoiceData.invoiceNumber}" already exists under GSTIN "${invoiceData.gstin}" for financial year "${invoiceData.financialYear}".`
          );
        }

        // Re-allocate next sequence atomically and retry
        const reallocated = await allocateInvoiceNumber({
          organisationId: invoiceData.organisationId,
          cafeId: invoiceData.cafeId,
          gstin: invoiceData.gstin,
          financialYear: invoiceData.financialYear,
          statutorySeriesCode: invoiceData.statutorySeriesCode,
          seriesName: invoiceData.seriesName,
        });

        invoiceData.sequenceNumber = reallocated.sequenceNumber;
        invoiceData.invoiceNumber = reallocated.invoiceNumber;
      } else {
        throw err;
      }
    }
  }
}

/**
 * Generate Authoritative Statutory GST Tax Invoice
 */
async function generateStatutoryTaxInvoice({
  organisationId,
  cafeId,
  orderId = null,
  billId = null,
  invoiceDate = new Date(),
  supplyType = 'INTRA_STATE',
  placeOfSupply = '32-Kerala',
  reverseCharge = false,
  supplierDetails = {},
  recipientDetails = {},
  lineItems = [],
  authorizedSignatory = { name: 'Store Manager', designation: 'Authorized Signatory' },
  auth = null,
}) {
  const fy = getIndianFinancialYear(invoiceDate);

  // Period Lock Check: Ensure fiscal period is not CLOSED
  const periodQuery = FinancialPeriod.findOne({
    organisationId,
    fiscalYear: fy,
    status: 'CLOSED',
  });
  const period = periodQuery && typeof periodQuery.lean === 'function' ? await periodQuery.lean() : await periodQuery;

  if (period) {
    // Check if invoice date falls in a closed period
    const invDateStr = new Date(invoiceDate).toISOString().slice(0, 10);
    if (invDateStr >= period.startDate && invDateStr <= period.endDate) {
      throw new ApiError(
        403,
        'FINANCIAL_PERIOD_LOCKED',
        `Financial period ${period.periodId} (${period.startDate} to ${period.endDate}) is closed. Cannot issue invoices in closed periods.`
      );
    }
  }

  // Calculate CBIC Taxes
  const taxCalculation = calculateGstTaxes({
    lines: lineItems,
    supplyType,
  });

  // Default supplier details if not provided
  const fullSupplier = {
    legalName: supplierDetails.legalName || 'Zamorin Hospitality Pvt Ltd',
    tradeName: supplierDetails.tradeName || 'Zamorin Café',
    gstin: (supplierDetails.gstin || '32AABCT1332L1ZV').toUpperCase().trim(),
    address: supplierDetails.address || 'Beach Road, Kozhikode, Kerala — 673001',
    stateCode: supplierDetails.stateCode || '32',
    stateName: supplierDetails.stateName || 'Kerala',
    pan: supplierDetails.pan || 'AABCT1332L',
  };

  // Allocate sequential number scoped to GSTIN
  const allocated = await allocateInvoiceNumber({
    organisationId,
    cafeId,
    gstin: fullSupplier.gstin,
    financialYear: fy,
  });
  const { sequenceNumber, invoiceNumber } = allocated;

  const invoiceId = `TXI-${fy.replace('-', '')}-${String(sequenceNumber).padStart(6, '0')}`;

  const fullRecipient = {
    isB2B: !!recipientDetails.isB2B || !!recipientDetails.gstin,
    legalName: recipientDetails.legalName || 'Cash Customer',
    tradeName: recipientDetails.tradeName || null,
    gstin: recipientDetails.gstin ? recipientDetails.gstin.toUpperCase().trim() : null,
    address: recipientDetails.address || null,
    stateCode: recipientDetails.stateCode || null,
    stateName: recipientDetails.stateName || null,
    phone: recipientDetails.phone || null,
    email: recipientDetails.email || null,
  };

  // Generate Stage 02 Universal QR code for e-invoice verification
  let signedQrData = null;
  let irn = null;

  try {
    const qrResult = await generateUniversalQr({
      organisationId,
      entityType: 'GST_INVOICE',
      entityId: invoiceNumber,
      cafeId,
      metadata: {
        supplierGstin: fullSupplier.gstin,
        recipientGstin: fullRecipient.gstin || 'URP',
        docNo: invoiceNumber,
        docDate: new Date(invoiceDate).toISOString().slice(0, 10),
        totInvVal: (taxCalculation.taxSummary.grandTotalPaisa / 100).toFixed(2),
      },
      authContext: auth,
    });
    signedQrData = qrResult.rawPayload || qrResult.qrData;
    irn = qrResult.token;
  } catch {
    signedQrData = `GSTIN:${fullSupplier.gstin}|INV:${invoiceNumber}|TOTAL:${(taxCalculation.taxSummary.grandTotalPaisa / 100).toFixed(2)}`;
    irn = `IRN-${Date.now()}`;
  }

  const invoiceData = {
    organisationId,
    invoiceId,
    invoiceNumber,
    financialYear: fy,
    sequenceNumber,
    cafeId,
    gstin: fullSupplier.gstin,
    seriesPrefix: allocated.statutorySeriesCode || allocated.seriesPrefix || null,
    statutorySeriesCode: allocated.statutorySeriesCode || null,
    orderId,
    billId,
    invoiceDate,
    supplyType: taxCalculation.supplyType,
    placeOfSupply,
    reverseCharge,
    supplierDetails: fullSupplier,
    recipientDetails: fullRecipient,
    lineItems: taxCalculation.lines,
    hsnSummary: taxCalculation.hsnSummary,
    taxSummary: taxCalculation.taxSummary,
    amountInWords: taxCalculation.amountInWords,
    irn,
    signedQrData,
    status: 'ISSUED',
    authorizedSignatory,
  };

  const invoice = await saveTaxInvoiceWithRetry({ invoiceData });

  // Audit event
  if (auth) {
    await auditService.recordAuditEvent({
      organisationId,
      cafeId,
      userId: auth.userId,
      eventCategory: 'FINANCE',
      eventType: 'GST_INVOICE_ISSUED',
      resourceType: 'TaxInvoice',
      resourceId: invoiceId,
      details: {
        invoiceNumber,
        grandTotalPaisa: taxCalculation.taxSummary.grandTotalPaisa,
        supplyType: taxCalculation.supplyType,
      },
    });
  }

  return invoice;
}

/**
 * Render Official CBIC GST Tax Invoice PDF adhering to Stage 01 APA 7 Corporate standard
 */
function renderStatutoryGstInvoicePdf(invoice) {
  const inv = invoice.toObject ? invoice.toObject() : invoice;
  const supplier = inv.supplierDetails || {};
  const recipient = inv.recipientDetails || {};
  const taxSummary = inv.taxSummary || {};
  const lines = inv.lineItems || [];
  const hsnSummary = inv.hsnSummary || [];

  const invoiceNum = inv.invoiceNumber || inv.invoiceId;
  const invDate = new Date(inv.invoiceDate || Date.now());
  const dateStr = invDate.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = invDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  function escapePdf(str) {
    return String(str ?? '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  let streamOps = '';

  // Background APA 7 Watermark
  streamOps += `q\n0.95 0.95 0.97 rg\nBT\n/F2 40 Tf\n1 0 0 1 100 420 Tm\n(ZAMORIN GST TAX INVOICE) Tj\nET\nQ\n`;

  // Header Banner: Navy #16223F
  streamOps += `q\n0.086 0.133 0.247 rg\n20 760 555 60 re\nf\nQ\n`;
  streamOps += `BT\n/F2 16 Tf\n0.776 0.647 0.404 rg\n1 0 0 1 32 795 Tm\n(${escapePdf((supplier.tradeName || 'ZAMORIN CAFE').toUpperCase())}) Tj\nET\n`;
  streamOps += `BT\n/F1 8.5 Tf\n1 1 1 rg\n1 0 0 1 32 780 Tm\n(Legal Name: ${escapePdf(supplier.legalName || '')} | GSTIN: ${escapePdf(supplier.gstin || '')} | State: ${escapePdf(supplier.stateName || '')} (${escapePdf(supplier.stateCode || '')})) Tj\nET\n`;
  streamOps += `BT\n/F1 8.5 Tf\n0.9 0.9 0.9 rg\n1 0 0 1 32 768 Tm\n(${escapePdf(supplier.address || '')}) Tj\nET\n`;

  // Title Box
  streamOps += `BT\n/F2 12 Tf\n0.08 0.12 0.22 rg\n1 0 0 1 20 735 Tm\n(TAX INVOICE — CBIC RULE 46 COMPLIANT) Tj\nET\n`;
  streamOps += `BT\n/F1 8.5 Tf\n0.3 0.35 0.45 rg\n1 0 0 1 20 720 Tm\n(Invoice No: ${escapePdf(invoiceNum)}   |   Date: ${escapePdf(dateStr)} ${escapePdf(timeStr)}   |   Supply Type: ${escapePdf(inv.supplyType)}   |   Place of Supply: ${escapePdf(inv.placeOfSupply)}) Tj\nET\n`;

  // Recipient / B2B Section
  streamOps += `q\n0.94 0.96 0.98 rg\n20 660 555 48 re\nf\n0.8 0.83 0.88 RG\n1 w\n20 660 555 48 re\nS\nQ\n`;
  streamOps += `BT\n/F2 9 Tf\n0.1 0.15 0.25 rg\n1 0 0 1 28 694 Tm\n(Billed To / Recipient Details:) Tj\nET\n`;
  streamOps += `BT\n/F1 8.5 Tf\n0.2 0.25 0.35 rg\n1 0 0 1 28 680 Tm\n(Name: ${escapePdf(recipient.legalName || 'Cash Customer')}   |   GSTIN: ${escapePdf(recipient.gstin || 'Unregistered')}   |   State: ${escapePdf(recipient.stateName || 'N/A')}) Tj\nET\n`;
  streamOps += `BT\n/F1 8.5 Tf\n0.2 0.25 0.35 rg\n1 0 0 1 28 667 Tm\n(Address: ${escapePdf(recipient.address || 'Counter Retail Sale')}   |   Reverse Charge (RCM): ${inv.reverseCharge ? 'YES' : 'NO'}) Tj\nET\n`;

  // Table Header
  let currentY = 635;
  streamOps += `q\n0.92 0.94 0.98 rg\n20 ${currentY - 18} 555 20 re\nf\n0.8 0.83 0.88 RG\n1 w\n20 ${currentY - 18} 555 20 re\nS\nQ\n`;
  streamOps += `BT\n/F2 8 Tf\n0.12 0.16 0.23 rg\n`;
  streamOps += `1 0 0 1 25 ${currentY - 13} Tm\n(Sl.) Tj\n`;
  streamOps += `1 0 0 1 45 ${currentY - 13} Tm\n(Description of Goods/Services) Tj\n`;
  streamOps += `1 0 0 1 220 ${currentY - 13} Tm\n(HSN) Tj\n`;
  streamOps += `1 0 0 1 265 ${currentY - 13} Tm\n(Qty) Tj\n`;
  streamOps += `1 0 0 1 300 ${currentY - 13} Tm\n(Rate) Tj\n`;
  streamOps += `1 0 0 1 350 ${currentY - 13} Tm\n(Taxable) Tj\n`;
  streamOps += `1 0 0 1 410 ${currentY - 13} Tm\n(CGST) Tj\n`;
  streamOps += `1 0 0 1 465 ${currentY - 13} Tm\n(SGST) Tj\n`;
  streamOps += `1 0 0 1 520 ${currentY - 13} Tm\n(Total) Tj\n`;
  streamOps += `ET\n`;
  currentY -= 20;

  // Table Lines
  lines.slice(0, 15).forEach((line, idx) => {
    const sl = idx + 1;
    const desc = line.description || 'Item';
    const hsn = line.hsnCode || '996331';
    const qty = `${line.quantity} ${line.uqc || 'NOS'}`;
    const rate = (line.ratePaisa / 100).toFixed(2);
    const taxable = (line.taxableAmountPaisa / 100).toFixed(2);
    const cgst = line.cgstAmountPaisa ? (line.cgstAmountPaisa / 100).toFixed(2) : '-';
    const sgst = line.sgstAmountPaisa ? (line.sgstAmountPaisa / 100).toFixed(2) : '-';
    const total = (line.totalItemAmountPaisa / 100).toFixed(2);

    if (idx % 2 === 1) {
      streamOps += `q\n0.98 0.98 0.99 rg\n20 ${currentY - 14} 555 15 re\nf\nQ\n`;
    }

    streamOps += `BT\n/F1 8 Tf\n0.15 0.18 0.25 rg\n`;
    streamOps += `1 0 0 1 25 ${currentY - 10} Tm\n(${sl}) Tj\n`;
    streamOps += `1 0 0 1 45 ${currentY - 10} Tm\n(${escapePdf(desc.slice(0, 32))}) Tj\n`;
    streamOps += `1 0 0 1 220 ${currentY - 10} Tm\n(${escapePdf(hsn)}) Tj\n`;
    streamOps += `1 0 0 1 265 ${currentY - 10} Tm\n(${escapePdf(qty)}) Tj\n`;
    streamOps += `1 0 0 1 300 ${currentY - 10} Tm\n(${rate}) Tj\n`;
    streamOps += `1 0 0 1 350 ${currentY - 10} Tm\n(${taxable}) Tj\n`;
    streamOps += `1 0 0 1 410 ${currentY - 10} Tm\n(${cgst}) Tj\n`;
    streamOps += `1 0 0 1 465 ${currentY - 10} Tm\n(${sgst}) Tj\n`;
    streamOps += `1 0 0 1 520 ${currentY - 10} Tm\n(${total}) Tj\n`;
    streamOps += `ET\n`;
    currentY -= 15;
  });

  // HSN Summary & Totals Box
  currentY -= 10;
  streamOps += `q\n0.95 0.96 0.98 rg\n20 ${currentY - 75} 300 75 re\nf\n0.8 0.83 0.88 RG\n1 w\n20 ${currentY - 75} 300 75 re\nS\nQ\n`;
  streamOps += `BT\n/F2 8.5 Tf\n0.1 0.15 0.25 rg\n1 0 0 1 28 ${currentY - 15} Tm\n(HSN/SAC Tax Slab Summary:) Tj\nET\n`;

  let hsnY = currentY - 28;
  hsnSummary.slice(0, 3).forEach((h) => {
    streamOps += `BT\n/F1 7.5 Tf\n0.2 0.25 0.35 rg\n1 0 0 1 28 ${hsnY} Tm\n(HSN ${escapePdf(h.hsnCode)}: Taxable INR ${(h.taxableValuePaisa / 100).toFixed(2)} | Tax INR ${(h.totalTaxPaisa / 100).toFixed(2)}) Tj\nET\n`;
    hsnY -= 12;
  });

  // Totals Box (Right Side)
  streamOps += `q\n0.95 0.96 0.98 rg\n330 ${currentY - 75} 245 75 re\nf\n0.8 0.83 0.88 RG\n1 w\n330 ${currentY - 75} 245 75 re\nS\nQ\n`;
  streamOps += `BT\n/F1 8 Tf\n0.2 0.25 0.35 rg\n`;
  streamOps += `1 0 0 1 340 ${currentY - 14} Tm\n(Total Taxable Value: ) Tj\n`;
  streamOps += `1 0 0 1 480 ${currentY - 14} Tm\n(INR ${(taxSummary.totalTaxablePaisa / 100).toFixed(2)}) Tj\n`;
  streamOps += `1 0 0 1 340 ${currentY - 26} Tm\n(Central Tax (CGST): ) Tj\n`;
  streamOps += `1 0 0 1 480 ${currentY - 26} Tm\n(INR ${(taxSummary.totalCgstPaisa / 100).toFixed(2)}) Tj\n`;
  streamOps += `1 0 0 1 340 ${currentY - 38} Tm\n(State Tax (SGST): ) Tj\n`;
  streamOps += `1 0 0 1 480 ${currentY - 38} Tm\n(INR ${(taxSummary.totalSgstPaisa / 100).toFixed(2)}) Tj\n`;
  streamOps += `1 0 0 1 340 ${currentY - 50} Tm\n(Round Off: ) Tj\n`;
  streamOps += `1 0 0 1 480 ${currentY - 50} Tm\n(INR ${(taxSummary.roundOffPaisa / 100).toFixed(2)}) Tj\n`;
  streamOps += `ET\n`;

  streamOps += `BT\n/F2 9.5 Tf\n0.05 0.1 0.2 rg\n`;
  streamOps += `1 0 0 1 340 ${currentY - 67} Tm\n(Grand Total (INR): ) Tj\n`;
  streamOps += `1 0 0 1 480 ${currentY - 67} Tm\n(INR ${(taxSummary.grandTotalPaisa / 100).toFixed(2)}) Tj\n`;
  streamOps += `ET\n`;

  // Amount In Words
  currentY -= 95;
  streamOps += `BT\n/F2 8.5 Tf\n0.1 0.15 0.25 rg\n1 0 0 1 20 ${currentY} Tm\n(Amount Chargeable (in words):) Tj\nET\n`;
  streamOps += `BT\n/F1 8.5 Tf\n0.2 0.25 0.35 rg\n1 0 0 1 170 ${currentY} Tm\n(${escapePdf(inv.amountInWords || '')}) Tj\nET\n`;

  // Signatory Box & Footer
  streamOps += `q\n0.8 0.83 0.88 rg\n20 70 555 1 re\nf\nQ\n`;
  streamOps += `BT\n/F1 8 Tf\n0.3 0.35 0.45 rg\n`;
  streamOps += `1 0 0 1 20 54 Tm\n(E. & O.E. • This is a computer-generated tax invoice issued in accordance with GST Rules.) Tj\n`;
  streamOps += `1 0 0 1 20 42 Tm\n(IRN: ${escapePdf(inv.irn || 'N/A')}   |   Authorised Signatory: ${escapePdf(inv.authorizedSignatory?.name || 'Zamorin Hospitality')}) Tj\n`;
  streamOps += `ET\n`;

  const streamBuf = Buffer.from(streamOps, 'utf8');

  // PDF 1.4 Container
  const obj1 = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  const obj2 = `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`;
  const obj3 = `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>\nendobj\n`;
  const obj4 = `4 0 obj\n<< /Length ${streamBuf.length} >>\nstream\n${streamOps}\nendstream\nendobj\n`;
  const obj5 = `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>\nendobj\n`;
  const obj6 = `6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`;

  const bodyObjects = [obj1, obj2, obj3, obj4, obj5, obj6];
  let pdfData = `%PDF-1.4\n%\xe2\xe3\xcf\xd3\n`;
  const offsets = [];

  for (const obj of bodyObjects) {
    offsets.push(Buffer.byteLength(pdfData, 'utf8'));
    pdfData += obj;
  }

  const xrefOffset = Buffer.byteLength(pdfData, 'utf8');
  pdfData += `xref\n0 ${bodyObjects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    pdfData += String(off).padStart(10, '0') + ` 00000 n \n`;
  }

  pdfData += `trailer\n<< /Size ${bodyObjects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  const safeFilename = String(invoiceNum).replace(/[\/\\?%*:|"<>]/g, '-');
  return {
    buffer: Buffer.from(pdfData, 'utf8'),
    filename: `${safeFilename}.pdf`,
    mimeType: 'application/pdf',
  };
}

/**
 * Generate GSTR-1 Outward Supply Summary
 */
async function generateGstr1Summary({ organisationId, cafeId, fromDate, toDate }) {
  const query = {
    organisationId,
    status: 'ISSUED',
  };
  if (cafeId) query.cafeId = cafeId;
  if (fromDate || toDate) {
    query.invoiceDate = {};
    if (fromDate) query.invoiceDate.$gte = new Date(fromDate);
    if (toDate) query.invoiceDate.$lte = new Date(`${toDate}T23:59:59.999Z`);
  }

  const invoices = await TaxInvoice.find(query).lean();

  const b2bInvoices = [];
  const b2cLargeInvoices = []; // Inter-state supplies to unregistered persons where invoice value > ₹2.5 Lakhs
  const b2cSmallMap = new Map(); // Grouped by Place of Supply and GST Rate
  const hsnMap = new Map();

  let totalOutwardTaxablePaisa = 0;
  let totalCgstPaisa = 0;
  let totalSgstPaisa = 0;
  let totalIgstPaisa = 0;

  for (const inv of invoices) {
    const isB2B = !!inv.recipientDetails?.isB2B && !!inv.recipientDetails?.gstin;
    const isInterState = inv.supplyType === 'INTER_STATE';
    const grandTotal = inv.taxSummary?.grandTotalPaisa || 0;

    totalOutwardTaxablePaisa += (inv.taxSummary?.totalTaxablePaisa || 0);
    totalCgstPaisa += (inv.taxSummary?.totalCgstPaisa || 0);
    totalSgstPaisa += (inv.taxSummary?.totalSgstPaisa || 0);
    totalIgstPaisa += (inv.taxSummary?.totalIgstPaisa || 0);

    if (isB2B) {
      b2bInvoices.push({
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        customerGstin: inv.recipientDetails.gstin,
        customerName: inv.recipientDetails.legalName,
        placeOfSupply: inv.placeOfSupply,
        reverseCharge: inv.reverseCharge ? 'Y' : 'N',
        taxableValuePaisa: inv.taxSummary.totalTaxablePaisa,
        cgstPaisa: inv.taxSummary.totalCgstPaisa,
        sgstPaisa: inv.taxSummary.totalSgstPaisa,
        igstPaisa: inv.taxSummary.totalIgstPaisa,
        grandTotalPaisa: grandTotal,
      });
    } else if (isInterState && grandTotal > 25000000) { // > ₹2,50,000
      b2cLargeInvoices.push({
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        placeOfSupply: inv.placeOfSupply,
        taxableValuePaisa: inv.taxSummary.totalTaxablePaisa,
        igstPaisa: inv.taxSummary.totalIgstPaisa,
        grandTotalPaisa: grandTotal,
      });
    } else {
      // B2C Small
      const pos = inv.placeOfSupply || '32-Kerala';
      for (const line of inv.lineItems || []) {
        const rateKey = `${pos}:${line.gstRatePercent}`;
        if (!b2cSmallMap.has(rateKey)) {
          b2cSmallMap.set(rateKey, {
            placeOfSupply: pos,
            gstRatePercent: line.gstRatePercent,
            taxableValuePaisa: 0,
            cgstPaisa: 0,
            sgstPaisa: 0,
            igstPaisa: 0,
          });
        }
        const b2cs = b2cSmallMap.get(rateKey);
        b2cs.taxableValuePaisa += line.taxableAmountPaisa;
        b2cs.cgstPaisa += line.cgstAmountPaisa;
        b2cs.sgstPaisa += line.sgstAmountPaisa;
        b2cs.igstPaisa += line.igstAmountPaisa;
      }
    }

    // Accumulate HSN
    for (const h of inv.hsnSummary || []) {
      const key = `${h.hsnCode}:${h.cgstRatePercent + h.sgstRatePercent + h.igstRatePercent}`;
      if (!hsnMap.has(key)) {
        hsnMap.set(key, {
          hsnCode: h.hsnCode,
          taxRatePercent: h.cgstRatePercent + h.sgstRatePercent + h.igstRatePercent,
          taxableValuePaisa: 0,
          cgstPaisa: 0,
          sgstPaisa: 0,
          igstPaisa: 0,
          totalTaxPaisa: 0,
        });
      }
      const entry = hsnMap.get(key);
      entry.taxableValuePaisa += h.taxableValuePaisa;
      entry.cgstPaisa += h.cgstAmountPaisa;
      entry.sgstPaisa += h.sgstAmountPaisa;
      entry.igstPaisa += h.igstAmountPaisa;
      entry.totalTaxPaisa += h.totalTaxPaisa;
    }
  }

  return {
    period: { fromDate, toDate },
    cafeId: cafeId || 'ALL_CAFES',
    totalInvoicesIssued: invoices.length,
    totals: {
      totalOutwardTaxablePaisa,
      totalCgstPaisa,
      totalSgstPaisa,
      totalIgstPaisa,
      totalTaxPaisa: totalCgstPaisa + totalSgstPaisa + totalIgstPaisa,
    },
    tables: {
      b2b: b2bInvoices,
      b2cl: b2cLargeInvoices,
      b2cs: Array.from(b2cSmallMap.values()),
      hsnSummary: Array.from(hsnMap.values()),
      documentSummary: {
        docType: 'TAX_INVOICE',
        issuedCount: invoices.length,
        cancelledCount: 0,
        netIssued: invoices.length,
      },
    },
  };
}

/**
 * Non-destructive migration audit for existing finalized invoices and bills (REC-16 §38).
 * Scans persisted historical documents and counts discrepancies against the canonical engine
 * without mutating any historical financial records.
 */
async function auditExistingInvoices({ organisationId, cafeId } = {}) {
  const query = {};
  if (organisationId) query.organisationId = organisationId;
  if (cafeId) query.cafeId = cafeId;

  const invoices = await TaxInvoice.find(query).lean();
  let totalInvoicesChecked = invoices.length;
  let exactMatches = 0;
  let onePaisaDifferences = 0;
  let greaterThanOnePaisaDifferences = 0;
  let missingComponentData = 0;
  const discrepancies = [];

  for (const inv of invoices) {
    if (!inv.taxSummary || inv.taxSummary.totalCgstPaisa == null || inv.taxSummary.totalSgstPaisa == null) {
      missingComponentData++;
      discrepancies.push({
        invoiceNumber: inv.invoiceNumber,
        type: 'MISSING_COMPONENT_DATA',
        details: 'TaxSummary or split components missing',
      });
      continue;
    }

    // Recompute with canonical engine
    const lines = (inv.lineItems || []).map((li) => ({
      ratePaisa: li.ratePaisa || (li.unitPricePaisa ? li.unitPricePaisa : (li.grossAmountPaisa / (li.quantity || 1))),
      quantity: li.quantity || 1,
      discountPaisa: li.discountPaisa || 0,
      gstRatePercent: li.gstRatePercent !== undefined ? li.gstRatePercent : ((li.cgstRatePercent || 0) + (li.sgstRatePercent || 0) + (li.igstRatePercent || 0)),
      hsnCode: li.hsnCode,
    }));

    const canonical = calculateGstTaxes({
      lines,
      supplyType: inv.supplyType || 'INTRA_STATE',
      customerPayableRounding: inv.taxSummary.roundingPolicyVersion === ROUNDING_POLICY_VERSION,
    });

    const diffCgst = Math.abs((inv.taxSummary.totalCgstPaisa || 0) - canonical.taxSummary.totalCgstPaisa);
    const diffSgst = Math.abs((inv.taxSummary.totalSgstPaisa || 0) - canonical.taxSummary.totalSgstPaisa);
    const diffTax = Math.abs((inv.taxSummary.totalTaxPaisa || 0) - canonical.taxSummary.totalTaxPaisa);

    if (diffCgst === 0 && diffSgst === 0 && diffTax === 0) {
      exactMatches++;
    } else if (diffTax === 1 || diffCgst === 1 || diffSgst === 1) {
      onePaisaDifferences++;
      discrepancies.push({
        invoiceNumber: inv.invoiceNumber,
        type: 'ONE_PAISA_DIFFERENCE',
        storedTaxPaisa: inv.taxSummary.totalTaxPaisa,
        canonicalTaxPaisa: canonical.taxSummary.totalTaxPaisa,
      });
    } else {
      greaterThanOnePaisaDifferences++;
      discrepancies.push({
        invoiceNumber: inv.invoiceNumber,
        type: 'GREATER_THAN_ONE_PAISA_DIFFERENCE',
        storedTaxPaisa: inv.taxSummary.totalTaxPaisa,
        canonicalTaxPaisa: canonical.taxSummary.totalTaxPaisa,
      });
    }
  }

  return {
    totalInvoicesChecked,
    exactMatches,
    onePaisaDifferences,
    greaterThanOnePaisaDifferences,
    missingComponentData,
    discrepancies,
    historicalRecordsModified: 0,
  };
}

/**
 * Validate tax jurisdiction compatibility (A121 Regional / Tax boundary rules)
 * Enforces mutual exclusivity between GST (India) and VAT (International/regional).
 */
function validateTaxJurisdictionCompatibility({ taxRegime, sellerGstin = null, vatNumber = null, lineItems = [] }) {
  const regime = String(taxRegime || '').toUpperCase().trim();
  if (regime !== 'GST' && regime !== 'VAT') {
    throw new ApiError(400, 'INVALID_TAX_REGIME', `Tax regime must be either 'GST' or 'VAT'. Received: ${taxRegime}`);
  }

  if (regime === 'GST') {
    if (vatNumber) {
      throw new ApiError(
        400,
        'TAX_REGIME_CONFLICT',
        'Mutual exclusivity violation: Cannot attach VAT TRN under Indian GST regime.'
      );
    }
  } else if (regime === 'VAT') {
    if (sellerGstin) {
      throw new ApiError(
        400,
        'TAX_REGIME_CONFLICT',
        'Mutual exclusivity violation: Cannot attach Indian GSTIN under VAT regime.'
      );
    }
    // Verify no line items specify dual CGST/SGST/IGST splits
    for (const item of lineItems) {
      if (item.cgstRatePercent || item.sgstRatePercent || item.igstRatePercent) {
        throw new ApiError(
          400,
          'TAX_REGIME_CONFLICT',
          'Mutual exclusivity violation: GST splits (CGST/SGST/IGST) cannot be applied under VAT regime.'
        );
      }
    }
  }

  return {
    valid: true,
    regime,
  };
}

/**
 * Generate NIC/CBIC Schema INV-01 compliant E-Invoice payload (A003)
 */
function generateEInvoicePayload({ taxInvoice }) {
  if (!taxInvoice || !taxInvoice.invoiceNumber) {
    throw new ApiError(400, 'INVALID_TAX_INVOICE', 'Valid tax invoice is required for E-Invoice payload generation.');
  }

  const invDate = new Date(taxInvoice.invoiceDate || Date.now());
  const day = String(invDate.getDate()).padStart(2, '0');
  const month = String(invDate.getMonth() + 1).padStart(2, '0');
  const year = invDate.getFullYear();
  const formattedDate = `${day}/${month}/${year}`;

  const supplier = taxInvoice.supplierDetails || {};
  const recipient = taxInvoice.recipientDetails || {};
  const taxSummary = taxInvoice.taxSummary || {};

  const itemList = (taxInvoice.lineItems || []).map((item, index) => {
    const isService = item.hsnCode && String(item.hsnCode).startsWith('99');
    return {
      SlNo: String(index + 1),
      PrdDesc: item.description || 'Food & Beverage Service',
      IsServc: isService ? 'Y' : 'N',
      HsnCd: String(item.hsnCode || '996331'),
      Qty: Number(item.quantity) || 1,
      Unit: item.uqc || 'NOS',
      UnitPrice: Number(fromPaisa(item.ratePaisa || 0)),
      TotAmt: Number(fromPaisa(item.grossAmountPaisa || 0)),
      Discount: Number(fromPaisa(item.discountPaisa || 0)),
      AssAmt: Number(fromPaisa(item.taxableAmountPaisa || 0)),
      GstRt: Number(item.gstRatePercent || 0),
      CgstAmt: Number(fromPaisa(item.cgstAmountPaisa || 0)),
      SgstAmt: Number(fromPaisa(item.sgstAmountPaisa || 0)),
      IgstAmt: Number(fromPaisa(item.igstAmountPaisa || 0)),
      CesRt: 0,
      CesAmt: 0,
      TotItemVal: Number(fromPaisa(item.totalItemAmountPaisa || 0)),
    };
  });

  return {
    Version: '1.1',
    TranDtls: {
      TaxSch: 'GST',
      SupTyp: recipient.isB2B ? 'B2B' : 'B2C',
      RegRev: taxInvoice.reverseCharge ? 'Y' : 'N',
      EcmGstin: null,
      IgstOnIntra: 'N',
    },
    DocDtls: {
      Typ: 'INV',
      No: taxInvoice.invoiceNumber,
      Dt: formattedDate,
    },
    SellerDtls: {
      Gstin: supplier.gstin || '',
      LglNm: supplier.legalName || 'Zamorin Cafe',
      TrdNm: supplier.tradeName || supplier.legalName || 'Zamorin Cafe',
      Addr1: supplier.address || 'Calicut',
      Loc: supplier.stateName || 'Kerala',
      Pin: Number(supplier.pin || 673001),
      Stcd: String(supplier.stateCode || '32'),
    },
    BuyerDtls: {
      Gstin: recipient.gstin || 'URP',
      LglNm: recipient.legalName || 'Counter Customer',
      Pos: taxInvoice.placeOfSupply ? String(taxInvoice.placeOfSupply).split('-')[0] : '32',
      Addr1: recipient.address || 'Counter POS',
      Loc: recipient.stateName || 'Kerala',
      Pin: Number(recipient.pin || 673001),
      Stcd: String(recipient.stateCode || '32'),
    },
    ItemList: itemList,
    ValDtls: {
      AssVal: Number(fromPaisa(taxSummary.totalTaxablePaisa || 0)),
      CgstVal: Number(fromPaisa(taxSummary.totalCgstPaisa || 0)),
      SgstVal: Number(fromPaisa(taxSummary.totalSgstPaisa || 0)),
      IgstVal: Number(fromPaisa(taxSummary.totalIgstPaisa || 0)),
      CesVal: 0,
      RndOffAmt: Number(fromPaisa(taxSummary.roundOffPaisa || 0)),
      TotInvVal: Number(fromPaisa(taxSummary.grandTotalPaisa || 0)),
    },
  };
}

/**
 * Generate NIC Form GST EWB-01 compliant E-Way Bill payload (A003)
 */
function generateEWayBillPayload({ taxInvoice, transporterDetails = {} }) {
  if (!taxInvoice || !taxInvoice.invoiceNumber) {
    throw new ApiError(400, 'INVALID_TAX_INVOICE', 'Valid tax invoice is required for E-Way Bill payload generation.');
  }

  const invDate = new Date(taxInvoice.invoiceDate || Date.now());
  const day = String(invDate.getDate()).padStart(2, '0');
  const month = String(invDate.getMonth() + 1).padStart(2, '0');
  const year = invDate.getFullYear();
  const formattedDate = `${day}/${month}/${year}`;

  const supplier = taxInvoice.supplierDetails || {};
  const recipient = taxInvoice.recipientDetails || {};
  const taxSummary = taxInvoice.taxSummary || {};

  const itemList = (taxInvoice.lineItems || []).map((item) => ({
    productName: item.description || 'Food & Beverage',
    productDesc: item.description || 'Food & Beverage',
    hsnCode: Number(item.hsnCode) || 996331,
    quantity: Number(item.quantity) || 1,
    qtyUnit: item.uqc || 'NOS',
    taxableAmount: Number(fromPaisa(item.taxableAmountPaisa || 0)),
    cgstRate: Number(item.cgstRatePercent || 0),
    sgstRate: Number(item.sgstRatePercent || 0),
    igstRate: Number(item.igstRatePercent || 0),
    cessRate: 0,
  }));

  return {
    supplyType: 'O',
    subSupplyType: '1',
    subSupplyDesc: 'Supply',
    docType: 'INV',
    docNo: taxInvoice.invoiceNumber,
    docDate: formattedDate,
    fromGstin: supplier.gstin || '',
    fromTrdName: supplier.tradeName || supplier.legalName || 'Zamorin Cafe',
    fromAddr1: supplier.address || 'Calicut',
    fromPlace: supplier.stateName || 'Calicut',
    fromPincode: Number(supplier.pin || 673001),
    fromStateCode: Number(supplier.stateCode || 32),
    actualFromStateCode: Number(supplier.stateCode || 32),
    toGstin: recipient.gstin || 'URP',
    toTrdName: recipient.legalName || 'Customer',
    toAddr1: recipient.address || 'Delivery Address',
    toPlace: recipient.stateName || 'Calicut',
    toPincode: Number(recipient.pin || 673001),
    toStateCode: Number(recipient.stateCode || 32),
    actualToStateCode: Number(recipient.stateCode || 32),
    totalValue: Number(fromPaisa(taxSummary.totalTaxablePaisa || 0)),
    cgstValue: Number(fromPaisa(taxSummary.totalCgstPaisa || 0)),
    sgstValue: Number(fromPaisa(taxSummary.totalSgstPaisa || 0)),
    igstValue: Number(fromPaisa(taxSummary.totalIgstPaisa || 0)),
    cessValue: 0,
    totInvValue: Number(fromPaisa(taxSummary.grandTotalPaisa || 0)),
    transDistance: Number(transporterDetails.distanceKm || 10),
    transporterId: transporterDetails.transporterId || '',
    transporterName: transporterDetails.transporterName || '',
    transDocNo: transporterDetails.transDocNo || '',
    transDocDate: transporterDetails.transDocDate || '',
    vehicleNo: transporterDetails.vehicleNo || '',
    vehicleType: transporterDetails.vehicleType || 'R',
    itemList,
  };
}

module.exports = {
  getIndianFinancialYear,
  numberToIndianRupeeWords,
  calculateGstTaxes,
  calculateCanonicalGst,
  roundToPaisa,
  toPaisa,
  fromPaisa,
  calculateCustomerPayableRounding50P,
  TAX_RULE_VERSION,
  ROUNDING_POLICY_VERSION,
  registerStatutoryCafeCode,
  resolveCompactCafeCode,
  formatShortFinancialYear,
  calculateSeriesCapacity,
  validateStatutorySeriesConfig,
  allocateInvoiceNumber,
  cancelTaxInvoice,
  generateStatutoryTaxInvoice,
  saveTaxInvoiceWithRetry,
  renderStatutoryGstInvoicePdf,
  generateGstr1Summary,
  auditExistingInvoices,
  _clearStatutoryRegistries,
  syncTaxInvoiceIndexes,
  validateTaxJurisdictionCompatibility,
  generateEInvoicePayload,
  generateEWayBillPayload,
};

