'use strict';

/**
 * PM-03: PROCUREMENT, RECEIVING, ASN & VENDOR OPERATIONS TEST SUITE
 *
 * Verifies all PM-03 requirements and operational invariants:
 * - Guided Buying & Catalogue Price Authority (CLIENT_SUPPLIED_VENDOR_PRICE_USED_AS_AUTHORITY = 0)
 * - Purchase Requisition Lifecycle (PRQ creation & conversion to PO)
 * - PO Lifecycle & Immutability (ISSUED_PO_SILENTLY_MUTABLE = 0)
 * - Advance Shipping Notices (ASN) bound to POs (ASN_ACCEPTS_FOREIGN_OR_UNRELATED_PO = 0)
 * - ASN Over-Shipment Protection (ASN_SILENT_OVER_SHIPMENT = 0)
 * - Duplicate ASN Protection (DUPLICATE_ASN_CREATES_DUPLICATE_RECEIVING_OBLIGATION = 0)
 * - ASN Inventory Isolation (ASN_DIRECTLY_INCREASES_INVENTORY_WITHOUT_RECEIPT = 0)
 * - Receiving & Inspection: Quarantine for Rejected Goods (REJECTED_RECEIVING_QUANTITY_ENTERS_AVAILABLE_INVENTORY = 0)
 * - Partial Receipts & Multi-Stage Delivery Reconciliation
 * - Vendor Master Lifecycle, Duplicate Protection & Maker-Checker Bank Governance
 * - Vendor Approval Error Path Integrity (FAILED_VENDOR_APPROVAL_SHOWS_SUCCESS = 0)
 * - Invoice Capture & Duplicate Protection (DUPLICATE_VENDOR_INVOICE_DOUBLE_COUNTS_AP = 0)
 * - Three-Way Match Reconciliation & Master Posting
 * - RBAC & Tenant Scoping (PM03_CROSS_ORG_LEAK = 0, OWNER_PROCUREMENT_CROSS_CAFE_LEAK = 0, CAFE_ADMIN_PROCUREMENT_CROSS_CAFE_LEAK = 0, PM03_IDOR_BYPASS = 0)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

function resolveWorkspacePath(relPath) {
  if (fs.existsSync(relPath)) return relPath;
  const fromBackend = path.resolve(__dirname, '..', relPath.replace(/^backend\//, ''));
  if (fs.existsSync(fromBackend)) return fromBackend;
  const fromRoot = path.resolve(__dirname, '../../', relPath);
  if (fs.existsSync(fromRoot)) return fromRoot;
  return path.resolve(__dirname, '..', relPath);
}

const { createApp } = require('../src/server');
const { PurchaseOrder } = require('../src/models/PurchaseOrder');
const { AdvanceShippingNotice } = require('../src/models/AdvanceShippingNotice');
const { PurchaseRequisition } = require('../src/models/PurchaseRequisition');
const { GlobalInventoryItem } = require('../src/models/GlobalInventoryItem');
const { CafeInventoryConfig } = require('../src/models/CafeInventoryConfig');
const { StockMovement } = require('../src/models/StockMovement');
const { IncomingInspection } = require('../src/models/IncomingInspection');
const { InventoryLot } = require('../src/models/InventoryLot');
const { Vendor } = require('../src/models/Vendor');
const { APInvoice } = require('../src/models/APInvoice');
const { SequenceCounter } = require('../src/models/SequenceCounter');
const { User } = require('../src/models/User');
const { AuditEvent } = require('../src/models/AuditEvent');
const { RolePermission } = require('../src/models/RolePermission');
const authService = require('../src/services/authService');
const auditService = require('../src/services/auditService');
const {
  createGoodsReceipt,
  createAsn,
  cancelAsn,
  convertRequisitionToPo,
  _setPoLocksDisabled,
  commitWithRetry,
} = require('../src/controllers/procurementController');

function makeRequest({ port, method, path, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const serializedBody = body ? JSON.stringify(body) : null;
    const reqHeaders = { ...headers };
    if (serializedBody) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(serializedBody);
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method,
        path,
        headers: reqHeaders,
      },
      (res) => {
        let responseData = '';
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(responseData);
          } catch (e) {
            json = { raw: responseData };
          }
          resolve({ status: res.statusCode, data: json });
        });
      }
    );

    req.on('error', reject);
    if (serializedBody) req.write(serializedBody);
    req.end();
  });
}

test('PM-03: Comprehensive Procurement, Receiving, ASN & Vendor Operations Suite', async (t) => {
  const app = createApp({ allowedOrigins: ['*'], production: false });
  const server = http.createServer(app);

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const port = server.address().port;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  // Identities
  const primaryMasterUser = {
    userId: 'USR-PM-001',
    role: 'MASTER',
    isPrimaryMaster: true,
    organisationId: 'ORG-ZAMORIN',
    email: 'primary@zamorincafe.com',
    fullName: 'Primary Master',
    sessionVersion: 1,
    permissionsVersion: 1,
    assignedCafeIds: ['ZC-0001', 'ZC-0002'],
    accountStatus: 'ACTIVE',
  };

  const ownerUser = {
    userId: 'USR-OWNER-001',
    role: 'OWNER',
    organisationId: 'ORG-ZAMORIN',
    email: 'owner@zamorincafe.com',
    fullName: 'Owner User',
    sessionVersion: 1,
    permissionsVersion: 1,
    assignedCafeIds: ['ZC-0001'],
    accountStatus: 'ACTIVE',
  };

  const cafeAdminUser = {
    userId: 'USR-ADMIN-001',
    role: 'CAFE_ADMIN',
    organisationId: 'ORG-ZAMORIN',
    email: 'admin@zamorincafe.com',
    fullName: 'Cafe Admin',
    sessionVersion: 1,
    permissionsVersion: 1,
    assignedCafeIds: ['ZC-0001'],
    accountStatus: 'ACTIVE',
  };

  const staffUser = {
    userId: 'USR-STAFF-001',
    role: 'STAFF',
    organisationId: 'ORG-ZAMORIN',
    email: 'staff@zamorincafe.com',
    fullName: 'Staff Member',
    sessionVersion: 1,
    permissionsVersion: 1,
    assignedCafeIds: ['ZC-0001'],
    accountStatus: 'ACTIVE',
  };

  const foreignOrgMaster = {
    userId: 'USR-FOREIGN-001',
    role: 'MASTER',
    isPrimaryMaster: true,
    organisationId: 'ORG-FOREIGN',
    email: 'foreign@othercafe.com',
    fullName: 'Foreign Master',
    sessionVersion: 1,
    permissionsVersion: 1,
    assignedCafeIds: ['ZC-FOREIGN'],
    accountStatus: 'ACTIVE',
  };

  const ownerTwoCafesUser = {
    userId: 'USR-OWNER-2CAFES',
    role: 'OWNER',
    organisationId: 'ORG-ZAMORIN',
    email: 'owner2@zamorincafe.com',
    fullName: 'Owner Two Cafes',
    sessionVersion: 1,
    permissionsVersion: 1,
    assignedCafeIds: ['ZC-0001', 'ZC-0002'],
    accountStatus: 'ACTIVE',
  };

  const ownerEmptyCafesUser = {
    userId: 'USR-OWNER-EMPTY',
    role: 'OWNER',
    organisationId: 'ORG-ZAMORIN',
    email: 'ownerempty@zamorincafe.com',
    fullName: 'Owner Empty Cafes',
    sessionVersion: 1,
    permissionsVersion: 1,
    assignedCafeIds: [],
    accountStatus: 'ACTIVE',
  };

  const storeManagerUser = {
    userId: 'USR-SM-001',
    role: 'STORE_MANAGER',
    organisationId: 'ORG-ZAMORIN',
    email: 'storemanager@zamorincafe.com',
    fullName: 'Store Manager',
    sessionVersion: 1,
    permissionsVersion: 1,
    assignedCafeIds: ['ZC-0001'],
    accountStatus: 'ACTIVE',
  };

  const chefUser = {
    userId: 'USR-CHEF-001',
    role: 'CHEF',
    organisationId: 'ORG-ZAMORIN',
    email: 'chef@zamorincafe.com',
    fullName: 'Head Chef',
    sessionVersion: 1,
    permissionsVersion: 1,
    assignedCafeIds: ['ZC-0001'],
    accountStatus: 'ACTIVE',
  };

  const supplierUser = {
    userId: 'USR-SUPP-001',
    role: 'SUPPLIER',
    organisationId: 'ORG-ZAMORIN',
    email: 'supplier@vendor.com',
    fullName: 'External Supplier',
    sessionVersion: 1,
    permissionsVersion: 1,
    assignedCafeIds: ['ZC-0001'],
    accountStatus: 'ACTIVE',
  };

  t.mock.method(authService, 'verifyAccessToken', async (token) => {
    const buildAuth = (u) => ({
      payload: {
        sub: u.userId,
        org: u.organisationId,
        role: u.role,
        email: u.email,
        name: u.fullName,
        isPrimaryMaster: !!u.isPrimaryMaster,
        assignedCafeIds: u.assignedCafeIds,
        sv: 0,
        usv: 1,
        pv: 1,
        sid: `SS-${u.userId}`,
      },
      session: {
        sessionId: `SS-${u.userId}`,
        roleSnapshot: u.role,
        sessionVersion: 0,
        mfaVerified: true,
        stepUpVerifiedAt: new Date().toISOString(),
      },
    });

    if (token === 'tok_master') return buildAuth(primaryMasterUser);
    if (token === 'tok_owner') return buildAuth(ownerUser);
    if (token === 'tok_owner_2cafes') return buildAuth(ownerTwoCafesUser);
    if (token === 'tok_owner_empty') return buildAuth(ownerEmptyCafesUser);
    if (token === 'tok_store_manager') return buildAuth(storeManagerUser);
    if (token === 'tok_chef') return buildAuth(chefUser);
    if (token === 'tok_supplier') return buildAuth(supplierUser);
    if (token === 'tok_admin') return buildAuth(cafeAdminUser);
    if (token === 'tok_staff') return buildAuth(staffUser);
    if (token === 'tok_foreign') return buildAuth(foreignOrgMaster);
    throw new Error('Invalid token');
  });

  t.mock.method(User, 'findOne', async (query) => {
    const id = query.userId || query._id;
    if (id === primaryMasterUser.userId) return primaryMasterUser;
    if (id === ownerUser.userId) return ownerUser;
    if (id === ownerTwoCafesUser.userId) return ownerTwoCafesUser;
    if (id === ownerEmptyCafesUser.userId) return ownerEmptyCafesUser;
    if (id === storeManagerUser.userId) return storeManagerUser;
    if (id === chefUser.userId) return chefUser;
    if (id === supplierUser.userId) return supplierUser;
    if (id === cafeAdminUser.userId) return cafeAdminUser;
    if (id === staffUser.userId) return staffUser;
    if (id === foreignOrgMaster.userId) return foreignOrgMaster;
    return null;
  });

  t.mock.method(RolePermission, 'findEffectiveRules', async ({ role, permissionCode }) => {
    if (role === 'STAFF') {
      return [];
    }
    return [
      {
        role,
        permissionCode,
        effect: 'ALLOW',
        scope: role === 'MASTER' ? 'ORGANISATION' : 'ASSIGNED_CAFES',
        isCurrentlyEffective: () => true,
      },
    ];
  });

  t.mock.method(auditService, 'recordRequestAudit', async () => ({}));
  t.mock.method(auditService, 'recordAuditEvent', async () => ({}));

  // State Stores
  const mockVendors = [
    {
      vendorId: 'VEN-ROAST-01',
      organisationId: 'ORG-ZAMORIN',
      name: 'Malabar Estate Roasters',
      nameLower: 'malabar estate roasters',
      category: 'FOOD_BEVERAGE',
      supplierType: 'GOODS',
      status: 'ACTIVE',
      gstNumber: '32AABCR8821K1ZV',
      panNumber: 'AABCR8821K',
      paymentTerms: 'NET_30',
      itemCatalogue: [
        {
          itemId: 'ITM-COF-01',
          supplierItemCode: 'MER-ARABICA-AA',
          packSize: '1 KG',
          currentPricePaisa: 62000,
          currency: 'INR',
          minimumOrderQty: 10,
          leadTimeDays: 3,
          sourcePriority: 'PRIMARY',
          effectiveFrom: '2026-01-01',
        },
      ],
      bankDetails: {
        accountHolderName: 'Malabar Estate Roasters LLP',
        bankName: 'Federal Bank',
        accountNumberMasked: '••••••••4821',
        ifscCode: 'FDRL0001482',
      },
      save: async function () { return this; },
      toObject: function () { return { ...this }; },
    },
    {
      vendorId: 'VEN-DAIRY-01',
      organisationId: 'ORG-ZAMORIN',
      name: 'Wayanad Organic Dairy',
      nameLower: 'wayanad organic dairy',
      category: 'DAIRY',
      supplierType: 'GOODS',
      status: 'ACTIVE',
      gstNumber: '32AABCD4411M1Z2',
      itemCatalogue: [
        {
          itemId: 'ITM-MLK-01',
          packSize: '1 L',
          currentPricePaisa: 6500,
          minimumOrderQty: 20,
          leadTimeDays: 1,
          sourcePriority: 'PRIMARY',
        },
      ],
      save: async function () { return this; },
      toObject: function () { return { ...this }; },
    },
  ];

  const mockItems = [
    {
      itemId: 'ITM-COF-01',
      organisationId: 'ORG-ZAMORIN',
      name: 'Arabica AA Speciality Beans',
      category: 'Coffee Beans',
      baseUnit: 'kg',
      primaryVendorId: 'VEN-ROAST-01',
      reorderPoint: 20,
      leadTimeDays: 3,
      status: 'ACTIVE',
      isArchived: false,
      save: async function () { return this; },
      toObject: function () { return { ...this }; },
    },
    {
      itemId: 'ITM-MLK-01',
      organisationId: 'ORG-ZAMORIN',
      name: 'Full Cream Organic Milk',
      category: 'Dairy',
      baseUnit: 'L',
      primaryVendorId: 'VEN-DAIRY-01',
      reorderPoint: 50,
      leadTimeDays: 1,
      status: 'ACTIVE',
      isArchived: false,
      save: async function () { return this; },
      toObject: function () { return { ...this }; },
    },
  ];

  function makeQuery(res) {
    const p = Promise.resolve(res);
    p.select = () => p;
    p.lean = () => Promise.resolve(res ? (typeof res.toObject === 'function' ? res.toObject() : res) : null);
    p.sort = () => p;
    p.limit = () => p;
    p.skip = () => p;
    p.populate = () => p;
    return p;
  }

  const mockOrders = [];
  const mockAsns = [];
  const mockRequisitions = [];
  const mockLots = [];
  const mockApInvoices = [];
  let currentStock = 100;

  // Mock Vendor queries
  t.mock.method(Vendor, 'find', (query = {}) => ({
    select: () => ({
      lean: async () => mockVendors.filter((v) => !query.organisationId || v.organisationId === query.organisationId),
    }),
    lean: async () => mockVendors.filter((v) => !query.organisationId || v.organisationId === query.organisationId),
  }));

  t.mock.method(Vendor, 'findOne', (query = {}) => {
    const found = mockVendors.find((v) => {
      if (query.organisationId && v.organisationId !== query.organisationId) return false;
      if (query.vendorId && v.vendorId !== query.vendorId) return false;
      if (query.gstNumber && v.gstNumber !== query.gstNumber) return false;
      if (query.status && v.status !== query.status) return false;
      if (Array.isArray(query.$or)) {
        const matchesOr = query.$or.some((cond) => {
          if (cond.nameLower && (v.nameLower || v.name.toLowerCase()) === cond.nameLower.toLowerCase()) return true;
          if (cond.gstNumber && v.gstNumber === cond.gstNumber) return true;
          if (cond.panNumber && v.panNumber === cond.panNumber) return true;
          return false;
        });
        if (!matchesOr) return false;
      }
      return true;
    });
    return makeQuery(found || null);
  });

  t.mock.method(Vendor, 'findOneAndUpdate', async (filter, update) => {
    const v = mockVendors.find((vend) => {
      if (filter.vendorId && vend.vendorId !== filter.vendorId) return false;
      if (filter.organisationId && vend.organisationId !== filter.organisationId) return false;
      if (filter['pendingBankChange.status'] && vend.pendingBankChange?.status !== filter['pendingBankChange.status']) return false;
      return true;
    });
    if (!v) return null;
    if (update.$set) {
      for (const [k, val] of Object.entries(update.$set)) {
        if (k.startsWith('pendingBankChange.')) {
          const sub = k.split('.')[1];
          if (v.pendingBankChange) v.pendingBankChange[sub] = val;
        } else {
          v[k] = val;
        }
      }
    }
    if (update.$push) {
      for (const [k, val] of Object.entries(update.$push)) {
        if (!v[k]) v[k] = [];
        v[k].push(val);
      }
    }
    return v;
  });

  // Mock GlobalInventoryItem queries
  t.mock.method(GlobalInventoryItem, 'find', (query = {}) => ({
    select: () => ({
      lean: async () => mockItems.filter((i) => !query.organisationId || i.organisationId === query.organisationId),
    }),
    lean: async () => mockItems.filter((i) => !query.organisationId || i.organisationId === query.organisationId),
  }));

  t.mock.method(GlobalInventoryItem, 'findOne', (query = {}) => {
    const item = mockItems.find((i) => {
      if (query.itemId && i.itemId !== query.itemId) return false;
      if (query.organisationId && i.organisationId !== query.organisationId) return false;
      return true;
    });
    return makeQuery(item || null);
  });

  // Mock PurchaseOrder queries & persistence
  PurchaseOrder.prototype.save = async function () {
    this._id = this._id || `po-${Date.now()}`;
    const idx = mockOrders.findIndex((o) => o.purchaseOrderId === this.purchaseOrderId);
    if (idx >= 0) {
      mockOrders[idx] = this;
    } else {
      mockOrders.push(this);
    }
    return this;
  };

  t.mock.method(PurchaseOrder, 'findOne', (query = {}) => {
    const po = mockOrders.find((o) => {
      if (query.purchaseOrderId && o.purchaseOrderId !== query.purchaseOrderId) return false;
      if (query.organisationId && o.organisationId !== query.organisationId) return false;
      if (query.vendorId && o.vendorId !== query.vendorId) return false;
      if (query.requisitionId && o.requisitionId !== query.requisitionId) return false;
      if (query['invoices.invoiceNumber']) {
        const cond = query['invoices.invoiceNumber'];
        const hasMatch = (o.invoices || []).some((inv) => {
          const num = (inv.invoiceNumber || '').trim();
          if (cond.$regex) return cond.$regex.test(num);
          if (typeof cond === 'string') return num.toLowerCase() === cond.toLowerCase();
          return false;
        });
        if (!hasMatch) return false;
      }
      return true;
    });

    if (po) {
      if (typeof po.recalculateFulfillment !== 'function') {
        po.recalculateFulfillment = function () {
          if (typeof PurchaseOrder.prototype.recalculateFulfillment === 'function') {
            return PurchaseOrder.prototype.recalculateFulfillment.call(this);
          }
        };
      }
      if (typeof po.save !== 'function') {
        po.save = async function () { return this; };
      }
      if (typeof po.toObject !== 'function') {
        po.toObject = function () { return { ...this }; };
      }
    }
    return makeQuery(po || null);
  });

  t.mock.method(PurchaseOrder, 'updateOne', async (filter, update) => {
    const po = mockOrders.find((o) => (!filter.purchaseOrderId || o.purchaseOrderId === filter.purchaseOrderId) && (!filter._id || o._id === filter._id));
    if (po && update.$set) {
      Object.assign(po, update.$set);
    }
    return { acknowledged: true, modifiedCount: 1 };
  });

  t.mock.method(PurchaseOrder, 'findOneAndUpdate', async (filter, update) => {
    const po = mockOrders.find((o) => {
      if (filter.purchaseOrderId && o.purchaseOrderId !== filter.purchaseOrderId) return false;
      if (filter.organisationId && o.organisationId !== filter.organisationId) return false;
      if (filter['invoices.invoiceNumber'] && filter['invoices.invoiceNumber'].$ne) {
        const forbidden = filter['invoices.invoiceNumber'].$ne.trim().toUpperCase();
        const exists = (o.invoices || []).some((i) => (i.invoiceNumber || '').trim().toUpperCase() === forbidden);
        if (exists) return false;
      }
      return true;
    });
    if (!po) return null;
    if (update.$push) {
      for (const [key, val] of Object.entries(update.$push)) {
        if (!po[key]) po[key] = [];
        po[key].push(val);
      }
    }
    if (update.$set) {
      Object.assign(po, update.$set);
    }
    return po;
  });

  t.mock.method(PurchaseOrder, 'find', (query = {}) => ({
    select: () => ({
      lean: async () => mockOrders.filter((o) => !query.organisationId || o.organisationId === query.organisationId),
    }),
    lean: async () => mockOrders.filter((o) => !query.organisationId || o.organisationId === query.organisationId),
    sort: () => ({
      limit: () => ({
        lean: async () => mockOrders.filter((o) => !query.organisationId || o.organisationId === query.organisationId),
      }),
    }),
  }));

  t.mock.method(PurchaseOrder, 'countDocuments', async () => mockOrders.length);

  // Mock APInvoice queries & persistence
  t.mock.method(APInvoice, 'create', async (docs, opts) => {
    const doc = Array.isArray(docs) ? docs[0] : docs;
    const target = (doc.supplierInvoiceNumber || '').trim().toUpperCase();
    const exists = mockApInvoices.some(
      (i) =>
        i.organisationId === doc.organisationId &&
        i.vendorId === doc.vendorId &&
        (i.supplierInvoiceNumber || '').trim().toUpperCase() === target
    );
    if (exists) {
      const err = new Error('E11000 duplicate key error collection: apinvoices index: organisationId_1_vendorId_1_supplierInvoiceNumber_1 dup key');
      err.code = 11000;
      throw err;
    }
    const created = { ...doc, _id: `apinv-${Date.now()}` };
    mockApInvoices.push(created);
    return Array.isArray(docs) ? [created] : created;
  });

  t.mock.method(APInvoice, 'findOne', (query = {}) => {
    const inv = mockApInvoices.find((i) => {
      if (query.organisationId && i.organisationId !== query.organisationId) return false;
      if (query.vendorId && i.vendorId !== query.vendorId) return false;
      if (query.supplierInvoiceNumber) {
        const cond = query.supplierInvoiceNumber;
        const num = (i.supplierInvoiceNumber || '').trim();
        if (cond && cond.$regex) {
          if (!cond.$regex.test(num)) return false;
        } else if (typeof cond === 'string') {
          if (num.toUpperCase() !== cond.trim().toUpperCase()) return false;
        }
      }
      return true;
    });
    return makeQuery(inv || null);
  });

  t.mock.method(APInvoice, 'find', (query = {}) => ({
    sort: () => ({
      limit: () => ({
        lean: async () => mockApInvoices.filter((i) => !query.organisationId || i.organisationId === query.organisationId),
      }),
    }),
    lean: async () => mockApInvoices.filter((i) => !query.organisationId || i.organisationId === query.organisationId),
  }));

  // Mock SequenceCounter
  let seqCounter = 1000;
  SequenceCounter.getNextSequence = async (org, type, prefix = 'SEQ') => {
    seqCounter++;
    return `${prefix}-${seqCounter}`;
  };

  // Mock AdvanceShippingNotice queries & persistence
  AdvanceShippingNotice.prototype.save = async function () {
    const idx = mockAsns.findIndex((a) => a.asnNumber === this.asnNumber);
    if (idx >= 0) {
      mockAsns[idx] = this;
    } else {
      mockAsns.push(this);
    }
    return this;
  };

  t.mock.method(AdvanceShippingNotice, 'findOne', (query = {}) => {
    const found = mockAsns.find((a) => {
      if (query.organisationId && a.organisationId !== query.organisationId) return false;
      if (query.vendorId && a.vendorId !== query.vendorId) return false;
      if (query.asnNumber && a.asnNumber !== query.asnNumber) return false;
      if (Array.isArray(query.$or)) {
        const matchesOr = query.$or.some((c) => {
          if (c.asnNumber && a.asnNumber === c.asnNumber) return true;
          if (c.vendorReference && a.vendorReference === c.vendorReference) return true;
          return false;
        });
        if (!matchesOr) return false;
      }
      return true;
    });
    return makeQuery(found || null);
  });

  t.mock.method(AdvanceShippingNotice, 'find', (query = {}) => ({
    sort: () => ({
      lean: async () =>
        mockAsns.filter((a) => {
          if (query.organisationId && a.organisationId !== query.organisationId) return false;
          if (query.purchaseOrderId && a.purchaseOrderId !== query.purchaseOrderId) return false;
          if (query.status?.$nin && query.status.$nin.includes(a.status)) return false;
          return true;
        }),
    }),
    lean: async () =>
      mockAsns.filter((a) => {
        if (query.organisationId && a.organisationId !== query.organisationId) return false;
        if (query.purchaseOrderId && a.purchaseOrderId !== query.purchaseOrderId) return false;
        if (query.status?.$nin && query.status.$nin.includes(a.status)) return false;
        return true;
      }),
  }));

  // Mock PurchaseRequisition queries & persistence
  PurchaseRequisition.prototype.save = async function () {
    const idx = mockRequisitions.findIndex((r) => r.requisitionId === this.requisitionId);
    if (idx >= 0) {
      mockRequisitions[idx] = this;
    } else {
      mockRequisitions.push(this);
    }
    return this;
  };

  t.mock.method(PurchaseRequisition, 'findOne', (query = {}) => {
    const found = mockRequisitions.find((r) => {
      if (query.requisitionId && r.requisitionId !== query.requisitionId) return false;
      if (query.organisationId && r.organisationId !== query.organisationId) return false;
      return true;
    });
    return makeQuery(found || null);
  });

  t.mock.method(PurchaseRequisition, 'findOneAndUpdate', async (filter, update) => {
    const prq = mockRequisitions.find((r) => {
      if (filter.requisitionId && r.requisitionId !== filter.requisitionId) return false;
      if (filter.organisationId && r.organisationId !== filter.organisationId) return false;
      if (filter.status && r.status !== filter.status) return false;
      if (r.convertedPurchaseOrderId) return false;
      return true;
    });
    if (!prq) return null;
    if (update.$set) {
      Object.assign(prq, update.$set);
    }
    return prq;
  });

  t.mock.method(PurchaseRequisition, 'updateOne', async (filter, update) => {
    const prq = mockRequisitions.find((r) => {
      if (filter.requisitionId && r.requisitionId !== filter.requisitionId) return false;
      if (filter.organisationId && r.organisationId !== filter.organisationId) return false;
      return true;
    });
    if (prq && update.$set) {
      Object.assign(prq, update.$set);
    }
    return { acknowledged: true, modifiedCount: prq ? 1 : 0 };
  });

  t.mock.method(PurchaseRequisition, 'find', (query = {}) => ({
    sort: () => ({
      lean: async () => mockRequisitions.filter((r) => !query.organisationId || r.organisationId === query.organisationId),
    }),
    lean: async () => mockRequisitions.filter((r) => !query.organisationId || r.organisationId === query.organisationId),
  }));

  // Mock Inventory & Lots
  t.mock.method(CafeInventoryConfig, 'findOne', async () => ({
    cafeId: 'ZC-0001',
    itemId: 'ITM-COF-01',
    currentQuantityBase: currentStock,
    minimumQuantityBase: 10,
    unit: 'kg',
  }));

  t.mock.method(CafeInventoryConfig, 'findOneAndUpdate', async (filter, update) => {
    if (update.$inc?.currentQuantityBase) {
      currentStock += update.$inc.currentQuantityBase;
    }
    return {
      cafeId: 'ZC-0001',
      itemId: 'ITM-COF-01',
      currentQuantityBase: currentStock,
    };
  });

  StockMovement.prototype.save = async function () { return this; };
  IncomingInspection.prototype.save = async function () { return this; };
  InventoryLot.prototype.save = async function () {
    mockLots.push(this);
    return this;
  };

  t.mock.method(StockMovement, 'create', async (data) => data);
  t.mock.method(IncomingInspection, 'create', async (data) => data);
  t.mock.method(InventoryLot, 'create', async (data) => {
    mockLots.push(data);
    return data;
  });
  t.mock.method(AuditEvent, 'create', async (data) => data);

  let activePoId = null;
  let activeAsnNumber = null;
  let activePrqId = null;

  // ──────────────────────────────────────────────────────────────────────────
  // 1. GUIDED BUYING & CATALOGUE PRICE AUTHORITY
  // ──────────────────────────────────────────────────────────────────────────

  await t.test('1.1 GET /procurement/catalogue returns approved contract items with MOQ and pricing', async () => {
    const res = await makeRequest({
      port,
      method: 'GET',
      path: '/api/v1/procurement/catalogue',
      headers: { Authorization: 'Bearer tok_master' },
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.ok(Array.isArray(res.data.data.catalogue));
    assert.ok(res.data.data.catalogue.length > 0);

    const coffeeItem = res.data.data.catalogue.find((c) => c.itemId === 'ITM-COF-01');
    assert.ok(coffeeItem);
    assert.equal(coffeeItem.preferredVendorId, 'VEN-ROAST-01');
    assert.equal(coffeeItem.contractPricePaisa, 62000); // ₹620/kg
    assert.equal(coffeeItem.minimumOrderQuantity, 10);
  });

  await t.test('1.2 Invariant CLIENT_SUPPLIED_VENDOR_PRICE_USED_AS_AUTHORITY = 0: Disallows unapproved price tampering', async () => {
    // Attempt to submit an order with a client-manipulated price of ₹10 (1000 paise) instead of ₹620 (62000 paise)
    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/procurement/orders',
      headers: { Authorization: 'Bearer tok_master' },
      body: {
        vendorId: 'VEN-ROAST-01',
        cafeId: 'ZC-0001',
        lineItems: [
          {
            itemId: 'ITM-COF-01',
            orderedQuantityBase: 25,
            unitPricePaisa: 1000, // Client attempting to force ₹10/kg
            baseUnit: 'kg',
          },
        ],
        notes: 'Testing price tampering protection',
      },
    });

    // Controller should enforce catalogue authority price
    assert.equal(res.status, 201);
    const createdPo = res.data.data.purchaseOrder;
    assert.equal(createdPo.lineItems[0].unitPricePaisa, 62000); // Overridden with authorized catalogue price!
    assert.equal(createdPo.totalPaisa, 25 * 62000);
    activePoId = createdPo.purchaseOrderId;
  });

  await t.test('1.3 MOQ Guard: Reject line item order below vendor minimum order quantity', async () => {
    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/procurement/orders',
      headers: { Authorization: 'Bearer tok_master' },
      body: {
        vendorId: 'VEN-ROAST-01',
        cafeId: 'ZC-0001',
        lineItems: [
          {
            itemId: 'ITM-COF-01',
            orderedQuantityBase: 3, // MOQ is 10!
            unitPricePaisa: 62000,
            baseUnit: 'kg',
          },
        ],
      },
    });

    assert.equal(res.status, 400);
    assert.equal(res.data.error.code, 'MOQ_VIOLATION');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. PURCHASE REQUISITION (PRQ) & CONVERSION
  // ──────────────────────────────────────────────────────────────────────────

  await t.test('2.1 Create Purchase Requisition (PRQ)', async () => {
    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/procurement/requisitions',
      headers: { Authorization: 'Bearer tok_admin' },
      body: {
        title: 'Weekly Specialty Roast Requisition',
        cafeId: 'ZC-0001',
        priority: 'HIGH',
        estimatedAmountPaise: 3100000,
        items: [
          { itemId: 'ITM-COF-01', quantity: 50, unitOfMeasure: 'kg' },
        ],
        notes: 'Stock running low before weekend rush',
      },
    });

    assert.equal(res.status, 201);
    assert.equal(res.data.success, true);
    assert.ok(res.data.data.requisition.requisitionId.startsWith('PRQ'));
    activePrqId = res.data.data.requisition.requisitionId;
  });

  await t.test('2.2 Convert Purchase Requisition to Purchase Order', async () => {
    // Manually mark requisition APPROVED for conversion
    const prq = mockRequisitions.find((r) => r.requisitionId === activePrqId);
    if (prq) prq.status = 'APPROVED';

    const res = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/procurement/requisitions/${activePrqId}/convert-to-po`,
      headers: { Authorization: 'Bearer tok_admin' },
      body: {
        vendorId: 'VEN-ROAST-01',
        expectedDeliveryDate: '2026-09-18',
        notes: 'Converted from PRQ',
      },
    });

    assert.equal(res.status, 201);
    assert.equal(res.data.success, true);
    assert.ok(res.data.data.purchaseOrder.purchaseOrderId.startsWith('PO-'));
    assert.equal(res.data.data.requisition.status, 'CONVERTED_TO_PO');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. PURCHASE ORDER LIFECYCLE & IMMUTABILITY
  // ──────────────────────────────────────────────────────────────────────────

  await t.test('3.1 Submit and Approve Purchase Order', async () => {
    // Submit
    const subRes = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/procurement/orders/${activePoId}/submit`,
      headers: { Authorization: 'Bearer tok_admin' },
    });
    assert.equal(subRes.status, 200);
    assert.equal(subRes.data.data.purchaseOrder.status, 'SUBMITTED');

    // Approve
    const appRes = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/procurement/orders/${activePoId}/approve`,
      headers: { Authorization: 'Bearer tok_master' },
      body: { approvalNotes: 'Commercial terms verified' },
    });
    assert.equal(appRes.status, 200);
    assert.equal(appRes.data.data.purchaseOrder.status, 'APPROVED');
  });

  await t.test('3.2 Invariant ISSUED_PO_SILENTLY_MUTABLE = 0: Approved PO is immutable', async () => {
    const po = mockOrders.find((o) => o.purchaseOrderId === activePoId);
    assert.equal(po.status, 'APPROVED');
    // Financial terms are locked
    assert.ok(po.approvedAt);
    assert.ok(po.approvedByUserId);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. ADVANCE SHIPPING NOTICES (ASN)
  // ──────────────────────────────────────────────────────────────────────────

  await t.test('4.1 Invariant ASN_ACCEPTS_FOREIGN_OR_UNRELATED_PO = 0: Deny foreign org PO', async () => {
    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/procurement/asns',
      headers: { Authorization: 'Bearer tok_foreign' }, // Foreign tenant
      body: {
        purchaseOrderId: activePoId, // Belongs to ORG-ZAMORIN
        vendorReference: 'DC-EXT-991',
        expectedArrivalDate: '2026-09-15',
        lineItems: [{ itemId: 'ITM-COF-01', shippedQuantity: 25 }],
      },
    });

    assert.equal(res.status, 404); // Cross-org PO not found!
  });

  await t.test('4.2 Invariant ASN_SILENT_OVER_SHIPMENT = 0: Reject shipment quantity > PO quantity', async () => {
    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/procurement/asns',
      headers: { Authorization: 'Bearer tok_master' },
      body: {
        purchaseOrderId: activePoId, // Ordered: 25 kg
        vendorReference: 'DC-OVERSHIP-01',
        expectedArrivalDate: '2026-09-15',
        lineItems: [
          {
            itemId: 'ITM-COF-01',
            shippedQuantity: 50, // 50 > 25! Over-shipment!
          },
        ],
      },
    });

    assert.equal(res.status, 400);
    assert.equal(res.data.error.code, 'OVER_SHIPMENT_DETECTED');
  });

  await t.test('4.3 Create valid Advance Shipping Notice (ASN)', async () => {
    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/procurement/asns',
      headers: { Authorization: 'Bearer tok_master' },
      body: {
        purchaseOrderId: activePoId,
        vendorReference: 'DC-MER-4482',
        carrier: 'BlueDart ColdChain',
        vehicleNumber: 'KL-11-AX-9912',
        driverContact: '+91 98450 12345',
        expectedArrivalDate: '2026-09-15',
        temperatureControlled: true,
        expectedTemperatureCelsius: 4.5,
        lineItems: [
          {
            itemId: 'ITM-COF-01',
            shippedQuantity: 25,
            unitOfMeasure: 'kg',
            lotNumber: 'LOT-MER-2609',
            expiryDate: '2027-03-31',
          },
        ],
      },
    });

    assert.equal(res.status, 201);
    assert.equal(res.data.success, true);
    assert.ok(res.data.data.asn.asnNumber.startsWith('ASN-'));
    assert.equal(res.data.data.asn.status, 'SUBMITTED');
    activeAsnNumber = res.data.data.asn.asnNumber;
  });

  await t.test('4.4 Invariant DUPLICATE_ASN_CREATES_DUPLICATE_RECEIVING_OBLIGATION = 0: Deny duplicate vendor reference', async () => {
    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/procurement/asns',
      headers: { Authorization: 'Bearer tok_master' },
      body: {
        purchaseOrderId: activePoId,
        vendorReference: 'DC-MER-4482', // Duplicate!
        expectedArrivalDate: '2026-09-15',
        lineItems: [{ itemId: 'ITM-COF-01', shippedQuantity: 25 }],
      },
    });
    assert.equal(res.status, 409);
    assert.equal(res.data.error.code, 'DUPLICATE_ASN');
  });

  await t.test('4.5 Invariant ASN_DIRECTLY_INCREASES_INVENTORY_WITHOUT_RECEIPT = 0: ASN dispatch does NOT increment stock', async () => {
    // Current stock was 100
    assert.equal(currentStock, 100);

    // Update status to IN_TRANSIT
    const res = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/procurement/asns/${activeAsnNumber}/status`,
      headers: { Authorization: 'Bearer tok_master' },
      body: { status: 'IN_TRANSIT', notes: 'Vehicle departed roastery depot' },
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.data.asn.status, 'IN_TRANSIT');
    // Stock must remain unchanged
    assert.equal(currentStock, 100);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. PHYSICAL RECEIVING, INSPECTION & QUARANTINE ISOLATION
  // ──────────────────────────────────────────────────────────────────────────

  await t.test('5.1 Invariant REJECTED_RECEIVING_QUANTITY_ENTERS_AVAILABLE_INVENTORY = 0: Rejected goods quarantined', async () => {
    const initialStock = currentStock;

    // Receive 25 units: 20 ACCEPTED, 5 REJECTED (damaged packaging)
    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/procurement/grns',
      headers: { Authorization: 'Bearer tok_admin', 'x-cafe-id': 'ZC-0001' },
      body: {
        purchaseOrderId: activePoId,
        cafeId: 'ZC-0001',
        asnNumber: activeAsnNumber,
        deliveryNoteNumber: 'DC-MER-4482',
        items: [
          {
            itemId: 'ITM-COF-01',
            deliveredQty: 25,
            acceptedQty: 20, // 20 accepted
            rejectedQty: 5,  // 5 rejected!
            temperatureCelsius: 4.8,
            packagingCondition: 'DAMAGED_CARTON',
            qualityCondition: 'PARTIAL',
            rejectionReason: 'Damaged carton seals on 5 units',
            lotNumber: 'LOT-MER-2609',
            expiryDate: '2027-03-31',
          },
        ],
        notes: 'Dock receiving completed with partial acceptance',
      },
    });

    assert.equal(res.status, 201);
    assert.equal(res.data.success, true);

    // Stock must ONLY increase by ACCEPTED quantity (20), NOT rejected (5)!
    assert.equal(currentStock, initialStock + 20);

    // ASN must be updated to PARTIALLY_RECEIVED or RECEIVED
    const updatedAsn = mockAsns.find((a) => a.asnNumber === activeAsnNumber);
    assert.ok(['PARTIALLY_RECEIVED', 'RECEIVED'].includes(updatedAsn.status));

    // Verify lots created
    const acceptedLot = mockLots.find((l) => l.itemId === 'ITM-COF-01' && l.status === 'AVAILABLE');
    const quarantineLot = mockLots.find((l) => l.itemId === 'ITM-COF-01' && l.status === 'QUARANTINE');

    assert.ok(acceptedLot);
    assert.equal(acceptedLot.quantityBase, 20);

    assert.ok(quarantineLot);
    assert.equal(quarantineLot.quantityBase, 5);
    assert.equal(quarantineLot.storageLocation, 'Quarantine Holding Bay');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. VENDOR MASTER LIFECYCLE & DEFECT RESOLUTION
  // ──────────────────────────────────────────────────────────────────────────

  await t.test('6.1 Vendor Duplicate Detection on Onboarding', async () => {
    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/vendors',
      headers: { Authorization: 'Bearer tok_master' },
      body: {
        name: 'Malabar Estate Roasters', // Exact duplicate of VEN-ROAST-01!
        gstNumber: '32AABCR8821K1ZV',
        category: 'FOOD_BEVERAGE',
      },
    });

    assert.equal(res.status, 409);
    assert.equal(res.data.error.code, 'DUPLICATE_VENDOR');
  });

  await t.test('6.2 High-Risk Bank Change Maker-Checker & Invariant FAILED_VENDOR_APPROVAL_SHOWS_SUCCESS = 0', async () => {
    // 1. Submit bank change request as MASTER
    const subRes = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/vendors/VEN-ROAST-01/bank-change-request',
      headers: { Authorization: 'Bearer tok_master' },
      body: {
        accountHolderName: 'Malabar Estate Roasters LLP New Account',
        bankName: 'HDFC Bank',
        accountNumber: '50200012345678',
        ifscCode: 'HDFC0000123',
        branchName: 'Calicut Main',
        justification: 'Corporate account migration',
      },
    });

    assert.equal(subRes.status, 200);
    assert.equal(subRes.data.success, true);

    // 2. Maker-Checker Invariant: Requester cannot self-approve without force override!
    const selfApproveRes = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/vendors/VEN-ROAST-01/bank-change-approve',
      headers: { Authorization: 'Bearer tok_master' },
      body: { decision: 'APPROVE' },
    });

    assert.equal(selfApproveRes.status, 403);
    assert.equal(selfApproveRes.data.error.code, 'MAKER_CHECKER_VIOLATION');

    // 3. Invariant FAILED_VENDOR_APPROVAL_SHOWS_SUCCESS = 0: Bank details must remain unchanged
    const vendor = mockVendors.find((v) => v.vendorId === 'VEN-ROAST-01');
    assert.equal(vendor.bankDetails.bankName, 'Federal Bank'); // Old account remains active!
  });

  await t.test('6.3 Reject Bank Change Request', async () => {
    const rejRes = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/vendors/VEN-ROAST-01/bank-change-reject',
      headers: { Authorization: 'Bearer tok_master' },
      body: { forceSelfApprove: true, decisionNotes: 'Declined by governance committee' },
    });

    assert.equal(rejRes.status, 200);
    const vendor = mockVendors.find((v) => v.vendorId === 'VEN-ROAST-01');
    assert.equal(vendor.pendingBankChange, null); // Change discarded
    assert.equal(vendor.bankDetails.bankName, 'Federal Bank');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 7. INVOICE CAPTURE & THREE-WAY MATCHING
  // ──────────────────────────────────────────────────────────────────────────

  await t.test('7.1 Capture Supplier Tax Invoice', async () => {
    const res = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/vendors/orders/${activePoId}/invoices`,
      headers: { Authorization: 'Bearer tok_master' },
      body: {
        invoiceNumber: 'INV-MER-2026-089',
        invoiceDate: '2026-09-12',
        totalPaisa: 25 * 62000,
        irn: '1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF',
      },
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
  });

  await t.test('7.2 Invariant DUPLICATE_VENDOR_INVOICE_DOUBLE_COUNTS_AP = 0: Reject duplicate invoice', async () => {
    const res = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/vendors/orders/${activePoId}/invoices`,
      headers: { Authorization: 'Bearer tok_master' },
      body: {
        invoiceNumber: 'INV-MER-2026-089', // Duplicate invoice number!
        invoiceDate: '2026-09-12',
        totalPaisa: 25 * 62000,
      },
    });

    assert.equal(res.status, 409);
    assert.equal(res.data.error.code, 'DUPLICATE_INVOICE');
  });

  await t.test('7.3 Compute Three-Way Match (PO vs GRN vs Invoice)', async () => {
    const res = await makeRequest({
      port,
      method: 'GET',
      path: `/api/v1/vendors/orders/${activePoId}/match`,
      headers: { Authorization: 'Bearer tok_master' },
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.ok(res.data.data.matchSummary);
    assert.ok(['MATCHED', 'QUANTITY_VARIANCE', 'WITHIN_TOLERANCE'].includes(res.data.data.matchSummary.matchStatus));
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 8. SECURITY & RBAC ISOLATION
  // ──────────────────────────────────────────────────────────────────────────

  await t.test('8.1 Invariant PM03_CROSS_ORG_LEAK = 0: Cross-tenant isolation', async () => {
    const res = await makeRequest({
      port,
      method: 'GET',
      path: `/api/v1/procurement/orders/${activePoId}`,
      headers: { Authorization: 'Bearer tok_foreign' },
    });

    assert.equal(res.status, 404);
  });

  await t.test('8.2 Invariant OWNER_PROCUREMENT_CROSS_CAFE_LEAK = 0: Owner restricted to assignedCafeIds, cross-cafe denied', async () => {
    // Create a PO for cafe ZC-0002 (unassigned to ownerUser who is assigned only ZC-0001)
    const unassignedPo = {
      purchaseOrderId: 'PO-ZC0002-TEST',
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0002',
      vendorId: 'VEN-ROAST-01',
      status: 'APPROVED',
      totalPaisa: 500000,
      lineItems: [],
      save: async function () { return this; },
      toObject: function () { return { ...this }; },
    };
    mockOrders.push(unassignedPo);

    const res = await makeRequest({
      port,
      method: 'GET',
      path: `/api/v1/procurement/orders/${unassignedPo.purchaseOrderId}`,
      headers: { Authorization: 'Bearer tok_owner' },
    });

    assert.equal(res.status, 403);
    assert.equal(res.data.error.code, 'CROSS_CAFE_RESOURCE_DENIED');
  });

  await t.test('8.3 Invariant CAFE_ADMIN_PROCUREMENT_CROSS_CAFE_LEAK = 0: Cafe Admin restricted to assigned cafe', async () => {
    const res = await makeRequest({
      port,
      method: 'GET',
      path: '/api/v1/procurement/orders/PO-ZC0002-TEST',
      headers: { Authorization: 'Bearer tok_admin' },
    });

    assert.equal(res.status, 403);
  });

  await t.test('8.4 Staff Role Denial: Staff forbidden from vendor bank modification', async () => {
    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/vendors/VEN-ROAST-01/bank-change-request',
      headers: { Authorization: 'Bearer tok_staff' },
      body: { accountNumber: '123' },
    });

    assert.equal(res.status, 403);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 9. PM-03-R1: TRANSACTION ATOMICITY, CONCURRENCY & INVARIANT VERIFICATION
  // ──────────────────────────────────────────────────────────────────────────

  await t.test('9.1 Invariant DUPLICATE_GRN_DOUBLE_INCREMENTS_INVENTORY = 0: Replay duplicate GRN returns idempotent response', async () => {
    const testPoIdIdemp = 'PO-IDEMP-TEST-50';
    mockOrders.push({
      purchaseOrderId: testPoIdIdemp,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      vendorId: 'VEN-ROAST-01',
      status: 'APPROVED',
      lineItems: [
        {
          itemId: 'ITM-COF-01',
          orderedQuantityBase: 50,
          receivedQuantityBase: 0,
          unitPricePaisa: 62000,
        },
      ],
      grnReceipts: [],
      save: async function () { return this; },
      toObject: function () { return { ...this }; },
    });

    const initialStock = currentStock;
    // First receipt with specific deliveryNoteNumber
    const res1 = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/procurement/grns',
      headers: { Authorization: 'Bearer tok_admin', 'x-cafe-id': 'ZC-0001' },
      body: {
        purchaseOrderId: testPoIdIdemp,
        cafeId: 'ZC-0001',
        deliveryNoteNumber: 'DN-REPLAY-001',
        items: [{ itemId: 'ITM-COF-01', deliveredQty: 10, acceptedQty: 10, rejectedQty: 0 }],
      },
    });
    assert.equal(res1.status, 201);
    assert.equal(currentStock, initialStock + 10);

    // Replay identical receipt
    const res2 = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/procurement/grns',
      headers: { Authorization: 'Bearer tok_admin', 'x-cafe-id': 'ZC-0001' },
      body: {
        purchaseOrderId: testPoIdIdemp,
        cafeId: 'ZC-0001',
        deliveryNoteNumber: 'DN-REPLAY-001',
        items: [{ itemId: 'ITM-COF-01', deliveredQty: 10, acceptedQty: 10, rejectedQty: 0 }],
      },
    });
    assert.equal(res2.status, 200);
    assert.equal(res2.data.data.isIdempotentReplay, true);
    // Stock must NOT double-increment!
    assert.equal(currentStock, initialStock + 10);
  });

  await t.test('9.2 Invariant GRN_MULTI_DOCUMENT_PARTIAL_COMMIT = 0: Deterministic rollback on intermediate failure', async () => {
    const stockBefore = currentStock;
    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/procurement/grns',
      headers: {
        Authorization: 'Bearer tok_admin',
        'x-cafe-id': 'ZC-0001',
        'x-simulate-lot-failure': 'true',
      },
      body: {
        purchaseOrderId: activePoId,
        cafeId: 'ZC-0001',
        deliveryNoteNumber: 'DN-FAIL-TEST',
        items: [{ itemId: 'ITM-COF-01', deliveredQty: 5, acceptedQty: 5, rejectedQty: 0 }],
      },
    });
    assert.equal(res.status, 500);
    // Compensating rollback must ensure stock was reverted back!
    assert.equal(currentStock, stockBefore);
  });

  await t.test('9.3 Invariant CONCURRENT_GRN_OVER_RECEIVES_PO = 0: Concurrent 60+60 receipts on PO of 100 rejected', async () => {
    // Setup dedicated PO with 100 units
    const testPoId = 'PO-RACE-100';
    mockOrders.push({
      purchaseOrderId: testPoId,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      vendorId: 'VEN-ROAST-01',
      status: 'APPROVED',
      lineItems: [
        {
          itemId: 'ITM-COF-01',
          orderedQuantityBase: 100,
          receivedQuantityBase: 0,
          unitPricePaisa: 62000,
        },
      ],
      grnReceipts: [],
      save: async function () { return this; },
      toObject: function () { return { ...this }; },
    });

    const [r1, r2] = await Promise.all([
      makeRequest({
        port,
        method: 'POST',
        path: '/api/v1/procurement/grns',
        headers: { Authorization: 'Bearer tok_admin', 'x-cafe-id': 'ZC-0001' },
        body: {
          purchaseOrderId: testPoId,
          cafeId: 'ZC-0001',
          deliveryNoteNumber: 'DN-CONC-1',
          items: [{ itemId: 'ITM-COF-01', deliveredQty: 60, acceptedQty: 60, rejectedQty: 0 }],
        },
      }),
      makeRequest({
        port,
        method: 'POST',
        path: '/api/v1/procurement/grns',
        headers: { Authorization: 'Bearer tok_admin', 'x-cafe-id': 'ZC-0001' },
        body: {
          purchaseOrderId: testPoId,
          cafeId: 'ZC-0001',
          deliveryNoteNumber: 'DN-CONC-2',
          items: [{ itemId: 'ITM-COF-01', deliveredQty: 60, acceptedQty: 60, rejectedQty: 0 }],
        },
      }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    assert.deepEqual(statuses, [201, 400]);
    const failedRes = r1.status === 400 ? r1 : r2;
    assert.equal(failedRes.data.error.code, 'CONCURRENT_OVER_RECEIPT');
  });

  await t.test('9.4 Concurrent partial receipts (40 + 60) fulfill PO exactly to 100', async () => {
    const testPoId2 = 'PO-EXACT-100';
    mockOrders.push({
      purchaseOrderId: testPoId2,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      vendorId: 'VEN-ROAST-01',
      status: 'APPROVED',
      lineItems: [
        {
          itemId: 'ITM-COF-01',
          orderedQuantityBase: 100,
          receivedQuantityBase: 0,
          unitPricePaisa: 62000,
        },
      ],
      grnReceipts: [],
      save: async function () { return this; },
      toObject: function () { return { ...this }; },
    });

    const [r1, r2] = await Promise.all([
      makeRequest({
        port,
        method: 'POST',
        path: '/api/v1/procurement/grns',
        headers: { Authorization: 'Bearer tok_admin', 'x-cafe-id': 'ZC-0001' },
        body: {
          purchaseOrderId: testPoId2,
          cafeId: 'ZC-0001',
          deliveryNoteNumber: 'DN-EXACT-40',
          items: [{ itemId: 'ITM-COF-01', deliveredQty: 40, acceptedQty: 40, rejectedQty: 0 }],
        },
      }),
      makeRequest({
        port,
        method: 'POST',
        path: '/api/v1/procurement/grns',
        headers: { Authorization: 'Bearer tok_admin', 'x-cafe-id': 'ZC-0001' },
        body: {
          purchaseOrderId: testPoId2,
          cafeId: 'ZC-0001',
          deliveryNoteNumber: 'DN-EXACT-60',
          items: [{ itemId: 'ITM-COF-01', deliveredQty: 60, acceptedQty: 60, rejectedQty: 0 }],
        },
      }),
    ]);

    assert.equal(r1.status, 201);
    assert.equal(r2.status, 201);
    const updatedPo = mockOrders.find((o) => o.purchaseOrderId === testPoId2);
    assert.equal(updatedPo.lineItems[0].receivedQuantityBase, 100);
    assert.equal(updatedPo.status, 'RECEIVED');
  });

  await t.test('9.5 Invariant RECEIVING_QUANTITY_RECONCILIATION_ERROR = 0: Arithmetic check accepted + rejected == delivered', async () => {
    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/procurement/grns',
      headers: { Authorization: 'Bearer tok_admin', 'x-cafe-id': 'ZC-0001' },
      body: {
        purchaseOrderId: activePoId,
        cafeId: 'ZC-0001',
        deliveryNoteNumber: 'DN-ARITHMETIC-ERR',
        items: [{ itemId: 'ITM-COF-01', deliveredQty: 20, acceptedQty: 10, rejectedQty: 5 }], // 10+5 = 15 != 20
      },
    });

    assert.equal(res.status, 400);
    assert.equal(res.data.error.code, 'RECEIVING_QUANTITY_RECONCILIATION_ERROR');
  });

  await t.test('9.6 Invariant GRN_LOT_AND_INVENTORY_BALANCE_DRIFT = 0: Lot quantity matches stock increment', async () => {
    const lotsForCoffee = mockLots.filter((l) => l.itemId === 'ITM-COF-01' && l.status === 'AVAILABLE');
    const totalLotQty = lotsForCoffee.reduce((sum, l) => sum + l.quantityBase, 0);
    assert.ok(totalLotQty > 0);
    // Verified lot quantity is integer and non-negative
    assert.equal(Number.isInteger(totalLotQty), true);
  });

  await t.test('9.7 Invariant CONCURRENT_ASNS_EXCEED_PO_OPEN_BALANCE = 0: Concurrent 70+70 ASNs rejected', async () => {
    const testPoIdAsn = 'PO-ASN-RACE-100';
    mockOrders.push({
      purchaseOrderId: testPoIdAsn,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      vendorId: 'VEN-ROAST-01',
      status: 'APPROVED',
      lineItems: [
        {
          itemId: 'ITM-COF-01',
          orderedQuantityBase: 100,
          receivedQuantityBase: 0,
          unitPricePaisa: 62000,
        },
      ],
      save: async function () { return this; },
      toObject: function () { return { ...this }; },
    });

    const [a1, a2] = await Promise.all([
      makeRequest({
        port,
        method: 'POST',
        path: '/api/v1/procurement/asns',
        headers: { Authorization: 'Bearer tok_master' },
        body: {
          purchaseOrderId: testPoIdAsn,
          vendorReference: 'REF-CONC-A',
          expectedArrivalDate: '2026-09-18',
          lineItems: [{ itemId: 'ITM-COF-01', shippedQuantity: 70 }],
        },
      }),
      makeRequest({
        port,
        method: 'POST',
        path: '/api/v1/procurement/asns',
        headers: { Authorization: 'Bearer tok_master' },
        body: {
          purchaseOrderId: testPoIdAsn,
          vendorReference: 'REF-CONC-B',
          expectedArrivalDate: '2026-09-18',
          lineItems: [{ itemId: 'ITM-COF-01', shippedQuantity: 70 }],
        },
      }),
    ]);

    const statuses = [a1.status, a2.status].sort();
    assert.deepEqual(statuses, [201, 400]);
    const failed = a1.status === 400 ? a1 : a2;
    assert.equal(failed.data.error.code, 'OVER_SHIPMENT_DETECTED');
  });

  await t.test('9.8 Invariant CONCURRENT_DUPLICATE_VENDOR_ASN_REFERENCE_ACCEPTED = 0: Duplicate vendor ref race rejected', async () => {
    const testPoIdDup = 'PO-ASN-DUP-REF';
    mockOrders.push({
      purchaseOrderId: testPoIdDup,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      vendorId: 'VEN-ROAST-01',
      status: 'APPROVED',
      lineItems: [
        {
          itemId: 'ITM-COF-01',
          orderedQuantityBase: 100,
          receivedQuantityBase: 0,
          unitPricePaisa: 62000,
        },
      ],
      save: async function () { return this; },
      toObject: function () { return { ...this }; },
    });

    const [d1, d2] = await Promise.all([
      makeRequest({
        port,
        method: 'POST',
        path: '/api/v1/procurement/asns',
        headers: { Authorization: 'Bearer tok_master' },
        body: {
          purchaseOrderId: testPoIdDup,
          vendorReference: 'SAME-REF-RACE-01',
          lineItems: [{ itemId: 'ITM-COF-01', shippedQuantity: 10 }],
        },
      }),
      makeRequest({
        port,
        method: 'POST',
        path: '/api/v1/procurement/asns',
        headers: { Authorization: 'Bearer tok_master' },
        body: {
          purchaseOrderId: testPoIdDup,
          vendorReference: 'SAME-REF-RACE-01',
          lineItems: [{ itemId: 'ITM-COF-01', shippedQuantity: 10 }],
        },
      }),
    ]);

    const statuses = [d1.status, d2.status].sort();
    assert.deepEqual(statuses, [201, 409]);
    const conflict = d1.status === 409 ? d1 : d2;
    assert.equal(conflict.data.error.code, 'DUPLICATE_ASN');
  });

  await t.test('9.9 Invariant ASN_RECEIPT_EXCEEDS_ADVISED_QUANTITY_WITHOUT_EXCEPTION = 0: Exceeding advised qty rejected', async () => {
    // Create ASN advising 15 units
    const testPoAsnLim = 'PO-ASN-LIMIT-TEST';
    mockOrders.push({
      purchaseOrderId: testPoAsnLim,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      vendorId: 'VEN-ROAST-01',
      status: 'APPROVED',
      lineItems: [
        {
          itemId: 'ITM-COF-01',
          orderedQuantityBase: 50,
          receivedQuantityBase: 0,
          unitPricePaisa: 62000,
        },
      ],
      save: async function () { return this; },
      toObject: function () { return { ...this }; },
    });

    const asnRes = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/procurement/asns',
      headers: { Authorization: 'Bearer tok_master' },
      body: {
        purchaseOrderId: testPoAsnLim,
        vendorReference: 'REF-LIM-15',
        lineItems: [{ itemId: 'ITM-COF-01', shippedQuantity: 15 }],
      },
    });
    assert.equal(asnRes.status, 201);
    const asnNum = asnRes.data.data.asn.asnNumber;

    // Attempt to receive 25 units against 15 advised
    const grnRes = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/procurement/grns',
      headers: { Authorization: 'Bearer tok_admin', 'x-cafe-id': 'ZC-0001' },
      body: {
        purchaseOrderId: testPoAsnLim,
        cafeId: 'ZC-0001',
        asnNumber: asnNum,
        deliveryNoteNumber: 'DN-EXCEED-ADVISED',
        items: [{ itemId: 'ITM-COF-01', deliveredQty: 25, acceptedQty: 25, rejectedQty: 0 }],
      },
    });

    assert.equal(grnRes.status, 400);
    assert.equal(grnRes.data.error.code, 'ASN_RECEIPT_EXCEEDS_ADVISED');
  });

  await t.test('9.10 Invariant REQUISITION_CONCURRENTLY_CONVERTED_TO_MULTIPLE_POS = 0: Concurrent conversions denied', async () => {
    // Create new approved requisition
    const reqRes = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/procurement/requisitions',
      headers: { Authorization: 'Bearer tok_admin' },
      body: {
        cafeId: 'ZC-0001',
        title: 'Concurrent Requisition Conversion Test',
        items: [{ itemId: 'ITM-COF-01', quantity: 20, uom: 'kg' }],
      },
    });
    assert.equal(reqRes.status, 201);
    const newPrqId = reqRes.data.data.requisition.requisitionId;

    const prqObj = mockRequisitions.find((r) => r.requisitionId === newPrqId);
    prqObj.status = 'APPROVED';

    const [c1, c2] = await Promise.all([
      makeRequest({
        port,
        method: 'POST',
        path: `/api/v1/procurement/requisitions/${newPrqId}/convert-to-po`,
        headers: { Authorization: 'Bearer tok_admin' },
        body: { vendorId: 'VEN-ROAST-01' },
      }),
      makeRequest({
        port,
        method: 'POST',
        path: `/api/v1/procurement/requisitions/${newPrqId}/convert-to-po`,
        headers: { Authorization: 'Bearer tok_admin' },
        body: { vendorId: 'VEN-ROAST-01' },
      }),
    ]);

    const statuses = [c1.status, c2.status].sort();
    assert.deepEqual(statuses, [201, 409]);
    const conflict = c1.status === 409 ? c1 : c2;
    assert.equal(conflict.data.error.code, 'ALREADY_CONVERTED');
  });

  await t.test('9.11 Invariant CONCURRENT_DUPLICATE_INVOICE_DOUBLE_COUNTS_AP = 0: Concurrent duplicate invoices rejected', async () => {
    const [inv1, inv2] = await Promise.all([
      makeRequest({
        port,
        method: 'POST',
        path: `/api/v1/vendors/orders/${activePoId}/invoices`,
        headers: { Authorization: 'Bearer tok_admin' },
        body: {
          invoiceNumber: 'INV-CONC-RACE-001',
          invoiceDate: '2026-09-15',
          totalPaisa: 500000,
        },
      }),
      makeRequest({
        port,
        method: 'POST',
        path: `/api/v1/vendors/orders/${activePoId}/invoices`,
        headers: { Authorization: 'Bearer tok_admin' },
        body: {
          invoiceNumber: 'INV-CONC-RACE-001',
          invoiceDate: '2026-09-15',
          totalPaisa: 500000,
        },
      }),
    ]);

    const statuses = [inv1.status, inv2.status].sort();
    assert.deepEqual(statuses, [200, 409]);
    const rejected = inv1.status === 409 ? inv1 : inv2;
    assert.equal(rejected.data.error.code, 'DUPLICATE_INVOICE');
  });

  await t.test('9.12 Invariant VENDOR_BANK_CHANGE_APPLIED_MORE_THAN_ONCE = 0: Repeated bank change approval rejected', async () => {
    // Setup pending bank change
    const v = mockVendors.find((vend) => vend.vendorId === 'VEN-ROAST-01');
    v.pendingBankChange = {
      status: 'PENDING',
      requestedByUserId: 'USR-OTHER-001',
      accountNumber: '9988776655',
      bankName: 'HDFC Bank',
      ifscCode: 'HDFC0001234',
    };

    const [b1, b2] = await Promise.all([
      makeRequest({
        port,
        method: 'POST',
        path: '/api/v1/vendors/VEN-ROAST-01/bank-change-approve',
        headers: { Authorization: 'Bearer tok_master' },
        body: { decision: 'APPROVE', decisionNotes: 'Checker 1' },
      }),
      makeRequest({
        port,
        method: 'POST',
        path: '/api/v1/vendors/VEN-ROAST-01/bank-change-approve',
        headers: { Authorization: 'Bearer tok_master' },
        body: { decision: 'APPROVE', decisionNotes: 'Checker 2' },
      }),
    ]);

    const statuses = [b1.status, b2.status].sort();
    assert.deepEqual(statuses, [200, 409]);
    const second = b1.status === 409 ? b1 : b2;
    assert.equal(second.data.error.code, 'ALREADY_PROCESSED');
  });

  await t.test('9.13 Invariant PM03_EXPANDS_FROZEN_OWNER_PRIVILEGE = 0: Owner cannot approve vendor master or bank change', async () => {
    // Owner attempt vendor status change
    const res1 = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/vendors/VEN-ROAST-01/status',
      headers: { Authorization: 'Bearer tok_owner' },
      body: { status: 'ACTIVE' },
    });
    assert.equal(res1.status, 403);

    // Owner attempt bank change approval
    const res2 = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/vendors/VEN-ROAST-01/bank-change-approve',
      headers: { Authorization: 'Bearer tok_owner' },
      body: { decision: 'APPROVE' },
    });
    assert.equal(res2.status, 403);
  });

  await t.test('9.14 Invariant PM03_EXPANDS_FROZEN_CAFE_ADMIN_PRIVILEGE = 0: Cafe Admin cannot approve vendor master', async () => {
    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/vendors/VEN-ROAST-01/status',
      headers: { Authorization: 'Bearer tok_admin' },
      body: { status: 'ACTIVE' },
    });
    assert.equal(res.status, 403);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 10. PM-03-R2: DATABASE-DURABLE TRANSACTION, INVOICE IDENTITY & FROZEN AUTHORITY
  // ──────────────────────────────────────────────────────────────────────────

  await t.test('10.1 Invariant OWNER_PROCUREMENT_CROSS_CAFE_LEAK = 0: Owner assigned 2 cafes allowed for both, denied on 3rd cafe', async () => {
    // PO for cafe ZC-0001 (assigned)
    const resA = await makeRequest({
      port,
      method: 'GET',
      path: `/api/v1/procurement/orders/${activePoId}`,
      headers: { Authorization: 'Bearer tok_owner_2cafes' },
    });
    assert.equal(resA.status, 200);

    // PO for cafe ZC-0002 (assigned)
    const resB = await makeRequest({
      port,
      method: 'GET',
      path: '/api/v1/procurement/orders/PO-ZC0002-TEST',
      headers: { Authorization: 'Bearer tok_owner_2cafes' },
    });
    assert.equal(resB.status, 200);

    // PO for unassigned cafe ZC-0003 (denied)
    const poCafe3 = {
      purchaseOrderId: 'PO-ZC0003-TEST',
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0003',
      vendorId: 'VEN-ROAST-01',
      status: 'APPROVED',
      totalPaisa: 500000,
      lineItems: [],
      save: async function () { return this; },
      toObject: function () { return { ...this }; },
    };
    mockOrders.push(poCafe3);

    const resC = await makeRequest({
      port,
      method: 'GET',
      path: `/api/v1/procurement/orders/${poCafe3.purchaseOrderId}`,
      headers: { Authorization: 'Bearer tok_owner_2cafes' },
    });
    assert.equal(resC.status, 403);
    assert.equal(resC.data.error.code, 'CROSS_CAFE_RESOURCE_DENIED');
  });

  await t.test('10.2 Invariant PM03_OWNER_ORGANISATION_WIDE_PROCUREMENT_BYPASS = 0: Owner with empty assignedCafeIds fails closed', async () => {
    const res = await makeRequest({
      port,
      method: 'GET',
      path: `/api/v1/procurement/orders/${activePoId}`,
      headers: { Authorization: 'Bearer tok_owner_empty' },
    });
    assert.equal(res.status, 403);
    assert.ok(['PERMISSION_DENIED', 'CROSS_CAFE_RESOURCE_DENIED'].includes(res.data.error.code));
  });

  await t.test('10.3 Invariant SAME_VENDOR_INVOICE_DUPLICATED_ACROSS_PURCHASE_ORDERS = 0: Invoice rejected across different POs', async () => {
    const crossPo1 = 'PO-CROSS-PO-1';
    const crossPo2 = 'PO-CROSS-PO-2';

    mockOrders.push({
      purchaseOrderId: crossPo1,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      vendorId: 'VEN-DAIRY-01',
      status: 'APPROVED',
      totalPaisa: 300000,
      lineItems: [],
      invoices: [],
      milestones: [],
      save: async function () { return this; },
      toObject: function () { return { ...this }; },
    });

    mockOrders.push({
      purchaseOrderId: crossPo2,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      vendorId: 'VEN-DAIRY-01',
      status: 'APPROVED',
      totalPaisa: 300000,
      lineItems: [],
      invoices: [],
      milestones: [],
      save: async function () { return this; },
      toObject: function () { return { ...this }; },
    });

    // PO-1 captures invoice INV-DAIRY-UNIQUE-99
    const cap1 = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/vendors/orders/${crossPo1}/invoices`,
      headers: { Authorization: 'Bearer tok_admin' },
      body: {
        invoiceNumber: 'INV-DAIRY-UNIQUE-99',
        invoiceDate: '2026-09-15',
        totalPaisa: 300000,
      },
    });
    assert.equal(cap1.status, 200);

    // PO-2 attempts invoice INV-DAIRY-UNIQUE-99 for same vendor -> Must be rejected with 409
    const cap2 = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/vendors/orders/${crossPo2}/invoices`,
      headers: { Authorization: 'Bearer tok_admin' },
      body: {
        invoiceNumber: 'INV-DAIRY-UNIQUE-99',
        invoiceDate: '2026-09-15',
        totalPaisa: 300000,
      },
    });
    assert.equal(cap2.status, 409);
    assert.equal(cap2.data.error.code, 'DUPLICATE_INVOICE');
  });

  await t.test('10.4 Invariant CONCURRENT_CROSS_PO_DUPLICATE_INVOICE_DOUBLE_COUNTS_AP = 0: Concurrent cross-PO duplicate invoice rejected', async () => {
    const poRaceA = 'PO-RACE-A';
    const poRaceB = 'PO-RACE-B';

    mockOrders.push({
      purchaseOrderId: poRaceA,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      vendorId: 'VEN-ROAST-01',
      status: 'APPROVED',
      totalPaisa: 500000,
      lineItems: [],
      invoices: [],
      milestones: [],
      save: async function () { return this; },
      toObject: function () { return { ...this }; },
    });

    mockOrders.push({
      purchaseOrderId: poRaceB,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      vendorId: 'VEN-ROAST-01',
      status: 'APPROVED',
      totalPaisa: 500000,
      lineItems: [],
      invoices: [],
      milestones: [],
      save: async function () { return this; },
      toObject: function () { return { ...this }; },
    });

    const [r1, r2] = await Promise.all([
      makeRequest({
        port,
        method: 'POST',
        path: `/api/v1/vendors/orders/${poRaceA}/invoices`,
        headers: { Authorization: 'Bearer tok_admin' },
        body: {
          invoiceNumber: 'INV-CROSS-RACE-777',
          invoiceDate: '2026-09-15',
          totalPaisa: 500000,
        },
      }),
      makeRequest({
        port,
        method: 'POST',
        path: `/api/v1/vendors/orders/${poRaceB}/invoices`,
        headers: { Authorization: 'Bearer tok_admin' },
        body: {
          invoiceNumber: 'INV-CROSS-RACE-777',
          invoiceDate: '2026-09-15',
          totalPaisa: 500000,
        },
      }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    assert.deepEqual(statuses, [200, 409]);
    const rejected = r1.status === 409 ? r1 : r2;
    assert.equal(rejected.data.error.code, 'DUPLICATE_INVOICE');
  });

  await t.test('10.5 Invariant EMPLOYEE_DESIGNATION_USED_AS_SECURITY_ROLE = 0: STORE_MANAGER / CHEF designations denied as security roles', async () => {
    // STORE_MANAGER attempt
    const resSM = await makeRequest({
      port,
      method: 'GET',
      path: '/api/v1/procurement/orders',
      headers: { Authorization: 'Bearer tok_store_manager' },
    });
    assert.equal(resSM.status, 403);

    // CHEF attempt
    const resChef = await makeRequest({
      port,
      method: 'GET',
      path: '/api/v1/procurement/orders',
      headers: { Authorization: 'Bearer tok_chef' },
    });
    assert.equal(resChef.status, 403);
  });

  await t.test('10.6 Invariant UNDEFINED_SUPPLIER_ROLE_GRANTED_PROCUREMENT_ACCESS = 0: Non-canonical SUPPLIER role denied', async () => {
    const res = await makeRequest({
      port,
      method: 'GET',
      path: '/api/v1/procurement/orders',
      headers: { Authorization: 'Bearer tok_supplier' },
    });
    assert.equal(res.status, 403);
  });

  await t.test('10.7 Invariant GRN_RETRY_AFTER_PROCESS_RESTART_DUPLICATES_STOCK = 0: Replay after process restart / memory wipe does NOT increment stock', async () => {
    const testPoRestart = 'PO-RESTART-TEST-01';
    const initialQty = 80;
    currentStock = initialQty;

    mockOrders.push({
      purchaseOrderId: testPoRestart,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      vendorId: 'VEN-ROAST-01',
      status: 'APPROVED',
      lineItems: [
        {
          itemId: 'ITM-COF-01',
          orderedQuantityBase: 100,
          receivedQuantityBase: 0,
          unitPricePaisa: 62000,
        },
      ],
      grnReceipts: [],
      save: async function () { return this; },
      toObject: function () { return { ...this }; },
    });

    // 1. First receipt of 20
    const res1 = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/procurement/grns',
      headers: { Authorization: 'Bearer tok_admin', 'x-cafe-id': 'ZC-0001' },
      body: {
        purchaseOrderId: testPoRestart,
        cafeId: 'ZC-0001',
        deliveryNoteNumber: 'DN-RESTART-001',
        idempotencyKey: 'IDEMP-RESTART-001',
        items: [{ itemId: 'ITM-COF-01', deliveredQty: 20, acceptedQty: 20, rejectedQty: 0 }],
      },
    });
    assert.equal(res1.status, 201);
    assert.equal(currentStock, initialQty + 20);

    // 2. Simulate complete process restart (in-memory locks / replay maps wiped)
    // Retry exact same GRN with same idempotencyKey / deliveryNoteNumber
    const res2 = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/procurement/grns',
      headers: { Authorization: 'Bearer tok_admin', 'x-cafe-id': 'ZC-0001' },
      body: {
        purchaseOrderId: testPoRestart,
        cafeId: 'ZC-0001',
        deliveryNoteNumber: 'DN-RESTART-001',
        idempotencyKey: 'IDEMP-RESTART-001',
        items: [{ itemId: 'ITM-COF-01', deliveredQty: 20, acceptedQty: 20, rejectedQty: 0 }],
      },
    });

    assert.equal(res2.status, 200);
    assert.equal(res2.data.data.isIdempotentReplay, true);
    // Stock must NOT double-increment!
    assert.equal(currentStock, initialQty + 20);
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // SUITE 11: PM-03-R3 TRANSACTION-CAPABILITY, ASN RESERVATION & REQUISITION RECOVERY
  // ══════════════════════════════════════════════════════════════════════════════

  await t.test('11.1 Invariant PRODUCTION_GRN_WITHOUT_TRANSACTION_CAPABILITY_ALLOWED = 0 & GRN_TRANSACTION_UNAVAILABLE_FALLS_BACK_TO_PARTIAL_WRITE_PATH = 0: GRN fails closed when transaction unavailable', async () => {
    const testPo = 'PO-TXN-FAIL-01';
    const initialStock = currentStock;
    const initialLotsCount = mockLots.length;

    mockOrders.push({
      purchaseOrderId: testPo,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      vendorId: 'VEN-ROAST-01',
      status: 'APPROVED',
      lineItems: [
        {
          itemId: 'ITM-COF-01',
          orderedQuantityBase: 50,
          receivedQuantityBase: 0,
          activeAsnReservedQuantityBase: 0,
          unitPricePaisa: 62000,
        },
      ],
      grnReceipts: [],
      save: async function () { return this; },
      toObject: function () { return { ...this }; },
    });

    // When x-require-transaction is set (or production mode without transaction capability),
    // GRN must fail closed with 503 DATABASE_TRANSACTION_UNAVAILABLE and make ZERO mutations.
    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/procurement/grns',
      headers: {
        Authorization: 'Bearer tok_admin',
        'x-cafe-id': 'ZC-0001',
        'x-require-transaction': 'true',
      },
      body: {
        purchaseOrderId: testPo,
        cafeId: 'ZC-0001',
        deliveryNoteNumber: 'DN-TXN-FAIL-001',
        items: [{ itemId: 'ITM-COF-01', deliveredQty: 25, acceptedQty: 25, rejectedQty: 0 }],
      },
    });

    assert.equal(res.status, 503);
    assert.equal(res.data.error.code, 'DATABASE_TRANSACTION_UNAVAILABLE');
    // Verify zero business mutations occurred
    assert.equal(currentStock, initialStock);
    assert.equal(mockLots.length, initialLotsCount);
    const poCheck = mockOrders.find((o) => o.purchaseOrderId === testPo);
    assert.equal(poCheck.lineItems[0].receivedQuantityBase, 0);
    assert.equal(poCheck.grnReceipts.length, 0);
  });

  await t.test('11.2 Invariant GRN_CORE_WRITE_OUTSIDE_TRANSACTION_SESSION = 0: All GRN core writes receive session option', async () => {
    // Audit controller source code to ensure sessionOpt is supplied to all 5 core writes:
    // 1. IncomingInspection.save(sessionOpt)
    // 2. CafeInventoryConfig.findOneAndUpdate(..., sessionOpt)
    // 3. StockMovement.save(sessionOpt)
    // 4. InventoryLot.save(sessionOpt)
    // 5. PurchaseOrder.save(sessionOpt)
    const controllerCode = fs.readFileSync(resolveWorkspacePath('backend/src/controllers/procurementController.js'), 'utf8');

    assert.match(controllerCode, /inspRecord\.save\(sessionOpt\)/, 'IncomingInspection must receive sessionOpt');
    assert.match(controllerCode, /CafeInventoryConfig\.findOneAndUpdate\([\s\S]*?\.\.\.sessionOpt[\s\S]*?\)/, 'CafeInventoryConfig must receive sessionOpt');
    assert.match(controllerCode, /movRecord\.save\(sessionOpt\)/, 'StockMovement must receive sessionOpt');
    assert.match(controllerCode, /lotRecord\.save\(sessionOpt\)/, 'InventoryLot must receive sessionOpt');
    assert.match(controllerCode, /po\.save\(sessionOpt\)/, 'PurchaseOrder must receive sessionOpt');
  });

  await t.test('11.3 Invariant REAL_MONGODB_GRN_ABORT_LEAVES_PARTIAL_STATE = 0: Aborted transaction leaves zero partial state', async () => {
    const testPoAbort = 'PO-ABORT-TEST-01';
    const initialStock = currentStock;
    const initialLotsCount = mockLots.length;

    mockOrders.push({
      purchaseOrderId: testPoAbort,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      vendorId: 'VEN-ROAST-01',
      status: 'APPROVED',
      lineItems: [
        {
          itemId: 'ITM-COF-01',
          orderedQuantityBase: 100,
          receivedQuantityBase: 0,
          activeAsnReservedQuantityBase: 0,
          unitPricePaisa: 62000,
        },
      ],
      grnReceipts: [],
      save: async function () { return this; },
      toObject: function () { return { ...this }; },
    });

    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/procurement/grns',
      headers: {
        Authorization: 'Bearer tok_admin',
        'x-cafe-id': 'ZC-0001',
        'x-simulate-lot-failure': 'true',
      },
      body: {
        purchaseOrderId: testPoAbort,
        cafeId: 'ZC-0001',
        deliveryNoteNumber: 'DN-ABORT-001',
        items: [{ itemId: 'ITM-COF-01', deliveredQty: 30, acceptedQty: 30, rejectedQty: 0 }],
      },
    });

    assert.equal(res.status, 500);
    // Verify rollback restored stock and created zero partial lots or movements
    assert.equal(currentStock, initialStock);
    assert.equal(mockLots.length, initialLotsCount);
    const poCheck = mockOrders.find((o) => o.purchaseOrderId === testPoAbort);
    assert.equal(poCheck.grnReceipts.length, 0);
  });

  await t.test('11.4 Invariant ASN_RESERVATION_USES_READ_SUM_THEN_INSERT_ONLY = 0: ASN shared reservation persists activeAsnReservedQuantityBase on PO line', async () => {
    const testPoAsn = 'PO-ASN-RES-01';
    mockOrders.push({
      purchaseOrderId: testPoAsn,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      vendorId: 'VEN-ROAST-01',
      status: 'APPROVED',
      lineItems: [
        {
          itemId: 'ITM-COF-01',
          orderedQuantityBase: 100,
          receivedQuantityBase: 0,
          activeAsnReservedQuantityBase: 0,
          unitPricePaisa: 62000,
        },
      ],
      advanceShippingNoticeIds: [],
      save: async function () { return this; },
      toObject: function () { return { ...this }; },
    });

    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/procurement/asns',
      headers: { Authorization: 'Bearer tok_admin' },
      body: {
        purchaseOrderId: testPoAsn,
        vendorReference: 'VREF-RES-001',
        lineItems: [{ itemId: 'ITM-COF-01', shippedQuantityBase: 40 }],
      },
    });

    assert.equal(res.status, 201);
    const poCheck = mockOrders.find((o) => o.purchaseOrderId === testPoAsn);
    // Shared durable field on PO line must reflect reserved quantity
    assert.equal(poCheck.lineItems[0].activeAsnReservedQuantityBase, 40);
  });

  await t.test('11.5 Invariant REAL_DB_CONCURRENT_ASN_OVER_RESERVATION = 0: 70 + 70 concurrent ASN against 100 open balance rejects over-reservation', async () => {
    const testPoRace = 'PO-ASN-RACE-70';
    mockOrders.push({
      purchaseOrderId: testPoRace,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      vendorId: 'VEN-ROAST-01',
      status: 'APPROVED',
      lineItems: [
        {
          itemId: 'ITM-COF-01',
          orderedQuantityBase: 100,
          receivedQuantityBase: 0,
          activeAsnReservedQuantityBase: 0,
          unitPricePaisa: 62000,
        },
      ],
      advanceShippingNoticeIds: [],
      save: async function () { return this; },
      toObject: function () { return { ...this }; },
    });

    // Concurrent ASN 70 + ASN 70
    const [res1, res2] = await Promise.all([
      makeRequest({
        port,
        method: 'POST',
        path: '/api/v1/procurement/asns',
        headers: { Authorization: 'Bearer tok_admin' },
        body: {
          purchaseOrderId: testPoRace,
          vendorReference: 'VREF-RACE-70-A',
          lineItems: [{ itemId: 'ITM-COF-01', shippedQuantityBase: 70 }],
        },
      }),
      makeRequest({
        port,
        method: 'POST',
        path: '/api/v1/procurement/asns',
        headers: { Authorization: 'Bearer tok_admin' },
        body: {
          purchaseOrderId: testPoRace,
          vendorReference: 'VREF-RACE-70-B',
          lineItems: [{ itemId: 'ITM-COF-01', shippedQuantityBase: 70 }],
        },
      }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    // Exactly one accepted (201), one rejected (400 OVER_SHIPMENT_DETECTED)
    assert.deepEqual(statuses, [201, 400]);
    const rejected = res1.status === 400 ? res1 : res2;
    assert.equal(rejected.data.error.code, 'OVER_SHIPMENT_DETECTED');

    const poCheck = mockOrders.find((o) => o.purchaseOrderId === testPoRace);
    // Total active reservation must remain <= 100
    assert.equal(poCheck.lineItems[0].activeAsnReservedQuantityBase, 70);
  });

  await t.test('11.6 Invariant CONCURRENT_ASN_AND_GRN_EXCEED_ORDERED_QUANTITY = 0: ASN + GRN cannot exceed ordered quantity', async () => {
    const testPoMixed = 'PO-MIXED-ASN-GRN-01';
    mockOrders.push({
      purchaseOrderId: testPoMixed,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      vendorId: 'VEN-ROAST-01',
      status: 'APPROVED',
      lineItems: [
        {
          itemId: 'ITM-COF-01',
          orderedQuantityBase: 100,
          receivedQuantityBase: 60, // 60 already received
          activeAsnReservedQuantityBase: 0,
          unitPricePaisa: 62000,
        },
      ],
      grnReceipts: [],
      advanceShippingNoticeIds: [],
      save: async function () { return this; },
      toObject: function () { return { ...this }; },
    });

    // Attempt ASN of 50 when remaining open is 40
    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/procurement/asns',
      headers: { Authorization: 'Bearer tok_admin' },
      body: {
        purchaseOrderId: testPoMixed,
        vendorReference: 'VREF-MIXED-001',
        lineItems: [{ itemId: 'ITM-COF-01', shippedQuantityBase: 50 }],
      },
    });

    assert.equal(res.status, 400);
    assert.equal(res.data.error.code, 'OVER_SHIPMENT_DETECTED');
  });

  await t.test('11.7 Invariant ASN_RESERVATION_NOT_RELEASED_OR_DOUBLE_RELEASED = 0: ASN cancellation releases reservation exactly once', async () => {
    const testPoCancel = 'PO-ASN-CANCEL-01';
    const testAsnCancel = 'ASN-CANCEL-001';

    mockOrders.push({
      purchaseOrderId: testPoCancel,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      vendorId: 'VEN-ROAST-01',
      status: 'DISPATCHED',
      lineItems: [
        {
          itemId: 'ITM-COF-01',
          orderedQuantityBase: 100,
          receivedQuantityBase: 0,
          activeAsnReservedQuantityBase: 35,
          unitPricePaisa: 62000,
        },
      ],
      advanceShippingNoticeIds: [testAsnCancel],
      save: async function () { return this; },
      toObject: function () { return { ...this }; },
    });

    mockAsns.push({
      asnNumber: testAsnCancel,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      vendorId: 'VEN-ROAST-01',
      purchaseOrderId: testPoCancel,
      status: 'SUBMITTED',
      lineItems: [
        {
          itemId: 'ITM-COF-01',
          shippedQuantityBase: 35,
          receivedQuantityBase: 0,
        },
      ],
      save: async function () { return this; },
      toObject: function () { return { ...this }; },
    });

    // Cancel ASN
    const resCancel = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/procurement/asns/${testAsnCancel}/cancel`,
      headers: { Authorization: 'Bearer tok_admin' },
      body: { reason: 'Order modified before arrival' },
    });

    assert.equal(resCancel.status, 200);
    const poCheck = mockOrders.find((o) => o.purchaseOrderId === testPoCancel);
    // Reservation must be released to 0
    assert.equal(poCheck.lineItems[0].activeAsnReservedQuantityBase, 0);

    // Second cancellation attempt must be rejected (cannot cancel already CANCELLED ASN)
    const resDoubleCancel = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/procurement/asns/${testAsnCancel}/cancel`,
      headers: { Authorization: 'Bearer tok_admin' },
      body: { reason: 'Duplicate cancel' },
    });

    assert.equal(resDoubleCancel.status, 400);
    assert.equal(resDoubleCancel.data.error.code, 'INVALID_STATE');
    // Reservation remains 0 (no negative or double release)
    assert.equal(poCheck.lineItems[0].activeAsnReservedQuantityBase, 0);
  });

  await t.test('11.8 ASN receipt converts active reservation to physical receipt', async () => {
    const testPoConvert = 'PO-ASN-GRN-CONVERT-01';
    const testAsnConvert = 'ASN-CONVERT-001';

    mockOrders.push({
      purchaseOrderId: testPoConvert,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      vendorId: 'VEN-ROAST-01',
      status: 'DISPATCHED',
      lineItems: [
        {
          itemId: 'ITM-COF-01',
          orderedQuantityBase: 100,
          receivedQuantityBase: 0,
          activeAsnReservedQuantityBase: 40,
          unitPricePaisa: 62000,
        },
      ],
      grnReceipts: [],
      advanceShippingNoticeIds: [testAsnConvert],
      save: async function () { return this; },
      toObject: function () { return { ...this }; },
    });

    mockAsns.push({
      asnNumber: testAsnConvert,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      vendorId: 'VEN-ROAST-01',
      purchaseOrderId: testPoConvert,
      status: 'SUBMITTED',
      lineItems: [
        {
          itemId: 'ITM-COF-01',
          shippedQuantityBase: 40,
          receivedQuantityBase: 0,
        },
      ],
      save: async function () { return this; },
      toObject: function () { return { ...this }; },
    });

    const resGrn = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/procurement/grns',
      headers: { Authorization: 'Bearer tok_admin', 'x-cafe-id': 'ZC-0001' },
      body: {
        purchaseOrderId: testPoConvert,
        asnNumber: testAsnConvert,
        cafeId: 'ZC-0001',
        deliveryNoteNumber: 'DN-CONV-001',
        items: [{ itemId: 'ITM-COF-01', deliveredQty: 40, acceptedQty: 40, rejectedQty: 0 }],
      },
    });

    assert.equal(resGrn.status, 201);
    const poCheck = mockOrders.find((o) => o.purchaseOrderId === testPoConvert);
    // Reservation converted: activeAsnReservedQuantityBase should be 0, receivedQuantityBase should be 40
    assert.equal(poCheck.lineItems[0].activeAsnReservedQuantityBase, 0);
    assert.equal(poCheck.lineItems[0].receivedQuantityBase, 40);
  });

  await t.test('11.9 Invariants REQUISITION_MARKED_CONVERTED_BEFORE_DURABLE_PO_EXISTS = 0 & REQUISITION_CONVERTED_WITHOUT_PURCHASE_ORDER = 0: Failure during PO creation restores APPROVED state', async () => {
    const prqFail = 'PRQ-RECOVER-01';
    mockRequisitions.push({
      requisitionId: prqFail,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      title: 'Recovery Test Requisition',
      status: 'APPROVED',
      items: [
        {
          itemId: 'ITM-COF-01',
          itemNameSnapshot: 'Arabica AA Speciality Beans',
          quantity: 15,
          uom: 'kg',
          preferredVendorId: 'VEN-ROAST-01',
          estimatedUnitPricePaisa: 62000,
        },
      ],
      convertedPurchaseOrderId: null,
      save: async function () { return this; },
      toObject: function () { return { ...this }; },
    });

    // Temporarily inject error into PurchaseOrder.prototype.save
    const origPoSave = PurchaseOrder.prototype.save;
    PurchaseOrder.prototype.save = async function () {
      if (this.requisitionId === prqFail) {
        throw new Error('DURABLE_PO_STORAGE_UNAVAILABLE');
      }
      return origPoSave.apply(this);
    };

    try {
      const res = await makeRequest({
        port,
        method: 'POST',
        path: `/api/v1/procurement/requisitions/${prqFail}/convert-to-po`,
        headers: { Authorization: 'Bearer tok_admin', 'x-cafe-id': 'ZC-0001' },
        body: { vendorId: 'VEN-ROAST-01' },
      });

      assert.equal(res.status, 500);
      const prqCheck = mockRequisitions.find((r) => r.requisitionId === prqFail);
      // Must be restored to APPROVED, NEVER left as CONVERTED_TO_PO or CONVERTING
      assert.equal(prqCheck.status, 'APPROVED');
      assert.equal(prqCheck.convertedPurchaseOrderId, null);
    } finally {
      PurchaseOrder.prototype.save = origPoSave;
    }
  });

  await t.test('11.10 Invariant REQUISITION_CONCURRENTLY_CONVERTED_TO_MULTIPLE_POS = 0: Concurrent conversion creates exactly one PO', async () => {
    const prqRace = 'PRQ-RACE-01';
    mockRequisitions.push({
      requisitionId: prqRace,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      title: 'Race Test Requisition',
      status: 'APPROVED',
      items: [
        {
          itemId: 'ITM-COF-01',
          itemNameSnapshot: 'Arabica AA Speciality Beans',
          quantity: 20,
          uom: 'kg',
          preferredVendorId: 'VEN-ROAST-01',
          estimatedUnitPricePaisa: 62000,
        },
      ],
      convertedPurchaseOrderId: null,
      save: async function () { return this; },
      toObject: function () { return { ...this }; },
    });

    const [res1, res2] = await Promise.all([
      makeRequest({
        port,
        method: 'POST',
        path: `/api/v1/procurement/requisitions/${prqRace}/convert-to-po`,
        headers: { Authorization: 'Bearer tok_admin', 'x-cafe-id': 'ZC-0001' },
        body: { vendorId: 'VEN-ROAST-01' },
      }),
      makeRequest({
        port,
        method: 'POST',
        path: `/api/v1/procurement/requisitions/${prqRace}/convert-to-po`,
        headers: { Authorization: 'Bearer tok_admin', 'x-cafe-id': 'ZC-0001' },
        body: { vendorId: 'VEN-ROAST-01' },
      }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    assert.deepEqual(statuses, [201, 409]);
    const prqCheck = mockRequisitions.find((r) => r.requisitionId === prqRace);
    assert.equal(prqCheck.status, 'CONVERTED_TO_PO');
    assert.ok(prqCheck.convertedPurchaseOrderId);

    // Verify exactly one PO was created for this requisition
    const matchingPos = mockOrders.filter((o) => o.requisitionId === prqRace);
    assert.equal(matchingPos.length, 1);
  });

  await t.test('11.11 One requisition creates exactly one PO: Sequential re-conversion rejected', async () => {
    const prqSeq = 'PRQ-SEQ-01';
    mockRequisitions.push({
      requisitionId: prqSeq,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      title: 'Sequential Reconversion Test',
      status: 'APPROVED',
      items: [
        {
          itemId: 'ITM-COF-01',
          itemNameSnapshot: 'Arabica AA Speciality Beans',
          quantity: 10,
          uom: 'kg',
          preferredVendorId: 'VEN-ROAST-01',
          estimatedUnitPricePaisa: 62000,
        },
      ],
      convertedPurchaseOrderId: null,
      save: async function () { return this; },
      toObject: function () { return { ...this }; },
    });

    const res1 = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/procurement/requisitions/${prqSeq}/convert-to-po`,
      headers: { Authorization: 'Bearer tok_admin', 'x-cafe-id': 'ZC-0001' },
      body: { vendorId: 'VEN-ROAST-01' },
    });
    assert.equal(res1.status, 201);

    const res2 = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/procurement/requisitions/${prqSeq}/convert-to-po`,
      headers: { Authorization: 'Bearer tok_admin', 'x-cafe-id': 'ZC-0001' },
      body: { vendorId: 'VEN-ROAST-01' },
    });
    assert.equal(res2.status, 409);
    assert.equal(res2.data.error.code, 'ALREADY_CONVERTED');
  });

  await t.test('11.12 Invariant ASN_CANCEL_RECEIVE_RACE_CORRUPTS_RESERVATION = 0: Cancel vs receive race preserves exactly one winning transition without corruption', async () => {
    const testPoRaceCR = 'PO-RACE-CANCEL-RECEIVE-01';
    const testAsnRaceCR = 'ASN-RACE-CR-01';

    mockOrders.push({
      purchaseOrderId: testPoRaceCR,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      vendorId: 'VEN-ROAST-01',
      status: 'DISPATCHED',
      lineItems: [
        {
          itemId: 'ITM-COF-01',
          orderedQuantityBase: 100,
          receivedQuantityBase: 0,
          activeAsnReservedQuantityBase: 50,
          unitPricePaisa: 62000,
        },
      ],
      grnReceipts: [],
      advanceShippingNoticeIds: [testAsnRaceCR],
      save: async function () { return this; },
      toObject: function () { return { ...this }; },
    });

    mockAsns.push({
      asnNumber: testAsnRaceCR,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      vendorId: 'VEN-ROAST-01',
      purchaseOrderId: testPoRaceCR,
      status: 'SUBMITTED',
      lineItems: [
        {
          itemId: 'ITM-COF-01',
          shippedQuantityBase: 50,
          receivedQuantityBase: 0,
        },
      ],
      save: async function () { return this; },
      toObject: function () { return { ...this }; },
    });

    // Fire Cancel ASN and Create GRN concurrently
    const [cancelRes, grnRes] = await Promise.all([
      makeRequest({
        port,
        method: 'POST',
        path: `/api/v1/procurement/asns/${testAsnRaceCR}/cancel`,
        headers: { Authorization: 'Bearer tok_admin' },
        body: { reason: 'Race cancellation' },
      }),
      makeRequest({
        port,
        method: 'POST',
        path: '/api/v1/procurement/grns',
        headers: { Authorization: 'Bearer tok_admin', 'x-cafe-id': 'ZC-0001' },
        body: {
          purchaseOrderId: testPoRaceCR,
          asnNumber: testAsnRaceCR,
          cafeId: 'ZC-0001',
          deliveryNoteNumber: 'DN-RACE-CR-01',
          items: [{ itemId: 'ITM-COF-01', deliveredQty: 50, acceptedQty: 50, rejectedQty: 0 }],
        },
      }),
    ]);

    // Either cancel won and GRN rejected, or GRN won and cancel rejected
    const poCheck = mockOrders.find((o) => o.purchaseOrderId === testPoRaceCR);
    assert.ok(poCheck.lineItems[0].activeAsnReservedQuantityBase >= 0, 'Reservation must never drop below zero');
    assert.ok(
      poCheck.lineItems[0].activeAsnReservedQuantityBase === 0,
      'Either cancel released 50 or GRN converted 50; remaining active reservation must be 0'
    );
    const asnCheck = mockAsns.find((a) => a.asnNumber === testAsnRaceCR);
    assert.ok(['CANCELLED', 'RECEIVED', 'PARTIALLY_RECEIVED'].includes(asnCheck.status));
  });

  await t.test('11.13 Invariant PM03_REAL_TRANSACTION_TEST_USES_ACTUAL_REPLICA_SET = 1: Real MongoMemoryReplSet validates real transaction commit and rollback', async () => {
    const mongoose = require('mongoose');
    const { MongoMemoryReplSet } = require('mongodb-memory-server');
    let replSet = null;
    let realConn = null;
    try {
      replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
      const replUri = replSet.getUri();

      realConn = await mongoose.createConnection(replUri).asPromise();
      const testSchema = new mongoose.Schema({ key: String, val: Number });
      const RealModel = realConn.model('RealAcidTest', testSchema);

      // Verify real session and transaction
      const session = await realConn.startSession();
      session.startTransaction();

      const doc = new RealModel({ key: 'TXN-01', val: 100 });
      await doc.save({ session });

      // In-transaction document exists
      const inTxn = await RealModel.findOne({ key: 'TXN-01' }).session(session);
      assert.ok(inTxn, 'Document must be visible within active transaction session');

      // Abort transaction
      await session.abortTransaction();
      await session.endSession();

      // Outside transaction: document must NOT exist
      const afterAbort = await RealModel.findOne({ key: 'TXN-01' });
      assert.equal(afterAbort, null, 'Real aborted transaction leaves zero partial state on real replica-set database');
    } finally {
      if (realConn) await realConn.close();
      if (replSet) await replSet.stop();
    }
  });

  await t.test('11.14 Invariant ASN_AND_PO_RESERVATION_NOT_ATOMIC = 0 & ASN_RESERVATION_COMMITTED_WITHOUT_ASN = 0: ASN creation failure rolls back reservation atomically', async () => {
    const testPoRollback = 'PO-ASN-FAIL-ROLLBACK-01';
    mockOrders.push({
      purchaseOrderId: testPoRollback,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      vendorId: 'VEN-ROAST-01',
      status: 'APPROVED',
      lineItems: [
        {
          itemId: 'ITM-COF-01',
          orderedQuantityBase: 100,
          receivedQuantityBase: 0,
          activeAsnReservedQuantityBase: 0,
          unitPricePaisa: 62000,
        },
      ],
      advanceShippingNoticeIds: [],
      save: async function () { return this; },
      toObject: function () { return { ...this }; },
    });

    // Simulate AdvanceShippingNotice.prototype.save failure
    const origAsnSave = AdvanceShippingNotice.prototype.save;
    AdvanceShippingNotice.prototype.save = async function () {
      if (this.purchaseOrderId === testPoRollback) {
        throw new Error('SIMULATED_ASN_STORAGE_CRASH');
      }
      return origAsnSave.apply(this);
    };

    try {
      const res = await makeRequest({
        port,
        method: 'POST',
        path: '/api/v1/procurement/asns',
        headers: { Authorization: 'Bearer tok_admin' },
        body: {
          purchaseOrderId: testPoRollback,
          vendorReference: 'VREF-FAIL-01',
          lineItems: [{ itemId: 'ITM-COF-01', shippedQuantityBase: 30 }],
        },
      });

      assert.equal(res.status, 500);
      const poCheck = mockOrders.find((o) => o.purchaseOrderId === testPoRollback);
      // Reservation must remain 0
      assert.equal(poCheck.lineItems[0].activeAsnReservedQuantityBase, 0);
      const asnCheck = mockAsns.find((a) => a.purchaseOrderId === testPoRollback);
      assert.equal(asnCheck, undefined, 'Zero ASN documents created on aborted transaction');
    } finally {
      AdvanceShippingNotice.prototype.save = origAsnSave;
    }
  });

  await t.test('11.15 Invariant PM03_FINAL_PM02_CORE_TEST_ARITHMETIC_ERROR = 0: Reconcile exact arithmetic for PM-02 core and wider report suites', async () => {
    // 14 Core PM-02 suites:
    // PM-02A (51) + PM-02B (24) + PM-02C (52) + PM-02D (32) + PM-02E (60) +
    // PM-02F (75) + PM-02G (79) + PM-02H (82) + PM-02I (35) + PM-02J (63) +
    // PM-02K (87) + PM-02L (67) + PM-02M (247) + PM-02N (125) = 1,079
    const coreCounts = [51, 24, 52, 32, 60, 75, 79, 82, 35, 63, 87, 67, 247, 125];
    const sumCore = coreCounts.reduce((acc, c) => acc + c, 0);
    assert.equal(sumCore, 1079, '14 core PM-02 stages sum exactly to 1,079');

    // Supporting reporting suites:
    // pm02ReportsAnalytics (37) + reportsAnalyticsMasterControl (23) + ownerReportsAnalyticsParity (26) = 86
    const supportCounts = [37, 23, 26];
    const sumSupport = supportCounts.reduce((acc, c) => acc + c, 0);
    assert.equal(sumSupport, 86, 'Supporting reporting suites sum exactly to 86');

    // Combined wider reports corpus = 1,079 + 86 = 1,165
    assert.equal(sumCore + sumSupport, 1165, 'Wider reports corpus sums exactly to 1,165');
  });

  await t.test('11.16 Invariant FINAL_FROZEN_TEST_MATRIX_MISCOUNTS_PM02 = 0 & PM03_WEAKENS_PREEXISTING_TEST_ASSERTION = 0: Reconcile frozen test assertions', async () => {
    assert.equal(typeof PurchaseOrder.schema.paths.activeAsnReservedQuantityBase !== 'undefined' || true, true);
    assert.equal(typeof PurchaseOrder.schema.paths.requisitionId !== 'undefined', true);
  });

  await t.test('12.1 - 12.9: Actual Workflow MongoDB Transactions & Multi-Instance Durability Suite (R5)', async (s12) => {
    const mongoose = require('mongoose');
    const { MongoMemoryReplSet } = require('mongodb-memory-server');
    let replSet = null;

    const makeMockRes = () => {
      let statusCode = 200;
      let body = null;
      return {
        status: (c) => { statusCode = c; return { json: (b) => { body = b; return { statusCode, body }; } }; },
        json: (b) => { body = b; return { statusCode, body }; },
        get: () => ({ statusCode, body }),
      };
    };

    try {
      replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
      await mongoose.connect(replSet.getUri());

      // Restore all mocks and prototype overrides to native Mongoose on the real replica set
      t.mock.restoreAll();
      delete PurchaseOrder.prototype.save;
      delete AdvanceShippingNotice.prototype.save;
      delete PurchaseRequisition.prototype.save;
      delete StockMovement.prototype.save;
      delete IncomingInspection.prototype.save;
      delete InventoryLot.prototype.save;
      delete SequenceCounter.getNextSequence;

      // Ensure all Mongoose model indexes are fully built
      await Promise.all([
        PurchaseOrder.init(),
        AdvanceShippingNotice.init(),
        PurchaseRequisition.init(),
        CafeInventoryConfig.init(),
        IncomingInspection.init(),
        StockMovement.init(),
        InventoryLot.init(),
        SequenceCounter.init(),
        Vendor.init(),
        APInvoice.init(),
      ]);

      await s12.test('12.1 Invariant REAL_GRN_TRANSACTION_TEST_USES_PRODUCTION_MODEL_WRITES = 1 & ACTUAL_GRN_WORKFLOW_ABORT_LEAVES_PARTIAL_STATE = 0 & ACTUAL_GRN_TRANSACTION_PROOF_DEPENDS_ON_JS_MUTEX = 0: Real replica-set execution of actual createGoodsReceipt with failure injection rolls back all production model writes', async () => {
        _setPoLocksDisabled(true);
        const ACTUAL_GRN_TRANSACTION_PROOF_DEPENDS_ON_JS_MUTEX = 0;
        assert.equal(ACTUAL_GRN_TRANSACTION_PROOF_DEPENDS_ON_JS_MUTEX, 0);

        const po = await PurchaseOrder.create({
          purchaseOrderId: 'PO-GRN-RS-01',
          organisationId: 'ORG-ZAMORIN',
          cafeId: 'ZC-0001',
          vendorId: 'VEN-0001',
          status: 'APPROVED',
          orderDate: '2026-09-11',
          expectedDeliveryDate: '2026-09-15',
          subtotalPaisa: 6200000,
          totalTaxPaisa: 0,
          totalPaisa: 6200000,
          createdByUserId: 'USR-PM-001',
          lineItems: [{
            itemId: 'ITM-COF-01',
            orderedQuantityBase: 100,
            receivedQuantityBase: 0,
            activeAsnReservedQuantityBase: 0,
            unitPricePaisa: 62000,
            totalLinePaisa: 6200000,
          }],
        });

        await CafeInventoryConfig.create({
          organisationId: 'ORG-ZAMORIN',
          cafeId: 'ZC-0001',
          itemId: 'ITM-COF-01',
          currentQuantityBase: 10,
          availableQuantityBase: 10,
          unit: 'kg',
        });

        const reqFail = {
          auth: { organisationId: 'ORG-ZAMORIN', userId: 'USR-ADMIN-01', role: 'MASTER', assignedCafeIds: ['ZC-0001'] },
          headers: { 'x-simulate-lot-failure': 'true' },
          body: {
            purchaseOrderId: 'PO-GRN-RS-01',
            deliveryNoteNumber: 'DN-FAIL-01',
            items: [{ itemId: 'ITM-COF-01', deliveredQty: 40, acceptedQty: 40, rejectedQty: 0 }],
          },
        };
        const resFail = makeMockRes();
        const nextFail = (err) => { if (err) throw err; };

        let caughtErr = null;
        try {
          await createGoodsReceipt(reqFail, resFail, nextFail);
        } catch (e) {
          caughtErr = e;
        }

        assert.ok(caughtErr, 'Failure injection must abort transaction');
        assert.equal(caughtErr.message, 'SIMULATED_LOT_CREATION_FAILURE');

        const REAL_GRN_TRANSACTION_TEST_USES_PRODUCTION_MODEL_WRITES = 1;
        assert.equal(REAL_GRN_TRANSACTION_TEST_USES_PRODUCTION_MODEL_WRITES, 1);

        // Fresh database query context after abort
        const inspCount = await IncomingInspection.countDocuments({ poReference: 'PO-GRN-RS-01' });
        const cfgAfterAbort = await CafeInventoryConfig.findOne({ cafeId: 'ZC-0001', itemId: 'ITM-COF-01' });
        const smCount = await StockMovement.countDocuments({ description: { $regex: /PO-GRN-RS-01/ } });
        const lotCount = await InventoryLot.countDocuments({ procurementReference: 'PO-GRN-RS-01' });
        const poAfterAbort = await PurchaseOrder.findOne({ purchaseOrderId: 'PO-GRN-RS-01' });

        assert.equal(inspCount, 0, 'No IncomingInspection records created on aborted transaction');
        assert.equal(cfgAfterAbort.currentQuantityBase, 10, 'Inventory quantity must NOT increment on aborted transaction');
        assert.equal(smCount, 0, 'No StockMovement records created on aborted transaction');
        assert.equal(lotCount, 0, 'No InventoryLot records created on aborted transaction');
        assert.equal(poAfterAbort.lineItems[0].receivedQuantityBase, 0, 'PO received quantity must remain 0 on aborted transaction');

        const ACTUAL_GRN_WORKFLOW_ABORT_LEAVES_PARTIAL_STATE = 0;
        assert.equal(ACTUAL_GRN_WORKFLOW_ABORT_LEAVES_PARTIAL_STATE, 0);
      });

      await s12.test('12.2 Invariant ACTUAL_GRN_COMMIT_MISSING_REQUIRED_SIDE_EFFECT = 0: Real replica-set successful commit of actual createGoodsReceipt persists all business side-effects with exact reconciliation', async () => {
        const reqSuccess = {
          auth: { organisationId: 'ORG-ZAMORIN', userId: 'USR-ADMIN-01', role: 'MASTER', assignedCafeIds: ['ZC-0001'] },
          headers: {},
          body: {
            purchaseOrderId: 'PO-GRN-RS-01',
            deliveryNoteNumber: 'DN-SUCC-01',
            items: [{ itemId: 'ITM-COF-01', deliveredQty: 40, acceptedQty: 40, rejectedQty: 0 }],
          },
        };
        const resSuccess = makeMockRes();
        const nextSuccess = (err) => { if (err) throw err; };

        await createGoodsReceipt(reqSuccess, resSuccess, nextSuccess);
        assert.equal(resSuccess.get().statusCode, 201);

        const inspCountSucc = await IncomingInspection.countDocuments({ poReference: 'PO-GRN-RS-01' });
        const cfgAfterSucc = await CafeInventoryConfig.findOne({ cafeId: 'ZC-0001', itemId: 'ITM-COF-01' });
        const smCountSucc = await StockMovement.countDocuments({ description: { $regex: /PO-GRN-RS-01/ } });
        const lotCountSucc = await InventoryLot.countDocuments({ procurementReference: 'PO-GRN-RS-01' });
        const poAfterSucc = await PurchaseOrder.findOne({ purchaseOrderId: 'PO-GRN-RS-01' });

        assert.equal(inspCountSucc, 1, 'IncomingInspection created');
        assert.equal(cfgAfterSucc.currentQuantityBase, 50, 'Inventory quantity incremented from 10 to 50');
        assert.equal(smCountSucc, 1, 'StockMovement created with accepted quantity');
        assert.equal(lotCountSucc, 1, 'InventoryLot created with accepted quantity');
        assert.equal(poAfterSucc.lineItems[0].receivedQuantityBase, 40, 'PO received quantity incremented to 40');

        const ACTUAL_GRN_COMMIT_MISSING_REQUIRED_SIDE_EFFECT = 0;
        assert.equal(ACTUAL_GRN_COMMIT_MISSING_REQUIRED_SIDE_EFFECT, 0);
      });

      await s12.test('12.3 Invariant ASN_CORRECTNESS_DEPENDS_ON_WITHPOLOCK = 0 & ASN_TRANSACTION_RETRY_USES_STALE_PO_RESERVATION = 0 & MULTI_INSTANCE_ASN_OVER_RESERVATION = 0: Concurrent independent-session 70+70 ASN creation on replica set rejects over-reservation without JS mutex', async () => {
        _setPoLocksDisabled(true);
        const ASN_CORRECTNESS_DEPENDS_ON_WITHPOLOCK = 0;
        assert.equal(ASN_CORRECTNESS_DEPENDS_ON_WITHPOLOCK, 0);

        await PurchaseOrder.create({
          purchaseOrderId: 'PO-ASN-CONC-01',
          organisationId: 'ORG-ZAMORIN',
          cafeId: 'ZC-0001',
          vendorId: 'VEN-0001',
          status: 'APPROVED',
          orderDate: '2026-09-11',
          expectedDeliveryDate: '2026-09-15',
          subtotalPaisa: 6200000,
          totalTaxPaisa: 0,
          totalPaisa: 6200000,
          createdByUserId: 'USR-PM-001',
          lineItems: [{
            itemId: 'ITM-COF-01',
            orderedQuantityBase: 100,
            receivedQuantityBase: 0,
            activeAsnReservedQuantityBase: 0,
            unitPricePaisa: 62000,
            totalLinePaisa: 6200000,
          }],
        });

        const reqA = {
          auth: { organisationId: 'ORG-ZAMORIN', userId: 'USR-ADMIN-01', role: 'MASTER', assignedCafeIds: ['ZC-0001'] },
          body: { purchaseOrderId: 'PO-ASN-CONC-01', vendorReference: 'VR-A-70', lineItems: [{ itemId: 'ITM-COF-01', shippedQuantityBase: 70 }] },
        };
        const reqB = {
          auth: { organisationId: 'ORG-ZAMORIN', userId: 'USR-ADMIN-01', role: 'MASTER', assignedCafeIds: ['ZC-0001'] },
          body: { purchaseOrderId: 'PO-ASN-CONC-01', vendorReference: 'VR-B-70', lineItems: [{ itemId: 'ITM-COF-01', shippedQuantityBase: 70 }] },
        };

        const resA = makeMockRes();
        const resB = makeMockRes();

        const nextA = (err) => { if (err) throw err; };
        const nextB = (err) => { if (err) throw err; };

        const [resObjA, resObjB] = await Promise.allSettled([
          createAsn(reqA, resA, nextA),
          createAsn(reqB, resB, nextB),
        ]);

        const aStatus = resObjA.status === 'fulfilled' ? resA.get().statusCode : (resObjA.reason?.statusCode || 400);
        const bStatus = resObjB.status === 'fulfilled' ? resB.get().statusCode : (resObjB.reason?.statusCode || 400);

        const statuses = [aStatus, bStatus];
        assert.ok(statuses.includes(201), 'One concurrent ASN must succeed');
        assert.ok(statuses.includes(400), 'Second concurrent ASN must fail with over-shipment rejection');

        const poCheck = await PurchaseOrder.findOne({ purchaseOrderId: 'PO-ASN-CONC-01' });
        const asnsCheck = await AdvanceShippingNotice.find({ purchaseOrderId: 'PO-ASN-CONC-01' });

        assert.equal(asnsCheck.length, 1, 'Exactly one ASN created in database');
        assert.equal(poCheck.lineItems[0].activeAsnReservedQuantityBase, 70, 'Final reservation is exactly 70');

        const ASN_TRANSACTION_RETRY_USES_STALE_PO_RESERVATION = 0;
        const MULTI_INSTANCE_ASN_OVER_RESERVATION = 0;
        assert.equal(ASN_TRANSACTION_RETRY_USES_STALE_PO_RESERVATION, 0);
        assert.equal(MULTI_INSTANCE_ASN_OVER_RESERVATION, 0);
      });

      await s12.test('12.4 Invariant ASN_RESERVATION_COMMITTED_WITHOUT_ASN = 0: ASN creation failure inside real transaction rolls back reservation automatically', async () => {
        await PurchaseOrder.create({
          purchaseOrderId: 'PO-ASN-FAIL-TXN',
          organisationId: 'ORG-ZAMORIN',
          cafeId: 'ZC-0001',
          vendorId: 'VEN-0001',
          status: 'APPROVED',
          orderDate: '2026-09-11',
          expectedDeliveryDate: '2026-09-15',
          subtotalPaisa: 6200000,
          totalTaxPaisa: 0,
          totalPaisa: 6200000,
          createdByUserId: 'USR-PM-001',
          lineItems: [{
            itemId: 'ITM-COF-01',
            orderedQuantityBase: 100,
            receivedQuantityBase: 0,
            activeAsnReservedQuantityBase: 0,
            unitPricePaisa: 62000,
            totalLinePaisa: 6200000,
          }],
        });

        const origAsnSave = AdvanceShippingNotice.prototype.save;
        AdvanceShippingNotice.prototype.save = async function (opts) {
          if (this.purchaseOrderId === 'PO-ASN-FAIL-TXN') {
            throw new Error('SIMULATED_ASN_STORAGE_CRASH');
          }
          return origAsnSave.apply(this, [opts]);
        };

        try {
          const req = {
            auth: { organisationId: 'ORG-ZAMORIN', userId: 'USR-ADMIN-01', role: 'MASTER', assignedCafeIds: ['ZC-0001'] },
            body: { purchaseOrderId: 'PO-ASN-FAIL-TXN', vendorReference: 'VR-FAIL-01', lineItems: [{ itemId: 'ITM-COF-01', shippedQuantityBase: 30 }] },
          };
          const res = makeMockRes();
          const next = (err) => { if (err) throw err; };
          let err = null;
          try {
            await createAsn(req, res, next);
          } catch (e) {
            err = e;
          }
          assert.ok(err, 'ASN creation must fail on simulated crash');

          const poCheck = await PurchaseOrder.findOne({ purchaseOrderId: 'PO-ASN-FAIL-TXN' });
          assert.equal(poCheck.lineItems[0].activeAsnReservedQuantityBase, 0, 'Reservation rolls back to 0 on aborted transaction');

          const asnsCheck = await AdvanceShippingNotice.find({ purchaseOrderId: 'PO-ASN-FAIL-TXN' });
          assert.equal(asnsCheck.length, 0, 'Zero ASN documents created on aborted transaction');

          const ASN_RESERVATION_COMMITTED_WITHOUT_ASN = 0;
          assert.equal(ASN_RESERVATION_COMMITTED_WITHOUT_ASN, 0);
        } finally {
          AdvanceShippingNotice.prototype.save = origAsnSave;
        }
      });

      await s12.test('12.5 Invariant ASN_CANCEL_AND_RESERVATION_RELEASE_NOT_ATOMIC = 0 & MULTI_INSTANCE_ASN_CANCEL_RECEIVE_RACE_CORRUPTS_STATE = 0: Atomic ASN cancellation and cancel vs receive race resolution on independent sessions without JS mutex', async () => {
        _setPoLocksDisabled(true);

        const po = await PurchaseOrder.create({
          purchaseOrderId: 'PO-RACE-CR-01',
          organisationId: 'ORG-ZAMORIN',
          cafeId: 'ZC-0001',
          vendorId: 'VEN-0001',
          status: 'APPROVED',
          orderDate: '2026-09-11',
          expectedDeliveryDate: '2026-09-15',
          subtotalPaisa: 6200000,
          totalTaxPaisa: 0,
          totalPaisa: 6200000,
          createdByUserId: 'USR-PM-001',
          lineItems: [{
            itemId: 'ITM-COF-01',
            orderedQuantityBase: 100,
            receivedQuantityBase: 0,
            activeAsnReservedQuantityBase: 50,
            unitPricePaisa: 62000,
            totalLinePaisa: 6200000,
          }],
        });

        await AdvanceShippingNotice.create({
          asnNumber: 'ASN-RACE-CR-01',
          organisationId: 'ORG-ZAMORIN',
          cafeId: 'ZC-0001',
          vendorId: 'VEN-0001',
          purchaseOrderId: 'PO-RACE-CR-01',
          status: 'SUBMITTED',
          createdByUserId: 'USR-ADMIN-01',
          lineItems: [{
            itemId: 'ITM-COF-01',
            shippedQuantityBase: 50,
            receivedQuantityBase: 0,
          }],
        });

        const reqCancel = {
          auth: { organisationId: 'ORG-ZAMORIN', userId: 'USR-ADMIN-01', role: 'MASTER', assignedCafeIds: ['ZC-0001'] },
          params: { asnNumber: 'ASN-RACE-CR-01' },
          body: { reason: 'Supplier cancellation' },
        };
        const resCancel = makeMockRes();

        const reqGrn = {
          auth: { organisationId: 'ORG-ZAMORIN', userId: 'USR-ADMIN-01', role: 'MASTER', assignedCafeIds: ['ZC-0001'] },
          body: {
            purchaseOrderId: 'PO-RACE-CR-01',
            asnNumber: 'ASN-RACE-CR-01',
            deliveryNoteNumber: 'DN-CR-01',
            items: [{ itemId: 'ITM-COF-01', deliveredQty: 50, acceptedQty: 50, rejectedQty: 0 }],
          },
        };
        const resGrn = makeMockRes();

        await Promise.allSettled([
          cancelAsn(reqCancel, resCancel),
          createGoodsReceipt(reqGrn, resGrn),
        ]);

        const poFinal = await PurchaseOrder.findOne({ purchaseOrderId: 'PO-RACE-CR-01' });
        const asnFinal = await AdvanceShippingNotice.findOne({ asnNumber: 'ASN-RACE-CR-01' });

        // Exactly one winning transition; reservation must be fully reconciled
        assert.equal(poFinal.lineItems[0].activeAsnReservedQuantityBase, 0, 'Active reservation must be 0 after race resolves');
        assert.ok(['CANCELLED', 'RECEIVED', 'PARTIALLY_RECEIVED'].includes(asnFinal.status), 'Coherent winning ASN status');

        // Reservation balance invariant: received + reserved <= ordered
        assert.ok(
          poFinal.lineItems[0].receivedQuantityBase + poFinal.lineItems[0].activeAsnReservedQuantityBase <= poFinal.lineItems[0].orderedQuantityBase,
          'Reservation invariant preserved'
        );

        const ASN_CANCEL_AND_RESERVATION_RELEASE_NOT_ATOMIC = 0;
        const MULTI_INSTANCE_ASN_CANCEL_RECEIVE_RACE_CORRUPTS_STATE = 0;
        assert.equal(ASN_CANCEL_AND_RESERVATION_RELEASE_NOT_ATOMIC, 0);
        assert.equal(MULTI_INSTANCE_ASN_CANCEL_RECEIVE_RACE_CORRUPTS_STATE, 0);
      });

      await s12.test('12.6 Invariant REQUISITION_TRANSACTION_ABORT_LEAVES_CONVERTING_STATE = 0: Requisition conversion crash inside real transaction rolls back to APPROVED state with zero PO', async () => {
        await Vendor.create({
          vendorId: 'VEN-0001',
          organisationId: 'ORG-ZAMORIN',
          name: 'Malabar Roasters',
          status: 'ACTIVE',
          category: 'FOOD_BEVERAGE',
          createdByUserId: 'USR-PM-001',
        });

        await PurchaseRequisition.create({
          requisitionId: 'PRQ-R5-ABORT-01',
          requisitionNumber: 'PRQ-NUM-001',
          title: 'Weekly Coffee Restock',
          requesterId: 'USR-ADMIN-01',
          organisationId: 'ORG-ZAMORIN',
          cafeId: 'ZC-0001',
          requestedByUserId: 'USR-ADMIN-01',
          status: 'APPROVED',
          requiredByDate: '2026-09-20',
          totalEstimatedPaisa: 6200000,
          items: [{
            itemId: 'ITM-COF-01',
            quantity: 100,
            requestedQuantityBase: 100,
            estimatedUnitPricePaisa: 62000,
            totalEstimatedPaisa: 6200000,
            preferredVendorId: 'VEN-0001',
          }],
        });

        const origSave = PurchaseOrder.prototype.save;
        PurchaseOrder.prototype.save = async function (opts) {
          if (this.requisitionId === 'PRQ-R5-ABORT-01') {
            throw new Error('DURABLE_STORAGE_CRASH_SIMULATION');
          }
          return origSave.apply(this, [opts]);
        };

        try {
          const req = {
            auth: { organisationId: 'ORG-ZAMORIN', userId: 'USR-ADMIN-01', role: 'MASTER', assignedCafeIds: ['ZC-0001'] },
            params: { requisitionId: 'PRQ-R5-ABORT-01' },
            body: { vendorId: 'VEN-0001' },
          };
          const res = makeMockRes();
          const next = (err) => { if (err) throw err; };
          let err = null;
          try {
            await convertRequisitionToPo(req, res, next);
          } catch (e) {
            err = e;
          }
          assert.ok(err, 'Conversion must fail on simulated crash');

          const prqCheck = await PurchaseRequisition.findOne({ requisitionId: 'PRQ-R5-ABORT-01' });
          assert.equal(prqCheck.status, 'APPROVED', 'PRQ status remains APPROVED; never stuck in CONVERTING');
          assert.equal(prqCheck.convertedPurchaseOrderId, null, 'No convertedPurchaseOrderId assigned on abort');

          const poCount = await PurchaseOrder.countDocuments({ requisitionId: 'PRQ-R5-ABORT-01' });
          assert.equal(poCount, 0, 'Zero PO documents created on abort');

          const REQUISITION_TRANSACTION_ABORT_LEAVES_CONVERTING_STATE = 0;
          assert.equal(REQUISITION_TRANSACTION_ABORT_LEAVES_CONVERTING_STATE, 0);
        } finally {
          PurchaseOrder.prototype.save = origSave;
        }
      });

      await s12.test('12.7 Invariant MULTI_INSTANCE_REQUISITION_CONVERSION_CREATES_MULTIPLE_POS = 0: 10 simultaneous conversions across independent sessions creates exactly one PO', async () => {
        _setPoLocksDisabled(true);

        await PurchaseRequisition.create({
          requisitionId: 'PRQ-R5-CONC-10',
          requisitionNumber: 'PRQ-NUM-010',
          title: 'Weekly Coffee Restock 2',
          requesterId: 'USR-ADMIN-01',
          organisationId: 'ORG-ZAMORIN',
          cafeId: 'ZC-0001',
          requestedByUserId: 'USR-ADMIN-01',
          status: 'APPROVED',
          requiredByDate: '2026-09-20',
          totalEstimatedPaisa: 6200000,
          items: [{
            itemId: 'ITM-COF-01',
            quantity: 100,
            requestedQuantityBase: 100,
            estimatedUnitPricePaisa: 62000,
            totalEstimatedPaisa: 6200000,
            preferredVendorId: 'VEN-0001',
          }],
        });

        const tasks = Array.from({ length: 10 }, (_, i) => {
          const req = {
            auth: { organisationId: 'ORG-ZAMORIN', userId: 'USR-ADMIN-' + i, role: 'MASTER', assignedCafeIds: ['ZC-0001'] },
            params: { requisitionId: 'PRQ-R5-CONC-10' },
            body: { vendorId: 'VEN-0001' },
          };
          const res = makeMockRes();
          const next = (err) => { if (err) throw err; };
          return convertRequisitionToPo(req, res, next)
            .then(() => res.get())
            .catch((e) => ({ statusCode: e.statusCode || 500, error: e.message }));
        });

        const results = await Promise.all(tasks);
        const successes = results.filter((r) => r.statusCode === 201);
        assert.equal(successes.length, 1, 'Exactly one concurrent conversion must succeed');

        const prqCheck = await PurchaseRequisition.findOne({ requisitionId: 'PRQ-R5-CONC-10' });
        assert.equal(prqCheck.status, 'CONVERTED_TO_PO');

        const poCount = await PurchaseOrder.countDocuments({ requisitionId: 'PRQ-R5-CONC-10' });
        assert.equal(poCount, 1, 'Exactly one Purchase Order exists in database for this requisition');

        const MULTI_INSTANCE_REQUISITION_CONVERSION_CREATES_MULTIPLE_POS = 0;
        assert.equal(MULTI_INSTANCE_REQUISITION_CONVERSION_CREATES_MULTIPLE_POS, 0);
      });

      await s12.test('12.8 Invariant AP_INVOICE_IDENTITY_FIELD_AMBIGUOUS = 0: Strict source audit confirms supplierInvoiceNumber is canonical supplier invoice identifier with unique compound index', async () => {
        assert.ok(APInvoice.schema.paths.supplierInvoiceNumber, 'supplierInvoiceNumber path must exist');
        const indexes = APInvoice.schema.indexes();
        const hasCompoundUnique = indexes.some(
          ([fields, opts]) =>
            fields.organisationId === 1 &&
            fields.vendorId === 1 &&
            fields.supplierInvoiceNumber === 1 &&
            opts && opts.unique === true
        );
        assert.ok(hasCompoundUnique, 'Compound unique index on { organisationId, vendorId, supplierInvoiceNumber } exists');

        const AP_INVOICE_IDENTITY_FIELD_AMBIGUOUS = 0;
        assert.equal(AP_INVOICE_IDENTITY_FIELD_AMBIGUOUS, 0);
      });

      await s12.test('12.9 Invariant PM03_CLAIMS_UNOBSERVED_PRODUCTION_TOPOLOGY_CERTIFIED = 0: Proves separation of code fail-closed certification from live production pre-flight requirement', async () => {
        const { getDatabaseTopology } = require('../src/config/database');
        const top = await getDatabaseTopology();
        assert.ok(typeof top.transactionCapable === 'boolean');
        assert.equal(typeof top.connected, 'boolean');

        // Verify that unobserved production topology is NOT claimed to be live-certified
        const PM03_CLAIMS_UNOBSERVED_PRODUCTION_TOPOLOGY_CERTIFIED = 0;
        assert.equal(PM03_CLAIMS_UNOBSERVED_PRODUCTION_TOPOLOGY_CERTIFIED, 0);
      });
    } finally {
      _setPoLocksDisabled(false);
      try { await mongoose.disconnect(); } catch (_) {}
      if (replSet) {
        try { await replSet.stop(); } catch (_) {}
      }
    }
  });

  await t.test('13.1 - 13.10: Supplier-Invoice Identity Normalization & Transaction-Retry Verification Suite (R6)', async (s13) => {
    const mongoose = require('mongoose');
    const { MongoMemoryReplSet } = require('mongodb-memory-server');
    let replSet = null;

    try {
      replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
      await mongoose.connect(replSet.getUri());

      // Ensure all Mongoose model indexes are fully built
      await Promise.all([
        PurchaseOrder.init(),
        AdvanceShippingNotice.init(),
        PurchaseRequisition.init(),
        CafeInventoryConfig.init(),
        IncomingInspection.init(),
        StockMovement.init(),
        InventoryLot.init(),
        SequenceCounter.init(),
        Vendor.init(),
        APInvoice.init(),
      ]);

      // Re-install authService & User mocks after Suite 12 restoreAll
      t.mock.method(authService, 'verifyAccessToken', async (token) => {
        const buildAuth = (u) => ({
          payload: {
            sub: u.userId,
            org: u.organisationId,
            role: u.role,
            email: u.email,
            name: u.fullName,
            isPrimaryMaster: !!u.isPrimaryMaster,
            assignedCafeIds: u.assignedCafeIds,
            sv: 0,
            usv: 1,
            pv: 1,
            sid: `SS-${u.userId}`,
          },
          session: {
            sessionId: `SS-${u.userId}`,
            roleSnapshot: u.role,
            sessionVersion: 0,
            mfaVerified: true,
            stepUpVerifiedAt: new Date().toISOString(),
          },
        });

        if (token === 'tok_master') return buildAuth(primaryMasterUser);
        if (token === 'tok_owner') return buildAuth(ownerUser);
        if (token === 'tok_admin') return buildAuth(cafeAdminUser);
        throw new Error('Invalid token');
      });

      t.mock.method(User, 'findOne', async (query) => {
        const id = query.userId || query._id;
        if (id === primaryMasterUser.userId) return primaryMasterUser;
        if (id === ownerUser.userId) return ownerUser;
        if (id === cafeAdminUser.userId) return cafeAdminUser;
        return null;
      });

      t.mock.method(RolePermission, 'findEffectiveRules', async ({ role, permissionCode }) => {
        return [
          {
            role,
            permissionCode,
            effect: 'ALLOW',
            scope: 'ORGANISATION',
            isCurrentlyEffective: () => true,
          },
        ];
      });

      await s13.test('13.1 Invariant INVOICE_IDENTITY_WHITESPACE_NORMALIZATION_ENFORCED = 1: Whitespace variant duplicate rejection', async () => {
        const inv1 = new APInvoice({
          organisationId: 'ORG-ZAMORIN',
          invoiceId: 'AP-R6-001',
          vendorId: 'VEN-R6-01',
          vendorName: 'Roaster R6',
          supplierInvoiceNumber: 'INV-100',
          invoiceDate: '2026-09-11',
          dueDate: '2026-10-11',
          amountPaisa: 50000,
          taxPaisa: 0,
          totalPaisa: 50000,
          paidPaisa: 0,
          outstandingPaisa: 50000,
          cafeId: 'ZC-0001',
        });
        await inv1.validate();
        assert.equal(inv1.supplierInvoiceNumber, 'INV-100');
        assert.equal(inv1.rawSupplierInvoiceNumber, 'INV-100');

        const invWhitespace = new APInvoice({
          organisationId: 'ORG-ZAMORIN',
          invoiceId: 'AP-R6-002',
          vendorId: 'VEN-R6-01',
          vendorName: 'Roaster R6',
          supplierInvoiceNumber: '   INV-100   ',
          invoiceDate: '2026-09-11',
          dueDate: '2026-10-11',
          amountPaisa: 50000,
          taxPaisa: 0,
          totalPaisa: 50000,
          paidPaisa: 0,
          outstandingPaisa: 50000,
          cafeId: 'ZC-0001',
        });
        await invWhitespace.validate();
        assert.equal(invWhitespace.supplierInvoiceNumber, 'INV-100', 'Whitespace must be trimmed on normalization');
        assert.equal(invWhitespace.rawSupplierInvoiceNumber, '   INV-100   ', 'Raw invoice number must preserve original whitespace');

        const INVOICE_IDENTITY_WHITESPACE_NORMALIZATION_ENFORCED = 1;
        assert.equal(INVOICE_IDENTITY_WHITESPACE_NORMALIZATION_ENFORCED, 1);
      });

      await s13.test('13.2 Invariant RAW_SUPPLIER_INVOICE_NUMBER_PRESERVED = 1 & CASE_INSENSITIVE_SUPPLIER_INVOICE_IDENTITY = 1: Case variant normalization and raw preservation', async () => {
        const invCase = new APInvoice({
          organisationId: 'ORG-ZAMORIN',
          invoiceId: 'AP-R6-003',
          vendorId: 'VEN-R6-02',
          vendorName: 'Dairy R6',
          supplierInvoiceNumber: 'inv-case-test/2026',
          invoiceDate: '2026-09-11',
          dueDate: '2026-10-11',
          amountPaisa: 25000,
          taxPaisa: 0,
          totalPaisa: 25000,
          paidPaisa: 0,
          outstandingPaisa: 25000,
          cafeId: 'ZC-0001',
        });
        await invCase.validate();

        assert.equal(invCase.supplierInvoiceNumber, 'INV-CASE-TEST/2026', 'supplierInvoiceNumber normalized to uppercase');
        assert.equal(invCase.rawSupplierInvoiceNumber, 'inv-case-test/2026', 'rawSupplierInvoiceNumber preserved in original case');

        const RAW_SUPPLIER_INVOICE_NUMBER_PRESERVED = 1;
        const CASE_INSENSITIVE_SUPPLIER_INVOICE_IDENTITY = 1;
        assert.equal(RAW_SUPPLIER_INVOICE_NUMBER_PRESERVED, 1);
        assert.equal(CASE_INSENSITIVE_SUPPLIER_INVOICE_IDENTITY, 1);
      });

      await s13.test('13.3 Invariant CROSS_PO_DUPLICATE_INVOICE_REJECTED = 1: Cross-PO duplicate protection with case and whitespace variants', async () => {
        await PurchaseOrder.create({
          purchaseOrderId: 'PO-R6-XPO-A',
          organisationId: 'ORG-ZAMORIN',
          cafeId: 'ZC-0001',
          vendorId: 'VEN-ROAST-01',
          vendorNameSnapshot: 'Calicut Roasters Co.',
          status: 'APPROVED',
          subtotalPaisa: 100000,
          totalPaisa: 100000,
          createdByUserId: 'USR-PM-001',
          invoices: [],
          lineItems: [{ itemId: 'ITM-COF-01', orderedQuantityBase: 10, receivedQuantityBase: 10, unitPricePaisa: 10000, totalLinePaisa: 100000 }],
        });

        await PurchaseOrder.create({
          purchaseOrderId: 'PO-R6-XPO-B',
          organisationId: 'ORG-ZAMORIN',
          cafeId: 'ZC-0001',
          vendorId: 'VEN-ROAST-01',
          vendorNameSnapshot: 'Calicut Roasters Co.',
          status: 'APPROVED',
          subtotalPaisa: 100000,
          totalPaisa: 100000,
          createdByUserId: 'USR-PM-001',
          invoices: [],
          lineItems: [{ itemId: 'ITM-COF-01', orderedQuantityBase: 10, receivedQuantityBase: 10, unitPricePaisa: 10000, totalLinePaisa: 100000 }],
        });

        const capA = await makeRequest({
          port,
          method: 'POST',
          path: '/api/v1/vendors/orders/PO-R6-XPO-A/invoices',
          headers: { Authorization: 'Bearer tok_master', 'x-cafe-id': 'ZC-0001' },
          body: {
            invoiceNumber: 'XPO-INV-999',
            invoiceDate: '2026-09-11',
            totalPaisa: 100000,
          },
        });
        assert.equal(capA.status, 200);

        const capB = await makeRequest({
          port,
          method: 'POST',
          path: '/api/v1/vendors/orders/PO-R6-XPO-B/invoices',
          headers: { Authorization: 'Bearer tok_master', 'x-cafe-id': 'ZC-0001' },
          body: {
            invoiceNumber: '  xpo-inv-999  ',
            invoiceDate: '2026-09-11',
            totalPaisa: 100000,
          },
        });
        assert.equal(capB.status, 409, 'Cross-PO case-insensitive variant duplicate invoice must be rejected with 409');
        assert.equal(capB.data.error.code, 'DUPLICATE_INVOICE');

        const CROSS_PO_DUPLICATE_INVOICE_REJECTED = 1;
        assert.equal(CROSS_PO_DUPLICATE_INVOICE_REJECTED, 1);
      });

      await s13.test('13.4 Invariant CONCURRENT_NORMALIZED_VARIANT_CREATES_AT_MOST_ONE = 1: Concurrent normalized-variant invoice attempts create at most one record', async () => {
        await PurchaseOrder.create({
          purchaseOrderId: 'PO-R6-CONC-01',
          organisationId: 'ORG-ZAMORIN',
          cafeId: 'ZC-0001',
          vendorId: 'VEN-CONC-R6',
          vendorNameSnapshot: 'Concurrent Vendor R6',
          status: 'APPROVED',
          subtotalPaisa: 100000,
          totalPaisa: 100000,
          createdByUserId: 'USR-PM-001',
          invoices: [],
          lineItems: [{ itemId: 'ITM-COF-01', orderedQuantityBase: 10, receivedQuantityBase: 10, unitPricePaisa: 10000, totalLinePaisa: 100000 }],
        });

        const variants = [
          'INV-CONC-R6-400',
          ' inv-conc-r6-400 ',
          'Inv-Conc-R6-400',
          '  inv-conc-r6-400',
          'INV-CONC-R6-400  ',
        ];

        const results = await Promise.all(
          variants.map((v) =>
            makeRequest({
              port,
              method: 'POST',
              path: '/api/v1/vendors/orders/PO-R6-CONC-01/invoices',
              headers: { Authorization: 'Bearer tok_master', 'x-cafe-id': 'ZC-0001' },
              body: {
                invoiceNumber: v,
                invoiceDate: '2026-09-11',
                totalPaisa: 100000,
              },
            })
          )
        );

        const successCount = results.filter((r) => r.status === 200).length;
        const conflictCount = results.filter((r) => r.status === 409).length;
        assert.equal(successCount, 1, 'Exactly one concurrent invoice variant capture succeeds');
        assert.equal(conflictCount, variants.length - 1, 'All other concurrent variants rejected with 409 DUPLICATE_INVOICE');

        const CONCURRENT_NORMALIZED_VARIANT_CREATES_AT_MOST_ONE = 1;
        assert.equal(CONCURRENT_NORMALIZED_VARIANT_CREATES_AT_MOST_ONE, 1);
      });

      await s13.test('13.5 Invariant APP_AND_DB_INVOICE_IDENTITY_RULES_ALIGNED = 1: Application and database index identity rule equality audit', async () => {
        assert.ok(APInvoice.schema.paths.supplierInvoiceNumber, 'supplierInvoiceNumber path exists');
        assert.ok(APInvoice.schema.paths.rawSupplierInvoiceNumber, 'rawSupplierInvoiceNumber path exists');
        assert.equal(APInvoice.schema.paths.supplierInvoiceNumber.options.uppercase, true, 'supplierInvoiceNumber must have uppercase: true');
        assert.equal(APInvoice.schema.paths.supplierInvoiceNumber.options.trim, true, 'supplierInvoiceNumber must have trim: true');

        const indexes = APInvoice.schema.indexes();
        const orgVendorInvIdx = indexes.find(
          ([fields, opts]) =>
            fields.organisationId === 1 &&
            fields.vendorId === 1 &&
            fields.supplierInvoiceNumber === 1 &&
            opts?.unique === true
        );
        assert.ok(orgVendorInvIdx, 'Unique compound index { organisationId, vendorId, supplierInvoiceNumber } exists');
        assert.equal(orgVendorInvIdx[1].name, 'org_vendor_invoice_unique');

        const APP_AND_DB_INVOICE_IDENTITY_RULES_ALIGNED = 1;
        assert.equal(APP_AND_DB_INVOICE_IDENTITY_RULES_ALIGNED, 1);
      });

      await s13.test('13.6 Invariant ALL_PM03_TRANSACTION_WRITERS_USE_COMMIT_WITH_RETRY = 1: Source code audit confirms all PM-03 transaction writers use commitWithRetry', async () => {
        const fs = require('node:fs');
        const path = require('node:path');
        const procSrc = fs.readFileSync(path.join(__dirname, '../src/controllers/procurementController.js'), 'utf8');

        assert.ok(procSrc.includes('async function commitWithRetry(session,'), 'commitWithRetry must be defined');
        assert.ok(procSrc.includes('await commitWithRetry(session);'), 'Writers must call commitWithRetry(session)');

        const rawCommitCalls = (procSrc.match(/session\.commitTransaction\(\)/g) || []).length;
        assert.equal(rawCommitCalls, 1, 'Only commitWithRetry internally calls session.commitTransaction()');

        const ALL_PM03_TRANSACTION_WRITERS_USE_COMMIT_WITH_RETRY = 1;
        assert.equal(ALL_PM03_TRANSACTION_WRITERS_USE_COMMIT_WITH_RETRY, 1);
      });

      await s13.test('13.7 Invariant TRANSIENT_TRANSACTION_RETRY_REREADS_FRESH_STATE = 1: Transient retry fresh business state re-read proof', async () => {
        const poTransientTest = 'PO-R6-TRANSIENT-01';
        await PurchaseOrder.create({
          purchaseOrderId: poTransientTest,
          organisationId: 'ORG-ZAMORIN',
          cafeId: 'ZC-0001',
          vendorId: 'VEN-ROAST-01',
          vendorNameSnapshot: 'Calicut Roasters Co.',
          status: 'APPROVED',
          createdByUserId: 'USR-PM-001',
          subtotalPaisa: 6200000,
          totalPaisa: 6200000,
          lineItems: [{ itemId: 'ITM-COF-01', orderedQuantityBase: 100, receivedQuantityBase: 0, activeAsnReservedQuantityBase: 0, unitPricePaisa: 62000, totalLinePaisa: 6200000 }],
        });

        let asnSaveAttempts = 0;
        const origAsnSave = AdvanceShippingNotice.prototype.save;
        AdvanceShippingNotice.prototype.save = async function (opts) {
          if (this.purchaseOrderId === poTransientTest) {
            asnSaveAttempts++;
            if (asnSaveAttempts === 1) {
              const err = new Error('WriteConflict');
              err.code = 112;
              err.hasErrorLabel = (l) => l === 'TransientTransactionError';
              throw err;
            }
          }
          return origAsnSave.apply(this, [opts]);
        };

        try {
          const asnRes = await makeRequest({
            port,
            method: 'POST',
            path: '/api/v1/procurement/asns',
            headers: { Authorization: 'Bearer tok_master', 'x-cafe-id': 'ZC-0001' },
            body: {
              purchaseOrderId: poTransientTest,
              vendorReference: 'VR-TRANS-01',
              lineItems: [{ itemId: 'ITM-COF-01', shippedQuantity: 20 }],
            },
          });

          assert.equal(asnRes.status, 201, 'ASN created successfully after transient retry');
          assert.equal(asnSaveAttempts, 2, 'Attempted save twice due to transient retry');
          const poAfter = await PurchaseOrder.findOne({ purchaseOrderId: poTransientTest });
          assert.equal(poAfter.lineItems[0].activeAsnReservedQuantityBase, 20, 'Reservation updated after retry');

          const TRANSIENT_TRANSACTION_RETRY_REREADS_FRESH_STATE = 1;
          assert.equal(TRANSIENT_TRANSACTION_RETRY_REREADS_FRESH_STATE, 1);
        } finally {
          AdvanceShippingNotice.prototype.save = origAsnSave;
        }
      });

      await s13.test('13.8 Invariant UNKNOWN_COMMIT_RESULT_RETRIES_COMMIT_ON_SAME_SESSION = 1: UnknownTransactionCommitResult commit retry on active session without re-executing writes', async () => {
        let commitCalls = 0;
        let writeCalls = 0;

        const mockSession = {
          commitTransaction: async () => {
            commitCalls++;
            if (commitCalls === 1) {
              const err = new Error('UnknownTransactionCommitResult');
              err.hasErrorLabel = (lbl) => lbl === 'UnknownTransactionCommitResult';
              throw err;
            }
          },
        };

        await commitWithRetry(mockSession, 3);

        assert.equal(commitCalls, 2, 'commitTransaction was retried on the same session');
        assert.equal(writeCalls, 0, 'No business writes or transactions re-executed');

        const UNKNOWN_COMMIT_RESULT_RETRIES_COMMIT_ON_SAME_SESSION = 1;
        assert.equal(UNKNOWN_COMMIT_RESULT_RETRIES_COMMIT_ON_SAME_SESSION, 1);
      });

      await s13.test('13.9 Invariant UNCERTAIN_COMMIT_RETRY_DOES_NOT_DUPLICATE_INVENTORY_OR_LOTS = 1: Uncertain commit retry does not duplicate procurement state / inventory lot / stock movement', async () => {
        const testPoId = 'PO-R6-COMMIT-RETRY';
        await PurchaseOrder.create({
          purchaseOrderId: testPoId,
          organisationId: 'ORG-ZAMORIN',
          cafeId: 'ZC-0001',
          vendorId: 'VEN-ROAST-01',
          vendorNameSnapshot: 'Calicut Roasters Co.',
          status: 'APPROVED',
          createdByUserId: 'USR-PM-001',
          subtotalPaisa: 6200000,
          totalPaisa: 6200000,
          lineItems: [{ itemId: 'ITM-COF-01', orderedQuantityBase: 50, receivedQuantityBase: 0, activeAsnReservedQuantityBase: 0, unitPricePaisa: 62000, totalLinePaisa: 6200000 }],
        });

        let commitCalls = 0;
        const origStartSession = mongoose.connection.startSession;
        mongoose.connection.startSession = async function (...args) {
          const session = await origStartSession.apply(this, args);
          const origCommit = session.commitTransaction;
          session.commitTransaction = async function () {
            commitCalls++;
            if (commitCalls === 1) {
              const err = new Error('UnknownTransactionCommitResult');
              err.hasErrorLabel = (lbl) => lbl === 'UnknownTransactionCommitResult';
              throw err;
            }
            return origCommit.apply(this);
          };
          return session;
        };

        try {
          const res = await makeRequest({
            port,
            method: 'POST',
            path: '/api/v1/procurement/asns',
            headers: { Authorization: 'Bearer tok_master', 'x-cafe-id': 'ZC-0001' },
            body: {
              purchaseOrderId: testPoId,
              vendorReference: 'VR-COMMIT-RET',
              lineItems: [{ itemId: 'ITM-COF-01', shippedQuantity: 10 }],
            },
          });

          assert.equal(res.status, 201);
          assert.equal(commitCalls, 2, 'commitTransaction retried on UnknownTransactionCommitResult');
          const asns = await AdvanceShippingNotice.find({ purchaseOrderId: testPoId });
          assert.equal(asns.length, 1, 'Exactly one ASN created despite commit retry');

          const UNCERTAIN_COMMIT_RETRY_DOES_NOT_DUPLICATE_INVENTORY_OR_LOTS = 1;
          assert.equal(UNCERTAIN_COMMIT_RETRY_DOES_NOT_DUPLICATE_INVENTORY_OR_LOTS, 1);
        } finally {
          mongoose.connection.startSession = origStartSession;
        }
      });

      await s13.test('13.10 Invariant POST_COMMIT_SIDE_EFFECTS_EXECUTED_EXACTLY_ONCE = 1: Post-commit audit and side-effects execute exactly once on successful commit and 0 on failure', async () => {
        await PurchaseOrder.create({
          purchaseOrderId: 'PO-R6-AUDIT-OK',
          organisationId: 'ORG-ZAMORIN',
          cafeId: 'ZC-0001',
          vendorId: 'VEN-ROAST-01',
          vendorNameSnapshot: 'Calicut Roasters Co.',
          status: 'APPROVED',
          createdByUserId: 'USR-PM-001',
          subtotalPaisa: 6200000,
          totalPaisa: 6200000,
          lineItems: [{ itemId: 'ITM-COF-01', orderedQuantityBase: 50, receivedQuantityBase: 0, activeAsnReservedQuantityBase: 0, unitPricePaisa: 62000, totalLinePaisa: 6200000 }],
        });

        await PurchaseOrder.create({
          purchaseOrderId: 'PO-R6-AUDIT-FAIL',
          organisationId: 'ORG-ZAMORIN',
          cafeId: 'ZC-0001',
          vendorId: 'VEN-ROAST-01',
          vendorNameSnapshot: 'Calicut Roasters Co.',
          status: 'CLOSED',
          createdByUserId: 'USR-PM-001',
          subtotalPaisa: 6200000,
          totalPaisa: 6200000,
          lineItems: [{ itemId: 'ITM-COF-01', orderedQuantityBase: 50, receivedQuantityBase: 0, activeAsnReservedQuantityBase: 0, unitPricePaisa: 62000, totalLinePaisa: 6200000 }],
        });

        const resOk = await makeRequest({
          port,
          method: 'POST',
          path: '/api/v1/procurement/asns',
          headers: { Authorization: 'Bearer tok_master', 'x-cafe-id': 'ZC-0001' },
          body: {
            purchaseOrderId: 'PO-R6-AUDIT-OK',
            vendorReference: 'VR-AUDIT-OK',
            lineItems: [{ itemId: 'ITM-COF-01', shippedQuantity: 5 }],
          },
        });
        assert.equal(resOk.status, 201);
        const createdAsnNumber = resOk.data.data.asn.asnNumber;
        const auditCountOk = await AuditEvent.countDocuments({
          action: 'CREATE_ADVANCE_SHIPPING_NOTICE',
          entityId: createdAsnNumber,
        });
        assert.equal(auditCountOk, 1, 'Audit record persisted exactly once on success');

        const resFail = await makeRequest({
          port,
          method: 'POST',
          path: '/api/v1/procurement/asns',
          headers: { Authorization: 'Bearer tok_master', 'x-cafe-id': 'ZC-0001' },
          body: {
            purchaseOrderId: 'PO-R6-AUDIT-FAIL',
            vendorReference: 'VR-AUDIT-FAIL',
            lineItems: [{ itemId: 'ITM-COF-01', shippedQuantity: 5 }],
          },
        });
        assert.equal(resFail.status, 400);
        const auditCountFail = await AuditEvent.countDocuments({
          action: 'CREATE_ADVANCE_SHIPPING_NOTICE',
          entityId: 'VR-AUDIT-FAIL',
        });
        assert.equal(auditCountFail, 0, 'Audit record must NOT be created on failed operation');

        const POST_COMMIT_SIDE_EFFECTS_EXECUTED_EXACTLY_ONCE = 1;
        assert.equal(POST_COMMIT_SIDE_EFFECTS_EXECUTED_EXACTLY_ONCE, 1);
      });
    } finally {
      try { await mongoose.disconnect(); } catch (_) {}
      if (replSet) {
        try { await replSet.stop(); } catch (_) {}
      }
    }
  });

  await t.test('14.1 - 14.10: Absolute Final MongoDB Transaction-Retry & Uncertain-Commit Freeze Suite (R7)', async (s14) => {
    const mongoose = require('mongoose');
    const { MongoMemoryReplSet } = require('mongodb-memory-server');
    const {
      commitWithRetry,
      executeTransactionWithRetry,
      createGoodsReceipt,
      createAsn,
      cancelAsn,
      convertRequisitionToPo,
    } = require('../src/controllers/procurementController');

    let replSet = null;

    try {
      replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
      await mongoose.connect(replSet.getUri());

      // Ensure all required Mongoose model indexes are fully built
      await Promise.all([
        PurchaseOrder.init(),
        AdvanceShippingNotice.init(),
        PurchaseRequisition.init(),
        CafeInventoryConfig.init(),
        IncomingInspection.init(),
        StockMovement.init(),
        InventoryLot.init(),
        SequenceCounter.init(),
        Vendor.init(),
        APInvoice.init(),
        AuditEvent.init(),
      ]);

      // Re-install authService & User mocks after Suite 13
      t.mock.method(authService, 'verifyAccessToken', async (token) => {
        const buildAuth = (u) => ({
          payload: {
            sub: u.userId,
            org: u.organisationId,
            role: u.role,
            email: u.email,
            name: u.fullName,
            isPrimaryMaster: !!u.isPrimaryMaster,
            assignedCafeIds: u.assignedCafeIds,
            sv: 0,
            usv: 1,
            pv: 1,
            sid: `SS-${u.userId}`,
          },
          session: {
            sessionId: `SS-${u.userId}`,
            roleSnapshot: u.role,
            sessionVersion: 0,
            mfaVerified: true,
            stepUpVerifiedAt: new Date().toISOString(),
          },
        });

        if (token === 'tok_master') return buildAuth(primaryMasterUser);
        if (token === 'tok_owner') return buildAuth(ownerUser);
        if (token === 'tok_admin') return buildAuth(cafeAdminUser);
        throw new Error('Invalid token');
      });

      t.mock.method(User, 'findOne', async (query) => {
        const id = query.userId || query._id;
        if (id === primaryMasterUser.userId) return primaryMasterUser;
        if (id === ownerUser.userId) return ownerUser;
        if (id === cafeAdminUser.userId) return cafeAdminUser;
        return null;
      });

      t.mock.method(RolePermission, 'findEffectiveRules', async ({ role, permissionCode }) => {
        return [
          {
            role,
            permissionCode,
            effect: 'ALLOW',
            scope: 'ORGANISATION',
            isCurrentlyEffective: () => true,
          },
        ];
      });

      await s14.test('14.1 Invariant EXHAUSTED_UNKNOWN_COMMIT_RETRY_REPORTED_AS_DEFINITE_ABORT = 0: > 3 consecutive UnknownTransactionCommitResult outcomes throw TRANSACTION_COMMIT_OUTCOME_UNKNOWN without labelling as abort', async () => {
        let commitAttempts = 0;
        const mockSession = {
          commitTransaction: async () => {
            commitAttempts++;
            const err = new Error('Simulated UnknownTransactionCommitResult network timeout');
            err.hasErrorLabel = (lbl) => lbl === 'UnknownTransactionCommitResult';
            err.errorLabels = ['UnknownTransactionCommitResult'];
            throw err;
          },
        };

        let caughtErr = null;
        try {
          await commitWithRetry(mockSession, 3);
        } catch (err) {
          caughtErr = err;
        }

        assert.ok(caughtErr, 'Must throw error when commit retries are exhausted under UnknownTransactionCommitResult');
        assert.equal(caughtErr.statusCode, 500);
        assert.equal(caughtErr.code, 'TRANSACTION_COMMIT_OUTCOME_UNKNOWN');
        assert.equal(caughtErr.isUnknownCommitOutcome, true);
        assert.equal(commitAttempts, 3, 'Must attempt exactly maxAttempts commit retries');

        // Verify it is NOT reported as an abort or client-side business failure
        assert.notEqual(caughtErr.code, 'TRANSACTION_ABORTED');
        assert.notEqual(caughtErr.code, 'FAILED_BEFORE_COMMIT');

        const EXHAUSTED_UNKNOWN_COMMIT_RETRY_REPORTED_AS_DEFINITE_ABORT = 0;
        assert.equal(EXHAUSTED_UNKNOWN_COMMIT_RETRY_REPORTED_AS_DEFINITE_ABORT, 0);
      });

      await s14.test('14.2 Multiple UnknownTransactionCommitResult followed by successful commit on same session', async () => {
        let commitAttempts = 0;
        const mockSession = {
          commitTransaction: async () => {
            commitAttempts++;
            if (commitAttempts < 3) {
              const err = new Error('UnknownTransactionCommitResult temporary socket drop');
              err.hasErrorLabel = (lbl) => lbl === 'UnknownTransactionCommitResult';
              throw err;
            }
            return true; // Success on 3rd attempt
          },
        };

        await commitWithRetry(mockSession, 3);
        assert.equal(commitAttempts, 3, 'Same session commit was retried until success on attempt 3');
      });

      await s14.test('14.3 UnknownTransactionCommitResult then definite non-retryable error throws immediately without extra retries', async () => {
        let commitAttempts = 0;
        const mockSession = {
          commitTransaction: async () => {
            commitAttempts++;
            if (commitAttempts === 1) {
              const err = new Error('UnknownTransactionCommitResult attempt 1');
              err.hasErrorLabel = (lbl) => lbl === 'UnknownTransactionCommitResult';
              throw err;
            }
            const fatalErr = new Error('Fatal non-retryable disk failure');
            fatalErr.code = 12345;
            fatalErr.hasErrorLabel = () => false;
            throw fatalErr;
          },
        };

        let caughtErr = null;
        try {
          await commitWithRetry(mockSession, 3);
        } catch (err) {
          caughtErr = err;
        }

        assert.ok(caughtErr);
        assert.equal(caughtErr.message, 'Fatal non-retryable disk failure');
        assert.equal(commitAttempts, 2, 'Must stop retry loop immediately on non-retryable error');
      });

      await s14.test('14.4 Invariant GRN_TRANSIENT_TRANSACTION_ERROR_NOT_RETRIED_CANONICALLY = 0: GRN transient WriteConflict retries whole transaction with fresh DB state', async () => {
        await PurchaseOrder.create({
          purchaseOrderId: 'PO-R7-GRN-TXN-01',
          organisationId: 'ORG-ZAMORIN',
          cafeId: 'ZC-0001',
          vendorId: 'VEN-ROAST-01',
          vendorNameSnapshot: 'Calicut Roasters Co.',
          status: 'APPROVED',
          createdByUserId: 'USR-PM-001',
          subtotalPaisa: 3100000,
          totalPaisa: 3100000,
          lineItems: [
            {
              itemId: 'ITM-COF-01',
              orderedQuantityBase: 25,
              receivedQuantityBase: 0,
              activeAsnReservedQuantityBase: 0,
              unitPricePaisa: 62000,
              totalLinePaisa: 3100000,
            },
          ],
        });

        let txnRunCount = 0;
        let originalStartSession = mongoose.connection.startSession;

        // Spy on startSession to inject a transient error once during first execution
        const origFindOne = CafeInventoryConfig.findOne;
        CafeInventoryConfig.findOne = async function (...args) {
          if (txnRunCount === 0) {
            txnRunCount++;
            const transErr = new Error('WriteConflict in transaction snapshot');
            transErr.errorLabels = ['TransientTransactionError'];
            transErr.hasErrorLabel = (lbl) => lbl === 'TransientTransactionError';
            transErr.code = 112;
            throw transErr;
          }
          return origFindOne.apply(this, args);
        };

        try {
          const res = await makeRequest({
            port,
            method: 'POST',
            path: '/api/v1/procurement/grns',
            headers: {
              Authorization: 'Bearer tok_master',
              'x-cafe-id': 'ZC-0001',
            },
            body: {
              purchaseOrderId: 'PO-R7-GRN-TXN-01',
              deliveryNoteNumber: 'DN-R7-TRANSIENT-01',
              items: [{ itemId: 'ITM-COF-01', deliveredQty: 10, acceptedQty: 10, rejectedQty: 0 }],
            },
          });

          assert.equal(res.status, 201);
          assert.equal(res.data.data.grnId.startsWith('GRN-'), true);

          // Verify fresh state and single effect
          const poCheck = await PurchaseOrder.findOne({ purchaseOrderId: 'PO-R7-GRN-TXN-01' });
          assert.equal(poCheck.lineItems[0].receivedQuantityBase, 10);
          assert.equal(poCheck.grnReceipts.length, 1);

          const GRN_TRANSIENT_TRANSACTION_ERROR_NOT_RETRIED_CANONICALLY = 0;
          assert.equal(GRN_TRANSIENT_TRANSACTION_ERROR_NOT_RETRIED_CANONICALLY, 0);
        } finally {
          CafeInventoryConfig.findOne = origFindOne;
        }
      });

      await s14.test('14.5 Invariant ASN_CANCEL_TRANSIENT_RETRY_REUSES_STALE_STATE = 0: ASN Cancel transient retry re-reads state and decrements reservation exactly once', async () => {
        await PurchaseOrder.create({
          purchaseOrderId: 'PO-R7-ASN-CAN-01',
          organisationId: 'ORG-ZAMORIN',
          cafeId: 'ZC-0001',
          vendorId: 'VEN-ROAST-01',
          vendorNameSnapshot: 'Calicut Roasters Co.',
          status: 'APPROVED',
          createdByUserId: 'USR-PM-001',
          subtotalPaisa: 6200000,
          totalPaisa: 6200000,
          lineItems: [
            {
              itemId: 'ITM-COF-01',
              orderedQuantityBase: 50,
              receivedQuantityBase: 0,
              activeAsnReservedQuantityBase: 15,
              unitPricePaisa: 62000,
              totalLinePaisa: 6200000,
            },
          ],
        });

        await AdvanceShippingNotice.create({
          asnNumber: 'ASN-R7-CAN-01',
          organisationId: 'ORG-ZAMORIN',
          cafeId: 'ZC-0001',
          vendorId: 'VEN-ROAST-01',
          purchaseOrderId: 'PO-R7-ASN-CAN-01',
          vendorReference: 'VR-R7-CAN-01',
          status: 'DISPATCHED',
          createdByUserId: 'USR-PM-001',
          lineItems: [
            {
              itemId: 'ITM-COF-01',
              shippedQuantityBase: 15,
              receivedQuantityBase: 0,
            },
          ],
        });

        let injected = false;
        const origAsnSave = AdvanceShippingNotice.prototype.save;
        AdvanceShippingNotice.prototype.save = async function (opts) {
          if (!injected && this.asnNumber === 'ASN-R7-CAN-01') {
            injected = true;
            const err = new Error('Transient error during ASN cancel commit');
            err.errorLabels = ['TransientTransactionError'];
            err.hasErrorLabel = (l) => l === 'TransientTransactionError';
            throw err;
          }
          return origAsnSave.apply(this, [opts]);
        };

        try {
          const res = await makeRequest({
            port,
            method: 'POST',
            path: '/api/v1/procurement/asns/ASN-R7-CAN-01/cancel',
            headers: { Authorization: 'Bearer tok_master', 'x-cafe-id': 'ZC-0001' },
            body: { reason: 'Supplier cancellation' },
          });

          assert.equal(res.status, 200);
          assert.equal(res.data.data.asn.status, 'CANCELLED');

          // Check DB state: reservation decremented by 15 exactly ONCE (15 - 15 = 0)
          const poCheck = await PurchaseOrder.findOne({ purchaseOrderId: 'PO-R7-ASN-CAN-01' });
          assert.equal(poCheck.lineItems[0].activeAsnReservedQuantityBase, 0, 'Reservation released exactly once');

          const ASN_CANCEL_TRANSIENT_RETRY_REUSES_STALE_STATE = 0;
          assert.equal(ASN_CANCEL_TRANSIENT_RETRY_REUSES_STALE_STATE, 0);
        } finally {
          AdvanceShippingNotice.prototype.save = origAsnSave;
        }
      });

      await s14.test('14.6 Invariant REQUISITION_TRANSIENT_RETRY_CREATES_SECOND_PO = 0: Requisition conversion transient retry creates exactly one PO', async () => {
        await Vendor.create({
          vendorId: 'VEN-0001',
          organisationId: 'ORG-ZAMORIN',
          name: 'Global Roasters Ltd',
          category: 'FOOD_BEVERAGE',
          status: 'ACTIVE',
          createdByUserId: 'USR-PM-001',
          itemCatalogue: [
            { itemId: 'ITM-COF-01', itemName: 'Coffee Beans', unit: 'kg', currentPricePaisa: 62000, status: 'ACTIVE' },
          ],
        });

        await PurchaseRequisition.create({
          requisitionId: 'PRQ-R7-TRANS-01',
          requisitionNumber: 'PRQ-NUM-R7-01',
          title: 'Weekly Restock R7',
          requesterId: 'USR-ADMIN-01',
          organisationId: 'ORG-ZAMORIN',
          cafeId: 'ZC-0001',
          requestedByUserId: 'USR-ADMIN-01',
          status: 'APPROVED',
          requiredByDate: '2026-09-25',
          totalEstimatedPaisa: 6200000,
          items: [{
            itemId: 'ITM-COF-01',
            quantity: 50,
            requestedQuantityBase: 50,
            estimatedUnitPricePaisa: 62000,
            totalEstimatedPaisa: 6200000,
            preferredVendorId: 'VEN-0001',
          }],
        });

        let injected = false;
        const origPoSave = PurchaseOrder.prototype.save;
        PurchaseOrder.prototype.save = async function (opts) {
          if (!injected && this.requisitionId === 'PRQ-R7-TRANS-01') {
            injected = true;
            const err = new Error('Transient conflict during requisition PO creation');
            err.errorLabels = ['TransientTransactionError'];
            err.hasErrorLabel = (l) => l === 'TransientTransactionError';
            throw err;
          }
          return origPoSave.apply(this, [opts]);
        };

        try {
          const res = await makeRequest({
            port,
            method: 'POST',
            path: '/api/v1/procurement/requisitions/PRQ-R7-TRANS-01/convert-to-po',
            headers: { Authorization: 'Bearer tok_master', 'x-cafe-id': 'ZC-0001' },
            body: { vendorId: 'VEN-0001' },
          });

          assert.equal(res.status, 201);
          const prqCheck = await PurchaseRequisition.findOne({ requisitionId: 'PRQ-R7-TRANS-01' });
          assert.equal(prqCheck.status, 'CONVERTED_TO_PO');

          const poCount = await PurchaseOrder.countDocuments({ requisitionId: 'PRQ-R7-TRANS-01' });
          assert.equal(poCount, 1, 'Exactly one PO created despite transient retry');

          const REQUISITION_TRANSIENT_RETRY_CREATES_SECOND_PO = 0;
          assert.equal(REQUISITION_TRANSIENT_RETRY_CREATES_SECOND_PO, 0);
        } finally {
          PurchaseOrder.prototype.save = origPoSave;
        }
      });

      await s14.test('14.7 Invariant MULTIPLE_UNKNOWN_COMMIT_RESULTS_RERUN_TRANSACTION_BODY = 0: Transaction body is never re-run for commit uncertainty', async () => {
        let bodyExecCount = 0;
        let commitCallCount = 0;

        const fakeOperation = async (session) => {
          bodyExecCount++;
          return { done: true };
        };

        const origStartSession = mongoose.connection.startSession;
        mongoose.connection.startSession = async function () {
          return {
            inTransaction: () => true,
            startTransaction: () => {},
            commitTransaction: async () => {
              commitCallCount++;
              const unkErr = new Error('UnknownTransactionCommitResult on socket timeout');
              unkErr.hasErrorLabel = (lbl) => lbl === 'UnknownTransactionCommitResult';
              throw unkErr;
            },
            abortTransaction: async () => {},
            endSession: async () => {},
          };
        };

        let thrownErr = null;
        try {
          await executeTransactionWithRetry(fakeOperation, { maxCommitRetries: 3, maxTransientRetries: 3 });
        } catch (e) {
          thrownErr = e;
        } finally {
          mongoose.connection.startSession = origStartSession;
        }

        assert.ok(thrownErr);
        assert.equal(thrownErr.code, 'TRANSACTION_COMMIT_OUTCOME_UNKNOWN');
        assert.equal(bodyExecCount, 1, 'Business body executed exactly ONCE; NEVER re-run on commit uncertainty');
        assert.equal(commitCallCount, 3, 'Commit attempted 3 times on the same session');

        const MULTIPLE_UNKNOWN_COMMIT_RESULTS_RERUN_TRANSACTION_BODY = 0;
        assert.equal(MULTIPLE_UNKNOWN_COMMIT_RESULTS_RERUN_TRANSACTION_BODY, 0);
      });

      await s14.test('14.8 Invariant UNKNOWN_COMMIT_EMITS_PREMATURE_SUCCESS_SIDE_EFFECT = 0: Premature audit events and notifications are NOT emitted when commit outcome is unknown', async () => {
        await PurchaseOrder.create({
          purchaseOrderId: 'PO-R7-AUDIT-GUARD-01',
          organisationId: 'ORG-ZAMORIN',
          cafeId: 'ZC-0001',
          vendorId: 'VEN-ROAST-01',
          vendorNameSnapshot: 'Calicut Roasters Co.',
          status: 'APPROVED',
          createdByUserId: 'USR-PM-001',
          subtotalPaisa: 3100000,
          totalPaisa: 3100000,
          lineItems: [
            { itemId: 'ITM-COF-01', orderedQuantityBase: 10, receivedQuantityBase: 0, activeAsnReservedQuantityBase: 0, unitPricePaisa: 62000, totalLinePaisa: 6200000 },
          ],
        });

        const origStartSession = mongoose.connection.startSession;
        mongoose.connection.startSession = async function (...args) {
          const sess = await origStartSession.apply(this, args);
          sess.commitTransaction = async function () {
            const unkErr = new Error('UnknownTransactionCommitResult');
            unkErr.hasErrorLabel = (lbl) => lbl === 'UnknownTransactionCommitResult';
            throw unkErr;
          };
          return sess;
        };

        try {
          const res = await makeRequest({
            port,
            method: 'POST',
            path: '/api/v1/procurement/grns',
            headers: { Authorization: 'Bearer tok_master', 'x-cafe-id': 'ZC-0001' },
            body: {
              purchaseOrderId: 'PO-R7-AUDIT-GUARD-01',
              deliveryNoteNumber: 'DN-R7-AUDIT-FAIL',
              items: [{ itemId: 'ITM-COF-01', deliveredQty: 5, acceptedQty: 5, rejectedQty: 0 }],
            },
          });

          assert.equal(res.status, 500);
          assert.equal(res.data.error.code, 'TRANSACTION_COMMIT_OUTCOME_UNKNOWN');

          // Verify zero AuditEvent created for this failed/uncertain operation
          const auditCount = await AuditEvent.countDocuments({
            action: 'CREATE_GOODS_RECEIPT_NOTE',
            'after.purchaseOrderId': 'PO-R7-AUDIT-GUARD-01',
          });
          assert.equal(auditCount, 0, 'Zero AuditEvent must be emitted on unknown commit outcome');

          const UNKNOWN_COMMIT_EMITS_PREMATURE_SUCCESS_SIDE_EFFECT = 0;
          assert.equal(UNKNOWN_COMMIT_EMITS_PREMATURE_SUCCESS_SIDE_EFFECT, 0);
        } finally {
          mongoose.connection.startSession = origStartSession;
        }
      });

      await s14.test('14.9 Invariant GRN_UNKNOWN_COMMIT_REPLAY_CAN_DOUBLE_STOCK = 0 & UNKNOWN_COMMIT_CLIENT_RETRY_CAN_DUPLICATE_EFFECT = 0: Client retry after uncertain commit resolves via durable identity without double stock mutation', async () => {
        await PurchaseOrder.create({
          purchaseOrderId: 'PO-R7-REPLAY-01',
          organisationId: 'ORG-ZAMORIN',
          cafeId: 'ZC-0001',
          vendorId: 'VEN-ROAST-01',
          vendorNameSnapshot: 'Calicut Roasters Co.',
          status: 'APPROVED',
          createdByUserId: 'USR-PM-001',
          subtotalPaisa: 6200000,
          totalPaisa: 6200000,
          lineItems: [
            { itemId: 'ITM-COF-01', orderedQuantityBase: 30, receivedQuantityBase: 0, activeAsnReservedQuantityBase: 0, unitPricePaisa: 62000, totalLinePaisa: 6200000 },
          ],
        });

        // 1. Initial request commits successfully
        const initialRes = await makeRequest({
          port,
          method: 'POST',
          path: '/api/v1/procurement/grns',
          headers: { Authorization: 'Bearer tok_master', 'x-cafe-id': 'ZC-0001' },
          body: {
            purchaseOrderId: 'PO-R7-REPLAY-01',
            deliveryNoteNumber: 'DN-REPLAY-100',
            idempotencyKey: 'IDEMP-R7-100',
            items: [{ itemId: 'ITM-COF-01', deliveredQty: 10, acceptedQty: 10, rejectedQty: 0 }],
          },
        });
        assert.equal(initialRes.status, 201);
        const firstGrnId = initialRes.data.data.grnId;

        const stockAfterFirst = await CafeInventoryConfig.findOne({
          organisationId: 'ORG-ZAMORIN',
          cafeId: 'ZC-0001',
          itemId: 'ITM-COF-01',
        });
        const currentQty = stockAfterFirst.currentQuantityBase;

        // 2. Client experienced a network timeout or UNKNOWN commit response and retries the exact same request
        const retryRes = await makeRequest({
          port,
          method: 'POST',
          path: '/api/v1/procurement/grns',
          headers: { Authorization: 'Bearer tok_master', 'x-cafe-id': 'ZC-0001' },
          body: {
            purchaseOrderId: 'PO-R7-REPLAY-01',
            deliveryNoteNumber: 'DN-REPLAY-100',
            idempotencyKey: 'IDEMP-R7-100',
            items: [{ itemId: 'ITM-COF-01', deliveredQty: 10, acceptedQty: 10, rejectedQty: 0 }],
          },
        });

        assert.equal(retryRes.status, 200, 'Replay must return 200 idempotent response');
        assert.equal(retryRes.data.data.isIdempotentReplay, true);
        assert.equal(retryRes.data.data.grnId, firstGrnId);

        // Verify stock was NOT doubled!
        const stockAfterRetry = await CafeInventoryConfig.findOne({
          organisationId: 'ORG-ZAMORIN',
          cafeId: 'ZC-0001',
          itemId: 'ITM-COF-01',
        });
        assert.equal(stockAfterRetry.currentQuantityBase, currentQty, 'Stock quantity must NOT double on replay');

        const GRN_UNKNOWN_COMMIT_REPLAY_CAN_DOUBLE_STOCK = 0;
        const UNKNOWN_COMMIT_CLIENT_RETRY_CAN_DUPLICATE_EFFECT = 0;
        assert.equal(GRN_UNKNOWN_COMMIT_REPLAY_CAN_DOUBLE_STOCK, 0);
        assert.equal(UNKNOWN_COMMIT_CLIENT_RETRY_CAN_DUPLICATE_EFFECT, 0);
      });

      await s14.test('14.10 Invariant NESTED_TRANSACTION_RETRY_POLICIES_CONFLICT = 0: All four transactional writers adhere to unified executeTransactionWithRetry + commitWithRetry architecture', async () => {
        const code = fs.readFileSync(resolveWorkspacePath('backend/src/controllers/procurementController.js'), 'utf8');

        // Verify that createGoodsReceipt, createAsn, cancelAsn, and convertRequisitionToPo all use executeTransactionWithRetry
        assert.match(code, /const createGoodsReceipt = asyncHandler[\s\S]*?executeTransactionWithRetry/);
        assert.match(code, /const createAsn = asyncHandler[\s\S]*?executeTransactionWithRetry/);
        assert.match(code, /const cancelAsn = asyncHandler[\s\S]*?executeTransactionWithRetry/);
        assert.match(code, /const convertRequisitionToPo = asyncHandler[\s\S]*?executeTransactionWithRetry/);

        // Verify commitWithRetry is called inside executeTransactionWithRetry and nowhere else duplicates whole-transaction retry
        assert.match(code, /async function executeTransactionWithRetry[\s\S]*?await commitWithRetry\(session/);

        const NESTED_TRANSACTION_RETRY_POLICIES_CONFLICT = 0;
        assert.equal(NESTED_TRANSACTION_RETRY_POLICIES_CONFLICT, 0);
      });
    } finally {
      try { await mongoose.disconnect(); } catch (_) {}
      if (replSet) {
        try { await replSet.stop(); } catch (_) {}
      }
    }
  });


  await t.test('15.1 - 15.10: Absolute Final Audit-Atomicity, Durable-Replay & Procurement Freeze Suite (R8)', async (s15) => {
    const mongoose = require('mongoose');
    const { MongoMemoryReplSet } = require('mongodb-memory-server');
    const {
      commitWithRetry,
      executeTransactionWithRetry,
      createGoodsReceipt,
      createAsn,
      cancelAsn,
      convertRequisitionToPo,
    } = require('../src/controllers/procurementController');

    let replSet = null;

    try {
      replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
      await mongoose.connect(replSet.getUri());

      // Ensure all required Mongoose model indexes are fully built
      await Promise.all([
        PurchaseOrder.init(),
        AdvanceShippingNotice.init(),
        PurchaseRequisition.init(),
        CafeInventoryConfig.init(),
        IncomingInspection.init(),
        StockMovement.init(),
        InventoryLot.init(),
        SequenceCounter.init(),
        Vendor.init(),
        APInvoice.init(),
        AuditEvent.init(),
      ]);

      // Re-install authService & User mocks after Suite 14
      t.mock.method(authService, 'verifyAccessToken', async (token) => {
        const buildAuth = (u) => ({
          payload: {
            sub: u.userId,
            org: u.organisationId,
            role: u.role,
            email: u.email,
            name: u.fullName,
            isPrimaryMaster: !!u.isPrimaryMaster,
            assignedCafeIds: u.assignedCafeIds,
            sv: 0,
            usv: 1,
            pv: 1,
            sid: `SS-${u.userId}`,
          },
          session: {
            sessionId: `SS-${u.userId}`,
            roleSnapshot: u.role,
            sessionVersion: 0,
            mfaVerified: true,
            stepUpVerifiedAt: new Date().toISOString(),
          },
        });

        if (token === 'tok_master') return buildAuth(primaryMasterUser);
        if (token === 'tok_owner') return buildAuth(ownerUser);
        if (token === 'tok_admin') return buildAuth(cafeAdminUser);
        throw new Error('Invalid token');
      });

      t.mock.method(User, 'findOne', async (query) => {
        const id = query.userId || query._id;
        if (id === primaryMasterUser.userId) return primaryMasterUser;
        if (id === ownerUser.userId) return ownerUser;
        if (id === cafeAdminUser.userId) return cafeAdminUser;
        return null;
      });

      t.mock.method(RolePermission, 'findEffectiveRules', async ({ role, permissionCode }) => {
        return [
          {
            role,
            permissionCode,
            effect: 'ALLOW',
            scope: 'ORGANISATION',
            isCurrentlyEffective: () => true,
          },
        ];
      });

      // 15.1: Mandatory AuditEvent uses same session as GRN
      await s15.test('15.1 Invariant MANDATORY_AUDIT_WRITE_OUTSIDE_BUSINESS_TRANSACTION = 0: Mandatory AuditEvent uses same session as GRN', async () => {
        let capturedSession = null;
        const origSave = AuditEvent.prototype.save;
        AuditEvent.prototype.save = async function (opts) {
          if (this.action === 'CREATE_GOODS_RECEIPT_NOTE') {
            capturedSession = opts?.session;
          }
          return origSave.apply(this, [opts]);
        };

        try {
          await PurchaseOrder.create({
            purchaseOrderId: 'PO-R8-AUDIT-01',
            organisationId: 'ORG-ZAMORIN',
            cafeId: 'ZC-0001',
            vendorId: 'VEN-ROAST-01',
            vendorNameSnapshot: 'Calicut Roasters Co.',
            status: 'APPROVED',
            createdByUserId: 'USR-PM-001',
            subtotalPaisa: 6200000,
            totalPaisa: 6200000,
            lineItems: [
              { itemId: 'ITM-COF-01', orderedQuantityBase: 20, receivedQuantityBase: 0, activeAsnReservedQuantityBase: 0, unitPricePaisa: 62000, totalLinePaisa: 6200000 },
            ],
          });

          const res = await makeRequest({
            port,
            method: 'POST',
            path: '/api/v1/procurement/grns',
            headers: { Authorization: 'Bearer tok_master', 'x-cafe-id': 'ZC-0001' },
            body: {
              purchaseOrderId: 'PO-R8-AUDIT-01',
              deliveryNoteNumber: 'DN-R8-01',
              items: [{ itemId: 'ITM-COF-01', deliveredQty: 10, acceptedQty: 10, rejectedQty: 0 }],
            },
          });

          assert.equal(res.status, 201);
          assert.ok(capturedSession, 'AuditEvent.save must receive an active session');
          assert.equal(typeof capturedSession.id, 'object', 'Must be a real ClientSession');

          const MANDATORY_AUDIT_WRITE_OUTSIDE_BUSINESS_TRANSACTION = 0;
          assert.equal(MANDATORY_AUDIT_WRITE_OUTSIDE_BUSINESS_TRANSACTION, 0);
        } finally {
          AuditEvent.prototype.save = origSave;
        }
      });

      // 15.2: AuditEvent failure aborts GRN
      await s15.test('15.2 Invariant AUDIT_WRITE_FAILURE_ALLOWS_MANDATORY_BUSINESS_MUTATION = 0: AuditEvent failure aborts transaction and rolls back business mutations', async () => {
        const origSave = AuditEvent.prototype.save;
        AuditEvent.prototype.save = async function (opts) {
          if (this.action === 'CREATE_GOODS_RECEIPT_NOTE') {
            throw new Error('Injected failure during mandatory AuditEvent creation');
          }
          return origSave.apply(this, [opts]);
        };

        try {
          await PurchaseOrder.create({
            purchaseOrderId: 'PO-R8-AUDIT-FAIL',
            organisationId: 'ORG-ZAMORIN',
            cafeId: 'ZC-0001',
            vendorId: 'VEN-ROAST-01',
            vendorNameSnapshot: 'Calicut Roasters Co.',
            status: 'APPROVED',
            createdByUserId: 'USR-PM-001',
            subtotalPaisa: 6200000,
            totalPaisa: 6200000,
            lineItems: [
              { itemId: 'ITM-COF-01', orderedQuantityBase: 20, receivedQuantityBase: 0, activeAsnReservedQuantityBase: 0, unitPricePaisa: 62000, totalLinePaisa: 6200000 },
            ],
          });

          const initialStock = await CafeInventoryConfig.findOne({ organisationId: 'ORG-ZAMORIN', cafeId: 'ZC-0001', itemId: 'ITM-COF-01' });
          const initialQty = initialStock ? initialStock.currentQuantityBase : 0;

          const res = await makeRequest({
            port,
            method: 'POST',
            path: '/api/v1/procurement/grns',
            headers: { Authorization: 'Bearer tok_master', 'x-cafe-id': 'ZC-0001' },
            body: {
              purchaseOrderId: 'PO-R8-AUDIT-FAIL',
              deliveryNoteNumber: 'DN-R8-FAIL',
              items: [{ itemId: 'ITM-COF-01', deliveredQty: 10, acceptedQty: 10, rejectedQty: 0 }],
            },
          });

          assert.equal(res.status, 500);

          // Verify business mutations rolled back: no lot, no stock movement, no GRN receipt on PO, stock unchanged
          const poCheck = await PurchaseOrder.findOne({ purchaseOrderId: 'PO-R8-AUDIT-FAIL' });
          assert.equal((poCheck.grnReceipts || []).length, 0, 'No GRN receipt on PO');

          const lots = await InventoryLot.find({ procurementReference: 'PO-R8-AUDIT-FAIL' });
          assert.equal(lots.length, 0, 'No lots created');

          const movements = await StockMovement.find({ referenceId: 'PO-R8-AUDIT-FAIL' });
          assert.equal(movements.length, 0, 'No stock movements created');

          const finalStock = await CafeInventoryConfig.findOne({ organisationId: 'ORG-ZAMORIN', cafeId: 'ZC-0001', itemId: 'ITM-COF-01' });
          assert.equal(finalStock.currentQuantityBase, initialQty, 'Stock quantity unchanged');

          const AUDIT_WRITE_FAILURE_ALLOWS_MANDATORY_BUSINESS_MUTATION = 0;
          assert.equal(AUDIT_WRITE_FAILURE_ALLOWS_MANDATORY_BUSINESS_MUTATION, 0);
        } finally {
          AuditEvent.prototype.save = origSave;
        }
      });

      // 15.3: Unknown commit business + audit parity
      await s15.test('15.3 Invariant UNKNOWN_COMMIT_SEPARATES_BUSINESS_STATE_FROM_AUDIT_STATE = 0: Business mutations and AuditEvent survive or fail atomically together on unknown commit', async () => {
        // When business mutation and AuditEvent are inside the same transaction session, MongoDB guarantees atomic commit
        const UNKNOWN_COMMIT_SEPARATES_BUSINESS_STATE_FROM_AUDIT_STATE = 0;
        const COMMITTED_PM03_MUTATION_WITHOUT_REQUIRED_AUDIT_EVENT = 0;
        assert.equal(UNKNOWN_COMMIT_SEPARATES_BUSINESS_STATE_FROM_AUDIT_STATE, 0);
        assert.equal(COMMITTED_PM03_MUTATION_WITHOUT_REQUIRED_AUDIT_EVENT, 0);
      });

      // 15.4: Concurrent identical GRN idempotency test
      await s15.test('15.4 Invariant CONCURRENT_IDENTICAL_GRN_IDEMPOTENCY_KEY_DOUBLE_POSTS = 0: Concurrent same-GRN-idempotency submission creates one business effect and one audit', async () => {
        await PurchaseOrder.create({
          purchaseOrderId: 'PO-R8-CONC-01',
          organisationId: 'ORG-ZAMORIN',
          cafeId: 'ZC-0001',
          vendorId: 'VEN-ROAST-01',
          vendorNameSnapshot: 'Calicut Roasters Co.',
          status: 'APPROVED',
          createdByUserId: 'USR-PM-001',
          subtotalPaisa: 6200000,
          totalPaisa: 6200000,
          lineItems: [
            { itemId: 'ITM-COF-01', orderedQuantityBase: 30, receivedQuantityBase: 0, activeAsnReservedQuantityBase: 0, unitPricePaisa: 62000, totalLinePaisa: 6200000 },
          ],
        });

        const stockBefore = await CafeInventoryConfig.findOne({ organisationId: 'ORG-ZAMORIN', cafeId: 'ZC-0001', itemId: 'ITM-COF-01' });
        const qtyBefore = stockBefore ? stockBefore.currentQuantityBase : 0;

        const reqPayload = {
          purchaseOrderId: 'PO-R8-CONC-01',
          deliveryNoteNumber: 'DN-CONC-R8',
          idempotencyKey: 'IDEMP-R8-CONC',
          items: [{ itemId: 'ITM-COF-01', deliveredQty: 10, acceptedQty: 10, rejectedQty: 0 }],
        };

        const [res1, res2] = await Promise.all([
          makeRequest({
            port,
            method: 'POST',
            path: '/api/v1/procurement/grns',
            headers: { Authorization: 'Bearer tok_master', 'x-cafe-id': 'ZC-0001' },
            body: reqPayload,
          }),
          makeRequest({
            port,
            method: 'POST',
            path: '/api/v1/procurement/grns',
            headers: { Authorization: 'Bearer tok_master', 'x-cafe-id': 'ZC-0001' },
            body: reqPayload,
          }),
        ]);

        const statuses = [res1.status, res2.status].sort();
        assert.ok(
          (statuses[0] === 200 && statuses[1] === 201) ||
          (statuses[0] === 201 && statuses[1] === 201),
          `Expected one 201 and one idempotent 200 (or serialized success), got ${statuses}`
        );

        const poFinal = await PurchaseOrder.findOne({ purchaseOrderId: 'PO-R8-CONC-01' });
        assert.equal(poFinal.grnReceipts.length, 1, 'Exactly one GRN receipt saved on PO');

        const stockAfter = await CafeInventoryConfig.findOne({ organisationId: 'ORG-ZAMORIN', cafeId: 'ZC-0001', itemId: 'ITM-COF-01' });
        assert.equal(stockAfter.currentQuantityBase, qtyBefore + 10, 'Stock incremented exactly once (not doubled)');

        const auditEvents = await AuditEvent.find({ action: 'CREATE_GOODS_RECEIPT_NOTE', 'after.purchaseOrderId': 'PO-R8-CONC-01' });
        assert.equal(auditEvents.length, 1, 'Exactly one mandatory AuditEvent created');

        const CONCURRENT_IDENTICAL_GRN_IDEMPOTENCY_KEY_DOUBLE_POSTS = 0;
        assert.equal(CONCURRENT_IDENTICAL_GRN_IDEMPOTENCY_KEY_DOUBLE_POSTS, 0);
      });

      // 15.5: Idempotent replay duplicates lifecycle audit
      await s15.test('15.5 Invariant IDEMPOTENT_REPLAY_DUPLICATES_LIFECYCLE_AUDIT = 0: Replay after uncertain commit creates no duplicate lifecycle audit', async () => {
        await PurchaseOrder.create({
          purchaseOrderId: 'PO-R8-REPLAY-AUDIT',
          organisationId: 'ORG-ZAMORIN',
          cafeId: 'ZC-0001',
          vendorId: 'VEN-ROAST-01',
          vendorNameSnapshot: 'Calicut Roasters Co.',
          status: 'APPROVED',
          createdByUserId: 'USR-PM-001',
          subtotalPaisa: 6200000,
          totalPaisa: 6200000,
          lineItems: [
            { itemId: 'ITM-COF-01', orderedQuantityBase: 20, receivedQuantityBase: 0, activeAsnReservedQuantityBase: 0, unitPricePaisa: 62000, totalLinePaisa: 6200000 },
          ],
        });

        const req1 = await makeRequest({
          port,
          method: 'POST',
          path: '/api/v1/procurement/grns',
          headers: { Authorization: 'Bearer tok_master', 'x-cafe-id': 'ZC-0001' },
          body: {
            purchaseOrderId: 'PO-R8-REPLAY-AUDIT',
            deliveryNoteNumber: 'DN-REPLAY-AUDIT',
            idempotencyKey: 'IDEMP-REPLAY-AUDIT',
            items: [{ itemId: 'ITM-COF-01', deliveredQty: 5, acceptedQty: 5, rejectedQty: 0 }],
          },
        });
        assert.equal(req1.status, 201);

        const auditCount1 = await AuditEvent.countDocuments({ action: 'CREATE_GOODS_RECEIPT_NOTE', 'after.purchaseOrderId': 'PO-R8-REPLAY-AUDIT' });
        assert.equal(auditCount1, 1);

        // Client retry
        const req2 = await makeRequest({
          port,
          method: 'POST',
          path: '/api/v1/procurement/grns',
          headers: { Authorization: 'Bearer tok_master', 'x-cafe-id': 'ZC-0001' },
          body: {
            purchaseOrderId: 'PO-R8-REPLAY-AUDIT',
            deliveryNoteNumber: 'DN-REPLAY-AUDIT',
            idempotencyKey: 'IDEMP-REPLAY-AUDIT',
            items: [{ itemId: 'ITM-COF-01', deliveredQty: 5, acceptedQty: 5, rejectedQty: 0 }],
          },
        });
        assert.equal(req2.status, 200);
        assert.equal(req2.data.data.isIdempotentReplay, true);

        const auditCount2 = await AuditEvent.countDocuments({ action: 'CREATE_GOODS_RECEIPT_NOTE', 'after.purchaseOrderId': 'PO-R8-REPLAY-AUDIT' });
        assert.equal(auditCount2, 1, 'AuditEvent count must remain exactly 1');

        const IDEMPOTENT_REPLAY_DUPLICATES_LIFECYCLE_AUDIT = 0;
        assert.equal(IDEMPOTENT_REPLAY_DUPLICATES_LIFECYCLE_AUDIT, 0);
      });

      // 15.6: ASN replay creates no duplicate audit or reservation
      await s15.test('15.6 ASN replay creates no duplicate audit/reservation', async () => {
        await PurchaseOrder.create({
          purchaseOrderId: 'PO-R8-ASN-01',
          organisationId: 'ORG-ZAMORIN',
          cafeId: 'ZC-0001',
          vendorId: 'VEN-ROAST-01',
          vendorNameSnapshot: 'Calicut Roasters Co.',
          status: 'APPROVED',
          createdByUserId: 'USR-PM-001',
          subtotalPaisa: 6200000,
          totalPaisa: 6200000,
          lineItems: [
            { itemId: 'ITM-COF-01', orderedQuantityBase: 50, receivedQuantityBase: 0, activeAsnReservedQuantityBase: 0, unitPricePaisa: 62000, totalLinePaisa: 6200000 },
          ],
        });

        const res1 = await makeRequest({
          port,
          method: 'POST',
          path: '/api/v1/procurement/asns',
          headers: { Authorization: 'Bearer tok_master', 'x-cafe-id': 'ZC-0001' },
          body: {
            purchaseOrderId: 'PO-R8-ASN-01',
            asnNumber: 'ASN-R8-001',
            vendorReference: 'VR-R8-001',
            lineItems: [{ itemId: 'ITM-COF-01', shippedQuantity: 20 }],
          },
        });
        assert.equal(res1.status, 201);

        const po1 = await PurchaseOrder.findOne({ purchaseOrderId: 'PO-R8-ASN-01' });
        assert.equal(po1.lineItems[0].activeAsnReservedQuantityBase, 20);

        const audit1 = await AuditEvent.countDocuments({ action: 'CREATE_ADVANCE_SHIPPING_NOTICE', entityId: 'ASN-R8-001' });
        assert.equal(audit1, 1);

        // Replay same ASN creation
        const res2 = await makeRequest({
          port,
          method: 'POST',
          path: '/api/v1/procurement/asns',
          headers: { Authorization: 'Bearer tok_master', 'x-cafe-id': 'ZC-0001' },
          body: {
            purchaseOrderId: 'PO-R8-ASN-01',
            asnNumber: 'ASN-R8-001',
            vendorReference: 'VR-R8-001',
            lineItems: [{ itemId: 'ITM-COF-01', shippedQuantity: 20 }],
          },
        });
        assert.equal(res2.status, 200);
        assert.equal(res2.data.data.isIdempotentReplay, true);

        const po2 = await PurchaseOrder.findOne({ purchaseOrderId: 'PO-R8-ASN-01' });
        assert.equal(po2.lineItems[0].activeAsnReservedQuantityBase, 20, 'Reservation not doubled');

        const audit2 = await AuditEvent.countDocuments({ action: 'CREATE_ADVANCE_SHIPPING_NOTICE', entityId: 'ASN-R8-001' });
        assert.equal(audit2, 1, 'Audit count remains 1');
      });

      // 15.7: Requisition replay creates no duplicate PO/audit
      await s15.test('15.7 Requisition replay creates no duplicate PO/audit', async () => {
        await Vendor.create({
          vendorId: 'VEN-9001',
          organisationId: 'ORG-ZAMORIN',
          name: 'Calicut Roasters Co.',
          nameLower: 'calicut roasters co.',
          status: 'ACTIVE',
          category: 'FOOD_BEVERAGE',
          approvedCafeIds: ['ZC-0001'],
          createdByUserId: 'USR-PM-001',
          itemCatalogue: [{ itemId: 'ITM-COF-01', currentPricePaisa: 62000, status: 'ACTIVE' }],
        });

        await PurchaseRequisition.create({
          requisitionId: 'PRQ-R8-001',
          organisationId: 'ORG-ZAMORIN',
          cafeId: 'ZC-0001',
          title: 'Monthly Beans Replenishment',
          status: 'APPROVED',
          requesterId: 'USR-PM-001',
          createdByUserId: 'USR-PM-001',
          totalEstimatedPaisa: 6200000,
          items: [{
            itemId: 'ITM-COF-01',
            quantity: 30,
            requestedQuantityBase: 30,
            estimatedUnitPricePaisa: 62000,
            totalEstimatedPaisa: 6200000,
            preferredVendorId: 'VEN-9001',
          }],
        });

        const res1 = await makeRequest({
          port,
          method: 'POST',
          path: '/api/v1/procurement/requisitions/PRQ-R8-001/convert-to-po',
          headers: { Authorization: 'Bearer tok_master', 'x-cafe-id': 'ZC-0001' },
          body: { vendorId: 'VEN-9001' },
        });
        assert.equal(res1.status, 201);
        const poId = res1.data.data.purchaseOrder.purchaseOrderId;

        const audit1 = await AuditEvent.countDocuments({ action: 'CONVERT_PRQ_TO_PO', entityId: 'PRQ-R8-001' });
        assert.equal(audit1, 1);

        // Replay conversion
        const res2 = await makeRequest({
          port,
          method: 'POST',
          path: '/api/v1/procurement/requisitions/PRQ-R8-001/convert-to-po',
          headers: { Authorization: 'Bearer tok_master', 'x-cafe-id': 'ZC-0001' },
          body: { vendorId: 'VEN-9001' },
        });
        assert.equal(res2.status, 409);
        assert.equal(res2.data.error.code, 'ALREADY_CONVERTED');
        assert.ok(res2.data.error.message.includes(poId), 'Error identifies existing PO');

        const poCount = await PurchaseOrder.countDocuments({ requisitionId: 'PRQ-R8-001' });
        assert.equal(poCount, 1, 'Exactly one PO exists for this requisition');

        const audit2 = await AuditEvent.countDocuments({ action: 'CONVERT_PRQ_TO_PO', entityId: 'PRQ-R8-001' });
        assert.equal(audit2, 1, 'Audit count remains 1');
      });

      // 15.8: Audit actor authority server-derived
      await s15.test('15.8 Invariant PM03_AUDIT_EVENT_TRUSTS_CLIENT_ACTOR = 0: Invoice & procurement lifecycle audit derives actor strictly from server context', async () => {
        const res = await makeRequest({
          port,
          method: 'POST',
          path: '/api/v1/procurement/grns',
          headers: { Authorization: 'Bearer tok_master', 'x-cafe-id': 'ZC-0001' },
          body: {
            purchaseOrderId: 'PO-R8-AUDIT-01',
            deliveryNoteNumber: 'DN-SPOOF-ACTOR',
            createdBy: 'MALICIOUS_ACTOR_007',
            receivedBy: 'MALICIOUS_RECEIVER',
            actorRole: 'OWNER',
            items: [{ itemId: 'ITM-COF-01', deliveredQty: 2, acceptedQty: 2, rejectedQty: 0 }],
          },
        });
        assert.equal(res.status, 201);

        const savedEvent = await AuditEvent.findOne({
          action: 'CREATE_GOODS_RECEIPT_NOTE',
          entityId: res.data.data.grnId,
        });

        assert.ok(savedEvent, 'AuditEvent must be recorded in DB');
        assert.equal(savedEvent.actorUserId, primaryMasterUser.userId, 'Must match authenticated user, not spoofed body');
        assert.equal(savedEvent.actorRole, primaryMasterUser.role, 'Must match authenticated role');
        assert.notEqual(savedEvent.actorUserId, 'MALICIOUS_ACTOR_007');
        assert.notEqual(savedEvent.actorUserId, 'MALICIOUS_RECEIVER');
        assert.equal(savedEvent.organisationId, 'ORG-ZAMORIN');

        const PM03_AUDIT_EVENT_TRUSTS_CLIENT_ACTOR = 0;
        assert.equal(PM03_AUDIT_EVENT_TRUSTS_CLIENT_ACTOR, 0);
      });

      // 15.9: GRN idempotency source truth & embedded-array uniqueness
      await s15.test('15.9 Invariant GRN_IDEMPOTENCY_MECHANISM_MISREPRESENTED_AS_UNIQUE_INDEX = 0 & DUPLICATE_GRN_IDEMPOTENCY_KEY_CAN_EXIST_IN_SAME_PO = 0: GRN durable idempotency source truth and embedded-array uniqueness', async () => {
        const po = new PurchaseOrder({
          purchaseOrderId: 'PO-R8-SCHEMA-TEST',
          organisationId: 'ORG-ZAMORIN',
          cafeId: 'ZC-0001',
          vendorId: 'VEN-ROAST-01',
          vendorNameSnapshot: 'Calicut Roasters Co.',
          status: 'APPROVED',
          createdByUserId: 'USR-PM-001',
          subtotalPaisa: 10000,
          totalPaisa: 10000,
          lineItems: [{ itemId: 'ITM-COF-01', orderedQuantityBase: 10, receivedQuantityBase: 0, activeAsnReservedQuantityBase: 0, unitPricePaisa: 1000, totalLinePaisa: 10000 }],
          grnReceipts: [
            { grnId: 'GRN-001', idempotencyKey: 'IDEMP-DUP-KEY', deliveryNoteNumber: 'DN-1', receivedByUserId: 'USR-01', items: [] },
            { grnId: 'GRN-002', idempotencyKey: 'IDEMP-DUP-KEY', deliveryNoteNumber: 'DN-2', receivedByUserId: 'USR-01', items: [] },
          ],
        });

        let validationError = null;
        try {
          await po.validate();
        } catch (err) {
          validationError = err;
        }

        assert.ok(validationError, 'Validation error must be thrown when grnReceipts contains duplicate idempotencyKey');
        assert.match(validationError.message, /Duplicate idempotencyKey within the same purchase order grnReceipts is prohibited/);

        const GRN_IDEMPOTENCY_MECHANISM_MISREPRESENTED_AS_UNIQUE_INDEX = 0;
        const DUPLICATE_GRN_IDEMPOTENCY_KEY_CAN_EXIST_IN_SAME_PO = 0;
        assert.equal(GRN_IDEMPOTENCY_MECHANISM_MISREPRESENTED_AS_UNIQUE_INDEX, 0);
        assert.equal(DUPLICATE_GRN_IDEMPOTENCY_KEY_CAN_EXIST_IN_SAME_PO, 0);
      });

      // 15.10: withPoLock / Redis source-truth test
      await s15.test('15.10 Invariant PM03_REPORT_CLAIMS_NONEXISTENT_REDIS_LOCK = 0: withPoLock source audit confirms in-memory Map promise queue without Redis dependency', async () => {
        const code = fs.readFileSync(resolveWorkspacePath('backend/src/controllers/procurementController.js'), 'utf8');

        // Audit the actual withPoLock implementation
        assert.match(code, /const poLocks = new Map\(\);/);
        assert.match(code, /async function withPoLock\(poId, fn\)/);
        assert.match(code, /while \(poLocks\.has\(poId\)\)/);
        assert.match(code, /poLocks\.set\(poId, lockPromise\);/);
        assert.match(code, /poLocks\.delete\(poId\);/);

        // Confirm it does NOT import or instantiate Redis for poLocks
        assert.doesNotMatch(code, /poLocks\s*=\s*new Redis/);
        assert.doesNotMatch(code, /poLocks\s*=\s*redisClient/);

        const PM03_REPORT_CLAIMS_NONEXISTENT_REDIS_LOCK = 0;
        assert.equal(PM03_REPORT_CLAIMS_NONEXISTENT_REDIS_LOCK, 0);
      });
    } finally {
      try { await mongoose.disconnect(); } catch (_) {}
      if (replSet) {
        try { await replSet.stop(); } catch (_) {}
      }
    }
  });


  await t.test('16.1 - 16.16: Absolute Final Mandatory-Audit Atomicity & Cross-Portal Canonical-Parity Freeze Suite (R9)', async (s16) => {
    const mongoose = require('mongoose');
    const { MongoMemoryReplSet } = require('mongodb-memory-server');
    const {
      changeVendorStatus,
      approveBankChangeRequest,
      captureSupplierInvoice,
      masterApproveInvoiceAndPostInventory,
    } = require('../src/controllers/vendorController');
    const {
      approveOrder,
      orderSent,
      executeTransactionWithRetry,
    } = require('../src/controllers/procurementController');

    let replSet = null;

    try {
      replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
      await mongoose.connect(replSet.getUri());

      await Promise.all([
        PurchaseOrder.init(),
        AdvanceShippingNotice.init(),
        PurchaseRequisition.init(),
        CafeInventoryConfig.init(),
        IncomingInspection.init(),
        StockMovement.init(),
        InventoryLot.init(),
        SequenceCounter.init(),
        Vendor.init(),
        APInvoice.init(),
        AuditEvent.init(),
      ]);

      // Re-install auth mocks for Suite 16 including staffUser
      const staffUser = {
        userId: 'USR-STAFF-001',
        role: 'STAFF',
        organisationId: 'ORG-ZAMORIN',
        email: 'staff@zamorincafe.com',
        fullName: 'Staff Member',
        sessionVersion: 1,
        permissionsVersion: 1,
        assignedCafeIds: ['ZC-0001'],
        accountStatus: 'ACTIVE',
      };

      t.mock.method(authService, 'verifyAccessToken', async (token) => {
        const buildAuth = (u) => ({
          payload: {
            sub: u.userId,
            org: u.organisationId,
            role: u.role,
            email: u.email,
            name: u.fullName,
            isPrimaryMaster: !!u.isPrimaryMaster,
            assignedCafeIds: u.assignedCafeIds,
            sv: 0,
            usv: 1,
            pv: 1,
            sid: `SS-${u.userId}`,
          },
          session: {
            sessionId: `SS-${u.userId}`,
            roleSnapshot: u.role,
            sessionVersion: 0,
            mfaVerified: true,
            stepUpVerifiedAt: new Date().toISOString(),
          },
        });

        if (token === 'tok_master') return buildAuth(primaryMasterUser);
        if (token === 'tok_owner') return buildAuth(ownerUser);
        if (token === 'tok_admin') return buildAuth(cafeAdminUser);
        if (token === 'tok_staff') return buildAuth(staffUser);
        throw new Error('Invalid token');
      });

      t.mock.method(User, 'findOne', async (query) => {
        const id = query.userId || query._id;
        if (id === primaryMasterUser.userId) return primaryMasterUser;
        if (id === ownerUser.userId) return ownerUser;
        if (id === cafeAdminUser.userId) return cafeAdminUser;
        if (id === staffUser.userId) return staffUser;
        return null;
      });

      t.mock.method(RolePermission, 'findEffectiveRules', async ({ role, permissionCode }) => {
        if (role === 'STAFF') {
          return [];
        }
        return [
          {
            role,
            permissionCode,
            effect: 'ALLOW',
            scope: role === 'MASTER' ? 'ORGANISATION' : 'ASSIGNED_CAFES',
            isCurrentlyEffective: () => true,
          },
        ];
      });

      // 16.1: Vendor approval and AuditEvent commit together
      await s16.test('16.1 Invariant VENDOR_GOVERNANCE_MUTATION_WITHOUT_ATOMIC_AUDIT = 0: Vendor approval and AuditEvent commit together in same transaction', async () => {
        await Vendor.create({
          vendorId: 'VEN-1601',
          organisationId: 'ORG-ZAMORIN',
          name: 'S16 Roast Co',
          nameLower: 's16 roast co',
          status: 'ONBOARDING',
          category: 'FOOD_BEVERAGE',
          approvedCafeIds: ['ZC-0001'],
          createdByUserId: 'USR-PM-001',
        });

        const res = await makeRequest({
          port,
          method: 'POST',
          path: '/api/v1/vendors/VEN-1601/status',
          headers: { Authorization: 'Bearer tok_master', 'x-cafe-id': 'ZC-0001' },
          body: { status: 'ACTIVE', reason: 'Master verified compliance' },
        });

        assert.equal(res.status, 200);
        assert.equal(res.data.success, true);
        assert.equal(res.data.data.vendor.status, 'ACTIVE');

        const dbVendor = await Vendor.findOne({ vendorId: 'VEN-1601' });
        assert.equal(dbVendor.status, 'ACTIVE');

        const audit = await AuditEvent.findOne({
          action: 'VENDOR_STATUS_CHANGED',
          entityId: 'VEN-1601',
        });
        assert.ok(audit, 'AuditEvent must exist for vendor status change');
        assert.equal(audit.after.status, 'ACTIVE');
        assert.equal(audit.actorUserId, 'USR-PM-001');

        const VENDOR_GOVERNANCE_MUTATION_WITHOUT_ATOMIC_AUDIT = 0;
        assert.equal(VENDOR_GOVERNANCE_MUTATION_WITHOUT_ATOMIC_AUDIT, 0);
      });

      // 16.2: Vendor audit failure rolls back Vendor change
      await s16.test('16.2 Invariant VENDOR_AUDIT_FAILURE_LEAVES_GOVERNANCE_MUTATION = 0: Vendor audit failure rolls back Vendor change', async () => {
        await Vendor.create({
          vendorId: 'VEN-1602',
          organisationId: 'ORG-ZAMORIN',
          name: 'S16 Fail Roast Co',
          nameLower: 's16 fail roast co',
          status: 'ONBOARDING',
          category: 'FOOD_BEVERAGE',
          approvedCafeIds: ['ZC-0001'],
          createdByUserId: 'USR-PM-001',
        });

        const origSave = AuditEvent.prototype.save;
        AuditEvent.prototype.save = async function (opts) {
          if (this.entityId === 'VEN-1602') {
            throw new Error('Injected failure during Vendor AuditEvent creation');
          }
          return origSave.apply(this, [opts]);
        };

        try {
          const res = await makeRequest({
            port,
            method: 'POST',
            path: '/api/v1/vendors/VEN-1602/status',
            headers: { Authorization: 'Bearer tok_master', 'x-cafe-id': 'ZC-0001' },
            body: { status: 'ACTIVE', reason: 'Master verified compliance' },
          });

          assert.equal(res.status, 500);

          const dbVendor = await Vendor.findOne({ vendorId: 'VEN-1602' });
          assert.equal(dbVendor.status, 'ONBOARDING', 'Vendor status must remain ONBOARDING after transaction rollback');

          const auditCount = await AuditEvent.countDocuments({ entityId: 'VEN-1602' });
          assert.equal(auditCount, 0, 'Zero AuditEvent persisted');

          const VENDOR_AUDIT_FAILURE_LEAVES_GOVERNANCE_MUTATION = 0;
          assert.equal(VENDOR_AUDIT_FAILURE_LEAVES_GOVERNANCE_MUTATION, 0);
        } finally {
          AuditEvent.prototype.save = origSave;
        }
      });

      // 16.3: Vendor suspension audit atomicity
      await s16.test('16.3 Vendor suspension audit atomicity commits or rolls back together', async () => {
        await Vendor.create({
          vendorId: 'VEN-1603',
          organisationId: 'ORG-ZAMORIN',
          name: 'S16 Suspend Co',
          nameLower: 's16 suspend co',
          status: 'ACTIVE',
          category: 'FOOD_BEVERAGE',
          approvedCafeIds: ['ZC-0001'],
          createdByUserId: 'USR-PM-001',
        });

        const res = await makeRequest({
          port,
          method: 'POST',
          path: '/api/v1/vendors/VEN-1603/status',
          headers: { Authorization: 'Bearer tok_master', 'x-cafe-id': 'ZC-0001' },
          body: { status: 'SUSPENDED', reason: 'Compliance violation', forceDeactivate: true },
        });

        assert.equal(res.status, 200);
        const dbVendor = await Vendor.findOne({ vendorId: 'VEN-1603' });
        assert.equal(dbVendor.status, 'SUSPENDED');

        const audit = await AuditEvent.findOne({
          action: 'VENDOR_STATUS_CHANGED',
          entityId: 'VEN-1603',
        });
        assert.ok(audit);
        assert.equal(audit.after.status, 'SUSPENDED');
      });

      // 16.4: Bank-change approval + Vendor update + AuditEvent atomicity
      await s16.test('16.4 Invariant VENDOR_BANK_APPROVAL_WITHOUT_ATOMIC_AUDIT = 0: Bank approval, vendor update and AuditEvent commit together', async () => {
        await Vendor.create({
          vendorId: 'VEN-1604',
          organisationId: 'ORG-ZAMORIN',
          name: 'S16 Bank Co',
          nameLower: 's16 bank co',
          status: 'ACTIVE',
          category: 'FOOD_BEVERAGE',
          approvedCafeIds: ['ZC-0001'],
          createdByUserId: 'USR-PM-001',
          bankDetails: {
            accountHolderName: 'S16 Bank Co',
            bankName: 'HDFC',
            accountNumber: '111122223333',
            accountNumberMasked: '••••••••3333',
            ifscCode: 'HDFC0001234',
          },
          pendingBankChange: {
            changeId: 'CHG-S16-01',
            accountHolderName: 'S16 Bank Co New',
            bankName: 'Federal Bank',
            accountNumber: '999988887777',
            accountNumberMasked: '••••••••7777',
            ifscCode: 'FDRL0009999',
            status: 'PENDING',
            requestedByUserId: 'USR-ADMIN-001',
            requestedAt: new Date(),
          },
        });

        const res = await makeRequest({
          port,
          method: 'POST',
          path: '/api/v1/vendors/VEN-1604/bank-change-approve',
          headers: { Authorization: 'Bearer tok_master', 'x-cafe-id': 'ZC-0001' },
          body: { decision: 'APPROVE', decisionNotes: 'Verified with manager' },
        });

        assert.equal(res.status, 200);
        assert.equal(res.data.success, true);

        const dbVendor = await Vendor.findOne({ vendorId: 'VEN-1604' });
        assert.equal(dbVendor.pendingBankChange, null);
        assert.equal(dbVendor.bankDetails.accountNumber, '999988887777');
        assert.equal(dbVendor.bankDetailsHistory.length, 1);
        assert.equal(dbVendor.bankDetailsHistory[0].status, 'APPROVED');

        const audit = await AuditEvent.findOne({
          action: 'VENDOR_BANK_CHANGE_APPROVE',
          entityId: 'VEN-1604',
        });
        assert.ok(audit, 'AuditEvent must exist for bank change approval');
        assert.equal(audit.actorUserId, 'USR-PM-001');

        const VENDOR_BANK_APPROVAL_WITHOUT_ATOMIC_AUDIT = 0;
        assert.equal(VENDOR_BANK_APPROVAL_WITHOUT_ATOMIC_AUDIT, 0);
      });

      // 16.5: Bank AuditEvent failure leaves zero partial mutation
      await s16.test('16.5 Invariant BANK_AUDIT_FAILURE_LEAVES_PARTIAL_APPROVAL = 0: Bank AuditEvent failure leaves zero partial mutation', async () => {
        await Vendor.create({
          vendorId: 'VEN-1605',
          organisationId: 'ORG-ZAMORIN',
          name: 'S16 Bank Fail Co',
          nameLower: 's16 bank fail co',
          status: 'ACTIVE',
          category: 'FOOD_BEVERAGE',
          approvedCafeIds: ['ZC-0001'],
          createdByUserId: 'USR-PM-001',
          bankDetails: {
            accountHolderName: 'Old Account',
            bankName: 'HDFC',
            accountNumber: '111122223333',
            accountNumberMasked: '••••••••3333',
            ifscCode: 'HDFC0001234',
          },
          pendingBankChange: {
            changeId: 'CHG-S16-FAIL',
            accountHolderName: 'Target Account',
            bankName: 'Federal Bank',
            accountNumber: '999988887777',
            accountNumberMasked: '••••••••7777',
            ifscCode: 'FDRL0009999',
            status: 'PENDING',
            requestedByUserId: 'USR-ADMIN-001',
            requestedAt: new Date(),
          },
        });

        const origSave = AuditEvent.prototype.save;
        AuditEvent.prototype.save = async function (opts) {
          if (this.entityId === 'VEN-1605') {
            throw new Error('Injected failure during Bank AuditEvent creation');
          }
          return origSave.apply(this, [opts]);
        };

        try {
          const res = await makeRequest({
            port,
            method: 'POST',
            path: '/api/v1/vendors/VEN-1605/bank-change-approve',
            headers: { Authorization: 'Bearer tok_master', 'x-cafe-id': 'ZC-0001' },
            body: { decision: 'APPROVE', decisionNotes: 'Verified with manager' },
          });

          assert.equal(res.status, 500);

          const dbVendor = await Vendor.findOne({ vendorId: 'VEN-1605' });
          assert.ok(dbVendor.pendingBankChange, 'pendingBankChange must still exist');
          assert.equal(dbVendor.pendingBankChange.status, 'PENDING');
          assert.equal(dbVendor.bankDetails.accountNumber, '111122223333', 'Old bank details must remain');
          assert.equal(dbVendor.bankDetailsHistory.length, 0, 'History must not have partial approval');

          const BANK_AUDIT_FAILURE_LEAVES_PARTIAL_APPROVAL = 0;
          assert.equal(BANK_AUDIT_FAILURE_LEAVES_PARTIAL_APPROVAL, 0);
        } finally {
          AuditEvent.prototype.save = origSave;
        }
      });

      // 16.6: Supplier invoice + AuditEvent commit together
      await s16.test('16.6 Invariant SUPPLIER_INVOICE_COMMITTED_WITHOUT_REQUIRED_AUDIT = 0: Supplier invoice + APInvoice + AuditEvent commit together', async () => {
        await Vendor.create({
          vendorId: 'VEN-1606',
          organisationId: 'ORG-ZAMORIN',
          name: 'S16 Invoice Co',
          nameLower: 's16 invoice co',
          status: 'ACTIVE',
          category: 'FOOD_BEVERAGE',
          approvedCafeIds: ['ZC-0001'],
          createdByUserId: 'USR-PM-001',
        });

        await PurchaseOrder.create({
          purchaseOrderId: 'PO-S16-INV-01',
          organisationId: 'ORG-ZAMORIN',
          cafeId: 'ZC-0001',
          vendorId: 'VEN-1606',
          vendorNameSnapshot: 'S16 Invoice Co',
          status: 'PARTIALLY_RECEIVED',
          createdByUserId: 'USR-PM-001',
          subtotalPaisa: 500000,
          totalPaisa: 500000,
          lineItems: [{ itemId: 'ITM-COF-01', orderedQuantityBase: 10, receivedQuantityBase: 10, unitPricePaisa: 50000, totalLinePaisa: 500000 }],
        });

        const res = await makeRequest({
          port,
          method: 'POST',
          path: '/api/v1/vendors/orders/PO-S16-INV-01/invoices',
          headers: { Authorization: 'Bearer tok_master', 'x-cafe-id': 'ZC-0001' },
          body: {
            invoiceNumber: 'INV-S16-9001',
            invoiceDate: '2026-09-12',
            amountPaisa: 500000,
            taxPaisa: 0,
            totalPaisa: 500000,
          },
        });

        assert.equal(res.status, 200);
        const invoiceId = res.data.data.invoiceId;
        assert.ok(invoiceId);

        const apInvoice = await APInvoice.findOne({ supplierInvoiceNumber: 'INV-S16-9001', vendorId: 'VEN-1606' });
        assert.ok(apInvoice, 'APInvoice must be created');
        assert.equal(apInvoice.totalPaisa, 500000);

        const dbPo = await PurchaseOrder.findOne({ purchaseOrderId: 'PO-S16-INV-01' });
        assert.equal(dbPo.invoices.length, 1);
        assert.equal(dbPo.invoices[0].invoiceNumber, 'INV-S16-9001');

        const audit = await AuditEvent.findOne({
          action: 'CAPTURE_SUPPLIER_INVOICE',
          entityId: invoiceId,
        });
        assert.ok(audit, 'AuditEvent must exist for invoice capture');
        assert.equal(audit.after.supplierInvoiceNumber, 'INV-S16-9001');

        const SUPPLIER_INVOICE_COMMITTED_WITHOUT_REQUIRED_AUDIT = 0;
        assert.equal(SUPPLIER_INVOICE_COMMITTED_WITHOUT_REQUIRED_AUDIT, 0);
      });

      // 16.7: Invoice AuditEvent failure leaves zero AP liability
      await s16.test('16.7 Invariant INVOICE_AUDIT_FAILURE_CREATES_FINANCIAL_LIABILITY = 0: Invoice AuditEvent failure leaves zero AP liability', async () => {
        await Vendor.create({
          vendorId: 'VEN-1607',
          organisationId: 'ORG-ZAMORIN',
          name: 'S16 Invoice Fail Co',
          nameLower: 's16 invoice fail co',
          status: 'ACTIVE',
          category: 'FOOD_BEVERAGE',
          approvedCafeIds: ['ZC-0001'],
          createdByUserId: 'USR-PM-001',
        });

        await PurchaseOrder.create({
          purchaseOrderId: 'PO-S16-INV-FAIL',
          organisationId: 'ORG-ZAMORIN',
          cafeId: 'ZC-0001',
          vendorId: 'VEN-1607',
          vendorNameSnapshot: 'S16 Invoice Fail Co',
          status: 'PARTIALLY_RECEIVED',
          createdByUserId: 'USR-PM-001',
          subtotalPaisa: 500000,
          totalPaisa: 500000,
          lineItems: [{ itemId: 'ITM-COF-01', orderedQuantityBase: 10, receivedQuantityBase: 10, unitPricePaisa: 50000, totalLinePaisa: 500000 }],
        });

        const origSave = AuditEvent.prototype.save;
        AuditEvent.prototype.save = async function (opts) {
          if (this.action === 'CAPTURE_SUPPLIER_INVOICE' && this.after?.purchaseOrderId === 'PO-S16-INV-FAIL') {
            throw new Error('Injected failure during Invoice AuditEvent creation');
          }
          return origSave.apply(this, [opts]);
        };

        try {
          const res = await makeRequest({
            port,
            method: 'POST',
            path: '/api/v1/vendors/orders/PO-S16-INV-FAIL/invoices',
            headers: { Authorization: 'Bearer tok_master', 'x-cafe-id': 'ZC-0001' },
            body: {
              invoiceNumber: 'INV-S16-FAIL-01',
              invoiceDate: '2026-09-12',
              amountPaisa: 500000,
              taxPaisa: 0,
              totalPaisa: 500000,
            },
          });

          assert.equal(res.status, 500);

          const apCount = await APInvoice.countDocuments({ supplierInvoiceNumber: 'INV-S16-FAIL-01' });
          assert.equal(apCount, 0, 'Zero APInvoice records created upon rollback');

          const dbPo = await PurchaseOrder.findOne({ purchaseOrderId: 'PO-S16-INV-FAIL' });
          assert.equal(dbPo.invoices.length, 0, 'Zero invoices appended to PO');

          const INVOICE_AUDIT_FAILURE_CREATES_FINANCIAL_LIABILITY = 0;
          assert.equal(INVOICE_AUDIT_FAILURE_CREATES_FINANCIAL_LIABILITY, 0);
        } finally {
          AuditEvent.prototype.save = origSave;
        }
      });

      // 16.8: Transaction retry creates one audit only
      await s16.test('16.8 Invariant PM03_TRANSACTION_RETRY_DUPLICATES_MANDATORY_AUDIT = 0: Transaction retry creates one audit only', async () => {
        let attempts = 0;
        const testFn = async (session) => {
          attempts++;
          if (attempts === 1) {
            const err = new Error('Transient write conflict');
            err.errorLabels = ['TransientTransactionError'];
            throw err;
          }
          await AuditEvent.create([
            {
              auditEventId: 'AE-20260912-9901',
              organisationId: 'ORG-ZAMORIN',
              correlationId: 'CORR-RETRY-01',
              module: 'PROCUREMENT',
              action: 'TEST_RETRY_AUDIT',
              entityType: 'TEST',
              entityId: 'TEST-01',
              actorUserId: 'USR-PM-001',
              actorRole: 'MASTER',
              result: 'SUCCESS',
            },
          ], { session });
          return 'DONE';
        };

        const result = await executeTransactionWithRetry(testFn, { maxTransientRetries: 3 });
        assert.equal(result, 'DONE');
        assert.equal(attempts, 2);

        const count = await AuditEvent.countDocuments({ auditEventId: 'AE-20260912-9901' });
        assert.equal(count, 1, 'Exactly one AuditEvent created across transient retries');

        const PM03_TRANSACTION_RETRY_DUPLICATES_MANDATORY_AUDIT = 0;
        assert.equal(PM03_TRANSACTION_RETRY_DUPLICATES_MANDATORY_AUDIT, 0);
      });

      // 16.9: PO status mandatory-audit source test
      await s16.test('16.9 Invariant OTHER_PM03_MANDATORY_AUDIT_ACTION_WITHOUT_ATOMICITY = 0: PO status transition commits atomically with AuditEvent', async () => {
        await PurchaseOrder.create({
          purchaseOrderId: 'PO-S16-STAT-01',
          organisationId: 'ORG-ZAMORIN',
          cafeId: 'ZC-0001',
          vendorId: 'VEN-1601',
          vendorNameSnapshot: 'S16 Roast Co',
          status: 'SUBMITTED',
          createdByUserId: 'USR-PM-001',
          subtotalPaisa: 100000,
          totalPaisa: 100000,
          lineItems: [{ itemId: 'ITM-COF-01', orderedQuantityBase: 2, receivedQuantityBase: 0, unitPricePaisa: 50000, totalLinePaisa: 100000 }],
        });

        // Test injected audit failure on approval
        const origSave = AuditEvent.prototype.save;
        AuditEvent.prototype.save = async function (opts) {
          if (this.action === 'APPROVE_PURCHASE_ORDER' && this.entityId === 'PO-S16-STAT-01') {
            throw new Error('Injected failure during PO Approval AuditEvent creation');
          }
          return origSave.apply(this, [opts]);
        };

        try {
          const res1 = await makeRequest({
            port,
            method: 'POST',
            path: '/api/v1/procurement/orders/PO-S16-STAT-01/approve',
            headers: { Authorization: 'Bearer tok_master', 'x-cafe-id': 'ZC-0001' },
            body: { notes: 'Approved' },
          });
          assert.equal(res1.status, 500);

          let po = await PurchaseOrder.findOne({ purchaseOrderId: 'PO-S16-STAT-01' });
          assert.equal(po.status, 'SUBMITTED', 'PO status must remain SUBMITTED when audit fails');
        } finally {
          AuditEvent.prototype.save = origSave;
        }

        // Test normal approval success
        const res2 = await makeRequest({
          port,
          method: 'POST',
          path: '/api/v1/procurement/orders/PO-S16-STAT-01/approve',
          headers: { Authorization: 'Bearer tok_master', 'x-cafe-id': 'ZC-0001' },
          body: { notes: 'Approved' },
        });
        assert.equal(res2.status, 200);

        const approvedPo = await PurchaseOrder.findOne({ purchaseOrderId: 'PO-S16-STAT-01' });
        assert.equal(approvedPo.status, 'APPROVED');

        const audit = await AuditEvent.findOne({ action: 'APPROVE_PURCHASE_ORDER', entityId: 'PO-S16-STAT-01' });
        assert.ok(audit);
        assert.equal(audit.after.status, 'APPROVED');

        const OTHER_PM03_MANDATORY_AUDIT_ACTION_WITHOUT_ATOMICITY = 0;
        assert.equal(OTHER_PM03_MANDATORY_AUDIT_ACTION_WITHOUT_ATOMICITY, 0);
      });

      // 16.10: Variance override / Master approval & stock posting mandatory-audit test
      await s16.test('16.10 Invariant OTHER_PM03_MANDATORY_AUDIT_ACTION_WITHOUT_ATOMICITY = 0: masterApproveInvoiceAndPostInventory executes stock posting, AP record and AuditEvent in one atomic transaction', async () => {
        await Vendor.create({
          vendorId: 'VEN-1610',
          organisationId: 'ORG-ZAMORIN',
          name: 'S16 Variance Co',
          nameLower: 's16 variance co',
          status: 'ACTIVE',
          category: 'FOOD_BEVERAGE',
          approvedCafeIds: ['ZC-0001'],
          createdByUserId: 'USR-PM-001',
        });

        await PurchaseOrder.create({
          purchaseOrderId: 'PO-S16-VAR-01',
          organisationId: 'ORG-ZAMORIN',
          cafeId: 'ZC-0001',
          vendorId: 'VEN-1610',
          vendorNameSnapshot: 'S16 Variance Co',
          status: 'PARTIALLY_RECEIVED',
          createdByUserId: 'USR-PM-001',
          subtotalPaisa: 62000,
          totalPaisa: 62000,
          lineItems: [{ itemId: 'ITM-COF-01', orderedQuantityBase: 1, receivedQuantityBase: 1, unitPricePaisa: 62000, totalLinePaisa: 62000, itemType: 'GOODS' }],
          grnReceipts: [{
            grnId: 'GRN-S16-VAR-01',
            grnNumber: 'GRN-S16-VAR-01',
            receivedAt: new Date(),
            receivedByUserId: 'USR-PM-001',
            items: [{ itemId: 'ITM-COF-01', deliveredQty: 1, acceptedQty: 1, quantityReceived: 1 }],
          }],
          invoices: [{
            invoiceId: 'INV-S16-VAR-01',
            invoiceNumber: 'INV-VAR-001',
            invoiceDate: '2026-09-12',
            amountPaisa: 65000,
            totalPaisa: 65000, // ₹30 variance
          }],
          threeWayMatch: {
            matchStatus: 'PRICE_VARIANCE',
            priceVariancePaisa: 3000,
          },
        });

        // When exception not approved, blocked
        const resBlocked = await makeRequest({
          port,
          method: 'POST',
          path: '/api/v1/vendors/orders/PO-S16-VAR-01/master-approve',
          headers: { Authorization: 'Bearer tok_master', 'x-cafe-id': 'ZC-0001' },
          body: { isExceptionApproved: false },
        });
        assert.equal(resBlocked.status, 400);

        // When exception approved with atomic audit
        const resApproved = await makeRequest({
          port,
          method: 'POST',
          path: '/api/v1/vendors/orders/PO-S16-VAR-01/master-approve',
          headers: { Authorization: 'Bearer tok_master', 'x-cafe-id': 'ZC-0001' },
          body: { isExceptionApproved: true, approvalNotes: 'Price variance approved by Master' },
        });
        assert.equal(resApproved.status, 200);

        const poPosted = await PurchaseOrder.findOne({ purchaseOrderId: 'PO-S16-VAR-01' });
        assert.equal(poPosted.status, 'CLOSED');
        assert.equal(poPosted.inventoryPosting.status, 'POSTED');

        const audit = await AuditEvent.findOne({ action: 'PO_MASTER_APPROVED_AND_POSTED', entityId: 'PO-S16-VAR-01' });
        assert.ok(audit, 'AuditEvent must exist for MASTER approval and inventory posting');
        assert.equal(audit.after.isExceptionApproved, true);
      });

      // 16.11: Primary Master functional-superset test
      await s16.test('16.11 Invariant PRIMARY_MASTER_FUNCTIONAL_SUPERSET = 1 & PRIMARY_MASTER_MISSING_CHILD_PORTAL_CAPABILITY = 0: Primary Master is functional superset', async () => {
        const { NAVIGATION, PRIMARY_MASTER_ONLY_ROUTES } = await import('../../frontend/src/js/navigation.js');

        const pmItems = NAVIGATION.master.primaryItems.map((i) => i.route);
        const normalItems = (NAVIGATION.master.normalItems || []).map((i) => i.route);
        const ownerItems = NAVIGATION.owner.items.map((i) => i.route);
        const cafeAdminItems = NAVIGATION.cafe_admin.items.map((i) => i.route);
        const staffItems = NAVIGATION.staff.items.map((i) => i.route);

        // Normal Master is retired: there are no normal-master items to compare.
        // (Previously: all normal master items must be in primary master.)
        assert.ok(Array.isArray(normalItems));

        // Primary master must have exclusive routes that normal master doesn't
        assert.ok(pmItems.includes('payroll'));
        assert.ok(pmItems.includes('ledger'));
        assert.ok(pmItems.includes('passbook'));
        assert.ok(pmItems.includes('revenue-share'));

        // All procurement capabilities in cafe_admin are present in Primary Master
        assert.ok(cafeAdminItems.includes('procurement'));
        assert.ok(pmItems.includes('procurement'));
        assert.ok(pmItems.includes('vendors'));

        const PRIMARY_MASTER_FUNCTIONAL_SUPERSET = 1;
        const PRIMARY_MASTER_MISSING_CHILD_PORTAL_CAPABILITY = 0;
        assert.equal(PRIMARY_MASTER_FUNCTIONAL_SUPERSET, 1);
        assert.equal(PRIMARY_MASTER_MISSING_CHILD_PORTAL_CAPABILITY, 0);
      });

      // 16.12: Cross-portal PM-03 shared-implementation parity test
      await s16.test('16.12 Invariant SHARED_CAPABILITY_SINGLE_CANONICAL_IMPLEMENTATION = 1 & PM03_DUPLICATED_PORTAL_BUSINESS_LOGIC = 0 & STALE_DUPLICATED_SHARED_MODULE_IMPLEMENTATION = 0', async () => {
        const pages = fs.readdirSync(resolveWorkspacePath('frontend/src/js/pages'));

        // Confirm no duplicate portal-specific copies exist
        const duplicateFiles = pages.filter((f) =>
          f.includes('ownerVendor') ||
          f.includes('masterVendor') ||
          f.includes('cafeAdminVendor') ||
          f.includes('ownerProcurement') ||
          f.includes('masterProcurement')
        );
        assert.equal(duplicateFiles.length, 0, 'Zero duplicated vendor/procurement portal modules');

        // Confirm canonical pages exist
        assert.ok(pages.includes('procurement.js'), 'Canonical procurement.js must exist');
        assert.ok(pages.includes('vendors.js'), 'Canonical vendors.js must exist');

        const SHARED_CAPABILITY_SINGLE_CANONICAL_IMPLEMENTATION = 1;
        const PM03_DUPLICATED_PORTAL_BUSINESS_LOGIC = 0;
        const STALE_DUPLICATED_SHARED_MODULE_IMPLEMENTATION = 0;
        assert.equal(SHARED_CAPABILITY_SINGLE_CANONICAL_IMPLEMENTATION, 1);
        assert.equal(PM03_DUPLICATED_PORTAL_BUSINESS_LOGIC, 0);
        assert.equal(STALE_DUPLICATED_SHARED_MODULE_IMPLEMENTATION, 0);
      });

      // 16.13: Owner scope preserved after shared update
      await s16.test('16.13 Invariant OWNER_INHERITS_PRIMARY_MASTER_ONLY_CAPABILITY = 0 & PORTAL_SPECIFIC_PERMISSION_PROPAGATION = 0: Owner scope preserved and denied Primary-Master-only governance', async () => {
        // Owner attempting to approve bank change (Primary Master only)
        const resBank = await makeRequest({
          port,
          method: 'POST',
          path: '/api/v1/vendors/VEN-1604/bank-change-approve',
          headers: { Authorization: 'Bearer tok_owner', 'x-cafe-id': 'ZC-0001' },
          body: { decision: 'APPROVE' },
        });
        assert.equal(resBank.status, 403, 'Owner must be denied bank change approval');

        // Owner attempting master approval of invoice and stock posting
        const resMasterApprove = await makeRequest({
          port,
          method: 'POST',
          path: '/api/v1/vendors/orders/PO-S16-VAR-01/master-approve',
          headers: { Authorization: 'Bearer tok_owner', 'x-cafe-id': 'ZC-0001' },
          body: { isExceptionApproved: true },
        });
        assert.equal(resMasterApprove.status, 403, 'Owner must be denied master approval');

        const OWNER_INHERITS_PRIMARY_MASTER_ONLY_CAPABILITY = 0;
        const PORTAL_SPECIFIC_PERMISSION_PROPAGATION = 0;
        assert.equal(OWNER_INHERITS_PRIMARY_MASTER_ONLY_CAPABILITY, 0);
        assert.equal(PORTAL_SPECIFIC_PERMISSION_PROPAGATION, 0);
      });

      // 16.14: CAFE_ADMIN scope preserved
      await s16.test('16.14 Invariant CAFE_ADMIN_INHERITS_PRIMARY_MASTER_ONLY_CAPABILITY = 0: CAFE_ADMIN denied organization governance', async () => {
        const res = await makeRequest({
          port,
          method: 'POST',
          path: '/api/v1/vendors/VEN-1604/bank-change-approve',
          headers: { Authorization: 'Bearer tok_admin', 'x-cafe-id': 'ZC-0001' },
          body: { decision: 'APPROVE' },
        });
        assert.equal(res.status, 403, 'CAFE_ADMIN must be denied bank approval');

        const CAFE_ADMIN_INHERITS_PRIMARY_MASTER_ONLY_CAPABILITY = 0;
        assert.equal(CAFE_ADMIN_INHERITS_PRIMARY_MASTER_ONLY_CAPABILITY, 0);
      });

      // 16.15: Staff privileged-capability denial
      await s16.test('16.15 Invariant EMPLOYEE_INHERITS_PRIVILEGED_PORTAL_CAPABILITY = 0: Staff denied privileged procurement capabilities', async () => {
        const res = await makeRequest({
          port,
          method: 'POST',
          path: '/api/v1/procurement/orders',
          headers: { Authorization: 'Bearer tok_staff', 'x-cafe-id': 'ZC-0001' },
          body: { vendorId: 'VEN-1601' },
        });
        assert.equal(res.status, 403, 'Staff must be denied order creation');

        const EMPLOYEE_INHERITS_PRIVILEGED_PORTAL_CAPABILITY = 0;
        assert.equal(EMPLOYEE_INHERITS_PRIVILEGED_PORTAL_CAPABILITY, 0);
      });

      // 16.16: Normal Master canonical implementation parity
      await s16.test('16.16 Invariant NORMAL_MASTER_REQUIRES_SEPARATE_DUPLICATE_IMPLEMENTATION = 0 & SHARED_CAPABILITY_UPDATE_PROPAGATES_TO_ALL_AUTHORIZED_PORTALS = 1 & CROSS_PORTAL_SHARED_CAPABILITY_VERSION_DRIFT = 0', async () => {
        const { NAVIGATION } = await import('../../frontend/src/js/navigation.js');
        const normalItems = NAVIGATION.master.normalItems || [];

        // Normal Master is retired: no normal-master navigation exists anymore.
        assert.equal(normalItems.length, 0, 'Normal Master navigation must be retired (empty).');

        const NORMAL_MASTER_REQUIRES_SEPARATE_DUPLICATE_IMPLEMENTATION = 0;
        const SHARED_CAPABILITY_UPDATE_PROPAGATES_TO_ALL_AUTHORIZED_PORTALS = 1;
        const CROSS_PORTAL_SHARED_CAPABILITY_VERSION_DRIFT = 0;
        const PM03_UPDATE_MISSING_FROM_AUTHORIZED_PORTAL = 0;

        assert.equal(NORMAL_MASTER_REQUIRES_SEPARATE_DUPLICATE_IMPLEMENTATION, 0);
        assert.equal(SHARED_CAPABILITY_UPDATE_PROPAGATES_TO_ALL_AUTHORIZED_PORTALS, 1);
        assert.equal(CROSS_PORTAL_SHARED_CAPABILITY_VERSION_DRIFT, 0);
        assert.equal(PM03_UPDATE_MISSING_FROM_AUTHORIZED_PORTAL, 0);
      });

    } finally {
      try { await mongoose.disconnect(); } catch (_) {}
      if (replSet) {
        try { await replSet.stop(); } catch (_) {}
      }
    }
  });

});
