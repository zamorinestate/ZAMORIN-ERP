'use strict';

const mongoose = require('mongoose');

const trainingCourseSchema = new mongoose.Schema(
  {
    organisationId: {
      type: String,
      required: true,
      index: true,
    },
    courseId: {
      type: String,
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
    },
    sopId: {
      type: String,
      default: null,
    },
    domain: {
      type: String,
      default: 'FOOD_SAFETY',
    },
    applicableRoles: [
      {
        type: String,
        trim: true,
        uppercase: true,
      },
    ],
    durationMinutes: {
      type: Number,
      default: 60,
    },
    passThresholdPercent: {
      type: Number,
      default: 80,
      min: 0,
      max: 100,
    },
    refreshCycleDays: {
      type: Number,
      default: null, // null if one-time
    },
    isFostacLinked: {
      type: Boolean,
      default: false,
    },
    fostacProcedureDate: {
      type: String,
      default: '2026-08-05', // Standardized Procedure for Conduct of FoSTaC Programme (dated 5 August 2026)
    },
    learningMaterials: [
      {
        title: { type: String, default: '' },
        contentUrl: { type: String, default: '' },
        format: { type: String, default: 'PDF' },
      },
    ],
    mandatoryForCategories: [
      {
        type: String,
        trim: true,
      },
    ],
    quiz: [
      {
        question: { type: String, required: true },
        options: [{ type: String, required: true }],
        correctOptionIndex: { type: Number, required: true },
        points: { type: Number, default: 10 },
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

trainingCourseSchema.index({ organisationId: 1, courseId: 1 }, { unique: true });

const TrainingCourse = mongoose.model('TrainingCourse', trainingCourseSchema);

module.exports = { TrainingCourse };
