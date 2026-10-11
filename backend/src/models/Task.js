'use strict';

/**
 * TASK — MONGOOSE MODEL
 */

const mongoose = require('mongoose');

const TASK_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const TASK_STATUSES = [
  'PENDING',
  'IN_PROGRESS',
  'SUBMITTED',
  'AWAITING_VERIFICATION',
  'COMPLETED',
  'RETURNED_FOR_CORRECTION',
  'BLOCKED',
  'CANCELLED',
  'MISSED',
];
const TASK_CATEGORIES = [
  'EQUIPMENT_MAINTENANCE',
  'INVENTORY_RECEIVING',
  'SAFETY_COMPLIANCE',
  'HYGIENE_INSPECTION',
  'CASH_CONTROL_AUDIT',
  'MANAGEMENT_DELEGATION',
  'GENERAL_OPERATIONS',
];
const TASK_RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const VERIFICATION_STATUSES = ['NONE', 'PENDING_VERIFICATION', 'VERIFIED', 'RETURNED_FOR_CORRECTION'];

const taskSchema = new mongoose.Schema(
  {
    taskId: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      trim: true,
      uppercase: true,
      match: /^TSK-\d{4,}$/,
      index: true,
    },

    organisationId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    cafeId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
      index: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 300,
    },

    description: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: '',
    },

    category: {
      type: String,
      enum: TASK_CATEGORIES,
      default: 'GENERAL_OPERATIONS',
      index: true,
    },

    risk: {
      type: String,
      enum: TASK_RISK_LEVELS,
      default: 'LOW',
      index: true,
    },

    isCriticalControl: {
      type: Boolean,
      default: false,
      index: true,
    },

    assignedRole: {
      type: String,
      enum: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STAFF'],
      default: 'CAFE_ADMIN',
    },

    assignedUserId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },

    responsibleUserId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },

    priority: {
      type: String,
      enum: TASK_PRIORITIES,
      default: 'NORMAL',
    },

    status: {
      type: String,
      enum: TASK_STATUSES,
      default: 'PENDING',
      index: true,
    },

    dueDate: {
      type: String,
      trim: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      default: null,
    },

    dueTime: {
      type: String,
      trim: true,
      default: '23:59',
    },

    verificationRequired: {
      type: Boolean,
      default: false,
    },

    verificationStatus: {
      type: String,
      enum: VERIFICATION_STATUSES,
      default: 'NONE',
    },

    verifiedByUserId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },

    verifiedAt: {
      type: Date,
      default: null,
    },

    verificationRemarks: {
      type: String,
      trim: true,
      default: '',
    },

    returnReason: {
      type: String,
      trim: true,
      default: '',
    },

    returnHistory: [
      {
        returnedByUserId: String,
        returnedAt: { type: Date, default: Date.now },
        reason: String,
        remarks: String,
      },
    ],

    blockedReason: {
      type: String,
      trim: true,
      default: '',
    },

    blockedAt: {
      type: Date,
      default: null,
    },

    cancellationReason: {
      type: String,
      trim: true,
      default: '',
    },

    checklist: [
      {
        item: { type: String, required: true },
        status: { type: String, enum: ['PASS', 'FAIL', 'NA', 'PENDING'], default: 'PENDING' },
        failureReason: { type: String, default: '' },
      },
    ],

    evidence: [
      {
        fileId: String,
        fileName: String,
        fileUrl: String,
        uploadedByUserId: String,
        uploadedAt: { type: Date, default: Date.now },
        photoType: { type: String, default: 'TASK_PROOF' },
      },
    ],

    templateId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
      index: true,
    },

    dependencyTaskIds: [
      {
        type: String,
        trim: true,
        uppercase: true,
      },
    ],

    locationRequirement: {
      requiresLocation: { type: Boolean, default: false },
      targetLatitude: { type: Number, default: null },
      targetLongitude: { type: Number, default: null },
      allowedRadiusMeters: { type: Number, default: 200 },
    },

    submittedLocation: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
      accuracyMeters: { type: Number, default: null },
      distanceMeters: { type: Number, default: null },
      isVerified: { type: Boolean, default: null },
      submittedAt: { type: Date, default: null },
    },

    aiReview: {
      reviewedAt: { type: Date, default: null },
      isApproved: { type: Boolean, default: null },
      confidenceScore: { type: Number, default: null },
      providerStatus: {
        type: String,
        enum: ['VERIFIED', 'PENDING_HUMAN_REVIEW', 'BLOCKED_EXTERNAL_DEPENDENCY', 'NONE'],
        default: 'NONE',
      },
      evaluationNotes: { type: String, default: '' },
      flaggedIssues: [{ type: String }],
    },

    history: [
      {
        action: { type: String, required: true },
        actorId: { type: String, required: true },
        actorRole: { type: String, default: '' },
        timestamp: { type: Date, default: Date.now },
        reason: { type: String, default: '' },
        details: { type: mongoose.Schema.Types.Mixed, default: {} },
      },
    ],

    sopReference: {
      sopId: { type: String, default: null },
      title: { type: String, default: '' },
      version: { type: Number, default: 1 },
      docUrl: { type: String, default: '' },
    },

    recurrence: {
      isRecurring: { type: Boolean, default: false },
      frequency: { type: String, enum: ['DAILY', 'WEEKLY', 'MONTHLY'], default: 'DAILY' },
      occurrenceIndex: { type: Number, default: 1 },
    },

    source: {
      type: String,
      enum: ['MANUAL', 'RECURRING_TEMPLATE', 'FAILED_CHECKLIST', 'INCIDENT', 'SYSTEM_RULE'],
      default: 'MANUAL',
    },

    completedByUserId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    createdByUserId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
    },
  },
  {
    timestamps: true,
    versionKey: 'version',
    collection: 'tasks',
  }
);

taskSchema.index(
  { organisationId: 1, status: 1, assignedRole: 1 },
  { name: 'org_status_role' }
);

taskSchema.pre('validate', function normaliseTaskFields() {
  const upperFields = ['taskId', 'organisationId', 'cafeId', 'assignedUserId', 'completedByUserId', 'createdByUserId'];
  for (const field of upperFields) {
    if (this[field] && typeof this[field] === 'string') {
      this[field] = this[field].trim().toUpperCase();
    }
  }
  if (this.priority) this.priority = this.priority.trim().toUpperCase();
  if (this.status) this.status = this.status.trim().toUpperCase();
  if (this.assignedRole) this.assignedRole = this.assignedRole.trim().toUpperCase();
});

const Task =
  mongoose.models.Task ||
  mongoose.model('Task', taskSchema);

module.exports = {
  Task,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_CATEGORIES,
  TASK_RISK_LEVELS,
  VERIFICATION_STATUSES,
};
