'use strict';

/**
 * ZAMORIN AI INVOICE INTELLIGENCE — INVOICE EXTRACTION PROVIDER BASE
 *
 * Abstract provider interface defining the contract for AI/OCR invoice extraction.
 * Decouples the ERP core from any specific third-party provider or model API.
 */

class InvoiceExtractionProvider {
  /**
   * Returns human-readable provider identifier.
   * @returns {string}
   */
  getProviderName() {
    throw new Error('getProviderName() must be implemented by extraction provider.');
  }

  /**
   * Returns the model or processor version used by the provider.
   * @returns {string}
   */
  getModelVersion() {
    throw new Error('getModelVersion() must be implemented by extraction provider.');
  }

  /**
   * Performs connectivity or credential health check.
   * @returns {Promise<{ ok: boolean, message?: string }>}
   */
  async healthCheck() {
    return { ok: true, message: 'Provider ready' };
  }

  /**
   * Extracts raw invoice data from document buffer or reference.
   * @param {Object} document - Document payload containing fileBuffer or storageRef, mimeType, filename.
   * @param {Object} [options] - Extraction options (timeoutMs, hints, locale).
   * @returns {Promise<{ rawOutput: Object, metadata: Object }>}
   */
  async extractInvoice(_document, _options = {}) {
    throw new Error('extractInvoice() must be implemented by extraction provider.');
  }

  /**
   * Normalizes provider raw output into the Canonical Extraction Schema (Phase 3).
   * @param {Object} rawOutput - Provider-specific raw response.
   * @param {Object} [context] - Contextual metadata (documentId, documentHash, etc.)
   * @returns {Object} Canonical Extraction Schema representation.
   */
  normalizeResponse(_rawOutput, _context = {}) {
    throw new Error('normalizeResponse() must be implemented by extraction provider.');
  }
}

module.exports = {
  InvoiceExtractionProvider,
};
