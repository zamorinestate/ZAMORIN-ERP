'use strict';

const mongoose = require('mongoose');

const TRAINING_RECURRENCES = ['ONE_TIME', 'ANNUAL', 'SEMI_ANNUAL', 'ROLE_CHANGE', 'POLICY_REVISION', 'FOSTAC_RENEWAL', 'QUARTERLY'];
const TRAINING_STATUSES = ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE', 'EXPIRED', 'UPCOMING', 'DUE'];
const TRAINING_TYPES = ['GENERAL', 'FOOD_SAFETY_BASIC', 'FOOD_SAFETY_ADVANCED', 'FOSTAC', 'HACCP', 'HYGIENE', 'FOOD_SAFETY_ONSITE'];
const MEDICAL_FITNESS_STATUSES = ['FIT', 'UNFIT', 'PENDING_EXAMINATION'];
const FOSTAC_VERIFICATION_STATUSES = [
  'RECORDED',
  'PENDING_MANUAL_VERIFICATION',
  'MANUALLY_VERIFIED',
  'OFFICIAL_VERIFICATION_CONFIRMED',
  'INVALID',
  'EXPIRED',
];

const employeeTrainingSchema = new mongoose.Schema(
  {
    trainingId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      match: /^TRN-[\w-]+$/,
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
      index: true,
      default: '',
    },
    userId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    trainingTitle: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    trainingType: {
      type: String,
      enum: TRAINING_TYPES,
      default: 'GENERAL',
      index: true,
    },
    fostacCertificateNumber: {
      type: String,
      trim: true,
      default: '',
    },
    certificateValidityStatus: {
      type: String,
      enum: ['VALID', 'TIME_BOUND', 'CONDITIONALLY_VALID', 'REVOKED', 'EXPIRED', 'PERPETUAL'],
      default: 'VALID', // FSSAI Notice 1 Feb 2024 / 5 Aug 2026 procedure: 2-year validity period (perpetual default revoked)
    },
    certificateIssuedDate: {
      type: Date,
      default: null,
    },
    certificateExpiryDate: {
      type: Date,
      default: null,
    },
    applicableFoSTaCRuleVersion: {
      type: String,
      default: 'FOSTAC_PROCEDURE_2026_08_05',
    },
    refresherRequired: {
      type: Boolean,
      default: true,
    },
    refresherDueDate: {
      type: Date,
      default: null,
    },
    refresherCompletedDate: {
      type: Date,
      default: null,
    },
    renewedCertificateReference: {
      type: String,
      trim: true,
      default: '',
    },
    kob: {
      type: String,
      trim: true,
      default: 'CATERING',
    },
    certificateEvidence: {
      type: String,
      trim: true,
      default: '',
    },
    refresherRequirement: {
      required: { type: Boolean, default: true },
      frequency: { type: String, default: 'BIENNIAL' }, // Refresher required every 2 years for renewal
      lastCompletedDate: { type: Date, default: null },
      nextDueDate: { type: Date, default: null },
    },
    fostacVerificationStatus: {
      type: String,
      enum: FOSTAC_VERIFICATION_STATUSES,
      default: 'RECORDED',
      index: true,
    },
    fostacVerificationAudit: {
      verifiedByUserId: { type: String, trim: true, default: '' },
      verifiedAt: { type: Date, default: null },
      verificationMethod: { type: String, trim: true, default: '' },
      reference: { type: String, trim: true, default: '' },
      result: { type: String, trim: true, default: '' },
    },
    trainer: {
      userId: { type: String, trim: true, default: '' },
      name: { type: String, trim: true, default: '' },
      designation: { type: String, trim: true, default: '' },
    },
    attendance: [
      {
        employeeUserId: { type: String, trim: true },
        name: { type: String, trim: true, default: '' },
        attended: { type: Boolean, default: true },
      },
    ],
    topics: [
      {
        type: String,
        trim: true,
      },
    ],
    evidence: {
      type: String,
      trim: true,
      default: '',
    },
    isFoodSafetySupervisor: {
      type: Boolean,
      default: false,
    },
    medicalFitnessStatus: {
      type: String,
      enum: MEDICAL_FITNESS_STATUSES,
      default: 'FIT',
    },
    medicalCertificateExpiry: {
      type: String,
      default: null,
    },
    typhoidVaccinationDate: {
      type: String,
      default: null,
    },
    dewormingDate: {
      type: String,
      default: null,
    },
    provider: {
      type: String,
      trim: true,
      default: 'Zamorin Academy',
    },
    recurrence: {
      type: String,
      enum: TRAINING_RECURRENCES,
      default: 'ONE_TIME',
    },
    status: {
      type: String,
      enum: TRAINING_STATUSES,
      default: 'ASSIGNED',
      index: true,
    },
    assignedDate: {
      type: String,
      default: () => new Date().toISOString().split('T')[0],
    },
    dueDate: {
      type: String,
      required: true,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    verifiedBy: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },
    validUntil: {
      type: String,
      default: null,
    },
    certificateRef: {
      type: String,
      trim: true,
      default: '',
    },
    courseId: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    attempts: [
      {
        attemptNumber: { type: Number, required: true },
        score: { type: Number, required: true },
        totalPoints: { type: Number, required: true },
        percentage: { type: Number, required: true },
        passed: { type: Boolean, required: true },
        attemptedAt: { type: Date, default: Date.now },
        answers: [{ type: Number }],
      },
    ],
    passingScorePercent: {
      type: Number,
      default: 80,
    },
    isCertified: {
      type: Boolean,
      default: false,
    },
    certifiedAt: {
      type: Date,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

employeeTrainingSchema.index({ organisationId: 1, userId: 1, status: 1 });

/**
 * Calendar-year date arithmetic for FoSTaC 2-year validity.
 * Strictly adheres to regulatory calendar year semantics (not a fixed 730-day constant).
 * Accurately handles leap years (e.g. Feb 29 -> Feb 28 in non-leap target year) and date-only semantics.
 */
function addTwoYearsCalendar(dateInput) {
  const d = new Date(dateInput);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();

  const targetYear = year + 2;
  const isLeapTarget = (targetYear % 4 === 0 && targetYear % 100 !== 0) || (targetYear % 400 === 0);
  let targetDay = day;
  if (month === 1 && day === 29 && !isLeapTarget) {
    targetDay = 28;
  }

  return new Date(Date.UTC(targetYear, month, targetDay, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
}

/**
 * Authoritative FoSTaC Food Safety Supervisor Certificate Validity Engine
 * Governed by FSSAI Official Notice dated 1 February 2024 (discontinuing perpetual validity)
 * and FoSTaC Standardized Procedure dated 5 August 2026 (training delivery/assessment):
 * - Strict 2 calendar-year validity period (calendar year arithmetic, zero 730-day fixed constant)
 * - Refresher training mandatory for renewal
 * - Kind of Business (KoB) stream mismatch invalidation
 * - Zero perpetual grandfathering (1 Feb 2024 notice revoked lifetime validity across all FSS certificates)
 */
employeeTrainingSchema.statics.addTwoYearsCalendar = addTwoYearsCalendar;

employeeTrainingSchema.statics.evaluateFoSTaCCertificateValidity = function ({
  issuedDate,
  ruleVersion = 'FSSAI_NOTICE_2024_02_01',
  kob = 'CATERING',
  operationalKob = 'CATERING',
  refresherCompletedDate = null,
  asOfDate = new Date(),
}) {
  const issue = new Date(issuedDate);
  const now = new Date(asOfDate);

  // Calendar year addition (handles leap years, e.g. Feb 29 -> Feb 28)
  const expiry = addTwoYearsCalendar(issue);
  const isKobMatch = String(kob).toUpperCase() === String(operationalKob).toUpperCase();

  if (!isKobMatch) {
    return {
      certificateStatus: 'INVALID_KOB_MISMATCH',
      isCurrentlyValid: false,
      certificateExpiryDate: expiry,
      refresherRequired: true,
      refresherDueDate: expiry,
      applicableRule: 'FoSTaC Standardized Procedure 5 August 2026 (KoB stream mismatch invalidates certificate)',
      validityYears: 2,
      retrainingRequired: true,
      isPerpetual: false,
    };
  }

  if (now > expiry) {
    if (refresherCompletedDate) {
      const refreshedDate = new Date(refresherCompletedDate);
      const newExpiry = addTwoYearsCalendar(refreshedDate);
      const isStillValid = now <= newExpiry;
      return {
        certificateStatus: isStillValid ? 'VALID' : 'EXPIRED',
        isCurrentlyValid: isStillValid,
        certificateExpiryDate: newExpiry,
        refresherRequired: true,
        refresherDueDate: newExpiry,
        applicableRule: 'FSSAI Notice 1 Feb 2024 & FoSTaC Procedure (Refresher Completed - Renewed 2 Calendar Years)',
        validityYears: 2,
        retrainingRequired: !isStillValid,
        isRenewed: true,
        isPerpetual: false,
      };
    }

    return {
      certificateStatus: 'EXPIRED',
      isCurrentlyValid: false,
      certificateExpiryDate: expiry,
      refresherRequired: true,
      refresherDueDate: expiry,
      applicableRule: 'FSSAI Official Notice dated 1 Feb 2024 (2 Calendar Years Expiry Reached — Perpetual Grandfathering Prohibited)',
      validityYears: 2,
      retrainingRequired: true,
      isPerpetual: false,
    };
  }

  return {
    certificateStatus: 'VALID',
    isCurrentlyValid: true,
    certificateExpiryDate: expiry,
    refresherRequired: true,
    refresherDueDate: expiry,
    applicableRule: 'FSSAI Official Notice dated 1 Feb 2024 (2 Calendar Years Validity Period)',
    validityYears: 2,
    retrainingRequired: false,
    isPerpetual: false,
  };
};

const EmployeeTraining = mongoose.model('EmployeeTraining', employeeTrainingSchema);

module.exports = {
  EmployeeTraining,
  TRAINING_RECURRENCES,
  TRAINING_STATUSES,
  TRAINING_TYPES,
  MEDICAL_FITNESS_STATUSES,
  FOSTAC_VERIFICATION_STATUSES,
};
