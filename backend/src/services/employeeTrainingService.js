'use strict';

/**
 * EMPLOYEE TRAINING SERVICE
 * Training assignments, assessment attempt evaluation, passing criteria (80%),
 * and operational prerequisite enforcement.
 */

const { EmployeeTraining } = require('../models/EmployeeTraining');
const { TrainingCourse } = require('../models/TrainingCourse');
const { User } = require('../models/User');

class EmployeeTrainingService {
  /**
   * Asserts that an employee is active and not suspended or exited.
   */
  static async assertEmployeeActive(organisationId, userId) {
    if (!userId) return;
    const user = await User.findOne({ organisationId, userId: userId.toUpperCase() });
    if (user) {
      const isInactive =
        user.accountStatus === 'SUSPENDED' ||
        user.accountStatus === 'DISABLED' ||
        user.accountStatus === 'ARCHIVED' ||
        user.accountStatus === 'LOCKED' ||
        user.status === 'SUSPENDED' ||
        user.status === 'EXITED' ||
        user.status === 'INACTIVE' ||
        user.employmentStatus === 'EXITED' ||
        user.employmentStatus === 'ARCHIVED' ||
        user.employmentStatus === 'TERMINATED' ||
        user.lifecycleStatus === 'SUSPENDED' ||
        user.lifecycleStatus === 'SEPARATED' ||
        user.lifecycleStatus === 'TERMINATED' ||
        user.lifecycleStatus === 'RETIRED';

      if (isInactive) {
        const state = user.accountStatus || user.employmentStatus || user.status || 'INACTIVE';
        const err = new Error(`Employee ${userId} is currently ${state} and cannot receive operational tasks or training assignments.`);
        err.code = 'EMPLOYEE_INACTIVE';
        err.statusCode = 403;
        throw err;
      }
    }
  }

  /**
   * Assigns a training module to an employee.
   */
  static async assignTraining({
    organisationId,
    cafeId = '',
    userId,
    courseId,
    dueDate,
    assignedByUserId,
  }) {
    if (!organisationId || !userId || !courseId || !dueDate) {
      throw new Error('Missing mandatory fields for training assignment.');
    }

    await this.assertEmployeeActive(organisationId, userId);

    const course = await TrainingCourse.findOne({ organisationId, courseId });
    if (!course) {
      const err = new Error(`Training course ${courseId} not found.`);
      err.statusCode = 404;
      throw err;
    }

    const trainingId = `TRN-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const assignment = new EmployeeTraining({
      trainingId,
      organisationId,
      cafeId,
      userId: userId.toUpperCase(),
      courseId: course.courseId,
      trainingTitle: course.title,
      trainingType: course.domain === 'FOOD_SAFETY' ? 'FOOD_SAFETY_BASIC' : 'GENERAL',
      status: 'ASSIGNED',
      dueDate,
      passingScorePercent: course.passThresholdPercent || 80,
      attempts: [],
      isCertified: false,
      notes: `Assigned by ${assignedByUserId || 'SYSTEM'}`,
    });

    await assignment.save();
    return assignment;
  }

  /**
   * Submits an assessment attempt for an assigned training course.
   */
  static async submitAssessmentAttempt({
    organisationId,
    trainingId,
    userId,
    answers = [], // Array of selected option indices [0, 2, 1, ...]
  }) {
    const training = await EmployeeTraining.findOne({
      organisationId,
      trainingId: trainingId.toUpperCase(),
    });

    if (!training) {
      const err = new Error(`Training record ${trainingId} not found.`);
      err.statusCode = 404;
      throw err;
    }

    if (training.userId !== userId.toUpperCase()) {
      const err = new Error('You may only submit assessment attempts for your own assigned training.');
      err.statusCode = 403;
      throw err;
    }

    await this.assertEmployeeActive(organisationId, userId);

    const course = await TrainingCourse.findOne({
      organisationId,
      courseId: training.courseId,
    });

    const quiz = course?.quiz || [];
    let score = 0;
    let totalPoints = 0;

    if (quiz.length > 0) {
      for (let i = 0; i < quiz.length; i++) {
        const q = quiz[i];
        const points = q.points || 10;
        totalPoints += points;
        if (answers[i] === q.correctOptionIndex) {
          score += points;
        }
      }
    } else {
      // Default heuristic if no quiz questions defined: evaluate based on completion
      totalPoints = 100;
      score = answers.length > 0 ? 100 : 0;
    }

    const percentage = totalPoints > 0 ? Math.round((score / totalPoints) * 100) : 0;
    const passingThreshold = training.passingScorePercent || 80;
    const passed = percentage >= passingThreshold;

    const attemptNumber = (training.attempts || []).length + 1;
    const attemptRecord = {
      attemptNumber,
      score,
      totalPoints,
      percentage,
      passed,
      attemptedAt: new Date(),
      answers,
    };

    training.attempts.push(attemptRecord);

    if (passed) {
      training.status = 'COMPLETED';
      training.isCertified = true;
      training.certifiedAt = new Date();
      training.completedAt = new Date();
    } else {
      training.status = 'IN_PROGRESS';
    }

    await training.save();

    return {
      trainingId: training.trainingId,
      attemptNumber,
      score,
      totalPoints,
      percentage,
      passingThreshold,
      passed,
      status: training.status,
      isCertified: training.isCertified,
    };
  }

  /**
   * Checks if an employee has met required training prerequisites for a task category.
   */
  static async checkTaskPrerequisites({ organisationId, userId, category }) {
    if (!userId) return { eligible: true };

    const mandatoryCourses = await TrainingCourse.find({
      organisationId,
      isActive: true,
      mandatoryForCategories: category,
    });

    if (mandatoryCourses.length === 0) {
      return { eligible: true, missingCourses: [] };
    }

    const missingCourses = [];

    for (const course of mandatoryCourses) {
      const completed = await EmployeeTraining.findOne({
        organisationId,
        userId: userId.toUpperCase(),
        courseId: course.courseId,
        isCertified: true,
        status: 'COMPLETED',
      });

      if (!completed) {
        missingCourses.push({
          courseId: course.courseId,
          title: course.title,
        });
      }
    }

    return {
      eligible: missingCourses.length === 0,
      missingCourses,
    };
  }
}

module.exports = {
  EmployeeTrainingService,
};
