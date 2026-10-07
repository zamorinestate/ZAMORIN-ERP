'use strict';

/**
 * ZAMORIN AI INVOICE INTELLIGENCE — COMPOSITE CONFIDENCE SERVICE (PHASE 15)
 *
 * Calculates a multi-factor composite trust score (0.0 to 1.0) using objective signals.
 * Does NOT rely solely on the AI model's self-reported confidence.
 *
 * Factors & Weights:
 *   1. Mathematical validity (0.25): Indepedent line & header re-calculation
 *   2. Three-way match status (0.20): Alignment with PO & accepted GRN
 *   3. Vendor master match (0.15): Exact GSTIN / PAN / Verified supplier
 *   4. GST compliance validity (0.15): Valid GSTIN format, state code, tax rates
 *   5. Field completeness (0.15): Essential accounting header & line fields present
 *   6. Provider raw confidence (0.10): OCR/Vision model raw token confidence
 *
 * Bands:
 *   - HIGH (>= 0.85): Eligible for expedited human review / quick approval
 *   - MEDIUM (0.65 - 0.84): Standard human verification recommended
 *   - LOW (< 0.65): Mandatory comprehensive review required
 *
 * Invariant: Confidence score NEVER authorizes automated financial postings.
 */

class InvoiceConfidenceService {
  /**
   * Evaluates multi-factor confidence.
   *
   * @param {Object} params
   * @param {Object} params.extracted - Canonical extraction data
   * @param {Object} params.provenance - Field provenance records
   * @param {Object} params.validation - Mathematical & GST validation result
   * @param {Object} params.vendorMatch - Vendor matching outcome
   * @param {Object} params.duplicateResult - Duplicate detection outcome
   * @param {Object} params.threeWayMatch - Three-way match outcome
   * @returns {Object} Composite confidence conforming to InvoiceExtraction schema
   */
  static calculateCompositeScore({
    extracted = {},
    provenance = {},
    validation = {},
    vendorMatch = {},
    duplicateResult = {},
    threeWayMatch = {},
  }) {
    // ── Factor 1: Mathematical Validity (Weight: 0.25) ─────────────────────────
    let mathScore = 0.0;
    if (validation.isValid) {
      mathScore = 1.0;
    } else {
      const mathErrors = (validation.discrepancies || []).filter(
        (d) => d.code === 'TOTAL_MISMATCH' || d.code === 'LINE_CALCULATION_MISMATCH'
      );
      if (mathErrors.length === 0) {
        mathScore = 0.7; // Minor discrepancy
      } else {
        mathScore = Math.max(0, 0.4 - mathErrors.length * 0.15);
      }
    }

    // ── Factor 2: Three-Way Match Status (Weight: 0.20) ────────────────────────
    let threeWayScore = 0.0;
    switch (threeWayMatch.status) {
      case 'MATCHED':
        threeWayScore = 1.0;
        break;
      case 'MATCHED_WITH_TOLERANCE':
        threeWayScore = 0.85;
        break;
      case 'EXCEPTION':
        threeWayScore = 0.4;
        break;
      case 'BLOCKED':
        threeWayScore = 0.1;
        break;
      default:
        threeWayScore = 0.3;
    }

    // ── Factor 3: Vendor Master Match (Weight: 0.15) ───────────────────────────
    let vendorScore = 0.0;
    switch (vendorMatch.matchStrategy) {
      case 'EXACT_GSTIN':
        vendorScore = 1.0;
        break;
      case 'EXACT_PAN':
        vendorScore = 0.9;
        break;
      case 'SUPPLIER_CODE':
        vendorScore = 0.95;
        break;
      case 'NORMALIZED_NAME':
        vendorScore = 0.8;
        break;
      case 'FUZZY_NAME':
        vendorScore = 0.65;
        break;
      case 'AMBIGUOUS':
        vendorScore = 0.35;
        break;
      default:
        vendorScore = 0.0;
    }

    // ── Factor 4: GST Compliance Validity (Weight: 0.15) ──────────────────────
    let gstScore = 0.0;
    const gstCheck = validation.gstValidation || {};
    if (gstCheck.isGstinValid && gstCheck.isRateConsistent) {
      gstScore = 1.0;
    } else if (gstCheck.isGstinValid) {
      gstScore = 0.7;
    } else if (extracted.supplier?.gstin) {
      gstScore = 0.3; // Has string but invalid structure
    } else {
      gstScore = 0.0;
    }

    // ── Factor 5: Field Completeness (Weight: 0.15) ───────────────────────────
    const essentialChecks = [
      Boolean(extracted.supplier?.name),
      Boolean(extracted.supplier?.gstin),
      Boolean(extracted.invoice?.invoiceNumber),
      Boolean(extracted.invoice?.invoiceDate),
      Boolean(Array.isArray(extracted.lineItems) && extracted.lineItems.length > 0),
      Boolean(extracted.totals?.taxableValue !== undefined && extracted.totals?.taxableValue !== null),
      Boolean(extracted.totals?.grandTotal !== undefined && extracted.totals?.grandTotal !== null),
    ];
    const completedCount = essentialChecks.filter(Boolean).length;
    const completenessScore = Number((completedCount / essentialChecks.length).toFixed(3));

    // ── Factor 6: Provider Raw Confidence (Weight: 0.10) ──────────────────────
    let rawProviderConf = 0.0;
    if (provenance.grandTotal?.confidence !== undefined) {
      rawProviderConf = Number(provenance.grandTotal.confidence || 0);
    } else if (provenance.invoiceNumber?.confidence !== undefined) {
      rawProviderConf = Number(provenance.invoiceNumber.confidence || 0);
    } else {
      rawProviderConf = 0.8; // Baseline default if provider does not return token confidence
    }
    const clampedProviderConf = Math.min(1, Math.max(0, rawProviderConf));

    // ── Factor 7: Duplicate Penalty (Deduction) ────────────────────────────────
    let duplicatePenalty = 0.0;
    if (duplicateResult.status === 'EXACT_DUPLICATE') {
      duplicatePenalty = 0.5; // Severe trust penalty
    } else if (duplicateResult.status === 'POSSIBLE_DUPLICATE') {
      duplicatePenalty = 0.15;
    }

    // ── Weighted Overall Score Computation ────────────────────────────────────
    const weightedScore =
      mathScore * 0.25 +
      threeWayScore * 0.20 +
      vendorScore * 0.15 +
      gstScore * 0.15 +
      completenessScore * 0.15 +
      clampedProviderConf * 0.10 -
      duplicatePenalty;

    const overallScore = Math.min(1.0, Math.max(0.0, Number(weightedScore.toFixed(3))));

    let level = 'LOW';
    if (overallScore >= 0.85) {
      level = 'HIGH';
    } else if (overallScore >= 0.65) {
      level = 'MEDIUM';
    }

    return {
      overallScore,
      level,
      breakdown: {
        providerConfidence: Number(clampedProviderConf.toFixed(3)),
        fieldCompleteness: completenessScore,
        vendorMatchScore: Number(vendorScore.toFixed(3)),
        mathematicalValidity: Number(mathScore.toFixed(3)),
        gstValidity: Number(gstScore.toFixed(3)),
        threeWayMatchScore: Number(threeWayScore.toFixed(3)),
        duplicateCheckScore: duplicateResult.status === 'EXACT_DUPLICATE' ? 0.0 : 1.0,
      },
    };
  }
}

module.exports = {
  InvoiceConfidenceService,
};
