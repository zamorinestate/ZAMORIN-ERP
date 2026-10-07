'use strict';

/**
 * ZAMORIN AI INVOICE INTELLIGENCE — INVOICE VALIDATION SERVICE (PHASE 10 & 11)
 *
 * Deterministic mathematical and statutory validation engine.
 * Never trusts AI totals. Recalculates all values in integer paise to avoid
 * floating-point drift. Enforces Indian CBIC GST statutory rules.
 */

const { roundToPaisa, toPaisa } = require('../gstTaxService');
const { validateGstinFormat } = require('../../config/regulatoryCompliance2026');

class InvoiceValidationService {
  /**
   * Performs complete deterministic validation on extracted invoice data.
   * @param {Object} canonical - Canonical invoice data from extraction.
   * @param {Object} [options] - Tolerance and config options.
   * @returns {Object} Validation summary with mathematicalValidation, gstValidation, and exceptions.
   */
  static validate(canonical = {}, options = {}) {
    const mathErrors = [];
    const gstErrors = [];
    const exceptions = [];
    const tolerancePaise = Number(options.tolerancePaise !== undefined ? options.tolerancePaise : 100); // ₹1 default tolerance

    const supplier = canonical.supplier || {};
    const invoice = canonical.invoice || {};
    const lineItems = Array.isArray(canonical.lineItems) ? canonical.lineItems : [];
    const totals = canonical.totals || {};

    // ── 1. Basic Metadata Validation ──────────────────────────────────────────
    if (!invoice.invoiceNumber || !String(invoice.invoiceNumber).trim()) {
      mathErrors.push('Invoice number is missing from document extraction.');
      exceptions.push({
        code: 'INVOICE_NUMBER_MISSING',
        message: 'Invoice number could not be extracted from document.',
        severity: 'BLOCKING',
        field: 'invoice.invoiceNumber',
      });
    }

    if (!invoice.invoiceDate || !String(invoice.invoiceDate).trim()) {
      mathErrors.push('Invoice date is missing from document extraction.');
      exceptions.push({
        code: 'INVOICE_DATE_MISSING',
        message: 'Invoice date could not be extracted from document.',
        severity: 'BLOCKING',
        field: 'invoice.invoiceDate',
      });
    }

    // ── 2. GST Statutory Validation (Phase 11) ────────────────────────────────
    let isInterState = false;
    let gstinValid = false;
    let extractedStateCode = null;
    let extractedPan = null;

    if (supplier.gstin) {
      const gstinResult = validateGstinFormat(supplier.gstin);
      if (gstinResult.valid) {
        gstinValid = true;
        extractedStateCode = gstinResult.stateCode;
        extractedPan = gstinResult.pan;
      } else {
        gstErrors.push(`Supplier GSTIN validation failed: ${gstinResult.reason}`);
        exceptions.push({
          code: 'GSTIN_INVALID',
          message: `Invalid GSTIN structure: ${gstinResult.reason}`,
          severity: 'BLOCKING',
          field: 'supplier.gstin',
        });
      }
    } else {
      gstErrors.push('Supplier GSTIN is missing from invoice.');
      exceptions.push({
        code: 'GSTIN_MISSING',
        message: 'Supplier GSTIN is missing.',
        severity: 'WARNING',
        field: 'supplier.gstin',
      });
    }

    // Determine supply type: Intra-State vs Inter-State
    // If supplier state code differs from place of supply state code, it's Interstate (IGST)
    const placeOfSupply = String(invoice.placeOfSupply || '').trim();
    if (extractedStateCode && placeOfSupply) {
      const posStateCode = placeOfSupply.slice(0, 2);
      isInterState = posStateCode !== extractedStateCode;
    } else if (totals.igst > 0 && totals.cgst === 0 && totals.sgst === 0) {
      isInterState = true;
    }

    // ── 3. Line-Item Mathematical Recalculation (Phase 10) ────────────────────
    let computedTaxablePaise = 0;
    let computedCgstPaise = 0;
    let computedSgstPaise = 0;
    let computedIgstPaise = 0;
    let computedCessPaise = 0;
    let computedGrossPaise = 0;

    const lineValidation = [];

    for (let i = 0; i < lineItems.length; i++) {
      const line = lineItems[i];
      const qty = Number(line.quantity) || 0;
      const ratePaisa = toPaisa(line.unitPrice);
      const discountPaisa = toPaisa(line.discountAmount);
      const gstRate = Number(line.gstRate) || 0;

      const calcGrossPaisa = roundToPaisa(qty * ratePaisa);
      const calcTaxablePaisa = Math.max(0, calcGrossPaisa - discountPaisa);

      let calcCgstPaisa = 0;
      let calcSgstPaisa = 0;
      let calcIgstPaisa = 0;

      if (isInterState) {
        calcIgstPaisa = roundToPaisa((calcTaxablePaisa * gstRate) / 100);
      } else {
        const halfRate = gstRate / 2;
        calcCgstPaisa = roundToPaisa((calcTaxablePaisa * halfRate) / 100);
        calcSgstPaisa = roundToPaisa((calcTaxablePaisa * halfRate) / 100);
      }

      const calcCessPaisa = toPaisa(line.cessAmount);
      const calcLineTotalPaisa = calcTaxablePaisa + calcCgstPaisa + calcSgstPaisa + calcIgstPaisa + calcCessPaisa;

      computedGrossPaise += calcGrossPaisa;
      computedTaxablePaise += calcTaxablePaisa;
      computedCgstPaise += calcCgstPaisa;
      computedSgstPaise += calcSgstPaisa;
      computedIgstPaise += calcIgstPaisa;
      computedCessPaise += calcCessPaisa;

      const reportedLineTotalPaisa = toPaisa(line.lineTotal);
      const lineDiffPaisa = Math.abs(reportedLineTotalPaisa - calcLineTotalPaisa);

      lineValidation.push({
        lineNumber: line.lineNumber || (i + 1),
        description: line.description,
        calculatedTaxablePaise: calcTaxablePaisa,
        calculatedTaxPaise: calcCgstPaisa + calcSgstPaisa + calcIgstPaisa,
        calculatedTotalPaise: calcLineTotalPaisa,
        reportedTotalPaise: reportedLineTotalPaisa,
        discrepancyPaisa: lineDiffPaisa,
        isLineValid: lineDiffPaisa <= tolerancePaise,
      });

      if (lineDiffPaisa > tolerancePaise) {
        mathErrors.push(
          `Line ${i + 1} (${line.description || 'Item'}): reported total ₹${line.lineTotal} differs from calculated ₹${(calcLineTotalPaisa / 100).toFixed(2)}.`
        );
        exceptions.push({
          code: 'LINE_CALCULATION_MISMATCH',
          message: `Line ${i + 1} (${line.description || 'Item'}): reported total ₹${line.lineTotal} differs from calculated ₹${(calcLineTotalPaisa / 100).toFixed(2)}.`,
          severity: 'BLOCKING',
          field: `lineItems[${i}].lineTotal`,
        });
      }
    }

    // ── 4. Header Totals Summation & Reconciliation ───────────────────────────
    const freightPaise = toPaisa(totals.freight);
    const otherChargesPaise = toPaisa(totals.otherCharges);
    const roundOffPaise = toPaisa(totals.roundOff);

    const computedTotalTaxPaise = computedCgstPaise + computedSgstPaise + computedIgstPaise + computedCessPaise;
    const computedGrandTotalPaise =
      computedTaxablePaise +
      computedTotalTaxPaise +
      freightPaise +
      otherChargesPaise +
      roundOffPaise;

    const reportedGrandTotalPaise = toPaisa(totals.grandTotal);
    const reportedTaxablePaise = toPaisa(totals.taxableValue);
    const grandTotalDiscrepancyPaise = Math.abs(reportedGrandTotalPaise - computedGrandTotalPaise);

    // Verify Taxable Value
    if (reportedTaxablePaise > 0 && Math.abs(reportedTaxablePaise - computedTaxablePaise) > tolerancePaise) {
      mathErrors.push(
        `Invoice taxable value mismatch: reported ₹${totals.taxableValue}, calculated ₹${(computedTaxablePaise / 100).toFixed(2)}.`
      );
      exceptions.push({
        code: 'TAXABLE_VALUE_MISMATCH',
        message: `Reported taxable value (₹${totals.taxableValue}) differs from itemized lines (₹${(computedTaxablePaise / 100).toFixed(2)}).`,
        severity: 'BLOCKING',
        field: 'totals.taxableValue',
      });
    }

    // Verify Grand Total
    const isMathValid = grandTotalDiscrepancyPaise <= tolerancePaise && mathErrors.length === 0;

    if (!isMathValid && grandTotalDiscrepancyPaise > tolerancePaise) {
      mathErrors.push(
        `Invoice grand total mismatch: reported ₹${totals.grandTotal}, computed sum ₹${(computedGrandTotalPaise / 100).toFixed(2)} (diff: ₹${(grandTotalDiscrepancyPaise / 100).toFixed(2)}).`
      );
      exceptions.push({
        code: 'TOTAL_MISMATCH',
        message: `Grand total mismatch: invoice claims ₹${totals.grandTotal}, recalculated total is ₹${(computedGrandTotalPaise / 100).toFixed(2)}.`,
        severity: 'BLOCKING',
        field: 'totals.grandTotal',
      });
    }

    // Check CGST / SGST consistency
    if (!isInterState && totals.cgst > 0 && totals.sgst > 0) {
      const cgstPaisa = toPaisa(totals.cgst);
      const sgstPaisa = toPaisa(totals.sgst);
      if (Math.abs(cgstPaisa - sgstPaisa) > 10) {
        gstErrors.push(`Intra-state CGST (₹${totals.cgst}) and SGST (₹${totals.sgst}) must be identical.`);
        exceptions.push({
          code: 'GST_CALCULATION_MISMATCH',
          message: 'CGST and SGST amounts do not balance.',
          severity: 'BLOCKING',
          field: 'totals.cgst',
        });
      }
    }

    const isOverallValid = isMathValid && mathErrors.length === 0 && (!supplier.gstin || gstinValid) && gstErrors.length === 0;

    return {
      isValid: isOverallValid,
      discrepancies: exceptions,
      recalculatedTotals: {
        taxableValuePaisa: computedTaxablePaise,
        grandTotalPaisa: computedGrandTotalPaise,
      },
      mathematicalValidation: {
        isValid: isMathValid,
        discrepancyPaise: grandTotalDiscrepancyPaise,
        computedTotals: {
          taxableValuePaisa: computedTaxablePaise,
          cgstPaisa: computedCgstPaise,
          sgstPaisa: computedSgstPaise,
          igstPaisa: computedIgstPaise,
          cessPaisa: computedCessPaise,
          freightPaisa: freightPaise,
          otherChargesPaisa: otherChargesPaise,
          roundOffPaisa: roundOffPaise,
          grandTotalPaisa: computedGrandTotalPaise,
        },
        lineValidation,
        errors: mathErrors,
      },
      gstValidation: {
        isValid: gstErrors.length === 0 && (!supplier.gstin || gstinValid),
        isInterState,
        gstinValid: Boolean(gstinValid),
        isGstinValid: Boolean(gstinValid),
        isRateConsistent: gstErrors.length === 0,
        stateCode: extractedStateCode,
        pan: extractedPan,
        errors: gstErrors,
      },
      exceptions,
    };
  }
}

module.exports = {
  InvoiceValidationService,
};
