'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — BENCHMARK SCOPE DECISION & INTEGRATION DEPENDENCY MODEL
 * ============================================================================
 * Package P21: External Services and Benchmark Scope Decisions
 *
 * Persisted authoritative registry reconciling all 485 Petpooja benchmark records
 * (351 main report entries F001-F351 + 134 omissions supplement entries A001-A134).
 */

const mongoose = require('mongoose');

const DISPOSITIONS = [
  'VERIFY_AND_EXTEND',
  'ADAPT_TO_ZAMORIN',
  'CONDITIONAL_INTEGRATION',
  'BENCHMARK_CONTEXT',
  'EXCLUDED_BY_CURRENT_SCOPE',
  'REGRESSION_BEHAVIOUR',
];

const VERIFICATION_STATES = [
  'IMPLEMENTED_AND_VERIFIED',
  'CONDITIONAL_PENDING_DEPENDENCY',
  'EXCLUDED_BY_FREEZE',
  'BLOCKED_UNCONFIGURED',
  'BENCHMARK_REFERENCE_ONLY',
];

const DEPENDENCY_CATEGORIES = [
  'PARTNER_SERVICES',
  'PAYMENTS_GATEWAY',
  'MESSAGING_NOTIFICATIONS',
  'AI_DOCUMENT_PROCESSING',
  'HARDWARE_PERIPHERALS',
  'JURISDICTIONAL_TAX',
  'KITCHEN_OPERATIONS_KDS',
  'RETAIL_BENCHMARK_CONTEXT',
  'CORE_POS_BILLING',
  'WORKFORCE_PAYROLL',
  'INVENTORY_PROCUREMENT',
  'PORTFOLIO_GOVERNANCE',
  'COMMERCIAL_CUSTOMER_CRM',
];

const decisionHistorySchema = new mongoose.Schema(
  {
    previousDisposition: {
      type: String,
      enum: DISPOSITIONS,
    },
    newDisposition: {
      type: String,
      enum: DISPOSITIONS,
      required: true,
    },
    previousVerificationState: {
      type: String,
      enum: VERIFICATION_STATES,
    },
    newVerificationState: {
      type: String,
      enum: VERIFICATION_STATES,
      default: 'IMPLEMENTED_AND_VERIFIED',
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    nextDecision: {
      type: String,
      required: true,
      trim: true,
    },
    decidedBy: {
      type: String,
      required: true,
      trim: true,
    },
    decidedAt: {
      type: Date,
      default: Date.now,
    },
    auditRef: {
      type: String,
      trim: true,
      default: null,
    },
  },
  { _id: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

decisionHistorySchema.virtual('changedByUserId').get(function () {
  return this.decidedBy;
});

decisionHistorySchema.virtual('changedByPersona').get(function () {
  return 'PRIMARY_MASTER';
});

decisionHistorySchema.virtual('changedAt').get(function () {
  return this.decidedAt;
});

const benchmarkScopeDecisionSchema = new mongoose.Schema(
  {
    benchmarkId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    organisationId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    cafeId: {
      type: String,
      trim: true,
      uppercase: true,
      default: 'GLOBAL',
      index: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
    },

    capability: {
      type: String,
      required: true,
      trim: true,
    },

    functionalPackage: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    category: {
      type: String,
      required: true,
      index: true,
    },

    disposition: {
      type: String,
      enum: DISPOSITIONS,
      required: true,
      index: true,
    },

    verificationState: {
      type: String,
      enum: VERIFICATION_STATES,
      required: true,
      index: true,
    },

    // Mandatory for conditional or excluded entries
    exclusionOrConditionalReason: {
      type: String,
      trim: true,
      default: '',
    },

    // Mandatory concrete next decision, prerequisite, or review action
    nextDecisionOrPrerequisite: {
      type: String,
      trim: true,
      default: '',
    },

    providerOrPartner: {
      providerName: {
        type: String,
        trim: true,
        default: 'INTERNAL_OR_N/A',
      },
      evidencedVersion: {
        type: String,
        trim: true,
        default: 'N/A',
      },
      applicableRegion: {
        type: String,
        trim: true,
        default: 'IN-KL', // Kerala, India default jurisdiction
      },
      pricingModel: {
        type: String,
        trim: true,
        default: 'N/A',
      },
      supportConstraints: {
        type: String,
        trim: true,
        default: 'N/A',
      },
      hasRequiredCredentials: {
        type: Boolean,
        default: false,
      },
      configPrerequisites: {
        type: [String],
        default: [],
      },
    },

    accountableFunction: {
      type: String,
      trim: true,
      default: 'PRIMARY_MASTER',
    },

    reviewDate: {
      type: String,
      trim: true,
      default: () => new Date().toISOString().slice(0, 10),
    },

    sourceReference: {
      type: String,
      trim: true,
      default: 'Petpooja Canonical Benchmark Register 2026',
    },

    evidenceReferences: {
      type: [String],
      default: [],
    },

    isKdsRelated: {
      type: Boolean,
      default: false,
      index: true,
    },

    decisionHistory: {
      type: [decisionHistorySchema],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: 'benchmark_scope_decisions',
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual aliases for compatibility across tests and UI
benchmarkScopeDecisionSchema.virtual('decisionReason').get(function () {
  return this.exclusionOrConditionalReason;
}).set(function (val) {
  this.exclusionOrConditionalReason = val;
});

benchmarkScopeDecisionSchema.virtual('nextDecision').get(function () {
  return this.nextDecisionOrPrerequisite;
}).set(function (val) {
  this.nextDecisionOrPrerequisite = val;
});

benchmarkScopeDecisionSchema.virtual('evidenceReference').get(function () {
  return Array.isArray(this.evidenceReferences) && this.evidenceReferences.length > 0
    ? this.evidenceReferences[0]
    : '';
}).set(function (val) {
  if (val) {
    this.evidenceReferences = [val];
  }
});

benchmarkScopeDecisionSchema.virtual('isKdsComponent').get(function () {
  return this.isKdsRelated;
}).set(function (val) {
  this.isKdsRelated = Boolean(val);
});

benchmarkScopeDecisionSchema.virtual('affectedCapability').get(function () {
  return this.capability;
}).set(function (val) {
  this.capability = val;
});

benchmarkScopeDecisionSchema.virtual('dependencyCategory').get(function () {
  return this.category;
}).set(function (val) {
  this.category = val;
});

benchmarkScopeDecisionSchema.virtual('sourceSection').get(function () {
  return this.sourceReference;
});

benchmarkScopeDecisionSchema.virtual('providerOrPartnerName').get(function () {
  return this.providerOrPartner?.providerName || 'N/A';
});

// Compound unique index ensuring benchmarkId uniqueness per organisation & cafe
benchmarkScopeDecisionSchema.index(
  { organisationId: 1, cafeId: 1, benchmarkId: 1 },
  { unique: true }
);

// Validation guard: conditional or excluded items must have meaningful reasons & next decisions
benchmarkScopeDecisionSchema.pre('save', function () {
  const isConditionalOrExcluded =
    this.disposition === 'CONDITIONAL_INTEGRATION' ||
    this.disposition === 'EXCLUDED_BY_CURRENT_SCOPE' ||
    this.verificationState === 'CONDITIONAL_PENDING_DEPENDENCY' ||
    this.verificationState === 'EXCLUDED_BY_FREEZE';

  if (isConditionalOrExcluded) {
    if (!this.exclusionOrConditionalReason || this.exclusionOrConditionalReason.trim().length < 10) {
      throw new Error('Conditional or excluded benchmark scope decisions require a meaningful documented reason.');
    }
    if (!this.nextDecisionOrPrerequisite || this.nextDecisionOrPrerequisite.trim().length < 5) {
      throw new Error('Conditional or excluded benchmark scope decisions require a concrete next decision or prerequisite.');
    }
  }

  // KDS Architectural Freeze Guard: cannot mark KDS item as implemented or verified
  if (this.isKdsRelated && (this.disposition === 'VERIFY_AND_EXTEND' || this.verificationState === 'IMPLEMENTED_AND_VERIFIED')) {
    throw new Error('KDS activation is strictly prohibited by architectural freeze. Cannot mark KDS item as active or delivered.');
  }
});

// Secret sanitization on serialization
benchmarkScopeDecisionSchema.methods.toPublicJSON = function () {
  const obj = this.toObject();
  if (obj.providerOrPartner) {
    delete obj.providerOrPartner.secret;
    delete obj.providerOrPartner.password;
    delete obj.providerOrPartner.token;
    delete obj.providerOrPartner.apiKey;
    delete obj.providerOrPartner.credential;
  }
  return {
    ...obj,
    secretsExposed: 0,
    hasRequiredCredentials: Boolean(this.providerOrPartner?.hasRequiredCredentials),
    configPrerequisites: this.providerOrPartner?.configPrerequisites || [],
    decisionReason: this.exclusionOrConditionalReason,
    nextDecision: this.nextDecisionOrPrerequisite,
    evidenceReference: Array.isArray(this.evidenceReferences) && this.evidenceReferences.length > 0 ? this.evidenceReferences[0] : '',
    affectedCapability: this.capability,
    dependencyCategory: this.category,
    isKdsComponent: this.isKdsRelated,
  };
};

const BenchmarkScopeDecision = mongoose.model(
  'BenchmarkScopeDecision',
  benchmarkScopeDecisionSchema
);

module.exports = {
  BenchmarkScopeDecision,
  DISPOSITIONS,
  VERIFICATION_STATES,
  DEPENDENCY_CATEGORIES,
};
