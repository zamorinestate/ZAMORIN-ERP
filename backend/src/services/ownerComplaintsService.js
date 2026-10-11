'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — OWNER CUSTOMER COMPLAINTS & SERVICE RECOVERY SERVICE (STAGE 11)
 * ============================================================================
 */

const CustomerComplaintModule = require('../models/CustomerComplaint');
const CustomerComplaint = CustomerComplaintModule.CustomerComplaint || CustomerComplaintModule;
const BillModule = require('../models/Bill');
const Bill = BillModule.Bill || BillModule;
const FSIModule = require('../models/FoodSafetyIncident');
const FoodSafetyIncident = FSIModule.FoodSafetyIncident || FSIModule;
const CapaModule = require('../models/CapaRecord');
const CapaRecord = CapaModule.CapaRecord || CapaModule;
const refundService = require('./refundService');

const VALID_TRANSITIONS = {
  RECEIVED: ['TRIAGED', 'CLOSED'],
  TRIAGED: ['ASSIGNED', 'INVESTIGATING', 'CLOSED'],
  ASSIGNED: ['INVESTIGATING', 'ACTIONED', 'CLOSED'],
  INVESTIGATING: ['ACTIONED', 'CUSTOMER_RESPONSE', 'CLOSED'],
  ACTIONED: ['CUSTOMER_RESPONSE', 'RESOLVED', 'CLOSED'],
  CUSTOMER_RESPONSE: ['RESOLVED', 'ACTIONED', 'CLOSED'],
  RESOLVED: ['CLOSED', 'REOPENED'],
  CLOSED: ['REOPENED'],
  REOPENED: ['TRIAGED', 'INVESTIGATING', 'CLOSED']
};

class OwnerComplaintsService {
  /**
   * Create / Intake a new complaint
   */
  async createComplaint(organisationId, payload, user) {
    if (!organisationId) throw new Error('ORGANISATION_ID_REQUIRED');
    const {
      cafeId,
      channel = 'CAFE_IN_PERSON',
      channelReference,
      complaintCategory = 'OTHER',
      severity = 'MEDIUM',
      description,
      customerName,
      customerPhone,
      customerEmail,
      billId,
      menuItemId,
      serviceArea,
      isFoodSafetyIssue = false,
      foodSafetyDetails
    } = payload;

    if (!cafeId || !description) {
      throw new Error('CAFE_ID_AND_DESCRIPTION_REQUIRED');
    }

    if (user && (user.role === 'CAFE_ADMIN' || user.role === 'STORE_MANAGER')) {
      const assigned = user.assignedCafeIds || [user.cafeId || user.primaryCafeId].filter(Boolean);
      if (assigned.length > 0 && !assigned.includes(cafeId)) {
        throw new Error('CROSS_CAFE_ACCESS_DENIED: Cannot create complaint for another café.');
      }
    }

    // Bill linkage verification: verify real bill exists if provided
    let linkedBill = null;
    if (billId) {
      linkedBill = await Bill.findOne({
        $or: [{ _id: billId }, { billId: billId }],
        organisationId: { $in: [organisationId, organisationId.toString()] },
        cafeId: { $in: [cafeId, cafeId.toString()] }
      }).lean();
      if (!linkedBill) {
        throw new Error('BILL_NOT_FOUND_IN_SPECIFIED_CAFE');
      }
    }

    const complaintId = `CMP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    // Canonical Food-Safety Escalation if severe contamination, allergy, or food illness allegation
    let canonicalFoodSafetyIncidentId = null;
    let canonicalCapaId = null;

    if (isFoodSafetyIssue || complaintCategory === 'FOOD_SAFETY_ALLERGEN' || severity === 'CRITICAL') {
      try {
        const incidentIdStr = `FSI-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;
        const incident = await FoodSafetyIncident.create({
          incidentId: incidentIdStr,
          organisationId: organisationId.toString(),
          cafeId: cafeId.toString(),
          incidentType: complaintCategory === 'FOOD_SAFETY_ALLERGEN' ? 'ALLERGEN_REACTION' : 'OTHER',
          severity: severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
          description: `Customer allegation: ${description}`,
          status: 'REPORTED',
          reportedByUserId: user?.userId || 'SYSTEM'
        });
        canonicalFoodSafetyIncidentId = incident.incidentId || incident._id;

        if (severity === 'CRITICAL' || complaintCategory === 'FOOD_SAFETY_ALLERGEN') {
          const capaIdStr = `CAPA-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;
          const capa = await CapaRecord.create({
            capaId: capaIdStr,
            organisationId: organisationId.toString(),
            cafeId: cafeId.toString(),
            source: 'FOOD_SAFETY_INCIDENT',
            sourceReferenceId: complaintId,
            title: `CAPA for Customer Complaint ${complaintId}`,
            findingDescription: description,
            rootCauseAnalysis: 'Investigation in progress following customer allegation',
            correctiveActionPlan: 'Inspect batch and isolate affected inventory',
            preventiveActionPlan: 'Retrain staff on allergen handling protocol',
            assignedOwnerUserId: user?.userId || 'OWNER',
            dueDate: new Date(Date.now() + 7 * 86400000),
            status: 'OPEN'
          });
          canonicalCapaId = capa.capaId || capa._id;
        }
      } catch (err) {
        console.warn('FoodSafetyIncident linkage notice:', err.message);
      }
    }

    const complaint = new CustomerComplaint({
      complaintId,
      organisationId: organisationId.toString(),
      cafeId: cafeId.toString(),
      channel,
      sourceReference: channelReference || null,
      category: complaintCategory === 'FOOD_SAFETY_ALLERGEN' ? 'ALLERGEN_SAFETY' : (complaintCategory === 'FOOD_QUALITY' ? 'FOOD_QUALITY' : 'OTHER'),
      severity,
      customerName: customerName || 'Walk-in Guest',
      customerContact: customerPhone || customerEmail || null,
      customerPhone: customerPhone || null,
      customerEmail: customerEmail || null,
      billId: linkedBill ? linkedBill._id.toString() : (billId ? billId.toString() : null),
      menuItemId: menuItemId ? menuItemId.toString() : null,
      serviceArea: serviceArea || null,
      description,
      status: 'RECEIVED',
      foodSafetyEscalation: {
        isEscalated: !!canonicalFoodSafetyIncidentId,
        foodSafetyIncidentId: canonicalFoodSafetyIncidentId ? canonicalFoodSafetyIncidentId.toString() : null,
        escalationReason: foodSafetyDetails || ''
      },
      capaId: canonicalCapaId ? canonicalCapaId.toString() : null,
      createdByUserId: user?.userId || user?._id || 'SYSTEM'
    });

    await complaint.save();
    return this._formatComplaint(complaint.toObject(), user, { customerPhone, customerEmail });
  }

  /**
   * Transition complaint state with strict lifecycle validation
   */
  async updateComplaintStatus(organisationId, complaintId, newStatus, user, notes) {
    const complaint = await CustomerComplaint.findOne({
      $or: [{ organisationId }, { organisationId: organisationId.toString() }],
      complaintId
    });
    if (!complaint) throw new Error('COMPLAINT_NOT_FOUND');

    if (user && (user.role === 'CAFE_ADMIN' || user.role === 'STORE_MANAGER')) {
      const assigned = user.assignedCafeIds || [user.cafeId || user.primaryCafeId].filter(Boolean);
      if (assigned.length > 0 && !assigned.includes(complaint.cafeId)) {
        throw new Error('CROSS_CAFE_ACCESS_DENIED: Cannot mutate complaint from another café.');
      }
    }

    const allowedNext = VALID_TRANSITIONS[complaint.status] || [];
    if (!allowedNext.includes(newStatus)) {
      throw new Error(`ILLEGAL_LIFECYCLE_TRANSITION: Cannot transition from ${complaint.status} to ${newStatus}`);
    }

    complaint.status = newStatus;
    if (newStatus === 'RESOLVED' || newStatus === 'CLOSED') {
      complaint.resolutionDate = new Date();
      complaint.closureReason = notes || 'Standard closure';
    }
    if (newStatus === 'REOPENED') {
      complaint.reopenHistory.push({
        reopenedAt: new Date(),
        reopenedByUserId: user?.userId || user?._id || 'SYSTEM',
        reason: notes || 'Reopened'
      });
    }

    await complaint.save();
    return this._formatComplaint(complaint.toObject(), user);
  }

  /**
   * Issue / link a canonical refund for the complaint
   */
  async issueServiceRecoveryRefund(organisationId, complaintId, refundPayload, user) {
    const { amount, reason } = refundPayload;
    if (!amount || amount <= 0) throw new Error('VALID_REFUND_AMOUNT_REQUIRED');

    const complaint = await CustomerComplaint.findOne({
      $or: [{ organisationId }, { organisationId: organisationId.toString() }],
      complaintId
    });
    if (!complaint) throw new Error('COMPLAINT_NOT_FOUND');

    if (user && (user.role === 'CAFE_ADMIN' || user.role === 'STORE_MANAGER')) {
      const assigned = user.assignedCafeIds || [user.cafeId || user.primaryCafeId].filter(Boolean);
      if (assigned.length > 0 && !assigned.includes(complaint.cafeId)) {
        throw new Error('CROSS_CAFE_COMPENSATION_DENIED: Cannot issue compensation or refund for another café.');
      }
    }

    if (!complaint.billId) {
      throw new Error('CANNOT_REFUND_WITHOUT_CANONICAL_BILL_LINKAGE');
    }

    // Single authoritative refund business execution via canonical refundService
    const refundResult = await refundService.processBillRefund(
      {
        organisationId,
        cafeId: complaint.cafeId,
        user,
        channel: 'COMPLAINT_SERVICE_RECOVERY',
        complaintId: complaint.complaintId
      },
      {
        billId: complaint.billId.toString(),
        refundType: 'AMOUNT_BASED',
        amount,
        reason: reason || 'Service recovery refund authorized'
      }
    );

    const canonicalRefundId = refundResult.refund.refundId;

    // Complaint Service Recovery stores ONLY canonical refund reference & recovery metadata
    complaint.serviceRecovery = {
      remedyType: 'AUTHORISED_REFUND',
      remedyNotes: reason || 'Service recovery refund authorized',
      refundReference: canonicalRefundId,
      refundAmount: amount,
      actionDate: new Date(),
      actionByUserId: user?.userId || user?._id || 'SYSTEM'
    };

    await complaint.save();

    return {
      complaint: this._formatComplaint(complaint.toObject(), user),
      refundReference: canonicalRefundId,
      canonicalRefundId,
      billStatus: refundResult.bill.billStatus || refundResult.bill.status
    };
  }

  /**
   * Log communication with customer
   */
  async addCommunication(organisationId, complaintId, commPayload, user) {
    const complaint = await CustomerComplaint.findOne({
      $or: [{ organisationId }, { organisationId: organisationId.toString() }],
      complaintId
    });
    if (!complaint) throw new Error('COMPLAINT_NOT_FOUND');

    const { channel = 'PHONE', direction = 'OUTBOUND', summary } = commPayload;
    if (!summary) throw new Error('COMMUNICATION_SUMMARY_REQUIRED');

    complaint.communicationLog.push({
      channel,
      direction,
      messageSummary: summary,
      timestamp: new Date(),
      senderRecipientRole: user?.role || 'STAFF',
      status: 'DELIVERED'
    });

    await complaint.save();
    return this._formatComplaint(complaint.toObject(), user);
  }

  /**
   * Attach evidence
   */
  async attachEvidence(organisationId, complaintId, attachment, user) {
    const complaint = await CustomerComplaint.findOne({
      $or: [{ organisationId }, { organisationId: organisationId.toString() }],
      complaintId
    });
    if (!complaint) throw new Error('COMPLAINT_NOT_FOUND');

    const attachmentRef = attachment.attachmentId || attachment.url || `ATT-${Date.now()}`;
    complaint.evidenceAttachmentIds.push(attachmentRef);

    await complaint.save();
    return this._formatComplaint(complaint.toObject(), user);
  }

  /**
   * List complaints
   */
  async listComplaints(organisationId, filters = {}, user) {
    if (!organisationId) throw new Error('ORGANISATION_ID_REQUIRED');
    const query = {
      $or: [{ organisationId }, { organisationId: organisationId.toString() }]
    };

    if (filters.cafeId) query.cafeId = { $in: [filters.cafeId, filters.cafeId.toString()] };
    if (filters.status) query.status = filters.status;
    if (filters.severity) query.severity = filters.severity;

    if (user && (user.role === 'CAFE_ADMIN' || user.role === 'STORE_MANAGER')) {
      const assigned = user.assignedCafeIds || [user.cafeId || user.primaryCafeId].filter(Boolean);
      if (assigned.length > 0) {
        if (filters.cafeId && !assigned.includes(filters.cafeId)) {
          throw new Error('CROSS_CAFE_ACCESS_DENIED: Cannot access complaints for another café.');
        }
        query.cafeId = { $in: assigned };
      }
    }

    const complaints = await CustomerComplaint.find(query).sort({ complaintDate: -1 }).lean();
    return complaints.map(c => this._formatComplaint(c, user));
  }

  /**
   * Get single complaint by ID
   */
  async getComplaintById(organisationId, complaintId, user) {
    const complaint = await CustomerComplaint.findOne({
      $or: [{ organisationId }, { organisationId: organisationId.toString() }],
      complaintId
    }).lean();
    if (!complaint) throw new Error('COMPLAINT_NOT_FOUND');

    if (user && (user.role === 'CAFE_ADMIN' || user.role === 'STORE_MANAGER')) {
      const assigned = user.assignedCafeIds || [user.cafeId || user.primaryCafeId].filter(Boolean);
      if (assigned.length > 0 && !assigned.includes(complaint.cafeId)) {
        throw new Error('CROSS_CAFE_ACCESS_DENIED: Cannot access complaint from another café.');
      }
    }
    return this._formatComplaint(complaint, user);
  }

  /**
   * Owner Strategic Dashboard Metrics
   */
  async getOwnerDashboardMetrics(organisationId, options = {}) {
    if (!organisationId) throw new Error('ORGANISATION_ID_REQUIRED');
    const { cafeId, startDate, endDate } = options;

    const filter = {
      $or: [{ organisationId }, { organisationId: organisationId.toString() }]
    };
    if (cafeId) filter.cafeId = { $in: [cafeId, cafeId.toString()] };
    if (startDate || endDate) {
      filter.complaintDate = {};
      if (startDate) filter.complaintDate.$gte = new Date(startDate);
      if (endDate) filter.complaintDate.$lte = new Date(endDate);
    }

    const complaints = await CustomerComplaint.find(filter).lean();
    const totalComplaints = complaints.length;

    const categoryCounts = {};
    const severityCounts = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
    let totalRefundedAmount = 0;
    let foodSafetyEscalatedCount = 0;
    let reopenedCount = 0;

    for (const c of complaints) {
      categoryCounts[c.category] = (categoryCounts[c.category] || 0) + 1;
      if (severityCounts[c.severity] !== undefined) severityCounts[c.severity]++;
      if (c.status === 'REOPENED' || (c.reopenHistory && c.reopenHistory.length > 0)) reopenedCount++;
      if (c.foodSafetyEscalation?.isEscalated) foodSafetyEscalatedCount++;
      if (c.serviceRecovery?.refundAmount) totalRefundedAmount += c.serviceRecovery.refundAmount;
    }

    // Authoritative Bill Denominator
    const billFilter = {
      $or: [{ organisationId }, { organisationId: organisationId.toString() }]
    };
    if (cafeId) {
      billFilter.cafeId = { $in: [cafeId, cafeId.toString()] };
    }
    const totalBills = await Bill.countDocuments(billFilter);

    const complaintRatePerThousandBills = totalBills > 0
      ? Number(((totalComplaints / totalBills) * 1000).toFixed(2))
      : null;

    return {
      totalComplaints,
      authoritativeBillDenominator: totalBills,
      complaintRatePerThousandBills,
      reopenRatePercentage: totalComplaints > 0 ? Number(((reopenedCount / totalComplaints) * 100).toFixed(1)) : 0,
      totalRefundedAmount,
      foodSafetyEscalatedCount,
      categoryCounts,
      severityCounts,
      satisfactionScoreStatus: 'UNAVAILABLE / NO_VERIFIED_SURVEY_DATA'
    };
  }

  /**
   * Helper: Format complaint with privacy masking and compatibility properties
   */
  _formatComplaint(c, user, extra = {}) {
    if (!c) return null;
    const userRole = user?.role || user?.userType || '';
    const canViewFullContact = ['OWNER', 'STORE_MANAGER', 'CAFE_MANAGER'].includes(userRole);

    const rawPhone = c.customerPhone || (c.customerContact && !c.customerContact.includes('@') ? c.customerContact : extra.customerPhone);
    const rawEmail = c.customerEmail || (c.customerContact && c.customerContact.includes('@') ? c.customerContact : extra.customerEmail);

    const isMasked = !canViewFullContact;
    let maskedPhone = rawPhone;
    let maskedEmail = rawEmail;

    if (isMasked) {
      if (rawPhone) {
        maskedPhone = `${rawPhone.substring(0, 3)}****${rawPhone.substring(rawPhone.length - 2)}`;
      }
      if (rawEmail) {
        const parts = rawEmail.split('@');
        maskedEmail = `${parts[0].substring(0, 2)}***@${parts[1] || 'domain.com'}`;
      }
    }

    return {
      ...c,
      channelReference: c.sourceReference,
      complaintCategory: c.category,
      customerDetails: {
        customerName: c.customerName,
        phone: isMasked ? maskedPhone : rawPhone,
        email: isMasked ? maskedEmail : rawEmail,
        isContactMasked: isMasked
      },
      orderLink: {
        billId: c.billId
      },
      foodSafetyLink: {
        isFoodSafetyEscalated: !!c.foodSafetyEscalation?.isEscalated,
        incidentId: c.foodSafetyEscalation?.foodSafetyIncidentId,
        capaId: c.capaId
      },
      resolutionDetails: {
        resolvedAt: c.resolutionDate,
        closedAt: c.resolutionDate,
        closureReason: c.closureReason
      },
      evidenceAttachments: (c.evidenceAttachmentIds || []).map(id => ({ attachmentId: id, url: id }))
    };
  }
}

module.exports = new OwnerComplaintsService();
