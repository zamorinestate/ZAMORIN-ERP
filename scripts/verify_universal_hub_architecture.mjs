// =============================================================================
// Universal Module Hub & Dedicated Child Workspace Verification Audit Script
// Validates syntax and pattern compliance across all 17 management modules.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(__dirname, '../frontend/src/js');

const MODULES = [
  { name: 'Payroll Management', file: 'pages/payrollManagement.js', setter: 'setPayrollActiveTab', tileAttr: 'data-payroll-hub-tile', backBtn: 'payroll-back-to-hub-btn' },
  { name: 'Attendance & Shifts', file: 'modules/attendance/attendanceShifts.js', setter: 'setAttendanceActiveTab', tileAttr: 'data-attendance-hub-tile', backBtn: 'attendance-back-to-hub-btn' },
  { name: 'Inventory', file: 'pages/inventory.js', setter: 'setInventoryActiveTab', tileAttr: 'data-inv-hub-tile', backBtn: 'inv-back-to-hub-btn' },
  { name: 'Procurement', file: 'pages/procurement.js', setter: 'setProcurementActiveTab', tileAttr: 'data-proc-hub-tile', backBtn: 'proc-back-to-hub-btn' },
  { name: 'Assets & Equipment', file: 'pages/assets.js', setter: 'setAssetsActiveTab', tileAttr: 'data-assets-hub-tile', backBtn: 'assets-back-to-hub-btn' },
  { name: 'Quality & FSMS', file: 'pages/quality.js', setter: 'setQualityActiveTab', tileAttr: 'data-quality-hub-tile', backBtn: 'quality-back-to-hub-btn' },
  { name: 'Employees & HRIS', file: 'pages/employees.js', setter: 'setEmployeesActiveTab', tileAttr: 'data-workforce-hub-tile', backBtn: 'workforce-back-to-hub-btn' },
  { name: 'Owner Bills', file: 'pages/ownerBills.js', setter: 'setBillsActiveTab', tileAttr: 'data-bills-hub-tile', backBtn: 'bills-back-to-hub-btn' },
  { name: 'Expenses', file: 'pages/expenses.js', setter: 'setExpensesActiveTab', tileAttr: 'data-exp-hub-tile', backBtn: 'exp-back-to-hub-btn' },
  { name: 'Finance & Accounts', file: 'pages/financeAccounts.js', setter: 'setFinanceActiveTab', tileAttr: 'data-fin-hub-tile', backBtn: 'fin-back-to-hub-btn' },
  { name: 'Customers & Loyalty', file: 'pages/customers.js', setter: 'setCustomersActiveTab', tileAttr: 'data-cust-hub-tile', backBtn: 'cust-back-to-hub-btn' },
  { name: 'Menu & Recipes', file: 'pages/menuManagement.js', setter: 'setMenuActiveTab', tileAttr: 'data-menu-hub-tile', backBtn: 'menu-back-to-hub-btn' },
  { name: 'Vendors & Suppliers', file: 'pages/vendors.js', setter: 'setVendorsActiveTab', tileAttr: 'data-vnd-hub-tile', backBtn: 'vnd-back-to-hub-btn' },
  { name: 'Revenue Share', file: 'pages/revenueShare.js', setter: 'setRevenueShareActiveTab', tileAttr: 'data-rs-hub-tile', backBtn: 'rs-back-to-hub-btn' },
  { name: 'Reports & Analytics', file: 'pages/reportsAnalytics.js', setter: 'setReportsActiveTab', tileAttr: 'data-analytics-hub-tile', backBtn: 'analytics-back-to-hub-btn' },
  { name: 'Administration', file: 'pages/administration.js', setter: 'setAdminActiveTab', tileAttr: 'data-admin-hub-tile', backBtn: 'admin-back-to-hub-btn' },
  { name: 'Devices & Sessions', file: 'pages/cafeOperationsDevices.js', setter: 'setCafeDevicesActiveTab', tileAttr: 'data-devices-hub-tile', backBtn: 'devices-back-to-hub-btn' },
];

console.log('=============================================================================');
console.log('UNIVERSAL MODULE HUB ARCHITECTURE AUDIT VERIFICATION');
console.log('=============================================================================\n');

let passed = 0;
let failed = 0;

for (const mod of MODULES) {
  const filePath = path.join(FRONTEND_DIR, mod.file);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ [MISSING FILE] ${mod.name}: ${mod.file}`);
    failed++;
    continue;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const checks = [];

  // Check 1: Setter export
  const hasSetter = content.includes(`export function ${mod.setter}`) || content.includes(`export const ${mod.setter}`);
  checks.push({ name: `Export ${mod.setter}`, passed: hasSetter });

  // Check 2: Level 1 Hub Tiles Attribute
  const hasTileAttr = content.includes(mod.tileAttr);
  checks.push({ name: `Hub Tiles (${mod.tileAttr})`, passed: hasTileAttr });

  // Check 3: Level 2 Back Button
  const hasBackBtn = content.includes(mod.backBtn);
  checks.push({ name: `Back to Hub Button (#${mod.backBtn})`, passed: hasBackBtn });

  // Check 4: Subroute acceptance in render
  const hasSubrouteInRender = content.includes('render') && (content.includes('subroute') || content.includes('activeTab') || content.includes('activeSection'));
  checks.push({ name: 'Subroute Handler', passed: hasSubrouteInRender });

  const allPassed = checks.every(c => c.passed);
  if (allPassed) {
    console.log(`✅ [PASS] ${mod.name.padEnd(24)} (${mod.file})`);
    passed++;
  } else {
    console.log(`❌ [FAIL] ${mod.name.padEnd(24)} (${mod.file})`);
    for (const c of checks) {
      if (!c.passed) console.log(`   - FAILED: ${c.name}`);
    }
    failed++;
  }
}

// Router verification
console.log('\n--- Router Subroute Dispatch Verification ---');
const routerPath = path.join(FRONTEND_DIR, 'router.js');
const routerContent = fs.readFileSync(routerPath, 'utf-8');

const routerChecks = [
  { name: 'Base route and subroute split', passed: routerContent.includes('const [baseRoute, ...subSegments] = routePath.split("/")') },
  { name: 'Subroute dispatch switch (baseRoute)', passed: routerContent.includes('switch (baseRoute)') },
  { name: 'updateSidebarActive with state.route', passed: routerContent.includes('updateSidebarActive(state.route)') },
];

for (const rc of routerChecks) {
  if (rc.passed) {
    console.log(`✅ [PASS] ${rc.name}`);
    passed++;
  } else {
    console.log(`❌ [FAIL] ${rc.name}`);
    failed++;
  }
}

console.log('\n=============================================================================');
console.log(`TOTAL CHECKS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('=============================================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  console.log('ALL MODULES CONFORM STRICTLY TO THE UNIVERSAL HUB ARCHITECTURE REFERENCE PATTERN!');
}
