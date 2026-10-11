'use strict';

const mongoose = require('mongoose');

const HARDWARE_DEVICE_TYPES = [
  'RECEIPT_PRINTER',
  'BARCODE_SCANNER',
  'CASH_DRAWER',
  'WEIGHING_SCALE',
  'CUSTOMER_DISPLAY',
  'PAYMENT_TERMINAL',
  'POS_COUNTER',
];

const HARDWARE_CONNECTION_MODES = [
  'LAN_ETHERNET',
  'USB',
  'SERIAL_COM',
  'BLUETOOTH',
  'LOCAL_BRIDGE_PROXY',
  'VIRTUAL_SIMULATION',
];

const HARDWARE_HEALTH_STATUSES = [
  'ONLINE',
  'OFFLINE',
  'ERROR',
  'UNCONFIGURED',
  'SIMULATED',
];

const HARDWARE_STATIONS = [
  'BILLING',
  'DISPATCH',
  'BARISTA',
  'HOT_KITCHEN',
  'DESSERT_BAR',
  'UNASSIGNED',
];

const hardwareDeviceAuditSchema = new mongoose.Schema(
  {
    event: { type: String, required: true, trim: true },
    timestamp: { type: Date, default: Date.now },
    actorUserId: { type: String, required: true, trim: true, uppercase: true },
    action: { type: String, trim: true, default: null },
    details: { type: String, trim: true, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const hardwareDeviceSchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
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
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    deviceType: {
      type: String,
      enum: HARDWARE_DEVICE_TYPES,
      required: true,
      index: true,
    },
    connectionMode: {
      type: String,
      enum: HARDWARE_CONNECTION_MODES,
      default: 'LAN_ETHERNET',
    },
    configuration: {
      ipAddress: { type: String, trim: true, default: null },
      port: { type: Number, default: null },
      macAddress: { type: String, trim: true, default: null },
      baudRate: { type: Number, default: 9600 },
      comPort: { type: String, trim: true, default: null },
      usbVendorId: { type: String, trim: true, default: null },
      usbProductId: { type: String, trim: true, default: null },
      paperWidth: { type: Number, enum: [58, 80], default: 80 },
      characterSet: { type: String, trim: true, default: 'PC437_USA' },
      drawerPin: { type: Number, enum: [2, 5], default: 2 },
      scaleProtocol: {
        type: String,
        enum: ['TOLEDO', 'CAS', 'GENERIC_CONTINUOUS', 'NONE'],
        default: 'NONE',
      },
      scaleUnit: { type: String, enum: ['KG', 'G'], default: 'KG' },
      scaleMaxWeight: { type: Number, default: 30.0 },
      scalePrecision: { type: Number, default: 3 },
      paymentProvider: {
        type: String,
        enum: ['PINELABS', 'RAZORPAY_POS', 'MOCK', 'UNCONFIGURED'],
        default: 'UNCONFIGURED',
      },
      merchantId: { type: String, trim: true, default: null },
      terminalIdentifier: { type: String, trim: true, default: null },
    },
    assignment: {
      station: {
        type: String,
        enum: HARDWARE_STATIONS,
        default: 'UNASSIGNED',
      },
      counterName: { type: String, trim: true, default: 'Counter 1' },
      active: { type: Boolean, default: true },
    },
    healthStatus: {
      type: String,
      enum: HARDWARE_HEALTH_STATUSES,
      default: 'UNCONFIGURED',
      index: true,
    },
    lastSuccessfulCheck: { type: Date, default: null },
    lastError: {
      code: { type: String, trim: true, default: null },
      message: { type: String, trim: true, default: null },
      timestamp: { type: Date, default: null },
    },
    supportedCapabilities: {
      type: [String],
      default: [],
    },
    auditHistory: {
      type: [hardwareDeviceAuditSchema],
      default: [],
    },
    createdBy: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    updatedBy: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'hardware_devices',
  }
);

hardwareDeviceSchema.index({ organisationId: 1, cafeId: 1, deviceId: 1 }, { unique: true });
hardwareDeviceSchema.index({ organisationId: 1, cafeId: 1, deviceType: 1 });
hardwareDeviceSchema.index({ organisationId: 1, healthStatus: 1 });

const HardwareDevice =
  mongoose.models.HardwareDevice || mongoose.model('HardwareDevice', hardwareDeviceSchema);

module.exports = {
  HardwareDevice,
  HARDWARE_DEVICE_TYPES,
  HARDWARE_CONNECTION_MODES,
  HARDWARE_HEALTH_STATUSES,
  HARDWARE_STATIONS,
};
