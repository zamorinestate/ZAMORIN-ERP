'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — OWNER COMPLAINTS CONTROLLER (STAGE 11)
 * ============================================================================
 */

const ownerComplaintsService = require('../services/ownerComplaintsService');

class OwnerComplaintsController {
  _getAuth(req) {
    const auth = req.auth || req.user || req.authenticatedUser || {};
    return {
      organisationId: auth.organisationId,
      user: {
        userId: auth.userId || auth.id || auth.email || 'USER',
        email: auth.email || 'user@zamorincafe.com',
        role: auth.role || auth.userType || 'OWNER',
        assignedCafeIds: auth.assignedCafeIds || [],
        primaryCafeId: auth.primaryCafeId,
        cafeId: auth.cafeId,
      }
    };
  }

  async createComplaint(req, res) {
    try {
      const { organisationId, user } = this._getAuth(req);
      if (!organisationId) return res.status(401).json({ success: false, error: 'ORGANISATION_REQUIRED' });

      const complaint = await ownerComplaintsService.createComplaint(organisationId, req.body, user);
      return res.status(201).json({ success: true, data: complaint });
    } catch (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  async listComplaints(req, res) {
    try {
      const { organisationId, user } = this._getAuth(req);
      if (!organisationId) return res.status(401).json({ success: false, error: 'ORGANISATION_REQUIRED' });

      const complaints = await ownerComplaintsService.listComplaints(organisationId, req.query, user);
      return res.status(200).json({ success: true, data: complaints });
    } catch (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  async getComplaintById(req, res) {
    try {
      const { organisationId, user } = this._getAuth(req);
      if (!organisationId) return res.status(401).json({ success: false, error: 'ORGANISATION_REQUIRED' });

      const complaint = await ownerComplaintsService.getComplaintById(organisationId, req.params.complaintId, user);
      return res.status(200).json({ success: true, data: complaint });
    } catch (err) {
      return res.status(404).json({ success: false, error: err.message });
    }
  }

  async updateComplaintStatus(req, res) {
    try {
      const { organisationId, user } = this._getAuth(req);
      if (!organisationId) return res.status(401).json({ success: false, error: 'ORGANISATION_REQUIRED' });

      const { status, notes } = req.body;
      const updated = await ownerComplaintsService.updateComplaintStatus(organisationId, req.params.complaintId, status, user, notes);
      return res.status(200).json({ success: true, data: updated });
    } catch (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  async issueServiceRecoveryRefund(req, res) {
    try {
      const { organisationId, user } = this._getAuth(req);
      if (!organisationId) return res.status(401).json({ success: false, error: 'ORGANISATION_REQUIRED' });

      const result = await ownerComplaintsService.issueServiceRecoveryRefund(organisationId, req.params.complaintId, req.body, user);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  async addCommunication(req, res) {
    try {
      const { organisationId, user } = this._getAuth(req);
      if (!organisationId) return res.status(401).json({ success: false, error: 'ORGANISATION_REQUIRED' });

      const result = await ownerComplaintsService.addCommunication(organisationId, req.params.complaintId, req.body, user);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  async attachEvidence(req, res) {
    try {
      const { organisationId, user } = this._getAuth(req);
      if (!organisationId) return res.status(401).json({ success: false, error: 'ORGANISATION_REQUIRED' });

      const result = await ownerComplaintsService.attachEvidence(organisationId, req.params.complaintId, req.body, user);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  async getDashboardMetrics(req, res) {
    try {
      const { organisationId } = this._getAuth(req);
      if (!organisationId) return res.status(401).json({ success: false, error: 'ORGANISATION_REQUIRED' });

      const metrics = await ownerComplaintsService.getOwnerDashboardMetrics(organisationId, req.query);
      return res.status(200).json({ success: true, data: metrics });
    } catch (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }
}

module.exports = new OwnerComplaintsController();
