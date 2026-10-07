'use strict';

const express = require('express');

const authRoutes =
  require('./authRoutes');

const cafeRoutes =
  require('./cafeRoutes');

const cafeAccessRoutes =
  require('./cafeAccessRoutes');

const userRoutes =
  require('./userRoutes');

const employeeRoutes =
  require('./employeeRoutes');

const auditRoutes =
  require('./auditRoutes');

const notificationRoutes =
  require('./notificationRoutes');

const attendanceRoutes =
  require('../modules/attendance/attendanceRoutes');

const leaveRoutes =
  require('./leaveRoutes');

const cashRoutes =
  require('./cashRoutes');

const expenseRoutes =
  require('./expenseRoutes');

const financeRoutes =
  require('./financeRoutes');

const vendorLedgerRoutes =
  require('./vendorLedgerRoutes');

const reportRoutes =
  require('./reportRoutes');

const reportingProductivityRoutes =
  require('./reportingProductivityRoutes');

const payrollRoutes =
  require('./payrollRoutes');

const loanAdvanceRoutes =
  require('./loanAdvanceRoutes');

const personalLedgerRoutes =
  require('./personalLedgerRoutes');

const passbookRoutes =
  require('./passbookRoutes');

const inventoryRoutes =
  require('./inventoryRoutes');

const vendorRoutes =
  require('./vendorRoutes');

const vendorPortalRoutes =
  require('./vendorPortalRoutes');

const procurementRoutes =
  require('./procurementRoutes');

const menuRoutes =
  require('./menuRoutes');

const billRoutes =
  require('./billRoutes');

const customerRoutes =
  require('./customerRoutes');

const taskRoutes =
  require('./taskRoutes');

const approvalRoutes =
  require('./approvalRoutes');

const qualityRoutes =
  require('./qualityRoutes');

const foodSafetyGovernanceRoutes =
  require('./foodSafetyGovernanceRoutes');

const ownerRiskAuditRoutes =
  require('./ownerRiskAuditRoutes');

const ownerPlanningRoutes =
  require('./ownerPlanningRoutes');

const ownerComplianceRoutes =
  require('./ownerComplianceRoutes');

const ownerSupplierIntelligenceRoutes =
  require('./ownerSupplierIntelligenceRoutes');

const ownerAcademyRoutes =
  require('./ownerAcademyRoutes');

const ownerAssetReliabilityRoutes =
  require('./ownerAssetReliabilityRoutes');

const ownerPrivacyCyberRoutes =
  require('./ownerPrivacyCyberRoutes');

const ownerBcdrRoutes =
  require('./ownerBcdrRoutes');

const ownerMasterDataRoutes =
  require('./ownerMasterDataRoutes');

const ownerComplaintsRoutes =
  require('./ownerComplaintsRoutes');

const ownerMenuPricingRoutes =
  require('./ownerMenuPricingRoutes');

const ownerCustomerLoyaltyRoutes =
  require('./ownerCustomerLoyaltyRoutes');

const ownerUtilitiesWasteRoutes =
  require('./ownerUtilitiesWasteRoutes');

const ownerGovernanceDelegationRoutes =
  require('./ownerGovernanceDelegationRoutes');

const assetRoutes =
  require('./assetRoutes');

const departmentOrderRoutes =
  require('./departmentOrderRoutes');

const revenueShareRoutes =
  require('./revenueShareRoutes');

const dashboardRoutes =
  require('./dashboardRoutes');

const fileRoutes =
  require('./fileRoutes');

const documentRoutes =
  require('./documentRoutes');

const trashRoutes =
  require('./trashRoutes');

const searchRoutes =
  require('./searchRoutes');

const customFieldRoutes =
  require('./customFieldRoutes');

const expansionModulesRoutes =
  require('./expansionModulesRoutes');

const adminRoutes =
  require('./adminRoutes');

const settingsRoutes =
  require('./settingsRoutes');

const kdsRoutes =
  require('./kdsRoutes');

const systemRoutes =
  require('./systemRoutes');

const shiftRoutes =
  require('./shiftRoutes');

const holidayRoutes =
  require('./holidayRoutes');

const exportRoutes =
  require('./exportRoutes');

const universalQrRoutes =
  require('./universalQrRoutes');

const hardwareRoutes =
  require('./hardwareRoutes');

const posRoutes =
  require('./posRoutes');

const analyticsRoutes =
  require('./analyticsRoutes');

const router = express.Router();

router.use(
  '/admin',
  adminRoutes
);

router.use(
  '/auth',
  authRoutes
);

router.use(
  '/cafes',
  cafeRoutes
);

router.use(
  '/cafe-access',
  cafeAccessRoutes
);

router.use(
  '/cafe-operations/access',
  cafeAccessRoutes
);

router.use(
  '/users',
  userRoutes
);

router.use(
  '/employees',
  employeeRoutes
);

router.use(
  '/audit-events',
  auditRoutes
);

router.use(
  '/notifications',
  notificationRoutes
);

router.use(
  '/attendance',
  attendanceRoutes
);

router.use(
  '/shifts',
  shiftRoutes
);

router.use(
  '/holidays',
  holidayRoutes
);

router.use(
  '/leave',
  leaveRoutes
);

router.use(
  '/cash-transactions',
  cashRoutes
);

router.use(
  '/expenses',
  expenseRoutes
);

router.use(
  '/finance',
  financeRoutes
);

router.use(
  '/vendor-ledger',
  vendorLedgerRoutes
);

router.use(
  '/reports',
  reportRoutes
);

router.use(
  '/reporting-productivity',
  reportingProductivityRoutes
);

router.use(
  '/payroll',
  payrollRoutes
);

router.use(
  '/loan-advances',
  loanAdvanceRoutes
);

router.use(
  '/personal-ledger',
  personalLedgerRoutes
);

router.use(
  '/passbook',
  passbookRoutes
);

router.use(
  '/inventory',
  inventoryRoutes
);

router.use(
  '/vendors',
  vendorRoutes
);

router.use(
  '/vendor-portal',
  vendorPortalRoutes
);

router.use(
  '/procurement',
  procurementRoutes
);

router.use(
  '/menu',
  menuRoutes
);

router.use(
  '/bills',
  billRoutes
);

router.use(
  '/customers',
  customerRoutes
);

router.use(
  '/tasks',
  taskRoutes
);

router.use(
  '/approvals',
  approvalRoutes
);

router.use(
  '/quality',
  qualityRoutes
);

router.use(
  '/food-safety',
  foodSafetyGovernanceRoutes
);

router.use(
  '/risk-audit',
  ownerRiskAuditRoutes
);

router.use(
  '/planning',
  ownerPlanningRoutes
);

router.use(
  '/compliance',
  ownerComplianceRoutes
);

router.use(
  '/supplier-intelligence',
  ownerSupplierIntelligenceRoutes
);

router.use(
  '/academy',
  ownerAcademyRoutes
);

router.use(
  '/asset-reliability',
  ownerAssetReliabilityRoutes
);

router.use(
  '/privacy-cyber',
  ownerPrivacyCyberRoutes
);

router.use(
  '/bcdr',
  ownerBcdrRoutes
);

router.use(
  '/master-data',
  ownerMasterDataRoutes
);

router.use(
  '/complaints',
  ownerComplaintsRoutes
);

router.use(
  '/menu-pricing',
  ownerMenuPricingRoutes
);

router.use(
  '/customer-loyalty',
  ownerCustomerLoyaltyRoutes
);

router.use(
  '/utilities-waste',
  ownerUtilitiesWasteRoutes
);

router.use(
  '/governance-delegation',
  ownerGovernanceDelegationRoutes
);

// Strategic Portfolio /owner/* mounts
router.use('/owner/complaints', ownerComplaintsRoutes);
router.use('/owner/menu-pricing', ownerMenuPricingRoutes);
router.use('/owner/customer-loyalty', ownerCustomerLoyaltyRoutes);
router.use('/owner/utilities-waste', ownerUtilitiesWasteRoutes);
router.use('/owner/governance-delegation', ownerGovernanceDelegationRoutes);

router.use(
  '/assets',
  assetRoutes
);

router.use(
  '/department-orders',
  departmentOrderRoutes
);

router.use(
  '/revenue-share',
  revenueShareRoutes
);

router.use(
  '/dashboard',
  dashboardRoutes
);

router.use(
  '/files',
  fileRoutes
);

router.use(
  '/documents',
  documentRoutes
);

router.use(
  '/trash',
  trashRoutes
);

router.use(
  '/search',
  searchRoutes
);

router.use(
  '/custom-fields',
  customFieldRoutes
);

const deviceRoutes =
  require('./deviceRoutes');

const operatorSessionRoutes =
  require('./operatorSessionRoutes');

router.use(
  '/devices',
  deviceRoutes
);

router.use(
  '/cafe-devices',
  deviceRoutes
);

router.use(
  '/cafe-operations/devices',
  deviceRoutes
);

router.use(
  '/cafe-operations/operator',
  operatorSessionRoutes
);

router.use(
  '/operator',
  operatorSessionRoutes
);

const mailOpsRoutes = require('./mailOpsRoutes');
const cafeOpsRoutes = require('../cafe-operations/routes');

router.use(
  '/cafe-ops',
  cafeOpsRoutes
);

router.use(
  '/mailops',
  mailOpsRoutes
);

router.use(
  '/settings',
  settingsRoutes
);

router.use(
  '/kds',
  kdsRoutes
);

router.use(
  '/system',
  systemRoutes
);

router.use(
  '/exports',
  exportRoutes
);

router.use(
  '/qr',
  universalQrRoutes
);

router.use(
  '/hardware',
  hardwareRoutes
);

router.use(
  '/pos',
  posRoutes
);

router.use(
  '/analytics',
  analyticsRoutes
);

const sharedInfrastructureRoutes =
  require('./sharedInfrastructureRoutes');

const dailyCloseRoutes =
  require('./dailyCloseRoutes');

router.use(
  '/shared-infra',
  sharedInfrastructureRoutes
);

router.use(
  '/daily-close',
  dailyCloseRoutes
);

router.use(
  '/',
  expansionModulesRoutes
);

router.get(
  '/',
  (request, response) => {
    return response
      .status(200)
      .json({
        success: true,

        message:
          'Zamorin Cafe ERP API is running.',

        version: 'v1',

        correlationId:
          request.correlationId || null,
      });
  }
);

module.exports = router;
