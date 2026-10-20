'use strict';

require('dotenv').config({
  quiet: true,
});

const crypto = require('crypto');

const {
  connectDatabase,
  disconnectDatabase,
} = require('../config/database');

const {
  loadEnvironment,
} = require('../config/environment');

const {
  User,
} = require('../models/User');

const {
  RolePermission,
} = require('../models/RolePermission');

const {
  SequenceCounter,
} = require('../models/SequenceCounter');

const {
  hashPassword,
} = require('../services/authService');

function requireEnvironmentValue(name) {
  const value = process.env[name];

  if (!value || !value.trim()) {
    throw new Error(
      `${name} is required.`
    );
  }

  return value.trim();
}

function normalizeIdentifier(value) {
  return value
    .trim()
    .toUpperCase();
}

function normalizeEmail(value) {
  return value
    .trim()
    .toLowerCase();
}

const DEFAULT_PERMISSION_RULES = [
  {
    role: 'MASTER',
    permissionCode: 'CAFE:MANAGE',
    module: 'CAFE',
    resource: 'CAFE',
    action: 'MANAGE',
    effect: 'ALLOW',
    scope: 'ORGANISATION',
    requiresMfa: true,
    description:
      'MASTER may manage cafÃ©s across the organisation.',
  },
  {
    role: 'MASTER',
    permissionCode: 'USER:MANAGE',
    module: 'USER',
    resource: 'USER',
    action: 'MANAGE',
    effect: 'ALLOW',
    scope: 'ORGANISATION',
    requiresMfa: true,
    requiresStepUpAuthentication: true,
    requiresReason: true,
    requiresAuditEvent: true,
    requiresReauthentication: false,
    description:
      'MASTER may manage organisation users.',
  },
  {
    role: 'MASTER',
    permissionCode: 'EMPLOYEE:READ',
    module: 'EMPLOYEE',
    resource: 'EMPLOYEE',
    action: 'READ',
    effect: 'ALLOW',
    scope: 'ORGANISATION',
    requiresMfa: true,
    requiresAuditEvent: false,
    description:
      'MASTER may read organisation employee records.',
  },
  {
    role: 'MASTER',
    permissionCode: 'AUDIT:READ',
    module: 'AUDIT',
    resource: 'AUDIT_EVENT',
    action: 'READ',
    effect: 'ALLOW',
    scope: 'ORGANISATION',
    requiresMfa: true,
    description:
      'MASTER may read organisation audit events.',
  },
  {
    role: 'MASTER',
    permissionCode: 'PERSONAL_LEDGER_READ',
    module: 'PERSONAL_LEDGER',
    resource: 'PERSONAL_LEDGER_ENTRY',
    action: 'READ',
    effect: 'ALLOW',
    scope: 'ORGANISATION',
    requiresMfa: true,
    requiresAuditEvent: false,
    description: 'MASTER may read their own Personal Ledger.',
  },
  {
    role: 'MASTER',
    permissionCode: 'PERSONAL_LEDGER_WRITE',
    module: 'PERSONAL_LEDGER',
    resource: 'PERSONAL_LEDGER_ENTRY',
    action: 'WRITE',
    effect: 'ALLOW',
    scope: 'ORGANISATION',
    requiresMfa: true,
    requiresReason: true,
    requiresAuditEvent: true,
    description: 'MASTER may write to their own Personal Ledger.',
  },
  {
    role: 'OWNER',
    permissionCode: 'PERSONAL_LEDGER_READ',
    module: 'PERSONAL_LEDGER',
    resource: 'PERSONAL_LEDGER_ENTRY',
    action: 'READ',
    effect: 'ALLOW',
    scope: 'ORGANISATION',
    requiresMfa: true,
    requiresAuditEvent: false,
    description: 'OWNER may read own Personal Ledger & Owner Account.',
  },
  {
    role: 'OWNER',
    permissionCode: 'PERSONAL_LEDGER_WRITE',
    module: 'PERSONAL_LEDGER',
    resource: 'PERSONAL_LEDGER_ENTRY',
    action: 'WRITE',
    effect: 'ALLOW',
    scope: 'ORGANISATION',
    requiresMfa: true,
    requiresReason: true,
    requiresAuditEvent: true,
    description: 'OWNER may submit entries to own Personal Ledger & Owner Account.',
  },
  {
    role: 'OWNER',
    permissionCode: 'CAFE:READ',
    module: 'CAFE',
    resource: 'CAFE',
    action: 'READ',
    effect: 'ALLOW',
    scope: 'ORGANISATION',
    requiresMfa: true,
    description:
      'OWNER may read organisation cafÃ© information.',
  },
  {
    role: 'OWNER',
    permissionCode: 'USER:READ',
    module: 'USER',
    resource: 'USER',
    action: 'READ',
    effect: 'ALLOW',
    scope: 'ORGANISATION',
    requiresMfa: true,
    description:
      'OWNER may read organisation user information.',
  },
  {
    role: 'OWNER',
    permissionCode: 'EMPLOYEE:READ',
    module: 'EMPLOYEE',
    resource: 'EMPLOYEE',
    action: 'READ',
    effect: 'ALLOW',
    scope: 'ORGANISATION',
    requiresMfa: true,
    requiresAuditEvent: false,
    description:
      'OWNER may read organisation employee records.',
  },
  {
    role: 'CAFE_ADMIN',
    permissionCode: 'CAFE:READ',
    module: 'CAFE',
    resource: 'CAFE',
    action: 'READ',
    effect: 'ALLOW',
    scope: 'ASSIGNED_CAFES',
    requiresMfa: true,
    description:
      'CafÃ© Admin may read assigned cafÃ© information.',
  },
  {
    role: 'CAFE_ADMIN',
    permissionCode: 'USER:READ',
    module: 'USER',
    resource: 'USER',
    action: 'READ',
    effect: 'ALLOW',
    scope: 'ASSIGNED_CAFES',
    requiresMfa: true,
    description:
      'CafÃ© Admin may read users in assigned cafÃ©s.',
  },
  {
    role: 'CAFE_ADMIN',
    permissionCode: 'EMPLOYEE:READ',
    module: 'EMPLOYEE',
    resource: 'EMPLOYEE',
    action: 'READ',
    effect: 'ALLOW',
    scope: 'RECORD',
    requiresMfa: true,
    requiresAuditEvent: false,
    description:
      'Cafe Admin may read active employee records in assigned cafes.',
  },
 { role: 'MASTER', permissionCode: 'POS_READ', module: 'POS_BILLING', resource: 'BILL', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', requiresMfa: true, requiresAuditEvent: false },
  { role: 'MASTER', permissionCode: 'POS_WRITE', module: 'POS_BILLING', resource: 'BILL', action: 'WRITE', effect: 'ALLOW', scope: 'ORGANISATION', requiresMfa: true, requiresAuditEvent: true },
 { role: 'MASTER', permissionCode: 'POS_VOID', module: 'POS_BILLING', resource: 'BILL', action: 'VOID', effect: 'ALLOW', scope: 'ORGANISATION', requiresMfa: true, requiresReason: true, requiresAuditEvent: true },
  { role: 'OWNER', permissionCode: 'POS_READ', module: 'POS_BILLING', resource: 'BILL', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', requiresMfa: true, requiresAuditEvent: false },
  { role: 'OWNER', permissionCode: 'POS_VOID', module: 'POS_BILLING', resource: 'BILL', action: 'VOID', effect: 'ALLOW', scope: 'ORGANISATION', requiresMfa: true, requiresReason: true, requiresAuditEvent: true },
 { role: 'CAFE_ADMIN', permissionCode: 'POS_READ', module: 'POS_BILLING', resource: 'BILL', action: 'READ', effect: 'ALLOW', scope: 'RECORD', requiresMfa: true, requiresAuditEvent: false },
 { role: 'CAFE_ADMIN', permissionCode: 'POS_WRITE', module: 'POS_BILLING', resource: 'BILL', action: 'WRITE', effect: 'ALLOW', scope: 'ASSIGNED_CAFES', requiresMfa: true, requiresAuditEvent: true },
  { role: 'MASTER', permissionCode: 'INVENTORY_READ', module: 'INVENTORY', resource: 'INVENTORY', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', requiresMfa: true, requiresAuditEvent: false },
  { role: 'MASTER', permissionCode: 'INVENTORY_WRITE', module: 'INVENTORY', resource: 'INVENTORY', action: 'WRITE', effect: 'ALLOW', scope: 'ORGANISATION', requiresMfa: true, requiresAuditEvent: true },
  { role: 'OWNER', permissionCode: 'INVENTORY_READ', module: 'INVENTORY', resource: 'INVENTORY', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', requiresMfa: true, requiresAuditEvent: false },
  { role: 'CAFE_ADMIN', permissionCode: 'INVENTORY_READ', module: 'INVENTORY', resource: 'INVENTORY', action: 'READ', effect: 'ALLOW', scope: 'RECORD', requiresMfa: true, requiresAuditEvent: false },
  { role: 'CAFE_ADMIN', permissionCode: 'INVENTORY_WRITE', module: 'INVENTORY', resource: 'INVENTORY', action: 'WRITE', effect: 'ALLOW', scope: 'ASSIGNED_CAFES', requiresMfa: true, requiresAuditEvent: true },
  { role: 'MASTER', permissionCode: 'VENDORS_READ', module: 'VENDORS', resource: 'VENDOR', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', requiresMfa: true, requiresAuditEvent: false },
  { role: 'MASTER', permissionCode: 'VENDORS_WRITE', module: 'VENDORS', resource: 'VENDOR', action: 'WRITE', effect: 'ALLOW', scope: 'ORGANISATION', requiresMfa: true, requiresAuditEvent: true },
  { role: 'OWNER', permissionCode: 'VENDORS_READ', module: 'VENDORS', resource: 'VENDOR', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', requiresMfa: true, requiresAuditEvent: false },
  { role: 'CAFE_ADMIN', permissionCode: 'VENDORS_READ', module: 'VENDORS', resource: 'VENDOR', action: 'READ', effect: 'ALLOW', scope: 'RECORD', requiresMfa: true, requiresAuditEvent: false },
  { role: 'MASTER', permissionCode: 'MENU_READ', module: 'MENU', resource: 'MENU_ITEM', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', requiresMfa: true, requiresAuditEvent: false },
  { role: 'MASTER', permissionCode: 'MENU_WRITE', module: 'MENU', resource: 'MENU_ITEM', action: 'WRITE', effect: 'ALLOW', scope: 'ORGANISATION', requiresMfa: true, requiresAuditEvent: true },
  { role: 'OWNER', permissionCode: 'MENU_READ', module: 'MENU', resource: 'MENU_ITEM', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', requiresMfa: true, requiresAuditEvent: false },
  { role: 'CAFE_ADMIN', permissionCode: 'MENU_READ', module: 'MENU', resource: 'MENU_ITEM', action: 'READ', effect: 'ALLOW', scope: 'ASSIGNED_CAFES', requiresMfa: true, requiresAuditEvent: false },
  { role: 'CAFE_ADMIN', permissionCode: 'MENU_WRITE', module: 'MENU', resource: 'MENU_ITEM', action: 'WRITE', effect: 'ALLOW', scope: 'ASSIGNED_CAFES', requiresMfa: true, requiresAuditEvent: true },
  { role: 'MASTER', permissionCode: 'APPROVALS_READ', module: 'APPROVALS', resource: 'APPROVAL', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', requiresMfa: true, requiresAuditEvent: false },
  { role: 'MASTER', permissionCode: 'APPROVALS_DECIDE', module: 'APPROVALS', resource: 'APPROVAL', action: 'DECIDE', effect: 'ALLOW', scope: 'ORGANISATION', requiresMfa: true, requiresAuditEvent: true },
  { role: 'OWNER', permissionCode: 'APPROVALS_READ', module: 'APPROVALS', resource: 'APPROVAL', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', requiresMfa: true, requiresAuditEvent: false },
  { role: 'OWNER', permissionCode: 'APPROVALS_DECIDE', module: 'APPROVALS', resource: 'APPROVAL', action: 'DECIDE', effect: 'ALLOW', scope: 'ORGANISATION', requiresMfa: true, requiresAuditEvent: true },
  { role: 'CAFE_ADMIN', permissionCode: 'APPROVALS_READ', module: 'APPROVALS', resource: 'APPROVAL', action: 'READ', effect: 'ALLOW', scope: 'RECORD', requiresMfa: true, requiresAuditEvent: false },
  { role: 'CAFE_ADMIN', permissionCode: 'APPROVALS_DECIDE', module: 'APPROVALS', resource: 'APPROVAL', action: 'DECIDE', effect: 'ALLOW', scope: 'RECORD', requiresMfa: true, requiresAuditEvent: true },
  { role: 'MASTER', permissionCode: 'ASSETS_READ', module: 'ASSETS', resource: 'ASSET', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', requiresMfa: true, requiresAuditEvent: false },
  { role: 'MASTER', permissionCode: 'ASSETS_WRITE', module: 'ASSETS', resource: 'ASSET', action: 'WRITE', effect: 'ALLOW', scope: 'ORGANISATION', requiresMfa: true, requiresAuditEvent: true },
  { role: 'OWNER', permissionCode: 'ASSETS_READ', module: 'ASSETS', resource: 'ASSET', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', requiresMfa: true, requiresAuditEvent: false },
  { role: 'CAFE_ADMIN', permissionCode: 'ASSETS_READ', module: 'ASSETS', resource: 'ASSET', action: 'READ', effect: 'ALLOW', scope: 'RECORD', requiresMfa: true, requiresAuditEvent: false },
  { role: 'CAFE_ADMIN', permissionCode: 'ASSETS_WRITE', module: 'ASSETS', resource: 'ASSET', action: 'WRITE', effect: 'ALLOW', scope: 'ASSIGNED_CAFES', requiresMfa: true, requiresAuditEvent: true },
  { role: 'MASTER', permissionCode: 'CUSTOMERS_READ', module: 'CUSTOMERS', resource: 'CUSTOMER', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', requiresMfa: true, requiresAuditEvent: false },
  { role: 'MASTER', permissionCode: 'CUSTOMERS_WRITE', module: 'CUSTOMERS', resource: 'CUSTOMER', action: 'WRITE', effect: 'ALLOW', scope: 'ORGANISATION', requiresMfa: true, requiresAuditEvent: true },
  { role: 'OWNER', permissionCode: 'CUSTOMERS_READ', module: 'CUSTOMERS', resource: 'CUSTOMER', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', requiresMfa: true, requiresAuditEvent: false },
  { role: 'CAFE_ADMIN', permissionCode: 'CUSTOMERS_READ', module: 'CUSTOMERS', resource: 'CUSTOMER', action: 'READ', effect: 'ALLOW', scope: 'RECORD', requiresMfa: true, requiresAuditEvent: false },
  { role: 'CAFE_ADMIN', permissionCode: 'CUSTOMERS_WRITE', module: 'CUSTOMERS', resource: 'CUSTOMER', action: 'WRITE', effect: 'ALLOW', scope: 'RECORD', requiresMfa: true, requiresAuditEvent: true },
  { role: 'MASTER', permissionCode: 'DEPARTMENT_ORDERS_READ', module: 'DEPARTMENT_ORDERS', resource: 'DEPARTMENT_ORDER', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', requiresMfa: true, requiresAuditEvent: false },
  { role: 'MASTER', permissionCode: 'DEPARTMENT_ORDERS_WRITE', module: 'DEPARTMENT_ORDERS', resource: 'DEPARTMENT_ORDER', action: 'WRITE', effect: 'ALLOW', scope: 'ORGANISATION', requiresMfa: true, requiresAuditEvent: true },
  { role: 'OWNER', permissionCode: 'DEPARTMENT_ORDERS_READ', module: 'DEPARTMENT_ORDERS', resource: 'DEPARTMENT_ORDER', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', requiresMfa: true, requiresAuditEvent: false },
  { role: 'CAFE_ADMIN', permissionCode: 'DEPARTMENT_ORDERS_READ', module: 'DEPARTMENT_ORDERS', resource: 'DEPARTMENT_ORDER', action: 'READ', effect: 'ALLOW', scope: 'RECORD', requiresMfa: true, requiresAuditEvent: false },
  { role: 'CAFE_ADMIN', permissionCode: 'DEPARTMENT_ORDERS_WRITE', module: 'DEPARTMENT_ORDERS', resource: 'DEPARTMENT_ORDER', action: 'WRITE', effect: 'ALLOW', scope: 'RECORD', requiresMfa: true, requiresAuditEvent: true },
  { role: 'MASTER', permissionCode: 'PROCUREMENT_READ', module: 'PROCUREMENT', resource: 'PURCHASE_ORDER', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', requiresMfa: true, requiresAuditEvent: false },
  { role: 'MASTER', permissionCode: 'PROCUREMENT_WRITE', module: 'PROCUREMENT', resource: 'PURCHASE_ORDER', action: 'WRITE', effect: 'ALLOW', scope: 'ORGANISATION', requiresMfa: true, requiresAuditEvent: true },
  { role: 'MASTER', permissionCode: 'PROCUREMENT_APPROVE', module: 'PROCUREMENT', resource: 'PURCHASE_ORDER', action: 'APPROVE', effect: 'ALLOW', scope: 'ORGANISATION', requiresMfa: true, requiresAuditEvent: true },
  { role: 'MASTER', permissionCode: 'PROCUREMENT_RECEIVE', module: 'PROCUREMENT', resource: 'PURCHASE_ORDER', action: 'RECEIVE', effect: 'ALLOW', scope: 'ORGANISATION', requiresMfa: true, requiresAuditEvent: true },
  { role: 'OWNER', permissionCode: 'PROCUREMENT_READ', module: 'PROCUREMENT', resource: 'PURCHASE_ORDER', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', requiresMfa: true, requiresAuditEvent: false },
  { role: 'OWNER', permissionCode: 'PROCUREMENT_WRITE', module: 'PROCUREMENT', resource: 'PURCHASE_ORDER', action: 'WRITE', effect: 'ALLOW', scope: 'ORGANISATION', requiresMfa: true, requiresReason: true, requiresAuditEvent: true },
  { role: 'OWNER', permissionCode: 'PROCUREMENT_APPROVE', module: 'PROCUREMENT', resource: 'PURCHASE_ORDER', action: 'APPROVE', effect: 'ALLOW', scope: 'ORGANISATION', requiresMfa: true, requiresAuditEvent: true },
  { role: 'CAFE_ADMIN', permissionCode: 'PROCUREMENT_READ', module: 'PROCUREMENT', resource: 'PURCHASE_ORDER', action: 'READ', effect: 'ALLOW', scope: 'RECORD', requiresMfa: true, requiresAuditEvent: false },
  { role: 'CAFE_ADMIN', permissionCode: 'PROCUREMENT_WRITE', module: 'PROCUREMENT', resource: 'PURCHASE_ORDER', action: 'WRITE', effect: 'ALLOW', scope: 'RECORD', requiresMfa: true, requiresAuditEvent: true },
  { role: 'CAFE_ADMIN', permissionCode: 'PROCUREMENT_APPROVE', module: 'PROCUREMENT', resource: 'PURCHASE_ORDER', action: 'APPROVE', effect: 'ALLOW', scope: 'RECORD', requiresMfa: true, requiresAuditEvent: true },
  { role: 'CAFE_ADMIN', permissionCode: 'PROCUREMENT_RECEIVE', module: 'PROCUREMENT', resource: 'PURCHASE_ORDER', action: 'RECEIVE', effect: 'ALLOW', scope: 'RECORD', requiresMfa: true, requiresAuditEvent: true },
  {
    role: 'STAFF',
    permissionCode: 'USER:READ_SELF',
    module: 'USER',
    resource: 'USER',
    action: 'READ',
    effect: 'ALLOW',
    scope: 'SELF',
    requiresMfa: false,
    description:
      'Staff may read their own user information.',
  },
  {
    role: 'STAFF',
    permissionCode: 'EMPLOYEE:READ_SELF',
    module: 'EMPLOYEE',
    resource: 'EMPLOYEE',
    action: 'READ',
    effect: 'ALLOW',
    scope: 'SELF',
    requiresMfa: false,
    requiresAuditEvent: false,
    description:
      'Staff may read only their own employee record.',
  },
  {
    role: 'STAFF',
    permissionCode: 'EMPLOYEE:WRITE_SELF',
    module: 'EMPLOYEE',
    resource: 'EMPLOYEE',
    action: 'WRITE',
    effect: 'ALLOW',
    scope: 'SELF',
    requiresMfa: false,
    requiresAuditEvent: true,
    description:
      'Staff may update only their own employee self-service profile.',
  },
  {
    role: 'STAFF',
    permissionCode: 'NOTIFICATION:READ_SELF',
    module: 'NOTIFICATION',
    resource: 'NOTIFICATION',
    action: 'READ',
    effect: 'ALLOW',
    scope: 'SELF',
    requiresMfa: false,
    description:
      'Staff may read their own notifications.',
  },
  {
    role: 'MASTER',
    permissionCode: 'ADMIN',
    module: 'ADMINISTRATION',
    resource: 'CUSTOM_FIELDS',
    action: 'MANAGE',
    effect: 'ALLOW',
    scope: 'ORGANISATION',
    requiresMfa: true,
    description: 'MASTER may manage organisation custom field definitions.',
  },
  {
    role: 'OWNER',
    permissionCode: 'ADMIN',
    module: 'ADMINISTRATION',
    resource: 'CUSTOM_FIELDS',
    action: 'READ',
    effect: 'ALLOW',
    scope: 'ORGANISATION',
    requiresMfa: false,
    description: 'OWNER may read organisation custom field definitions.',
  },
  {
    role: 'CAFE_ADMIN',
    permissionCode: 'ADMIN',
    module: 'ADMINISTRATION',
    resource: 'CUSTOM_FIELDS',
    action: 'READ',
    effect: 'ALLOW',
    scope: 'ASSIGNED_CAFES',
    requiresMfa: false,
    description: 'CAFE_ADMIN may read organisation custom field definitions.',
  },
  {
    role: 'STAFF',
    permissionCode: 'ADMIN',
    module: 'ADMINISTRATION',
    resource: 'CUSTOM_FIELDS',
    action: 'READ',
    effect: 'ALLOW',
    scope: 'SELF',
    requiresMfa: false,
    description: 'STAFF may read custom field definitions for self forms.',
  },
  // Quality & Compliance
  { role: 'MASTER', permissionCode: 'QUALITY_READ', module: 'QUALITY', resource: 'CHECKLIST', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', description: 'MASTER may read quality checklists.' },
  { role: 'OWNER', permissionCode: 'QUALITY_READ', module: 'QUALITY', resource: 'CHECKLIST', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', description: 'OWNER may read quality checklists.' },
  { role: 'CAFE_ADMIN', permissionCode: 'QUALITY_READ', module: 'QUALITY', resource: 'CHECKLIST', action: 'READ', effect: 'ALLOW', scope: 'ASSIGNED_CAFES', description: 'CAFE_ADMIN may read quality checklists.' },
  { role: 'MASTER', permissionCode: 'QUALITY_WRITE', module: 'QUALITY', resource: 'CHECKLIST', action: 'WRITE', effect: 'ALLOW', scope: 'ORGANISATION', description: 'MASTER may submit quality checklists.' },
  { role: 'CAFE_ADMIN', permissionCode: 'QUALITY_WRITE', module: 'QUALITY', resource: 'CHECKLIST', action: 'WRITE', effect: 'ALLOW', scope: 'ASSIGNED_CAFES', description: 'CAFE_ADMIN may submit quality checklists.' },
  // Revenue Share
  { role: 'MASTER', permissionCode: 'REVENUE_SHARE_READ', module: 'REVENUE_SHARE', resource: 'AGREEMENT', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', description: 'MASTER may read revenue share agreements.' },
  { role: 'OWNER', permissionCode: 'REVENUE_SHARE_READ', module: 'REVENUE_SHARE', resource: 'AGREEMENT', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', description: 'OWNER may read revenue share agreements.' },
  { role: 'MASTER', permissionCode: 'REVENUE_SHARE_WRITE', module: 'REVENUE_SHARE', resource: 'AGREEMENT', action: 'WRITE', effect: 'ALLOW', scope: 'ORGANISATION', description: 'MASTER may create revenue share agreements.' },
  // Tasks
  { role: 'MASTER', permissionCode: 'TASKS_READ', module: 'TASKS', resource: 'TASK', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', description: 'MASTER may read tasks.' },
  { role: 'OWNER', permissionCode: 'TASKS_READ', module: 'TASKS', resource: 'TASK', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', description: 'OWNER may read tasks.' },
  { role: 'CAFE_ADMIN', permissionCode: 'TASKS_READ', module: 'TASKS', resource: 'TASK', action: 'READ', effect: 'ALLOW', scope: 'ASSIGNED_CAFES', description: 'CAFE_ADMIN may read tasks.' },
  { role: 'STAFF', permissionCode: 'TASKS_READ', module: 'TASKS', resource: 'TASK', action: 'READ', effect: 'ALLOW', scope: 'SELF', description: 'STAFF may read own tasks.' },
  { role: 'MASTER', permissionCode: 'TASKS_WRITE', module: 'TASKS', resource: 'TASK', action: 'WRITE', effect: 'ALLOW', scope: 'ORGANISATION', description: 'MASTER may manage tasks.' },
  { role: 'OWNER', permissionCode: 'TASKS_WRITE', module: 'TASKS', resource: 'TASK', action: 'WRITE', effect: 'ALLOW', scope: 'ORGANISATION', description: 'OWNER may manage tasks.' },
  { role: 'CAFE_ADMIN', permissionCode: 'TASKS_WRITE', module: 'TASKS', resource: 'TASK', action: 'WRITE', effect: 'ALLOW', scope: 'ASSIGNED_CAFES', description: 'CAFE_ADMIN may manage tasks.' },
  { role: 'STAFF', permissionCode: 'TASKS_WRITE', module: 'TASKS', resource: 'TASK', action: 'WRITE', effect: 'ALLOW', scope: 'SELF', description: 'STAFF may update own task status.' },
  // Trash Bin
  { role: 'MASTER', permissionCode: 'TRASH_READ', module: 'TRASH', resource: 'TRASH_ITEM', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', description: 'MASTER may read trash items.' },
  { role: 'MASTER', permissionCode: 'TRASH_RESTORE', module: 'TRASH', resource: 'TRASH_ITEM', action: 'RESTORE', effect: 'ALLOW', scope: 'ORGANISATION', description: 'MASTER may restore trash items.' },
  // Dashboard
  { role: 'MASTER', permissionCode: 'DASHBOARD_READ', module: 'DASHBOARD', resource: 'DASHBOARD', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', description: 'MASTER may read dashboard.' },
  { role: 'OWNER', permissionCode: 'DASHBOARD_READ', module: 'DASHBOARD', resource: 'DASHBOARD', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', description: 'OWNER may read dashboard.' },
  { role: 'CAFE_ADMIN', permissionCode: 'DASHBOARD_READ', module: 'DASHBOARD', resource: 'DASHBOARD', action: 'READ', effect: 'ALLOW', scope: 'ASSIGNED_CAFES', description: 'CAFE_ADMIN may read dashboard.' },
  { role: 'STAFF', permissionCode: 'DASHBOARD_READ', module: 'DASHBOARD', resource: 'DASHBOARD', action: 'READ', effect: 'ALLOW', scope: 'SELF', description: 'STAFF may read dashboard.' },
  // Employee Write
  { role: 'MASTER', permissionCode: 'EMPLOYEE:WRITE', module: 'EMPLOYEE', resource: 'EMPLOYEE', action: 'WRITE', effect: 'ALLOW', scope: 'ORGANISATION', description: 'MASTER may update employee records.' },
  { role: 'OWNER', permissionCode: 'EMPLOYEE:WRITE', module: 'EMPLOYEE', resource: 'EMPLOYEE', action: 'WRITE', effect: 'ALLOW', scope: 'ORGANISATION', description: 'OWNER may update employee records.' },
  // Inventory Management
  { role: 'MASTER', permissionCode: 'INVENTORY_ADMIN', module: 'INVENTORY', resource: 'ITEM', action: 'ADMIN', effect: 'ALLOW', scope: 'ORGANISATION', description: 'MASTER may manage inventory admin operations and recalls.' },
  // Expense Management
  { role: 'MASTER', permissionCode: 'EXPENSE:READ', module: 'EXPENSE', resource: 'EXPENSE', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', description: 'MASTER may read organisation expenses.' },
  { role: 'OWNER', permissionCode: 'EXPENSE:READ', module: 'EXPENSE', resource: 'EXPENSE', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', description: 'OWNER may read organisation expenses.' },
  { role: 'CAFE_ADMIN', permissionCode: 'EXPENSE:READ', module: 'EXPENSE', resource: 'EXPENSE', action: 'READ', effect: 'ALLOW', scope: 'ASSIGNED_CAFES', description: 'CAFE_ADMIN may read cafe expenses.' },
  { role: 'STAFF', permissionCode: 'EXPENSE:READ', module: 'EXPENSE', resource: 'EXPENSE', action: 'READ', effect: 'ALLOW', scope: 'SELF', description: 'STAFF may read own expenses.' },
  { role: 'MASTER', permissionCode: 'EXPENSE:WRITE', module: 'EXPENSE', resource: 'EXPENSE', action: 'WRITE', effect: 'ALLOW', scope: 'ORGANISATION', description: 'MASTER may write expenses.' },
  { role: 'CAFE_ADMIN', permissionCode: 'EXPENSE:WRITE', module: 'EXPENSE', resource: 'EXPENSE', action: 'WRITE', effect: 'ALLOW', scope: 'ASSIGNED_CAFES', description: 'CAFE_ADMIN may write expenses.' },
  { role: 'STAFF', permissionCode: 'EXPENSE:WRITE', module: 'EXPENSE', resource: 'EXPENSE', action: 'WRITE', effect: 'ALLOW', scope: 'SELF', description: 'STAFF may submit own expenses.' },
  { role: 'MASTER', permissionCode: 'EXPENSE:DECIDE', module: 'EXPENSE', resource: 'EXPENSE', action: 'DECIDE', effect: 'ALLOW', scope: 'ORGANISATION', description: 'MASTER may decide on expense requests.' },
  // Finance & Accounts
  { role: 'MASTER', permissionCode: 'FINANCE:READ', module: 'FINANCE', resource: 'GENERAL_LEDGER', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', description: 'MASTER may read financial ledger and statements.' },
  { role: 'OWNER', permissionCode: 'FINANCE:READ', module: 'FINANCE', resource: 'GENERAL_LEDGER', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', description: 'OWNER may read financial statements.' },
  { role: 'CAFE_ADMIN', permissionCode: 'FINANCE:READ', module: 'FINANCE', resource: 'STORE_DAY', action: 'READ', effect: 'ALLOW', scope: 'ASSIGNED_CAFES', description: 'CAFE_ADMIN may read store day audits.' },
  { role: 'MASTER', permissionCode: 'FINANCE:WRITE', module: 'FINANCE', resource: 'GENERAL_LEDGER', action: 'WRITE', effect: 'ALLOW', scope: 'ORGANISATION', description: 'MASTER may create journals and invoices.' },
  { role: 'MASTER', permissionCode: 'FINANCE:POST', module: 'FINANCE', resource: 'JOURNAL', action: 'POST', effect: 'ALLOW', scope: 'ORGANISATION', description: 'MASTER may post journals and settlements.' },
  { role: 'MASTER', permissionCode: 'FINANCE:ADMIN', module: 'FINANCE', resource: 'CHART_OF_ACCOUNTS', action: 'ADMIN', effect: 'ALLOW', scope: 'ORGANISATION', description: 'MASTER may configure chart of accounts and bank accounts.' },
  { role: 'MASTER', permissionCode: 'FINANCE:CLOSE', module: 'FINANCE', resource: 'FINANCIAL_PERIOD', action: 'CLOSE', effect: 'ALLOW', scope: 'ORGANISATION', description: 'MASTER may close or lock financial periods.' },
  // MailOps & Operational Communications
  { role: 'MASTER', permissionCode: 'MAILOPS_READ', module: 'MAILOPS', resource: 'MAIL_MESSAGE', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', description: 'MASTER may read MailOps inbox, outbox, and telemetry.' },
  { role: 'OWNER', permissionCode: 'MAILOPS_READ', module: 'MAILOPS', resource: 'MAIL_MESSAGE', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', description: 'OWNER may read MailOps telemetry and messages.' },
  { role: 'CAFE_ADMIN', permissionCode: 'MAILOPS_READ', module: 'MAILOPS', resource: 'MAIL_MESSAGE', action: 'READ', effect: 'ALLOW', scope: 'ASSIGNED_CAFES', description: 'CAFE_ADMIN may read assigned cafe communications.' },
  { role: 'MASTER', permissionCode: 'MAILOPS_WRITE', module: 'MAILOPS', resource: 'MAIL_MESSAGE', action: 'WRITE', effect: 'ALLOW', scope: 'ORGANISATION', description: 'MASTER may compose, draft, and reply to operational messages.' },
  { role: 'CAFE_ADMIN', permissionCode: 'MAILOPS_WRITE', module: 'MAILOPS', resource: 'MAIL_MESSAGE', action: 'WRITE', effect: 'ALLOW', scope: 'ASSIGNED_CAFES', description: 'CAFE_ADMIN may draft and reply to assigned cafe communications.' },
  { role: 'MASTER', permissionCode: 'MAILOPS_ADMIN', module: 'MAILOPS', resource: 'MAIL_CONFIGURATION', action: 'ADMIN', effect: 'ALLOW', scope: 'ORGANISATION', description: 'Primary MASTER may manage MailOps provider, pause queues, and configure security policies.' },
  // Loans & Advances (SCR-014)
  { role: 'MASTER', permissionCode: 'LOAN_ADVANCE_READ_SELF', module: 'LOANS', resource: 'LOAN', action: 'READ', effect: 'ALLOW', scope: 'SELF', description: 'Primary MASTER may view own self-service loans if linked.' },
  { role: 'MASTER', permissionCode: 'LOAN_ADVANCE_WRITE_SELF', module: 'LOANS', resource: 'LOAN', action: 'WRITE', effect: 'ALLOW', scope: 'SELF', description: 'Primary MASTER may request own loans if linked.' },
  { role: 'MASTER', permissionCode: 'LOAN_ADVANCE_ADMIN', module: 'LOANS', resource: 'LOAN', action: 'ADMIN', effect: 'ALLOW', scope: 'ORGANISATION', description: 'Primary MASTER may govern organisation-wide loans, approvals, and integrity.' },
  { role: 'OWNER', permissionCode: 'LOAN_ADVANCE_READ_SELF', module: 'LOANS', resource: 'LOAN', action: 'READ', effect: 'ALLOW', scope: 'SELF', description: 'OWNER may view own self-service loans.' },
  { role: 'OWNER', permissionCode: 'LOAN_ADVANCE_WRITE_SELF', module: 'LOANS', resource: 'LOAN', action: 'WRITE', effect: 'ALLOW', scope: 'SELF', description: 'OWNER may request own self-service loans.' },
  { role: 'CAFE_ADMIN', permissionCode: 'LOAN_ADVANCE_READ_SELF', module: 'LOANS', resource: 'LOAN', action: 'READ', effect: 'ALLOW', scope: 'SELF', description: 'CAFE_ADMIN may view own self-service loans.' },
  { role: 'CAFE_ADMIN', permissionCode: 'LOAN_ADVANCE_WRITE_SELF', module: 'LOANS', resource: 'LOAN', action: 'WRITE', effect: 'ALLOW', scope: 'SELF', description: 'CAFE_ADMIN may request own self-service loans.' },
  { role: 'STAFF', permissionCode: 'LOAN_ADVANCE_READ_SELF', module: 'LOANS', resource: 'LOAN', action: 'READ', effect: 'ALLOW', scope: 'SELF', description: 'STAFF may view own loans and advances.' },
  { role: 'STAFF', permissionCode: 'LOAN_ADVANCE_WRITE_SELF', module: 'LOANS', resource: 'LOAN', action: 'WRITE', effect: 'ALLOW', scope: 'SELF', description: 'STAFF may submit loan and advance requests.' },
  // Reports & Analytics (SCR-022)
  { role: 'MASTER', permissionCode: 'REPORTS_READ', module: 'REPORTS', resource: 'REPORT', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', description: 'MASTER may read management reports and analytics across all cafes.' },
  { role: 'OWNER', permissionCode: 'REPORTS_READ', module: 'REPORTS', resource: 'REPORT', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', description: 'OWNER may read management reports and analytics across all cafes.' },
  { role: 'CAFE_ADMIN', permissionCode: 'REPORTS_READ', module: 'REPORTS', resource: 'REPORT', action: 'READ', effect: 'ALLOW', scope: 'ASSIGNED_CAFES', description: 'CAFE_ADMIN may read reports for assigned cafes.' },
  { role: 'MASTER', permissionCode: 'REPORTS_EXPORT', module: 'REPORTS', resource: 'REPORT', action: 'EXPORT', effect: 'ALLOW', scope: 'ORGANISATION', description: 'MASTER may export ZURF corporate reports.' },
  { role: 'OWNER', permissionCode: 'REPORTS_EXPORT', module: 'REPORTS', resource: 'REPORT', action: 'EXPORT', effect: 'ALLOW', scope: 'ORGANISATION', description: 'OWNER may export ZURF corporate reports.' },
  { role: 'CAFE_ADMIN', permissionCode: 'REPORTS_EXPORT', module: 'REPORTS', resource: 'REPORT', action: 'EXPORT', effect: 'ALLOW', scope: 'ASSIGNED_CAFES', description: 'CAFE_ADMIN may export ZURF reports for assigned cafes.' },
  // Offline Risk Configuration (R02C)
  { role: 'MASTER', permissionCode: 'OFFLINE_RISK_CONFIG_READ', module: 'OPERATIONS', resource: 'OFFLINE_RISK_CONFIG', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', description: 'MASTER may read organisation-wide offline risk configuration.' },
  { role: 'MASTER', permissionCode: 'OFFLINE_RISK_CONFIG_WRITE', module: 'OPERATIONS', resource: 'OFFLINE_RISK_CONFIG', action: 'WRITE', effect: 'ALLOW', scope: 'ORGANISATION', description: 'MASTER may govern organisation-wide offline risk configuration and cafe overrides.' },
  { role: 'OWNER', permissionCode: 'OFFLINE_RISK_CONFIG_READ', module: 'OPERATIONS', resource: 'OFFLINE_RISK_CONFIG', action: 'READ', effect: 'ALLOW', scope: 'ORGANISATION', description: 'OWNER may read organisation-wide offline risk configuration.' },
  { role: 'CAFE_ADMIN', permissionCode: 'OFFLINE_RISK_CONFIG_READ', module: 'OPERATIONS', resource: 'OFFLINE_RISK_CONFIG', action: 'READ', effect: 'ALLOW', scope: 'ASSIGNED_CAFES', description: 'CAFE_ADMIN may read effective offline risk configuration.' },
  { role: 'CAFE_ADMIN', permissionCode: 'OFFLINE_RISK_CONFIG_WRITE', module: 'OPERATIONS', resource: 'OFFLINE_RISK_CONFIG', action: 'WRITE', effect: 'ALLOW', scope: 'ASSIGNED_CAFES', description: 'CAFE_ADMIN may configure authorized cafe-specific offline risk overrides.' },
  { role: 'STAFF', permissionCode: 'OFFLINE_RISK_CONFIG_READ', module: 'OPERATIONS', resource: 'OFFLINE_RISK_CONFIG', action: 'READ', effect: 'ALLOW', scope: 'SELF', description: 'STAFF may view effective operational offline risk thresholds for current register session.' },
];

const PRIMARY_MASTER_DESIGNATION_REASON =
  'Initial Primary Master designation during secure bootstrap.';

function assertPrimaryMasterCandidate({
  user,
  organisationId,
}) {
  if (!user) {
    throw new Error(
      'A Primary Master candidate is required.'
    );
  }

  if (
    user.organisationId !== organisationId
  ) {
    throw new Error(
      'The Primary Master candidate belongs to a different organisation.'
    );
  }

  if (user.role !== 'MASTER') {
    throw new Error(
      'The Primary Master candidate must have the MASTER role.'
    );
  }

  if (user.accountStatus !== 'ACTIVE') {
    throw new Error(
      'The Primary Master candidate must have an ACTIVE account.'
    );
  }

  if (
    user.primaryCafeId ||
    (user.assignedCafeIds || []).length > 0
  ) {
    throw new Error(
      'The Primary Master candidate cannot be restricted to cafÃ© assignments.'
    );
  }
}

async function seedMasterUser({
  organisationId,
  masterName,
  masterEmail,
  masterPassword,
}) {
  const normEmail = masterEmail.trim().toLowerCase();
  const designatedAt = new Date();

  // 1. Check existing designated Primary Master accounts
  const existingPrimaryMasters = await User.find({
    organisationId,
    isPrimaryMaster: true,
  }).sort({ createdAt: 1 });

  if (existingPrimaryMasters.length > 0) {
    if (existingPrimaryMasters.length > 1) {
      throw new Error(
        'Multiple Primary Master accounts exist and no Primary Master can be selected automatically.'
      );
    }
    const primary = existingPrimaryMasters[0];
    assertPrimaryMasterCandidate({ user: primary, organisationId });
    return primary;
  }

  // 2. Check existing non-primary MASTER accounts
  const existingMasters = await User.find({
    organisationId,
    role: 'MASTER',
  }).sort({ createdAt: 1 });

  if (existingMasters.length === 1) {
    const candidate = existingMasters[0];
    assertPrimaryMasterCandidate({ user: candidate, organisationId });

    if (User.collection?.updateOne) {
      await User.collection.updateOne(
        {
          _id: candidate._id,
          organisationId,
        },
        {
          $set: {
            isPrimaryMaster: true,
            primaryMasterDesignatedAt: designatedAt,
            primaryMasterDesignatedBy: candidate.userId,
            primaryMasterDesignationReason: PRIMARY_MASTER_DESIGNATION_REASON,
          },
          $push: {
            roleHistory: {
              toRole: 'MASTER',
              changedAt: designatedAt,
              changedBy: candidate.userId,
              reason: PRIMARY_MASTER_DESIGNATION_REASON,
              correlationId: null,
              sessionId: null,
            },
          },
        }
      );
    }
    if (User.findById) {
      return await User.findById(candidate._id) || candidate;
    }
    return candidate;
  }

  if (existingMasters.length > 1) {
    throw new Error(
      'Multiple MASTER accounts exist and no Primary Master can be selected automatically.'
    );
  }

  // 3. Ensure email is not already taken by another account
  const existingUserWithEmail = await User.findOne({
    organisationId,
    email: normEmail,
  });

  if (existingUserWithEmail) {
    throw new Error(
      'MASTER email is already used by another account in the organisation.'
    );
  }

  // 4. Create fresh Primary Master account
  const passwordHash = await hashPassword(masterPassword);
  const userId =
    await SequenceCounter.generateId({
      organisationId,
      sequenceKey: 'USER_MASTER',
      prefix: 'MU',
      minimumDigits: 4,
    });

  const masterUser = await User.create({
    userId,
    organisationId,
    name: masterName,
    preferredName: '',
    email: normEmail,
    phone: '',
    role: 'MASTER',
    accountStatus: 'ACTIVE',
    primaryCafeId: null,
    assignedCafeIds: [],
    isPrimaryMaster: true,
    primaryMasterDesignatedAt: designatedAt,
    primaryMasterDesignatedBy: userId,
    primaryMasterDesignationReason: PRIMARY_MASTER_DESIGNATION_REASON,
    passwordHash,
    roleHistory: [
      {
        toRole: 'MASTER',
        changedAt: designatedAt,
        changedBy: userId,
        reason: PRIMARY_MASTER_DESIGNATION_REASON,
        correlationId: null,
        sessionId: null,
      },
    ],
    createdBy: userId,
    updatedBy: userId,
  });

  return masterUser;
}

async function seedPermissionRules({
  organisationId,
  masterUserId,
}) {
  let createdCount = 0;
  let existingCount = 0;

  for (
    const rule of
    DEFAULT_PERMISSION_RULES
  ) {
    const existingRule =
      await RolePermission.findOne({
        organisationId,
        role: rule.role,
        cafeId: null,
        permissionCode:
          rule.permissionCode,
        isActive: true,
        archivedAt: null,
      });

    if (existingRule) {
      const desiredProperties = {
        scope: rule.scope,
        module: rule.module,
        resource: rule.resource,
        action: rule.action,
        effect: rule.effect,
        description: rule.description,
        requiresMfa: Boolean(rule.requiresMfa),
        requiresStepUpAuthentication: Boolean(rule.requiresStepUpAuthentication),
        requiresReason: Boolean(rule.requiresReason),
        requiresAuditEvent: rule.requiresAuditEvent !== false,
        requiresReauthentication: Boolean(rule.requiresReauthentication),
      };

      let ruleChanged = false;

      for (const [field, value] of Object.entries(desiredProperties)) {
        if (existingRule[field] !== undefined && existingRule[field] !== value) {
          existingRule[field] = value;
          ruleChanged = true;
        }
      }

      if (ruleChanged) {
        existingRule.updatedBy = masterUserId;
        existingRule.policyVersion = Number.isInteger(existingRule.policyVersion)
          ? existingRule.policyVersion + 1
          : 1;

        await existingRule.save();
      }

      existingCount += 1;
      continue;
    }

    const permissionRuleId =
      await SequenceCounter.generateId({
        organisationId,
        sequenceKey:
          'PERMISSION_RULE',
        prefix: 'PR',
        minimumDigits: 4,
      });

    await RolePermission.create({
      permissionRuleId,
      organisationId,
      role: rule.role,
      cafeId: null,
      permissionCode:
        rule.permissionCode,
      module: rule.module,
      resource: rule.resource,
      action: rule.action,
      effect: rule.effect,
      scope: rule.scope,
      fieldAccess: {
        allowedFields: [],
        deniedFields: [],
        maskedFields: [],
      },
      conditions: {},
      requiresMfa:
        rule.requiresMfa,
      requiresStepUpAuthentication:
        Boolean(
          rule
            .requiresStepUpAuthentication
        ),
      requiresReason:
        Boolean(rule.requiresReason),
      requiresAuditEvent:
        rule.requiresAuditEvent !== false,
      requiresReauthentication:
        Boolean(
          rule.requiresReauthentication
        ),
      isDelegable: false,
      isActive: true,
      effectiveFrom: new Date(),
      effectiveTo: null,
      description:
        rule.description,
      policyVersion: 1,
      createdBy:
        masterUserId,
      updatedBy:
        masterUserId,
    });

    createdCount += 1;
  }

  // Deactivate any stale active system-level rules (cafeId: null) that are no longer in DEFAULT_PERMISSION_RULES
  let deactivatedCount = 0;
  if (RolePermission.db && RolePermission.db.readyState === 1) {
    const validRuleKeys = new Set(
      DEFAULT_PERMISSION_RULES.map((r) => `${r.role}|${r.permissionCode}`)
    );

    const activeSystemRules = await RolePermission.find({
      organisationId,
      cafeId: null,
      isActive: true,
      archivedAt: null,
    });

    for (const dbRule of activeSystemRules) {
      const key = `${dbRule.role}|${dbRule.permissionCode}`;
      if (!validRuleKeys.has(key)) {
        dbRule.isActive = false;
        dbRule.archivedAt = new Date();
        dbRule.updatedBy = masterUserId;
        await dbRule.save();
        deactivatedCount += 1;
      }
    }
  }

  console.log(
    `Permission rules created: ${createdCount}`
  );

  console.log(
    `Permission rules already existing: ${existingCount}`
  );

  if (deactivatedCount > 0) {
    console.log(
      `Stale permission rules deactivated: ${deactivatedCount}`
    );
  }
}

async function seedSystemCommunicationSettings({ organisationId, masterEmail }) {
  const { SystemCommunicationSettings } = require('../models/SystemCommunicationSettings');
  let settings = await SystemCommunicationSettings.findOne({ organisationId });
  if (!settings) {
    settings = await SystemCommunicationSettings.create({
      organisationId,
      operationsEmail: 'zamorinestatepvtltd.erp@gmail.com',
      primaryMasterEmail: masterEmail || 'pradeeshk331@gmail.com',
      identityType: 'SYSTEM_OPERATIONS_MAILBOX',
      applicationRole: 'NONE',
      canLoginToERP: false,
      enabled: true,
      provider: 'GMAIL_API',
      defaultSenderName: 'Zamorin Cafe ERP',
      replyTo: 'zamorinestatepvtltd.erp@gmail.com',
    });
    console.log('System communication settings initialized for zamorinestatepvtltd.erp@gmail.com');
  }
  return settings;
}

async function seedDepartmentOrdersData({ organisationId, masterUserId }) {
  const { DepartmentOrder } = require('../models/DepartmentOrder');
  const { InstitutionalAccount } = require('../models/InstitutionalAccount');

  const existingAccount = await InstitutionalAccount.findOne({ organisationId, accountId: 'INST-001' });
  if (!existingAccount) {
    await InstitutionalAccount.create({
      accountId: 'INST-001',
      organisationId,
      institutionName: 'University of Calicut',
      preferredCafeId: 'ZC-0001',
      creditLimitPaisa: 10000000,
      currentExposurePaisa: 567000,
      creditStatus: 'ACTIVE',
      poRequired: true,
      defaultBillingCycle: 'MONTHLY',
      departments: [
        {
          departmentName: 'Dean Office / Academic Affairs',
          costCentre: 'UOC-ACAD-01',
          primaryContactName: 'Dr. K. S. Namboodiri',
          primaryContactPhone: '+919447012345',
        },
      ],
    });
  }

  const existingOrder = await DepartmentOrder.findOne({ organisationId, orderId: 'DO-2026-0001' });
  if (!existingOrder) {
    await DepartmentOrder.create({
      orderId: 'DO-2026-0001',
      organisationId,
      cafeId: 'ZC-0001',
      institutionName: 'University of Calicut',
      departmentName: 'Dean Office / Academic Affairs',
      careOfContact: 'Dr. K. S. Namboodiri',
      orderDate: '2026-08-15',
      fulfilmentDate: '2026-08-20',
      promisedTimeWindow: '10:00 - 10:30 AM',
      headcount: { estimated: 20, guaranteed: 20, final: 20, actual: 20 },
      items: [
        { name: 'Pour-Over Specialty Coffee', quantity: 20, unit: 'cups', unitPricePaisa: 15000, totalPaisa: 300000 },
        { name: 'Artisanal Butter Croissants', quantity: 20, unit: 'pieces', unitPricePaisa: 12000, totalPaisa: 240000 },
      ],
      subtotalPaisa: 540000,
      taxPaisa: 27000,
      totalPaisa: 567000,
      settledPaisa: 0,
      orderStatus: 'CONFIRMED',
      fulfilmentStatus: 'SCHEDULED',
      creditStatus: 'CREDIT_OPEN',
      poNumber: 'UOC-ACAD-2026-088',
      requestedByUserId: masterUserId,
    });
  }
}

async function seedWorkforceData({ organisationId, masterUserId }) {
  const { Position } = require('../models/Position');
  const { EmployeeSkill } = require('../models/EmployeeSkill');

  const positionsCount = await Position.countDocuments({ organisationId });
  if (positionsCount === 0) {
    await Position.create([
      {
        positionId: 'POS-ZC0001-001',
        organisationId,
        positionTitle: 'General Store Manager',
        department: 'Management',
        cafeId: 'ZC-0001',
        approvedCapacity: 1,
        status: 'FILLED',
        isCritical: true,
      },
      {
        positionId: 'POS-ZC0001-002',
        organisationId,
        positionTitle: 'Senior Head Barista',
        department: 'Barista',
        cafeId: 'ZC-0001',
        approvedCapacity: 2,
        status: 'FILLED',
        isCritical: true,
      },
      {
        positionId: 'POS-ZC0001-003',
        organisationId,
        positionTitle: 'Junior Barista',
        department: 'Barista',
        cafeId: 'ZC-0001',
        approvedCapacity: 4,
        status: 'OPEN',
        isCritical: false,
      },
    ]);
  }
}

async function seedExpensePolicyData({ organisationId, masterUserId }) {
  const { ExpensePolicy } = require('../models/ExpensePolicy');

  const policyCount = await ExpensePolicy.countDocuments({ organisationId });
  if (policyCount === 0) {
    await ExpensePolicy.create({
      policyId: 'POL-EXP-2026-01',
      version: 'V1.0',
      policyName: 'Standard Café Operations & Outflow Policy',
      organisationId,
      receiptThresholdPaisa: 50000, // 500 INR
      poRequiredThresholdPaisa: 5000000, // 50,000 INR
      autoAuditPercentage: 10,
      categoryRules: [
        {
          category: 'COFFEE_RAW_MATERIALS',
          poRequiredThresholdPaisa: 5000000,
          receiptRequired: true,
        },
        {
          category: 'DAIRY_FRESH_MILK',
          poRequiredThresholdPaisa: 2000000,
          receiptRequired: true,
        },
      ],
      status: 'ACTIVE',
      effectiveFrom: '2026-01-01',
      publishedBy: masterUserId,
    });
  }
}

async function seedFinanceData({ organisationId, masterUserId }) {
  const { ChartOfAccount } = require('../models/ChartOfAccount');
  const { BankAccount } = require('../models/BankAccount');
  const { FinancialPeriod } = require('../models/FinancialPeriod');
  const { StoreDayAudit } = require('../models/StoreDayAudit');

  const coaCount = await ChartOfAccount.countDocuments({ organisationId });
  if (coaCount === 0) {
    await ChartOfAccount.create([
      { organisationId, accountCode: '1010-CASH', accountName: 'Cash on Hand / Till Float', accountType: 'ASSET', accountGroup: 'CURRENT_ASSETS', effectiveFrom: '2026-01-01' },
      { organisationId, accountCode: '1020-BANK-HDFC', accountName: 'HDFC Bank Current Account', accountType: 'ASSET', accountGroup: 'CURRENT_ASSETS', effectiveFrom: '2026-01-01' },
      { organisationId, accountCode: '1030-AR', accountName: 'Accounts Receivable Control', accountType: 'ASSET', accountGroup: 'CURRENT_ASSETS', controlAccountType: 'ACCOUNTS_RECEIVABLE', effectiveFrom: '2026-01-01' },
      { organisationId, accountCode: '1040-INVENTORY', accountName: 'Raw Materials & Beans Inventory', accountType: 'ASSET', accountGroup: 'INVENTORY', controlAccountType: 'INVENTORY_CONTROL', effectiveFrom: '2026-01-01' },
      { organisationId, accountCode: '2010-AP', accountName: 'Accounts Payable Control', accountType: 'LIABILITY', accountGroup: 'CURRENT_LIABILITIES', controlAccountType: 'ACCOUNTS_PAYABLE', effectiveFrom: '2026-01-01' },
      { organisationId, accountCode: '2020-GST-PAYABLE', accountName: 'GST Output Tax Payable', accountType: 'LIABILITY', accountGroup: 'TAX_LIABILITIES', controlAccountType: 'TAX_CONTROL', effectiveFrom: '2026-01-01' },
      { organisationId, accountCode: '3010-EQUITY', accountName: 'Owners Capital & Retained Earnings', accountType: 'EQUITY', accountGroup: 'EQUITY', effectiveFrom: '2026-01-01' },
      { organisationId, accountCode: '4010-REV-BEVERAGE', accountName: 'Speciality Coffee & Beverage Sales', accountType: 'REVENUE', accountGroup: 'OPERATING_REVENUE', effectiveFrom: '2026-01-01' },
      { organisationId, accountCode: '4020-REV-FOOD', accountName: 'Fresh Bakery & Food Sales', accountType: 'REVENUE', accountGroup: 'OPERATING_REVENUE', effectiveFrom: '2026-01-01' },
      { organisationId, accountCode: '5010-COGS-BEANS', accountName: 'Arabica & Raw Beans Consumption', accountType: 'EXPENSE', accountGroup: 'COST_OF_SALES', effectiveFrom: '2026-01-01' },
      { organisationId, accountCode: '5020-COGS-DAIRY', accountName: 'Fresh Milk & Dairy Supplies', accountType: 'EXPENSE', accountGroup: 'COST_OF_SALES', effectiveFrom: '2026-01-01' },
      { organisationId, accountCode: '6010-OPEX-SALARIES', accountName: 'Barista & Staff Salaries', accountType: 'EXPENSE', accountGroup: 'OPERATING_EXPENSES', effectiveFrom: '2026-01-01' },
      { organisationId, accountCode: '6020-OPEX-RENT', accountName: 'Café Premises Rent & Maintenance', accountType: 'EXPENSE', accountGroup: 'OPERATING_EXPENSES', effectiveFrom: '2026-01-01' },
    ]);
  }

  const bankCount = await BankAccount.countDocuments({ organisationId });
  if (bankCount === 0) {
    await BankAccount.create([
      { organisationId, bankAccountId: 'BANK-HDFC-01', accountAlias: 'HDFC Operating Current A/C', bankName: 'HDFC Bank Ltd', maskedAccountNumber: '•••• 4892', ifscCode: 'HDFC0000128', glAccountCode: '1020-BANK-HDFC', bookBalancePaisa: 45000000, status: 'ACTIVE' },
    ]);
  }

  const periodCount = await FinancialPeriod.countDocuments({ organisationId });
  if (periodCount === 0) {
    await FinancialPeriod.create([
      { organisationId, periodId: 'FY2026-P05', fiscalYear: '2026-2027', periodNumber: 5, periodName: 'August 2026', startDate: '2026-08-01', endDate: '2026-08-31', status: 'OPEN' },
    ]);
  }

  const storeDayCount = await StoreDayAudit.countDocuments({ organisationId });
  if (storeDayCount === 0) {
    await StoreDayAudit.create([
      {
        organisationId,
        storeDayId: 'SDA-ZC0001-20260818',
        cafeId: 'ZC-0001',
        businessDate: '2026-08-18',
        posEventCount: 428,
        financeEventCount: 428,
        grossSalesPaisa: 14200000,
        discountsPaisa: 600000,
        netSalesPaisa: 13600000,
        taxPaisa: 680000,
        tenderBreakdown: { cashPaisa: 4200000, upiPaisa: 6500000, cardPaisa: 2900000, departmentCreditPaisa: 0, marketplacePaisa: 0 },
        cashExpectedPaisa: 4200000,
        cashDeclaredPaisa: 4200000,
        cashVariancePaisa: 0,
        status: 'FINANCE_CLEARED',
        clearedBy: masterUserId,
        clearedAt: new Date(),
      },
    ]);
  }
}

async function seedInventoryData({ organisationId, masterUserId }) {
  const { GlobalInventoryItem } = require('../models/GlobalInventoryItem');
  const { CafeInventoryConfig } = require('../models/CafeInventoryConfig');
  const { StockMovement } = require('../models/StockMovement');
  const { InventoryLot } = require('../models/InventoryLot');

  const itemCount = await GlobalInventoryItem.countDocuments({ organisationId });
  if (itemCount === 0) {
    const items = [
      {
        organisationId,
        itemId: 'ITEM-1001',
        sku: 'CB-ARA-01',
        name: 'Arabica Whole Beans (Estate Blend)',
        category: 'COFFEE_BEANS',
        baseUnit: 'kg',
        criticality: 'CRITICAL',
        lotControl: true,
        shelfLifeDays: 90,
        unitCostPaisa: 85000,
        status: 'ACTIVE',
        createdByUserId: masterUserId,
      },
      {
        organisationId,
        itemId: 'ITEM-1002',
        sku: 'DY-MLK-01',
        name: 'Farm Fresh Whole Milk (3.5% Fat)',
        category: 'DAIRY_FRESH',
        baseUnit: 'litre',
        criticality: 'CRITICAL',
        lotControl: true,
        shelfLifeDays: 5,
        unitCostPaisa: 6200,
        status: 'ACTIVE',
        createdByUserId: masterUserId,
      },
      {
        organisationId,
        itemId: 'ITEM-1003',
        sku: 'SY-VAN-01',
        name: 'Madagascar Vanilla Bean Syrup (750ml)',
        category: 'SYRUPS_FLAVOURS',
        baseUnit: 'bottle',
        criticality: 'STANDARD',
        lotControl: true,
        shelfLifeDays: 180,
        unitCostPaisa: 75000,
        status: 'ACTIVE',
        createdByUserId: masterUserId,
      },
    ];

    await GlobalInventoryItem.insertMany(items);

    const cafes = ['ZC-0001', 'ZC-0002'];
    for (const cafeId of cafes) {
      for (const itm of items) {
        const initialQty = itm.sku === 'CB-ARA-01' ? 45 : itm.sku === 'DY-MLK-01' ? 80 : 14;
        await CafeInventoryConfig.create({
          organisationId,
          cafeId,
          itemId: itm.itemId,
          currentQuantityBase: initialQty,
          availableQuantityBase: initialQty,
          reservedQuantityBase: 0,
          quarantinedQuantityBase: 0,
          expiredQuantityBase: 0,
          inTransitQuantityBase: 0,
          minQuantityBase: 20,
          parQuantityBase: 50,
          maxQuantityBase: 100,
          safetyStockBase: 10,
          primaryLocation: 'Main Store',
          status: 'ACTIVE',
        });

        await StockMovement.create({
          organisationId,
          movementId: `MVT-INIT-${cafeId}-${itm.itemId}`,
          cafeId,
          itemId: itm.itemId,
          movementType: 'OPENING_BALANCE',
          quantityBase: initialQty,
          balanceBeforeBase: 0,
          balanceAfterBase: initialQty,
          reason: 'Initial system opening stock balance',
          performedByUserId: masterUserId,
        });

        await InventoryLot.create({
          organisationId,
          lotId: `LOT-${cafeId}-${itm.itemId}-01`,
          supplierLot: `SUP-${itm.sku}-99`,
          itemId: itm.itemId,
          cafeId,
          expiryDate: new Date(Date.now() + itm.shelfLifeDays * 86400000).toISOString().slice(0, 10),
          quantityBase: initialQty,
          status: 'AVAILABLE',
        });
      }
    }
  }
}

async function seedMenuData(orgOrObj, mUserId) {
  const organisationId = typeof orgOrObj === 'object' ? orgOrObj.organisationId : orgOrObj;
  const masterUserId = typeof orgOrObj === 'object' ? orgOrObj.masterUserId : mUserId;
  const { MenuItem } = require('../models/MenuItem');
  const { Recipe } = require('../models/Recipe');
  const { ModifierGroup } = require('../models/ModifierGroup');
  const { Menu } = require('../models/Menu');
  const { MenuSection } = require('../models/MenuSection');
  const { OutletOffering } = require('../models/OutletOffering');

  const SEED_RECIPES = [
    {
      recipeId: 'RCP-0001',
      name: 'Signature Estate Pour-Over Formula',
      batchYield: 1,
      yieldUom: 'PORTION',
      portionSize: 1,
      portionUom: 'PORTION',
      ingredients: [
        { inventoryItemId: 'INV-COFFEE-BEAN-001', ingredientName: 'Arabica Coffee Beans', quantity: 18, uom: 'G' },
      ],
      instructionsText: 'Grind 18g single-estate beans at setting 4.5. Brew 250ml water at 92C using V60.',
    },
    {
      recipeId: 'RCP-0002',
      name: 'Spanish Cortado Formula',
      batchYield: 1,
      yieldUom: 'PORTION',
      portionSize: 1,
      portionUom: 'PORTION',
      ingredients: [
        { inventoryItemId: 'INV-COFFEE-BEAN-001', ingredientName: 'Arabica Coffee Beans', quantity: 18, uom: 'G' },
        { inventoryItemId: 'INV-MILK-001', ingredientName: 'Full Cream Milk', quantity: 60, uom: 'ML' },
      ],
      instructionsText: 'Extract double espresso (36g). Steam equal parts whole milk with microfoam.',
    },
  ];

  for (const r of SEED_RECIPES) {
    const existing = await Recipe.findOne({ organisationId, recipeId: r.recipeId });
    if (!existing) {
      await Recipe.create({
        ...r,
        organisationId,
        version: 1,
        conceptEligibility: 'SHARED',
        status: 'APPROVED',
        createdByUserId: masterUserId,
      });
    }
  }

  const SEED_MODIFIERS = [
    {
      modifierGroupId: 'MOD-0001',
      name: 'Milk Choice',
      conceptEligibility: 'SHARED',
      minSelections: 0,
      maxSelections: 1,
      modifiers: [
        { modifierId: 'MOD-OAT-MILK', name: 'Oat Milk Sub', pricePaisaDelta: 4000, isAvailable: true },
        { modifierId: 'MOD-ALMOND-MILK', name: 'Almond Milk Sub', pricePaisaDelta: 4500, isAvailable: true },
      ],
    },
    {
      modifierGroupId: 'MOD-0002',
      name: 'Extra Shot',
      conceptEligibility: 'SHARED',
      minSelections: 0,
      maxSelections: 2,
      isMultiSelect: true,
      modifiers: [
        {
          modifierId: 'MOD-EXTRA-ESPRESSO',
          name: 'Extra Shot Single-Estate Espresso',
          pricePaisaDelta: 5000,
          recipeDeltas: [{ inventoryItemId: 'INV-COFFEE-BEAN-001', quantityDelta: 18, uom: 'G' }],
          isAvailable: true,
        },
      ],
    },
  ];

  for (const m of SEED_MODIFIERS) {
    const existing = await ModifierGroup.findOne({ organisationId, modifierGroupId: m.modifierGroupId });
    if (!existing) {
      await ModifierGroup.create({ ...m, organisationId, status: 'ACTIVE' });
    }
  }

  const SEED_ITEMS = [
    { menuItemId: 'MENU-01', itemCode: 'ITM-MENU-01', plu: 'MENU-01', name: 'Zamorin Signature Estate Pour-Over', category: 'COFFEE', pricePaisa: 24000, conceptEligibility: 'CAFE', dietaryTags: ['VEG'], primaryRecipeId: 'RCP-0001', description: 'Single-estate Arabica brewed through V60 dripper.' },
    { menuItemId: 'MENU-02', itemCode: 'ITM-MENU-02', plu: 'MENU-02', name: 'Spanish Cortado (Double Shot)', category: 'COFFEE', pricePaisa: 21000, conceptEligibility: 'CAFE', dietaryTags: ['VEG'], allergenTags: ['DAIRY'], primaryRecipeId: 'RCP-0002', description: 'Equal parts rich espresso and textured whole milk.' },
    { menuItemId: 'MENU-03', itemCode: 'ITM-MENU-03', plu: 'MENU-03', name: '18-Hour Slow Cold Brew', category: 'COFFEE', pricePaisa: 26000, conceptEligibility: 'CAFE', dietaryTags: ['VEG'], description: 'Steeped for 18 hours in cold filtered spring water.' },
    { menuItemId: 'MENU-04', itemCode: 'ITM-MENU-04', plu: 'MENU-04', name: 'Iced Spiced Cardamom Latte', category: 'COFFEE', pricePaisa: 28000, conceptEligibility: 'CAFE', dietaryTags: ['VEG'], allergenTags: ['DAIRY'], description: 'House cardamom syrup with espresso over ice.' },
    { menuItemId: 'MENU-05', itemCode: 'ITM-MENU-05', plu: 'MENU-05', name: 'Butter Croissant (French Butter)', category: 'BAKERY', pricePaisa: 18000, conceptEligibility: 'SHARED', dietaryTags: ['VEG'], allergenTags: ['GLUTEN', 'DAIRY'], description: 'Layered flaky pastry baked fresh daily.' },
    { menuItemId: 'MENU-06', itemCode: 'ITM-MENU-06', plu: 'MENU-06', name: 'Avocado & Sourdough Toast', category: 'SNACKS', pricePaisa: 34000, conceptEligibility: 'SHARED', dietaryTags: ['VEG'], allergenTags: ['GLUTEN'], description: 'Hass avocado, chili flakes, feta on toasted sourdough.' },
    { menuItemId: 'MENU-07', itemCode: 'ITM-MENU-07', plu: 'MENU-07', name: 'Smoked Chicken Ciabatta Panini', category: 'MAIN_COURSE', pricePaisa: 38000, conceptEligibility: 'RESTAURANT', courseType: 'MAIN', dietaryTags: ['NON_VEG'], allergenTags: ['GLUTEN', 'DAIRY'], description: 'Oak-smoked chicken, aged cheddar, dijon mustard.' },
  ];

  for (const itm of SEED_ITEMS) {
    const existing = await MenuItem.findOne({ organisationId, menuItemId: itm.menuItemId });
    if (!existing) {
      await MenuItem.create({
        menuItemId: itm.menuItemId,
        organisationId,
        itemCode: itm.itemCode,
        plu: itm.plu,
        name: itm.name,
        nameLower: itm.name.toLowerCase(),
        customerName: itm.name,
        posShortName: itm.name.slice(0, 20),
        receiptName: itm.name.slice(0, 20),
        category: itm.category,
        conceptEligibility: itm.conceptEligibility,
        courseType: itm.courseType || null,
        description: itm.description,
        currentPricePaisa: itm.pricePaisa,
        taxRatePercent: 5,
        isTaxInclusive: true,
        primaryRecipeId: itm.primaryRecipeId || null,
        modifierGroupIds: ['MOD-0001', 'MOD-0002'],
        dietaryTags: itm.dietaryTags || ['VEG'],
        allergenTags: itm.allergenTags || [],
        status: 'ACTIVE',
        priceHistory: [{ pricePaisa: itm.pricePaisa, effectiveFrom: new Date(), changedByUserId: masterUserId, reason: 'Initial Catalog Seed' }],
        createdByUserId: masterUserId,
      });
    }

    // Ensure outlet offerings exist for ZC-0001 and ZC-0002
    for (const cafeId of ['ZC-0001', 'ZC-0002']) {
      const off = await OutletOffering.findOne({ organisationId, outletId: cafeId, menuItemId: itm.menuItemId });
      if (!off) {
        await OutletOffering.create({
          organisationId,
          outletId: cafeId,
          menuItemId: itm.menuItemId,
          isEnabled: true,
          isAvailable: true,
          localPricePaisaOverride: null,
          priceSourceExplanation: 'Inherited from Global Default',
          lastModifiedByUserId: masterUserId,
        });
      }
    }
  }

  // Seed standard Menus
  const SEED_MENUS = [
    { menuId: 'MNU-CAT-0001', name: 'All-Day Café Menu', concept: 'CAFE', menuType: 'ALL_DAY', schedule: { startTime: '07:00', endTime: '23:00' }, outletIds: ['ZC-0001', 'ZC-0002'] },
    { menuId: 'MNU-CAT-0002', name: 'Restaurant Dinner Menu', concept: 'RESTAURANT', menuType: 'DINNER', schedule: { startTime: '18:00', endTime: '23:30' }, outletIds: ['ZC-0001', 'ZC-0002'] },
  ];

  for (const m of SEED_MENUS) {
    const existing = await Menu.findOne({ organisationId, menuId: m.menuId });
    if (!existing) {
      await Menu.create({ ...m, organisationId, status: 'ACTIVE' });
    }
  }
}

async function seedLoansData(orgOrObj, mUserId) {
  const organisationId = typeof orgOrObj === 'object' ? orgOrObj.organisationId : orgOrObj;
  const masterUserId = typeof orgOrObj === 'object' ? orgOrObj.masterUserId : mUserId;
  const { LoanPolicy } = require('../models/LoanPolicy');
  const { StaffLoanAdvance } = require('../models/StaffLoanAdvance');

  const existingPolicy = await LoanPolicy.findOne({ organisationId, policyId: 'POL-LOAN-2026' });
  if (!existingPolicy) {
    await LoanPolicy.create({
      policyId: 'POL-LOAN-2026',
      organisationId,
      policyVersion: 'POL-LOAN-2026-V1',
      maxLoanAmountPaise: 20000000,
      maxAdvanceAmountPaise: 5000000,
      minServiceMonths: 3,
      maxTenureMonths: 24,
      maxActiveLoansPerEmployee: 2,
      statutoryDeductionCapPercent: 50,
      status: 'ACTIVE',
    });
  }

  const existingLoan = await StaffLoanAdvance.findOne({ organisationId, loanAdvanceId: 'LN-2026-0001' });
  if (!existingLoan) {
    await StaffLoanAdvance.create({
      loanAdvanceId: 'LN-2026-0001',
      organisationId,
      cafeId: 'ZC-0001',
      employeeUserId: 'ST-0001',
      employeeName: 'Rahul Verma',
      requestType: 'LOAN',
      loanCategory: 'WELFARE',
      requestedAmountPaise: 6000000,
      approvedAmountPaise: 6000000,
      disbursedAmountPaise: 6000000,
      principalPaise: 6000000,
      outstandingPrincipalPaise: 4250000,
      arrearsPaise: 0,
      totalRepaidPaise: 1750000,
      monthlyInstalmentPaise: 500000,
      tenureMonths: 12,
      requestReason: 'Staff welfare and relocation advance support',
      status: 'ACTIVE',
      policyVersion: 'POL-LOAN-2026-V1',
      deductionReference: 'DED-LN-2026-0001',
      requestedAt: new Date(Date.now() - 60 * 86400000),
      approvedAt: new Date(Date.now() - 58 * 86400000),
      disbursedAt: new Date(Date.now() - 55 * 86400000),
      approvedByUserId: masterUserId,
      disbursedByUserId: masterUserId,
      createdByUserId: 'ST-0001',
    });
  }
}

async function seedCafeOperationsData(orgOrObj, mUserId) {
  const organisationId = typeof orgOrObj === 'object' ? orgOrObj.organisationId : orgOrObj;
  const masterUserId = typeof orgOrObj === 'object' ? orgOrObj.masterUserId : mUserId;
  const { Cafe } = require('../models/Cafe');
  const { DeviceRegistration } = require('../models/DeviceRegistration');
  const { User } = require('../models/User');
  const bcrypt = require('bcrypt');

  // 0. Seed Active Cafes with 6-digit Operations PIN
  const defaultCafePin = process.env.INITIAL_CAFE_PIN || crypto.randomInt(100000, 999999).toString();
  const defaultCafePinHash = await bcrypt.hash(defaultCafePin, 10);

  const cafe1 = await Cafe.findOne({ organisationId, cafeId: 'ZC-0001' });
  if (!cafe1) {
    await Cafe.create({
      cafeId: 'ZC-0001',
      organisationId,
      name: 'Koramangala Main Branch',
      displayName: 'Koramangala Main',
      cafeType: 'STANDARD_CAFE',
      status: 'ACTIVE',
      address: {
        building: 'Zamorin Estate Tower',
        street: '80 Feet Road, 4th Block',
        area: 'Koramangala',
        city: 'Bengaluru',
        state: 'Karnataka',
        pinCode: '560034',
      },
      operationsPinHash: defaultCafePinHash,
      operationsPinSetAt: new Date(),
      createdBy: masterUserId,
    });
  } else if (!cafe1.operationsPinHash) {
    cafe1.operationsPinHash = defaultCafePinHash;
    cafe1.operationsPinSetAt = new Date();
    await cafe1.save();
  }

  const cafe2 = await Cafe.findOne({ organisationId, cafeId: 'ZC-0002' });
  if (!cafe2) {
    await Cafe.create({
      cafeId: 'ZC-0002',
      organisationId,
      name: 'Indiranagar Central Branch',
      displayName: 'Indiranagar Central',
      cafeType: 'STANDARD_CAFE',
      status: 'ACTIVE',
      address: {
        building: 'Zamorin Coffee House',
        street: '100 Feet Road, HAL 2nd Stage',
        area: 'Indiranagar',
        city: 'Bengaluru',
        state: 'Karnataka',
        pinCode: '560038',
      },
      operationsPinHash: defaultCafePinHash,
      operationsPinSetAt: new Date(),
      createdBy: masterUserId,
    });
  } else if (!cafe2.operationsPinHash) {
    cafe2.operationsPinHash = defaultCafePinHash;
    cafe2.operationsPinSetAt = new Date();
    await cafe2.save();
  }

  // 1. Seed Cafe Operations Devices
  const dev1 = await DeviceRegistration.findOne({ deviceId: 'ZC-DEV-0001' });
  if (!dev1) {
    await DeviceRegistration.create({
      deviceId: 'ZC-DEV-0001',
      organisationId,
      deviceName: 'Koramangala Main Operations Tablet',
      deviceClass: 'CAFE_OWNED',
      assignedCafeId: 'ZC-0001',
      status: 'ACTIVE',
      trustLevel: 'ENROLLED',
      enrollmentApprovedBy: masterUserId,
      enrollmentApprovedAt: new Date(),
      lastSeenAt: new Date(),
      lastSyncAt: new Date(),
      policyVersion: 1,
      deviceVersion: 1,
    });
  }

  const dev2 = await DeviceRegistration.findOne({ deviceId: 'ZC-DEV-0002' });
  if (!dev2) {
    await DeviceRegistration.create({
      deviceId: 'ZC-DEV-0002',
      organisationId,
      deviceName: 'Indiranagar Central Operations Terminal',
      deviceClass: 'CAFE_OWNED',
      assignedCafeId: 'ZC-0002',
      status: 'ACTIVE',
      trustLevel: 'ENROLLED',
      enrollmentApprovedBy: masterUserId,
      enrollmentApprovedAt: new Date(),
      lastSeenAt: new Date(),
      lastSyncAt: new Date(),
      policyVersion: 1,
      deviceVersion: 1,
    });
  }

  // 2. Seed Sample Operator Users with 6-digit PIN
  const pin1 = process.env.INITIAL_OPERATOR_PIN_1 || crypto.randomInt(100000, 999999).toString();
  const pin2 = process.env.INITIAL_OPERATOR_PIN_2 || crypto.randomInt(100000, 999999).toString();
  const pin1Hash = await bcrypt.hash(pin1, 10);
  const pin2Hash = await bcrypt.hash(pin2, 10);

  const demoUserPassword = process.env.INITIAL_DEMO_PASSWORD || crypto.randomBytes(24).toString('base64url');
  const defaultPasswordHash = await bcrypt.hash(demoUserPassword, 10);

  const existingAdmin1 = await User.findOne({ organisationId, userId: 'AD-0001' });
  if (!existingAdmin1) {
    await User.create({
      userId: 'AD-0001',
      organisationId,
      name: 'Rahul K (Operations Lead)',
      email: 'rahul.ops@zamorin.cafe',
      role: 'CAFE_ADMIN',
      accountStatus: 'ACTIVE',
      primaryCafeId: 'ZC-0001',
      assignedCafeIds: ['ZC-0001'],
      passwordHash: defaultPasswordHash,
      operatorPinHash: pin1Hash,
      operatorPinSetAt: new Date(),
      isPrimaryMaster: false,
      createdBy: masterUserId,
      updatedBy: masterUserId,
    });
  } else if (!existingAdmin1.operatorPinHash) {
    existingAdmin1.operatorPinHash = pin1Hash;
    existingAdmin1.operatorPinSetAt = new Date();
    await existingAdmin1.save();
  }

  const existingAdmin2 = await User.findOne({ organisationId, userId: 'AD-0002' });
  if (!existingAdmin2) {
    await User.create({
      userId: 'AD-0002',
      organisationId,
      name: 'Priya Nair (Shift Supervisor)',
      email: 'priya.ops@zamorin.cafe',
      role: 'CAFE_ADMIN',
      accountStatus: 'ACTIVE',
      primaryCafeId: 'ZC-0002',
      assignedCafeIds: ['ZC-0002'],
      passwordHash: defaultPasswordHash,
      operatorPinHash: pin2Hash,
      operatorPinSetAt: new Date(),
      isPrimaryMaster: false,
      createdBy: masterUserId,
      updatedBy: masterUserId,
    });
  } else if (!existingAdmin2.operatorPinHash) {
    existingAdmin2.operatorPinHash = pin2Hash;
    existingAdmin2.operatorPinSetAt = new Date();
    await existingAdmin2.save();
  }

  // 3. Seed Canonical Role Accounts for Complete Role Recognition

  // Normal Master Account is permanently retired under Four-Persona Topology.
  // Legacy account (if present) must be disabled with reason ROLE_RETIRED_NORMAL_MASTER.
  const existingNormalMaster = await User.findOne({ organisationId, email: 'normal.master@example.com' });
  if (existingNormalMaster && existingNormalMaster.accountStatus !== 'DISABLED') {
    existingNormalMaster.accountStatus = 'DISABLED';
    existingNormalMaster.statusReason = 'ROLE_RETIRED_NORMAL_MASTER';
    await existingNormalMaster.save();
  }

  // Owner Account
  const existingOwner = await User.findOne({ organisationId, email: 'owner@example.com' });
  if (!existingOwner) {
    await User.create({
      userId: 'OW-0001',
      organisationId,
      name: 'Zamorin Owner',
      email: 'owner@example.com',
      role: 'OWNER',
      accountStatus: 'ACTIVE',
      primaryCafeId: 'ZC-0001',
      assignedCafeIds: ['ZC-0001', 'ZC-0002'],
      passwordHash: defaultPasswordHash,
      isPrimaryMaster: false,
      createdBy: masterUserId,
      updatedBy: masterUserId,
    });
  } else if (!existingOwner.assignedCafeIds || existingOwner.assignedCafeIds.length === 0) {
    existingOwner.primaryCafeId = existingOwner.primaryCafeId || 'ZC-0001';
    existingOwner.assignedCafeIds = ['ZC-0001', 'ZC-0002'];
    await existingOwner.save();
  }

  // Admin Account (Ops)
  const existingAdmin = await User.findOne({ organisationId, email: 'admin@example.com' });
  if (!existingAdmin) {
    await User.create({
      userId: 'AD-0003',
      organisationId,
      name: 'Cafe Admin (Ops)',
      email: 'admin@example.com',
      role: 'CAFE_ADMIN',
      accountStatus: 'ACTIVE',
      primaryCafeId: 'ZC-0001',
      assignedCafeIds: ['ZC-0001'],
      passwordHash: defaultPasswordHash,
      isPrimaryMaster: false,
      createdBy: masterUserId,
      updatedBy: masterUserId,
    });
  }

  // Staff / Normal Employee Account
  const existingStaff = await User.findOne({ organisationId, email: 'staff@example.com' });
  if (!existingStaff) {
    await User.create({
      userId: 'ST-0001',
      organisationId,
      name: 'Normal Employee / Staff',
      email: 'staff@example.com',
      role: 'STAFF',
      accountStatus: 'ACTIVE',
      primaryCafeId: 'ZC-0001',
      assignedCafeIds: ['ZC-0001'],
      passwordHash: defaultPasswordHash,
      isPrimaryMaster: false,
      createdBy: masterUserId,
      updatedBy: masterUserId,
    });
  }
}

async function runSeed() {
  const env = loadEnvironment();
  await connectDatabase({ uri: env.mongodbUri });
  try {
    const organisationId = env.initialOrganisationId || 'ZAMORIN';
    const masterPassword =
      env.initialMasterPassword ||
      process.env.INITIAL_MASTER_PASSWORD ||
      (process.env.NODE_ENV !== 'production' ? crypto.randomBytes(24).toString('base64url') : '');
    if (!masterPassword) {
      throw new Error('Initial master password is required to seed master user.');
    }
    const master = await seedMasterUser({
      organisationId,
      masterName: env.initialMasterName || 'Zamorin Master',
      masterEmail: env.initialMasterEmail || 'master@example.com',
      masterPassword,
    });
    await seedPermissionRules({ organisationId, masterUserId: master.userId });
    await seedSystemCommunicationSettings({ organisationId, masterEmail: env.initialMasterEmail || 'master@example.com' });

    const isMinimal = process.env.SEED_MINIMAL === 'true' || process.env.SEED_DEMO_DATA === 'false' || process.env.NODE_ENV === 'production';
    if (!isMinimal) {
      await seedDepartmentOrdersData({ organisationId, masterUserId: master.userId });
      await seedWorkforceData({ organisationId, masterUserId: master.userId });
      await seedExpensePolicyData({ organisationId, masterUserId: master.userId });
      await seedFinanceData({ organisationId, masterUserId: master.userId });
      await seedInventoryData({ organisationId, masterUserId: master.userId });
      await seedMenuData({ organisationId, masterUserId: master.userId });
      await seedLoansData({ organisationId, masterUserId: master.userId });
      await seedCafeOperationsData(organisationId, master.userId);
    }
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  runSeed();
}

module.exports = {
  DEFAULT_PERMISSION_RULES,
  PRIMARY_MASTER_DESIGNATION_REASON,
  assertPrimaryMasterCandidate,
  seedMasterUser,
  seedPermissionRules,
  seedSystemCommunicationSettings,
  seedDepartmentOrdersData,
  seedWorkforceData,
  seedExpensePolicyData,
  seedFinanceData,
  seedInventoryData,
  seedMenuData,
  seedLoansData,
  runSeed,
};
