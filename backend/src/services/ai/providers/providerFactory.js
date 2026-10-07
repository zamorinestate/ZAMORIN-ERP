'use strict';

/**
 * ZAMORIN AI INVOICE INTELLIGENCE — PROVIDER FACTORY
 *
 * Resolves the configured extraction provider based on INVOICE_AI_PROVIDER environment setting.
 * Supported providers: 'mock', 'deterministic_mock', 'gemini', 'document_ai'.
 */

const { DeterministicMockInvoiceProvider } = require('./DeterministicMockInvoiceProvider');
const { GeminiInvoiceExtractionProvider } = require('./GeminiInvoiceExtractionProvider');
const { GoogleDocumentAIInvoiceProvider } = require('./GoogleDocumentAIInvoiceProvider');

function getInvoiceExtractionProvider(providerKey = null) {
  const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const configured = providerKey || process.env.INVOICE_AI_PROVIDER || process.env.AI_INVOICE_PROVIDER || (isProduction ? '' : 'mock');
  const selected = String(configured).trim().toLowerCase().replace(/^google[_-]/, '');

  switch (selected) {
    case 'gemini':
      return new GeminiInvoiceExtractionProvider();
    case 'document_ai':
    case 'documentai':
      return new GoogleDocumentAIInvoiceProvider();
    case 'deterministic_mock':
    case 'mock':
      if (isProduction) {
        const err = new Error('Deterministic mock invoice provider is not permitted in production. Set INVOICE_AI_PROVIDER=gemini or document_ai.');
        err.code = 'AI_PROVIDER_UNCONFIGURED';
        err.statusCode = 503;
        throw err;
      }
      return new DeterministicMockInvoiceProvider();
    default: {
      const err = new Error(`Unknown or missing INVOICE_AI_PROVIDER '${selected || '(unset)'}'. Supported: gemini, document_ai${isProduction ? '' : ', mock'}.`);
      err.code = 'AI_PROVIDER_UNCONFIGURED';
      err.statusCode = 503;
      throw err;
    }
  }
}

const providerFactory = {
  getProvider: getInvoiceExtractionProvider,
};

module.exports = {
  getInvoiceExtractionProvider,
  providerFactory,
};
