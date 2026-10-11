'use strict';

/**
 * TASK TEMPLATE — MONGOOSE MODEL
 * Stepwise operational checklists, opening/closing routines, hygiene, maintenance, cash control.
 */

const mongoose = require('mongoose');
const {
  TASK_PRIORITIES,
  TASK_CATEGORIES,
  TASK_RISK_LEVELS,
} = require('./Task');

const RECURRENCE_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'SHIFT_BASED', 'NONE'];

const taskTemplateSchema = new mongoose.Schema(
  {
    templateId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      match: /^TPL-\d{4,}$/,
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
      default: null, // null = Enterprise global template
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

    priority: {
      type: String,
      enum: TASK_PRIORITIES,
      default: 'NORMAL',
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

    defaultAssignedUserId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },

    checklist: [
      {
        item: { type: String, required: true },
        isMandatory: { type: Boolean, default: true },
        category: { type: String, default: 'GENERAL' },
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
      frequency: { type: String, enum: RECURRENCE_FREQUENCIES, default: 'NONE' },
      scheduledTime: { type: String, default: '08:00' }, // HH:mm IST
      dueTimeOffsetHours: { type: Number, default: 4 }, // due time after scheduled time
      daysOfWeek: [{ type: Number, min: 0, max: 6 }], // 0 = Sun, 6 = Sat
      dayOfMonth: { type: Number, min: 1, max: 31, default: 1 },
    },

    verificationRequired: {
      type: Boolean,
      default: false,
    },

    requiresPhotoProof: {
      type: Boolean,
      default: false,
    },

    requiresLocationProof: {
      type: Boolean,
      default: false,
    },

    geofence: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
      radiusMeters: { type: Number, default: 200 },
    },

    aiVerificationEnabled: {
      type: Boolean,
      default: false,
    },

    requiredTrainingCourseId: {
      type: String,
      default: null,
    },

    dependencyTemplateIds: [
      {
        type: String,
        trim: true,
        uppercase: true,
      },
    ],

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    createdByUserId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
  },
  {
    timestamps: true,
    versionKey: 'version',
    collection: 'task_templates',
  }
);

taskTemplateSchema.index({ organisationId: 1, category: 1, isActive: 1 });
taskTemplateSchema.index({ organisationId: 1, cafeId: 1, isActive: 1 });

const TaskTemplate =
  mongoose.models.TaskTemplate ||
  mongoose.model('TaskTemplate', taskTemplateSchema);

module.exports = {
  TaskTemplate,
  RECURRENCE_FREQUENCIES,
};
