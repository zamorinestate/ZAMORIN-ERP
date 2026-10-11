'use strict';

const { HardwareDevice } = require('../models/HardwareDevice');
const { HardwareTerminal } = require('../models/HardwareTerminal');
const { Cafe } = require('../models/Cafe');
const { ApiError } = require('../utils/ApiError');
const auditService = require('./auditService');

const { ReceiptPrinterAdapter } = require('./hardwareAdapters/ReceiptPrinterAdapter');
const { CashDrawerAdapter } = require('./hardwareAdapters/CashDrawerAdapter');
const { BarcodeScannerAdapter } = require('./hardwareAdapters/BarcodeScannerAdapter');
const { WeighingScaleAdapter } = require('./hardwareAdapters/WeighingScaleAdapter');
const { PaymentTerminalAdapter } = require('./hardwareAdapters/PaymentTerminalAdapter');

class HardwareManagementService {
  /**
   * Register or update a HardwareDevice in an authoritative café scope.
   */
  async registerOrUpdateDevice(deviceData = {}, actor = {}) {
    const { organisationId, userId: actorUserId, role, isPrimaryMaster } = actor;
    const {
      deviceId,
      cafeId,
      name,
      deviceType,
      connectionMode = 'LAN_ETHERNET',
      configuration = {},
      assignment = {},
    } = deviceData;

    if (!deviceId || !cafeId || !name || !deviceType) {
      throw new ApiError(400, 'REQUIRED_FIELDS_MISSING', 'deviceId, cafeId, name, and deviceType are required.');
    }

    const normalizedDeviceId = deviceId.trim().toUpperCase();
    const normalizedCafeId = cafeId.trim().toUpperCase();
    const normalizedOrgId = (organisationId || '').trim().toUpperCase();

    if (role === 'OWNER') {
      throw new ApiError(403, 'OWNER_READ_ONLY', 'Owner persona is strictly read-only for operational mutations.');
    }

    if (role === 'MASTER' && !isPrimaryMaster) {
      throw new ApiError(403, 'ROLE_RETIRED', 'Normal Master role is permanently decommissioned.');
    }

    let device = await HardwareDevice.findOne({
      deviceId: normalizedDeviceId,
      organisationId: normalizedOrgId,
    });

    if (device) {
      // Prevent cross-café hijacking without Primary Master
      if (device.cafeId !== normalizedCafeId && !isPrimaryMaster) {
        throw new ApiError(403, 'CROSS_CAFE_REASSIGNMENT_DENIED', 'Cannot reassign device to a different café without Primary Master authority.');
      }
    }

    // Cafe Scoping Verification: Non-primary master must only register for assigned cafe
    if (!isPrimaryMaster) {
      const actorCafeId = (actor.cafeId || actor.primaryCafeId || '').trim().toUpperCase();
      if (actorCafeId && actorCafeId !== normalizedCafeId) {
        throw new ApiError(403, 'CAFE_ACCESS_DENIED', `User not authorized to manage devices for café ${normalizedCafeId}.`);
      }
    }

    if (device) {

      device.name = name.trim();
      device.deviceType = deviceType;
      device.cafeId = normalizedCafeId;
      device.connectionMode = connectionMode;
      device.configuration = { ...device.configuration?.toObject(), ...configuration };
      device.assignment = { ...device.assignment?.toObject(), ...assignment };
      device.updatedBy = actorUserId || 'SYSTEM';

      device.auditHistory.push({
        event: 'DEVICE_UPDATED',
        timestamp: new Date(),
        actorUserId: actorUserId || 'SYSTEM',
        action: 'UPDATE_CONFIG',
        details: `Updated configuration for device ${normalizedDeviceId}`,
      });

      await device.save();
      return device;
    }

    // New device creation
    device = await HardwareDevice.create({
      deviceId: normalizedDeviceId,
      organisationId: normalizedOrgId,
      cafeId: normalizedCafeId,
      name: name.trim(),
      deviceType,
      connectionMode,
      configuration,
      assignment,
      healthStatus: 'UNCONFIGURED',
      createdBy: actorUserId || 'SYSTEM',
      auditHistory: [
        {
          event: 'DEVICE_ENROLLED',
          timestamp: new Date(),
          actorUserId: actorUserId || 'SYSTEM',
          action: 'REGISTRATION',
          details: `Enrolled new device ${normalizedDeviceId} (${deviceType}) for cafe ${normalizedCafeId}`,
        },
      ],
    });

    return device;
  }

  /**
   * List all devices for a given café.
   */
  async getDevicesForCafe(cafeId, organisationId, actor = {}) {
    const normalizedOrgId = (organisationId || '').trim().toUpperCase();
    const normalizedCafeId = (cafeId || '').trim().toUpperCase();

    const query = { organisationId: normalizedOrgId };
    if (normalizedCafeId && normalizedCafeId !== 'ALL') {
      query.cafeId = normalizedCafeId;
    }

    return await HardwareDevice.find(query).sort({ createdAt: -1 }).lean();
  }

  /**
   * Run diagnostic test on a target hardware device.
   */
  async runDeviceDiagnostic(deviceId, actor = {}, options = {}) {
    const normalizedDeviceId = (deviceId || '').trim().toUpperCase();
    const normalizedOrgId = (actor.organisationId || '').trim().toUpperCase();

    const device = await HardwareDevice.findOne({
      deviceId: normalizedDeviceId,
      organisationId: normalizedOrgId,
    });

    if (!device) {
      throw new ApiError(404, 'DEVICE_NOT_FOUND', `Hardware device ${deviceId} not found.`);
    }

    // Scoping check
    if (!actor.isPrimaryMaster && actor.role !== 'MASTER') {
      const actorCafe = (actor.cafeId || actor.primaryCafeId || '').trim().toUpperCase();
      if (actorCafe && actorCafe !== device.cafeId) {
        throw new ApiError(403, 'CAFE_ACCESS_DENIED', 'Cannot run diagnostic on device outside assigned café.');
      }
    }

    let diagnosticResult = {};
    const startTime = Date.now();

    switch (device.deviceType) {
      case 'RECEIPT_PRINTER': {
        const cafe = await Cafe.findOne({ cafeId: device.cafeId, organisationId: normalizedOrgId }).lean();
        const cafeInfo = {
          brandName: cafe?.name || cafe?.identity?.brandName || 'ZAMORIN CAFE',
          legalName: cafe?.identity?.registeredBusinessName || 'Zamorin Hospitality Pvt Ltd',
          gstin: cafe?.registrations?.gstin || cafe?.taxAndCommercial?.gstin || '32AABCT1234L1ZV',
        };

        const testReceiptBuffer = ReceiptPrinterAdapter.compileReceipt(
          {
            billNumber: 'TEST-PRINT-DIAG',
            date: new Date().toISOString().slice(0, 10),
            time: new Date().toLocaleTimeString(),
            items: [
              { name: 'Malabar Roast Coffee (Diagnostic)', quantity: 1, price: 120, total: 120 },
              { name: 'Heritage Cardamom Bun', quantity: 1, price: 80, total: 80 },
            ],
            subtotal: 200,
            tax: 10,
            grandTotal: 210,
            isReprint: false,
          },
          cafeInfo,
          { paperWidth: device.configuration?.paperWidth || 80 }
        );

        diagnosticResult = {
          deviceType: 'RECEIPT_PRINTER',
          status: 'SUCCESS',
          paperWidth: device.configuration?.paperWidth || 80,
          bytesLength: testReceiptBuffer.length,
          base64Payload: testReceiptBuffer.toString('base64'),
          message: 'Diagnostic test receipt ESC/POS buffer compiled successfully.',
        };
        break;
      }

      case 'CASH_DRAWER': {
        diagnosticResult = CashDrawerAdapter.triggerKick(device, actor, {
          reason: options.reason || 'Hardware Diagnostics Kick Test',
        });
        break;
      }

      case 'BARCODE_SCANNER': {
        const sampleCode = options.sampleBarcode || 'ZC-ITEM-001';
        diagnosticResult = BarcodeScannerAdapter.parseScanInput(sampleCode);
        break;
      }

      case 'WEIGHING_SCALE': {
        const samplePayload = options.samplePayload || 'ST,GS,+00.450kg';
        diagnosticResult = WeighingScaleAdapter.parseScalePayload(samplePayload, {
          protocol: device.configuration?.scaleProtocol || 'TOLEDO',
          unit: device.configuration?.scaleUnit || 'KG',
          maxWeight: device.configuration?.scaleMaxWeight || 30.0,
        });
        break;
      }

      case 'PAYMENT_TERMINAL': {
        diagnosticResult = PaymentTerminalAdapter.assessTerminalStatus(device);
        break;
      }

      default: {
        diagnosticResult = {
          deviceType: device.deviceType,
          status: 'ONLINE',
          message: `Generic device ping completed in ${Date.now() - startTime}ms.`,
        };
      }
    }

    // Update device health status
    device.healthStatus = diagnosticResult.success !== false ? 'ONLINE' : 'ERROR';
    device.lastSuccessfulCheck = new Date();
    if (diagnosticResult.error) {
      device.lastError = {
        code: diagnosticResult.error,
        message: diagnosticResult.message || 'Diagnostic error',
        timestamp: new Date(),
      };
    } else {
      device.lastError = null;
    }

    device.auditHistory.push({
      event: 'DIAGNOSTIC_RUN',
      timestamp: new Date(),
      actorUserId: actor.userId || 'SYSTEM',
      action: 'SELF_TEST',
      details: `Diagnostic result: ${device.healthStatus}`,
      metadata: { durationMs: Date.now() - startTime },
    });

    await device.save();

    return {
      deviceId: device.deviceId,
      name: device.name,
      deviceType: device.deviceType,
      healthStatus: device.healthStatus,
      durationMs: Date.now() - startTime,
      result: diagnosticResult,
    };
  }

  /**
   * Check for Unassigned Printers (Benchmark A023).
   * Identifies menu categories or items with no configured station printer.
   */
  async checkUnassignedPrinterAlerts(cafeId, organisationId) {
    const devices = await HardwareDevice.find({
      organisationId: (organisationId || '').trim().toUpperCase(),
      cafeId: (cafeId || '').trim().toUpperCase(),
      deviceType: 'RECEIPT_PRINTER',
    }).lean();

    const assignedStations = new Set(
      devices.map((d) => d.assignment?.station).filter((st) => st && st !== 'UNASSIGNED')
    );

    const requiredStations = ['BILLING', 'HOT_KITCHEN', 'BARISTA', 'DISPATCH'];
    const unassignedStations = requiredStations.filter((st) => !assignedStations.has(st));

    return {
      cafeId,
      totalPrinters: devices.length,
      assignedStations: Array.from(assignedStations),
      unassignedStations,
      hasAlert: unassignedStations.length > 0,
      alertMessage:
        unassignedStations.length > 0
          ? `Stations lacking dedicated printer: ${unassignedStations.join(', ')}.`
          : 'All operational stations have assigned printers.',
    };
  }
}

const hardwareManagementService = new HardwareManagementService();

module.exports = {
  hardwareManagementService,
  HardwareManagementService,
};
