'use strict';

/**
 * TASK SCHEDULER SERVICE — F326, F329, F330
 * Idempotent recurring task generator and overdue detector.
 */

const { Task } = require('../models/Task');
const { TaskTemplate } = require('../models/TaskTemplate');
const { TaskRecurrenceSchedule } = require('../models/TaskRecurrenceSchedule');
const { SequenceCounter } = require('../models/SequenceCounter');
const { NotificationOutbox } = require('../models/NotificationOutbox');

function getIstDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function getIstDayOfWeek(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
  }).formatToParts(date);
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const val = parts.find((p) => p.type === 'weekday')?.value;
  return weekdayMap[val] ?? date.getDay();
}

function getIstDayOfMonth(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
  }).formatToParts(date);
  return Number.parseInt(parts.find((p) => p.type === 'day')?.value || '1', 10);
}

class TaskSchedulerService {
  /**
   * Generates recurring tasks idempotently for the specified date.
   */
  static async runRecurringGeneration({ organisationId, cafeId = null, executionDate = null, actorId = 'SYSTEM' }) {
    if (!organisationId) throw new Error('organisationId is required');

    const targetDate = executionDate || getIstDateString();
    const now = new Date();
    const dayOfWeek = getIstDayOfWeek(now);
    const dayOfMonth = getIstDayOfMonth(now);

    const query = {
      organisationId,
      isActive: true,
      'recurrence.isRecurring': true,
    };
    if (cafeId && cafeId !== 'ALL') {
      query.$or = [{ cafeId: null }, { cafeId }];
    }

    const templates = await TaskTemplate.find(query);
    const generatedTasks = [];
    const skippedTemplates = [];

    for (const tpl of templates) {
      // Check frequency applicability
      const rec = tpl.recurrence;
      let isApplicable = false;

      if (rec.frequency === 'DAILY') {
        isApplicable = true;
      } else if (rec.frequency === 'WEEKLY') {
        if (!rec.daysOfWeek || rec.daysOfWeek.length === 0 || rec.daysOfWeek.includes(dayOfWeek)) {
          isApplicable = true;
        }
      } else if (rec.frequency === 'MONTHLY') {
        if (!rec.dayOfMonth || rec.dayOfMonth === dayOfMonth) {
          isApplicable = true;
        }
      }

      if (!isApplicable) {
        skippedTemplates.push({ templateId: tpl.templateId, reason: 'NOT_SCHEDULED_TODAY' });
        continue;
      }

      const targetCafe = tpl.cafeId || cafeId || 'ALL';

      // Atomic deduplication check
      try {
        // Pre-generate ID
        const seqId = await SequenceCounter.generateId({
          organisationId,
          sequenceKey: 'TASK',
          prefix: 'TSK',
          minimumDigits: 4,
        });

        // Unique insert: if { organisationId, templateId, cafeId, executionDate } exists, will fail with code 11000
        const scheduleRecord = await TaskRecurrenceSchedule.create({
          organisationId,
          templateId: tpl.templateId,
          cafeId: targetCafe,
          executionDate: targetDate,
          generatedTaskId: seqId,
          status: 'GENERATED',
          executedAt: new Date(),
        });

        // Compute due time
        let dueTime = '23:59';
        if (rec.scheduledTime) {
          const [sh, sm] = rec.scheduledTime.split(':').map(Number);
          const offset = rec.dueTimeOffsetHours || 4;
          const dueHour = Math.min((sh || 0) + offset, 23);
          dueTime = `${String(dueHour).padStart(2, '0')}:${String(sm || 0).padStart(2, '0')}`;
        }

        // Create Task
        const newTask = new Task({
          taskId: seqId,
          organisationId,
          cafeId: tpl.cafeId || cafeId || null,
          title: tpl.title,
          description: tpl.description,
          category: tpl.category,
          risk: tpl.risk,
          priority: tpl.priority,
          isCriticalControl: tpl.isCriticalControl,
          assignedRole: tpl.assignedRole,
          assignedUserId: tpl.defaultAssignedUserId,
          dueDate: targetDate,
          dueTime,
          verificationRequired: tpl.verificationRequired,
          templateId: tpl.templateId,
          checklist: (tpl.checklist || []).map((c) => ({
            item: c.item,
            status: 'PENDING',
            failureReason: '',
          })),
          sopReference: tpl.sopReference || { sopId: null, title: '', version: 1, docUrl: '' },
          locationRequirement: tpl.geofence?.latitude != null
            ? {
                requiresLocation: Boolean(tpl.requiresLocationProof),
                targetLatitude: tpl.geofence.latitude,
                targetLongitude: tpl.geofence.longitude,
                allowedRadiusMeters: tpl.geofence.radiusMeters || 200,
              }
            : { requiresLocation: false, allowedRadiusMeters: 200 },
          source: 'RECURRING_TEMPLATE',
          recurrence: {
            isRecurring: true,
            frequency: tpl.recurrence.frequency,
            occurrenceIndex: 1,
          },
          history: [
            {
              action: 'GENERATED_FROM_TEMPLATE',
              actorId,
              actorRole: 'SYSTEM',
              timestamp: new Date(),
              reason: `Daily recurrence schedule for ${targetDate}`,
              details: { templateId: tpl.templateId },
            },
          ],
          createdByUserId: actorId,
        });

        await newTask.save();
        generatedTasks.push(newTask);

        // Queue Notification
        const notificationPayload = {
          outboxId: `OUTBOX-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
          organisationId,
          eventType: 'TASK_ASSIGNED',
          recipientUserId: tpl.defaultAssignedUserId || null,
          recipientEmail: `${(tpl.defaultAssignedUserId || 'ops').toLowerCase()}@zamorin.test`,
          templateId: 'TASK_ASSIGNMENT_EMAIL',
          subject: `New Task: ${tpl.title}`,
          channel: 'TASK_ASSIGNMENT',
          recipient: tpl.defaultAssignedUserId || tpl.assignedRole,
          title: `New Task: ${tpl.title}`,
          body: `Operational checklist ${tpl.title} assigned for ${targetDate}. Due at ${dueTime}.`,
          metadata: { taskId: seqId, templateId: tpl.templateId },
          status: 'QUEUED',
          retryCount: 0,
        };

        await NotificationOutbox.create(notificationPayload).catch(() => {});
      } catch (err) {
        if (err.code === 11000) {
          // Idempotent duplicate: already generated for this execution date
          skippedTemplates.push({ templateId: tpl.templateId, reason: 'ALREADY_GENERATED_FOR_DATE' });
        } else {
          throw err;
        }
      }
    }

    return {
      executionDate: targetDate,
      generatedCount: generatedTasks.length,
      skippedCount: skippedTemplates.length,
      tasks: generatedTasks,
      skipped: skippedTemplates,
    };
  }

  /**
   * Identifies overdue tasks and dispatches reminder notifications.
   */
  static async processOverdueTasks({ organisationId, cafeId = null }) {
    if (!organisationId) throw new Error('organisationId is required');

    const today = getIstDateString();
    const query = {
      organisationId,
      status: { $in: ['PENDING', 'IN_PROGRESS', 'AWAITING_VERIFICATION', 'RETURNED_FOR_CORRECTION'] },
      dueDate: { $lt: today },
    };
    if (cafeId && cafeId !== 'ALL') {
      query.cafeId = cafeId;
    }

    const overdueTasks = await Task.find(query);
    const notificationsQueued = [];

    for (const task of overdueTasks) {
      const outboxRecord = await NotificationOutbox.create({
        outboxId: `OUTBOX-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
        organisationId,
        eventType: 'TASK_OVERDUE',
        recipientUserId: task.assignedUserId || null,
        recipientEmail: `${(task.assignedUserId || 'ops').toLowerCase()}@zamorin.test`,
        recipientRole: task.assignedRole || 'STAFF',
        templateId: 'TASK_OVERDUE_EMAIL',
        subject: `OVERDUE TASK: ${task.title}`,
        channels: ['EMAIL', 'IN_APP'],
        payload: { taskId: task.taskId, priority: task.priority },
        status: 'QUEUED',
      }).catch((err) => {
        console.warn('NotificationOutbox error:', err.message);
        return null;
      });

      if (outboxRecord) notificationsQueued.push(outboxRecord);
    }

    return {
      overdueCount: overdueTasks.length,
      remindersQueued: notificationsQueued.length,
      tasks: overdueTasks.map((t) => ({ taskId: t.taskId, dueDate: t.dueDate, title: t.title })),
    };
  }
}

module.exports = {
  TaskSchedulerService,
};
