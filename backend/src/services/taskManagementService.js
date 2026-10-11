'use strict';

/**
 * TASK MANAGEMENT SERVICE — F326-F333
 * Core business engine for task assignment, dependencies, geofence proof,
 * AI review, segregation of duties, and compliance reports.
 */

const { Task } = require('../models/Task');
const { TaskTemplate } = require('../models/TaskTemplate');
const { StandardOperatingProcedure } = require('../models/StandardOperatingProcedure');
const { NotificationOutbox } = require('../models/NotificationOutbox');
const { validateLocationProof } = require('./taskLocationService');
const { TaskAiVerificationService } = require('./taskAiVerificationService');
const { EmployeeTrainingService } = require('./employeeTrainingService');
const { SequenceCounter } = require('../models/SequenceCounter');

function getIstDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

class TaskManagementService {
  /**
   * Asserts that all predecessor task dependencies are in COMPLETED status.
   */
  static async assertDependenciesSatisfied(task) {
    if (!task.dependencyTaskIds || task.dependencyTaskIds.length === 0) {
      return;
    }

    const predecessorTasks = await Task.find({
      organisationId: task.organisationId,
      taskId: { $in: task.dependencyTaskIds },
    });

    for (const predId of task.dependencyTaskIds) {
      const found = predecessorTasks.find((p) => p.taskId === predId);
      if (!found) {
        const err = new Error(`Required predecessor task ${predId} was not found.`);
        err.code = 'PREDECESSOR_NOT_FOUND';
        err.statusCode = 400;
        throw err;
      }
      if (found.status !== 'COMPLETED') {
        const err = new Error(
          `Cannot proceed: Predecessor task ${predId} is currently ${found.status} (must be COMPLETED first).`
        );
        err.code = 'PREDECESSOR_NOT_COMPLETED';
        err.statusCode = 400;
        err.predecessorTaskId = predId;
        err.predecessorStatus = found.status;
        throw err;
      }
    }
  }

  /**
   * Creates a new governed task with dependencies and template bindings.
   */
  static async createTask(organisationId, data, auth) {
    if (!organisationId) throw new Error('organisationId is required');

    // Check employee active status if assigned to user
    if (data.assignedUserId) {
      await EmployeeTrainingService.assertEmployeeActive(organisationId, data.assignedUserId);
    }

    // Check training prerequisites
    if (data.assignedUserId && data.category) {
      const prereq = await EmployeeTrainingService.checkTaskPrerequisites({
        organisationId,
        userId: data.assignedUserId,
        category: data.category,
      });
      if (!prereq.eligible) {
        const err = new Error(
          `Assigned employee has not completed mandatory training for category ${data.category}: ${prereq.missingCourses.map((c) => c.title).join(', ')}.`
        );
        err.code = 'TRAINING_PREREQUISITE_UNMET';
        err.statusCode = 400;
        throw err;
      }
    }

    // Resolve SOP version if sopId provided
    let sopRef = data.sopReference || { sopId: null, title: '', version: 1, docUrl: '' };
    if (data.sopId) {
      const sop = await StandardOperatingProcedure.findOne({
        organisationId,
        sopId: data.sopId,
        isDeleted: false,
      });
      if (sop) {
        sopRef = {
          sopId: sop.sopId,
          title: sop.title,
          version: sop.version,
          docUrl: `/api/v1/owner-academy/sops/${sop.sopId}`,
        };
      }
    }

    const seqId = await SequenceCounter.generateId({
      organisationId,
      sequenceKey: 'TASK',
      prefix: 'TSK',
      minimumDigits: 4,
    });

    const task = new Task({
      taskId: seqId,
      organisationId,
      cafeId: data.cafeId || null,
      title: data.title.trim(),
      description: data.description ? data.description.trim() : '',
      category: data.category || 'GENERAL_OPERATIONS',
      risk: data.risk || 'LOW',
      isCriticalControl: Boolean(data.isCriticalControl),
      assignedRole: data.assignedRole || 'CAFE_ADMIN',
      assignedUserId: data.assignedUserId ? data.assignedUserId.trim().toUpperCase() : null,
      responsibleUserId: data.responsibleUserId ? data.responsibleUserId.trim().toUpperCase() : null,
      priority: data.priority || 'NORMAL',
      status: 'PENDING',
      dueDate: data.dueDate || null,
      dueTime: data.dueTime || '23:59',
      verificationRequired: Boolean(data.verificationRequired),
      verificationStatus: 'NONE',
      templateId: data.templateId || null,
      dependencyTaskIds: Array.isArray(data.dependencyTaskIds)
        ? data.dependencyTaskIds.map((id) => String(id).trim().toUpperCase())
        : [],
      locationRequirement: data.locationRequirement || {
        requiresLocation: false,
        allowedRadiusMeters: 200,
      },
      checklist: Array.isArray(data.checklist)
        ? data.checklist.map((c) => ({
            item: typeof c === 'string' ? c.trim() : c.item.trim(),
            status: 'PENDING',
            failureReason: '',
          }))
        : [],
      sopReference: sopRef,
      recurrence: data.recurrence || { isRecurring: false, frequency: 'DAILY', occurrenceIndex: 1 },
      source: data.source || 'MANUAL',
      history: [
        {
          action: 'CREATED',
          actorId: auth.userId,
          actorRole: auth.role,
          timestamp: new Date(),
          reason: 'Manual or template creation',
          details: { assignedRole: data.assignedRole, assignedUserId: data.assignedUserId },
        },
      ],
      createdByUserId: auth.userId,
    });

    await task.save();

    // Outbox notification
    await NotificationOutbox.create({
      outboxId: `OUTBOX-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
      organisationId,
      eventType: 'TASK_ASSIGNED',
      recipientUserId: task.assignedUserId || null,
      recipientEmail: `${(task.assignedUserId || 'ops').toLowerCase()}@zamorin.test`,
      recipientRole: task.assignedRole || 'STAFF',
      templateId: 'TASK_ASSIGNMENT_EMAIL',
      subject: `Task Assigned: ${task.title}`,
      channels: ['EMAIL', 'IN_APP'],
      payload: { taskId: task.taskId, priority: task.priority },
      status: 'QUEUED',
    }).catch(() => {});

    return task;
  }

  /**
   * Submits evidence and checklist responses for a task.
   */
  static async submitTaskEvidence({ organisationId, taskId, submission, auth }) {
    const task = await Task.findOne({ organisationId, taskId });
    if (!task) {
      const err = new Error(`Task ${taskId} not found.`);
      err.statusCode = 404;
      throw err;
    }

    if (task.status === 'CANCELLED') {
      const err = new Error('Cancelled tasks cannot accept evidence submissions.');
      err.statusCode = 400;
      throw err;
    }

    if (task.status === 'COMPLETED') {
      const err = new Error('Task is already completed. Reopen first if submitting new evidence.');
      err.statusCode = 400;
      throw err;
    }

    // Check predecessor task dependencies
    await this.assertDependenciesSatisfied(task);

    // Update checklist responses
    if (Array.isArray(submission.checklist)) {
      task.checklist = submission.checklist.map((item) => ({
        item: item.item,
        status: item.status || 'PASS',
        failureReason: item.failureReason || '',
      }));
    }

    // Append evidence attachments
    if (Array.isArray(submission.evidence)) {
      for (const ev of submission.evidence) {
        task.evidence.push({
          fileId: ev.fileId || `FILE-${Date.now()}`,
          fileName: ev.fileName || 'evidence.jpg',
          fileUrl: ev.fileUrl || '',
          uploadedByUserId: auth.userId,
          uploadedAt: new Date(),
          photoType: ev.photoType || 'TASK_PROOF',
        });
      }
    }

    // Location verification
    let locationProofResult = null;
    if (submission.location) {
      const targetGeofence = {
        latitude: task.locationRequirement?.targetLatitude,
        longitude: task.locationRequirement?.targetLongitude,
        radiusMeters: task.locationRequirement?.allowedRadiusMeters || 200,
      };

      locationProofResult = validateLocationProof(submission.location, targetGeofence);

      task.submittedLocation = {
        latitude: submission.location.latitude,
        longitude: submission.location.longitude,
        accuracyMeters: submission.location.accuracyMeters || null,
        distanceMeters: locationProofResult.distanceMeters,
        isVerified: locationProofResult.isVerified,
        submittedAt: new Date(),
      };

      if (task.locationRequirement?.requiresLocation && !locationProofResult.isVerified) {
        const err = new Error(
          `Location verification failed: submitted location is ${locationProofResult.distanceMeters}m from site, exceeding the ${targetGeofence.radiusMeters}m permitted radius.`
        );
        err.code = 'GEOFENCE_VALIDATION_FAILED';
        err.statusCode = 400;
        err.distanceMeters = locationProofResult.distanceMeters;
        throw err;
      }
    } else if (task.locationRequirement?.requiresLocation) {
      const err = new Error('Location proof is mandatory for this task, but no GPS coordinates were submitted.');
      err.code = 'LOCATION_PROOF_REQUIRED';
      err.statusCode = 400;
      throw err;
    }

    // Automated AI proof evaluation (F328)
    const aiEvaluation = TaskAiVerificationService.evaluateEvidence(task, {
      evidence: task.evidence,
      checklist: task.checklist,
      notes: submission.notes,
    });

    task.aiReview = aiEvaluation;

    // Transition state
    task.completedByUserId = auth.userId;
    task.completedAt = new Date();

    if (task.verificationRequired) {
      task.status = 'AWAITING_VERIFICATION';
      task.verificationStatus = 'PENDING_VERIFICATION';
    } else {
      task.status = 'COMPLETED';
    }

    task.history.push({
      action: 'EVIDENCE_SUBMITTED',
      actorId: auth.userId,
      actorRole: auth.role,
      timestamp: new Date(),
      reason: submission.notes || 'Task completion submission with evidence',
      details: {
        evidenceCount: task.evidence.length,
        checklistCount: task.checklist.length,
        locationVerified: task.submittedLocation?.isVerified,
        aiStatus: task.aiReview?.providerStatus,
      },
    });

    await task.save();

    return {
      task,
      locationProofResult,
      aiEvaluation,
    };
  }

  /**
   * Aggregates multi-outlet task compliance and performance metrics (F331, F333).
   */
  static async getComplianceReport({ organisationId, cafeId = null }) {
    const today = getIstDateString();
    const query = { organisationId };
    if (cafeId && cafeId !== 'ALL') {
      query.cafeId = cafeId;
    }

    const tasks = await Task.find(query).lean();

    let totalTasks = tasks.length;
    let completedTasks = 0;
    let overdueTasks = 0;
    let onTimeCompleted = 0;
    let locationVerifiedCount = 0;
    let locationRequiredCount = 0;
    let photoEvidenceCount = 0;
    let returnedCount = 0;

    const byCategory = {};
    const byOutlet = {};

    for (const t of tasks) {
      const outletKey = t.cafeId || 'GLOBAL';
      byOutlet[outletKey] = byOutlet[outletKey] || { total: 0, completed: 0, overdue: 0 };
      byOutlet[outletKey].total++;

      const catKey = t.category || 'GENERAL_OPERATIONS';
      byCategory[catKey] = byCategory[catKey] || { total: 0, completed: 0 };
      byCategory[catKey].total++;

      if (t.status === 'COMPLETED') {
        completedTasks++;
        byOutlet[outletKey].completed++;
        byCategory[catKey].completed++;
        if (!t.dueDate || (t.completedAt && getIstDateString(new Date(t.completedAt)) <= t.dueDate)) {
          onTimeCompleted++;
        }
      }

      const isOpen = ['PENDING', 'IN_PROGRESS', 'AWAITING_VERIFICATION', 'RETURNED_FOR_CORRECTION'].includes(t.status);
      if (isOpen && t.dueDate && t.dueDate < today) {
        overdueTasks++;
        byOutlet[outletKey].overdue++;
      }

      if (t.status === 'RETURNED_FOR_CORRECTION') {
        returnedCount++;
      }

      if (t.locationRequirement?.requiresLocation) {
        locationRequiredCount++;
        if (t.submittedLocation?.isVerified) {
          locationVerifiedCount++;
        }
      }

      if (t.evidence && t.evidence.length > 0) {
        photoEvidenceCount++;
      }
    }

    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 100;
    const onTimeRate = completedTasks > 0 ? Math.round((onTimeCompleted / completedTasks) * 100) : 100;
    const geofenceComplianceRate =
      locationRequiredCount > 0 ? Math.round((locationVerifiedCount / locationRequiredCount) * 100) : 100;

    return {
      totalTasks,
      completedTasks,
      overdueTasks,
      onTimeCompleted,
      completionRate,
      onTimeRate,
      geofenceComplianceRate,
      photoEvidenceCount,
      returnedCount,
      byOutlet,
      byCategory,
    };
  }
}

module.exports = {
  TaskManagementService,
};
