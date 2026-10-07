'use strict';

/**
 * ZAMORIN AI INVOICE INTELLIGENCE — VENDOR MATCHING SERVICE (PHASE 8)
 *
 * Matches extracted supplier information to the authoritative Vendor Master.
 * Priority order:
 *   1. Exact GSTIN (outranks all others)
 *   2. PAN matching (exact PAN match or derived from GSTIN chars 2-12)
 *   3. Registered supplier identifier (e.g., VEN-xxxx or code)
 *   4. Normalized vendor name
 *   5. Controlled fuzzy / regex name matching
 *
 * NON-NEGOTIABLE SAFETY INVARIANT:
 * Never automatically create a new vendor solely because AI found an unknown supplier.
 * Unknown vendors must enter exception review (VENDOR_NOT_FOUND or VENDOR_AMBIGUOUS).
 */

const { Vendor } = require('../../models/Vendor');

function extractPanFromGstin(gstin) {
  if (!gstin || typeof gstin !== 'string') return null;
  const clean = gstin.trim().toUpperCase();
  return clean.length >= 12 ? clean.substring(2, 12) : null;
}

function normalizeName(name) {
  if (!name || typeof name !== 'string') return '';
  return name
    .toLowerCase()
    .replace(/[^\w\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

class InvoiceVendorMatchingService {
  /**
   * Matches extracted supplier against Vendor Master.
   *
   * @param {Object} params
   * @param {Object} params.extractedSupplier - Canonical supplier object { name, gstin, pan, address, ... }
   * @param {string} params.organisationId
   * @param {string} [params.cafeId]
   * @returns {Promise<Object>} Vendor match outcome conforming to InvoiceExtraction schema
   */
  static async matchSupplier({ extractedSupplier = {}, organisationId, cafeId = null }) {
    if (!organisationId) {
      throw new Error('organisationId is required for vendor matching');
    }

    const orgId = String(organisationId).trim().toUpperCase();
    const rawGstin = extractedSupplier.gstin ? String(extractedSupplier.gstin).trim().toUpperCase() : null;
    const rawPan = extractedSupplier.pan ? String(extractedSupplier.pan).trim().toUpperCase() : (rawGstin ? extractPanFromGstin(rawGstin) : null);
    const rawName = extractedSupplier.name ? String(extractedSupplier.name).trim() : '';
    const normName = normalizeName(rawName);

    // ── Priority 1: Exact GSTIN Match ──────────────────────────────────────────
    if (rawGstin) {
      const gstinMatches = await Vendor.find({
        organisationId: orgId,
        gstNumber: rawGstin,
        status: { $ne: 'ARCHIVED' },
      })
        .select('vendorId name tradeName gstNumber panNumber approvedCafeIds status')
        .lean();

      if (gstinMatches.length === 1) {
        const v = gstinMatches[0];
        return {
          status: 'MATCHED',
          matchedVendorId: v.vendorId,
          matchedVendorName: v.name,
          matchConfidence: 1.0,
          matchStrategy: 'EXACT_GSTIN',
          candidateVendors: [
            {
              vendorId: v.vendorId,
              name: v.name,
              gstin: v.gstNumber,
              pan: v.panNumber,
              score: 1.0,
            },
          ],
        };
      }

      if (gstinMatches.length > 1) {
        return {
          status: 'AMBIGUOUS',
          matchedVendorId: null,
          matchedVendorName: null,
          matchConfidence: 0.6,
          matchStrategy: 'EXACT_GSTIN_COLLISION',
          candidateVendors: gstinMatches.map((v) => ({
            vendorId: v.vendorId,
            name: v.name,
            gstin: v.gstNumber,
            pan: v.panNumber,
            score: 0.8,
          })),
        };
      }
    }

    // ── Priority 2: Exact PAN Match ────────────────────────────────────────────
    if (rawPan && rawPan.length === 10) {
      const panMatches = await Vendor.find({
        organisationId: orgId,
        panNumber: rawPan,
        status: { $ne: 'ARCHIVED' },
      })
        .select('vendorId name tradeName gstNumber panNumber approvedCafeIds status')
        .lean();

      if (panMatches.length === 1) {
        const v = panMatches[0];
        return {
          status: 'MATCHED',
          matchedVendorId: v.vendorId,
          matchedVendorName: v.name,
          matchConfidence: 0.95,
          matchStrategy: 'EXACT_PAN',
          candidateVendors: [
            {
              vendorId: v.vendorId,
              name: v.name,
              gstin: v.gstNumber,
              pan: v.panNumber,
              score: 0.95,
            },
          ],
        };
      }

      if (panMatches.length > 1) {
        return {
          status: 'AMBIGUOUS',
          matchedVendorId: null,
          matchedVendorName: null,
          matchConfidence: 0.65,
          matchStrategy: 'EXACT_PAN_MULTIPLE',
          candidateVendors: panMatches.map((v) => ({
            vendorId: v.vendorId,
            name: v.name,
            gstin: v.gstNumber,
            pan: v.panNumber,
            score: 0.7,
          })),
        };
      }
    }

    // ── Priority 3: Registered Supplier Identifier (VEN-xxxx) ──────────────────
    const idPattern = /\b(VEN-\d{4,})\b/i;
    const idMatch = rawName.match(idPattern) || (extractedSupplier.supplierCode && extractedSupplier.supplierCode.match(idPattern));
    if (idMatch) {
      const targetId = idMatch[1].toUpperCase();
      const codeMatch = await Vendor.findOne({
        organisationId: orgId,
        vendorId: targetId,
        status: { $ne: 'ARCHIVED' },
      })
        .select('vendorId name tradeName gstNumber panNumber approvedCafeIds status')
        .lean();

      if (codeMatch) {
        return {
          status: 'MATCHED',
          matchedVendorId: codeMatch.vendorId,
          matchedVendorName: codeMatch.name,
          matchConfidence: 0.95,
          matchStrategy: 'SUPPLIER_CODE',
          candidateVendors: [
            {
              vendorId: codeMatch.vendorId,
              name: codeMatch.name,
              gstin: codeMatch.gstNumber,
              pan: codeMatch.panNumber,
              score: 0.95,
            },
          ],
        };
      }
    }

    // ── Priority 4: Normalized Vendor Name ─────────────────────────────────────
    if (normName && normName.length >= 3) {
      const nameMatches = await Vendor.find({
        organisationId: orgId,
        nameLower: normName,
        status: { $ne: 'ARCHIVED' },
      })
        .select('vendorId name tradeName gstNumber panNumber approvedCafeIds status')
        .lean();

      if (nameMatches.length === 1) {
        const v = nameMatches[0];
        return {
          status: 'MATCHED',
          matchedVendorId: v.vendorId,
          matchedVendorName: v.name,
          matchConfidence: 0.85,
          matchStrategy: 'NORMALIZED_NAME',
          candidateVendors: [
            {
              vendorId: v.vendorId,
              name: v.name,
              gstin: v.gstNumber,
              pan: v.panNumber,
              score: 0.85,
            },
          ],
        };
      }

      if (nameMatches.length > 1) {
        return {
          status: 'AMBIGUOUS',
          matchedVendorId: null,
          matchedVendorName: null,
          matchConfidence: 0.6,
          matchStrategy: 'NAME_COLLISION',
          candidateVendors: nameMatches.map((v) => ({
            vendorId: v.vendorId,
            name: v.name,
            gstin: v.gstNumber,
            pan: v.panNumber,
            score: 0.7,
          })),
        };
      }

      // ── Priority 5: Controlled Fuzzy / Prefix / Word Token Match ───────────────
      const escaped = escapeRegex(rawName.trim());
      const fuzzyMatches = await Vendor.find({
        organisationId: orgId,
        status: { $ne: 'ARCHIVED' },
        $or: [
          { name: new RegExp(`^${escaped}`, 'i') },
          { tradeName: new RegExp(`^${escaped}`, 'i') },
          { nameLower: new RegExp(escapeRegex(normName.split(' ')[0]), 'i') },
        ],
      })
        .select('vendorId name tradeName gstNumber panNumber approvedCafeIds status')
        .limit(5)
        .lean();

      if (fuzzyMatches.length === 1) {
        const v = fuzzyMatches[0];
        return {
          status: 'MATCHED',
          matchedVendorId: v.vendorId,
          matchedVendorName: v.name,
          matchConfidence: 0.75,
          matchStrategy: 'FUZZY_NAME',
          candidateVendors: [
            {
              vendorId: v.vendorId,
              name: v.name,
              gstin: v.gstNumber,
              pan: v.panNumber,
              score: 0.75,
            },
          ],
        };
      }

      if (fuzzyMatches.length > 1) {
        return {
          status: 'AMBIGUOUS',
          matchedVendorId: null,
          matchedVendorName: null,
          matchConfidence: 0.5,
          matchStrategy: 'FUZZY_MULTIPLE',
          candidateVendors: fuzzyMatches.map((v) => ({
            vendorId: v.vendorId,
            name: v.name,
            gstin: v.gstNumber,
            pan: v.panNumber,
            score: 0.5,
          })),
        };
      }
    }

    // ── NOT FOUND ─────────────────────────────────────────────────────────────
    return {
      status: 'NOT_FOUND',
      matchedVendorId: null,
      matchedVendorName: null,
      matchConfidence: 0.0,
      matchStrategy: 'NONE',
      candidateVendors: [],
    };
  }
}

module.exports = {
  InvoiceVendorMatchingService,
};
