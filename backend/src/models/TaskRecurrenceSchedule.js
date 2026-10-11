'use strict';

/**
 * TASK RECURRENCE SCHEDULE — MONGOOSE MODEL
 * Idempotent tracker for recurring template task generation across dates.
 */

const mongoose = require('mongoose');

const taskRecurrenceScheduleSchema = new mongoose.Schema(
  {
    organisationId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    templateId: {
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
      default: 'ALL',
      index: true,
    },

    executionDate: {
      type: String,
      required: true,
      trim: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      index: true,
    },

    generatedTaskId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    status: {
      type: String,
      enum: ['GENERATED', 'SKIPPED', 'FAILED'],
      default: 'GENERATED',
    },

    executedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: 'task_recurrence_schedules',
  }
);

// Compound unique index guaranteeing exact once generation per template per cafe per date
taskRecurrenceScheduleSchema.index(
  { organisationId: 1, templateId: 1, cafeId: 1, executionDate: 1 },
  { unique: true }
);

const TaskRecurrenceSchedule =
  mongoose.models.TaskRecurrenceSchedule ||
  mongoose.model('TaskRecurrenceSchedule', taskRecurrenceScheduleSchema);

module.exports = {
  TaskRecurrenceSchedule,
};
