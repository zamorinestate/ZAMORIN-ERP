'use strict';

/**
 * ZAMORIN CAFÉ ERP — REPORTING FOUNDATION
 * Module: reportRegistry.js
 * 
 * Central Canonical Report Registry:
 * - Governs allowable report definitions, categories, and permission thresholds.
 * - Establishes report classification (INTERNAL, CONFIDENTIAL, HIGHLY_CONFIDENTIAL).
 * - Establishes trust levels (CERTIFIED, OPERATIONAL, ESTIMATED, FORECAST, CUSTOM, DATA_ISSUE).
 * - Maps core reports to their constituent source metrics and lineage.
 */

const REPORT_CATEGORIES = {
  EXECUTIVE: {
    id: 'EXECUTIVE',
    label: 'Executive & Management',
    description: 'Monitor high-level organizational health, core portfolio performance, and executive indicators.',
    icon: '📊',
  },
  SALES_REVENUE: {
    id: 'SALES_REVENUE',
    label: 'Sales & Revenue',
    description: 'Understand revenue, orders, discounts, refunds, tax, payment mix and sales trends.',
    icon: '🛒',
  },
  MENU_PRODUCT: {
    id: 'MENU_PRODUCT',
    label: 'Menu & Product Performance',
    description: 'Evaluate dish velocity, product contribution margins, Boston-box popularity, and category mix.',
    icon: '☕',
  },
  FINANCE_PROFITABILITY: {
    id: 'FINANCE_PROFITABILITY',
    label: 'Finance & Profitability',
    description: 'Track store-level revenue, operating expenses and available profitability metrics.',
    icon: '💰',
  },
  CASH_PAYMENTS: {
    id: 'CASH_PAYMENTS',
    label: 'Cash & Payments',
    description: 'Audit register session floats, cash collections, safe drops, payouts, and tender variances.',
    icon: '💵',
  },
  INVENTORY_COGS: {
    id: 'INVENTORY_COGS',
    label: 'Inventory & Cost',
    description: 'Understand current inventory value, movement, waste and stock availability.',
    icon: '📦',
  },
  PROCUREMENT_VENDORS: {
    id: 'PROCUREMENT_VENDORS',
    label: 'Procurement & Vendors',
    description: 'Review purchase commitments, supplier spend distribution, price variances, and deliveries.',
    icon: '🚚',
  },
  WASTE_LOSS: {
    id: 'WASTE_LOSS',
    label: 'Waste & Loss',
    description: 'Analyze food waste, expired inventory lots, recipe variances, and operational shrink (Reserved domain — no governed reports currently active).',
    icon: '🗑️',
  },
  WORKFORCE: {
    id: 'WORKFORCE',
    label: 'Workforce',
    description: 'Monitor workforce productivity, labour cost percentage, attendance exceptions, and scheduling.',
    icon: '👥',
  },
  ATTENDANCE_SHIFTS: {
    id: 'ATTENDANCE_SHIFTS',
    label: 'Attendance & Shifts',
    description: 'Review shift rosters, employee punches, tardiness patterns, and shift handover compliance.',
    icon: '⏱️',
  },
  PAYROLL: {
    id: 'PAYROLL',
    label: 'Payroll',
    description: 'Track salary disbursements, overtime payments, advance deductions, and statutory liabilities.',
    icon: '💳',
  },
  CUSTOMERS_LOYALTY: {
    id: 'CUSTOMERS_LOYALTY',
    label: 'Customers & Loyalty',
    description: 'Analyze customer visit frequency, retention cohorts, loyalty point velocity, and repeat spend.',
    icon: '💎',
  },
  POS_BILLING_CONTROL: {
    id: 'POS_BILLING_CONTROL',
    label: 'POS & Billing Control',
    description: 'Audit cancelled receipts, bill discounts, line voids, reprints, and cashier integrity (PM-02H Activated).',
    icon: '🧾',
  },
  OPERATIONS_SERVICE: {
    id: 'OPERATIONS_SERVICE',
    label: 'Operations & Service',
    description: 'Track kitchen prep times, table turnover, fulfillment speed, and service mode efficiency (PM-02H Activated).',
    icon: '🛎️',
  },
  QUALITY_COMPLIANCE: {
    id: 'QUALITY_COMPLIANCE',
    label: 'Quality & Compliance',
    description: 'Monitor food safety checklists, temperature logs, hygiene audits, and active CAPAs.',
    icon: '🛡️',
  },
  MULTI_CAFE: {
    id: 'MULTI_CAFE',
    label: 'Multi-Café Performance',
    description: 'Benchmark like-for-like sales growth, mature store pacing, and branch comparisons.',
    icon: '🌐',
  },
  BUDGET_VARIANCE: {
    id: 'BUDGET_VARIANCE',
    label: 'Budget & Variance',
    description: 'Compare planned revenue and opex budgets against actuals and investigate variances.',
    icon: '🎯',
  },
  FORECASTING: {
    id: 'FORECASTING',
    label: 'Forecasting & Planning',
    description: 'Predictive demand models, sales projections, and future scenarios (Reserved domain — no governed reports currently active).',
    icon: '📈',
  },
  REVENUE_SHARE: {
    id: 'REVENUE_SHARE',
    label: 'Revenue Share',
    description: 'Review franchise revenue sharing agreements, concession settlements, and partner splits (Reserved domain — no governed reports currently active).',
    icon: '🤝',
  },
  TREASURY_LEDGER: {
    id: 'TREASURY_LEDGER',
    label: 'Treasury & Ledger',
    description: 'Monitor bank account balances, petty cash floats, passbook reconciliations, and liquidity (Reserved domain — no governed reports currently active).',
    icon: '🏛️',
  },
  ASSETS_MAINTENANCE: {
    id: 'ASSETS_MAINTENANCE',
    label: 'Assets & Maintenance',
    description: 'Track equipment uptime, preventive maintenance compliance, MTBF, and repair expenses.',
    icon: '⚙️',
  },
  TASKS_APPROVALS: {
    id: 'TASKS_APPROVALS',
    label: 'Tasks & Approvals',
    description: 'Monitor operational governance tasks, pending management approvals, and SLA completion.',
    icon: '✅',
  },
  AUDIT_EXCEPTIONS: {
    id: 'AUDIT_EXCEPTIONS',
    label: 'Audit & Exceptions',
    description: 'Investigate system security logs, ledger reconciliations, anomalies, and policy breaches.',
    icon: '⚖️',
  },
  TAX_STATUTORY: {
    id: 'TAX_STATUTORY',
    label: 'Tax & Statutory',
    description: 'Review GST collections, input tax credits, and statutory filings (Reserved domain — no governed reports currently active).',
    icon: '📋',
  },
  CUSTOM: {
    id: 'CUSTOM',
    label: 'Custom Reports',
    description: 'User-defined ad-hoc report views and custom queries (Reserved domain — governed builder scheduled for PM-02M).',
    icon: '🔍',
  },
};

const REPORT_CLASSIFICATIONS = {
  INTERNAL: {
    code: 'INTERNAL',
    label: 'Internal Operational',
    description: 'General operational reporting accessible to authorized store management and above.',
  },
  CONFIDENTIAL: {
    code: 'CONFIDENTIAL',
    label: 'Confidential Commercial',
    description: 'Financial ledgers, supplier contracts, and margins restricted to Owner and Master.',
  },
  HIGHLY_CONFIDENTIAL: {
    code: 'HIGHLY_CONFIDENTIAL',
    label: 'Highly Confidential / Statutory',
    description: 'Individual employee compensation, statutory filings, and executive distributions.',
  },
};

const REPORT_TRUST_LEVELS = {
  CERTIFIED: {
    code: 'CERTIFIED',
    label: 'Certified Financial / Reconciled',
    description: 'Reconciled against double-entry General Ledger postings or closed register sessions.',
  },
  OPERATIONAL: {
    code: 'OPERATIONAL',
    label: 'Live Operational Snapshot',
    description: 'Dynamic operational aggregate from live store tills; subject to end-of-day close.',
  },
  ESTIMATED: {
    code: 'ESTIMATED',
    label: 'BOM / Engineered Estimate',
    description: 'Calculated using recipe BOM standard costing or statistical models.',
  },
  FORECAST: {
    code: 'FORECAST',
    label: 'Forward-Looking Projection',
    description: 'Predictive scenario; not an audited actual.',
  },
  CUSTOM: {
    code: 'CUSTOM',
    label: 'User-Configured Query',
    description: 'Ad-hoc user view combining governed metrics.',
  },
  DATA_ISSUE: {
    code: 'DATA_ISSUE',
    label: 'Source Discrepancy / Hold',
    description: 'Data has unresolved ledger variance or missing canonical source.',
  },
};

const CANONICAL_REPORTS = {
  'daily-sales': {
    reportId: 'daily-sales',
    title: 'Daily Sales & Operations Summary',
    description: 'Gross to net sales revenue, hourly velocity, fulfillment channels, and payment tender mix.',
    category: 'SALES_REVENUE',
    classification: 'INTERNAL',
    trustLevel: 'OPERATIONAL',
    actuality: 'ACTUAL',
    runnable: true,
    endpoint: '/api/v1/reports/sales',
    frontendSubroute: 'sales',
    requiredPermission: 'REPORTS_READ',
    supportedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'],
    supportedDimensions: ['BUSINESS_DATE', 'HOUR', 'DAY_OF_WEEK', 'CAFE', 'MENU_CATEGORY', 'MENU_ITEM', 'MODIFIER', 'SERVICE_MODE', 'ORDER_SOURCE', 'PAYMENT_METHOD', 'OPERATOR'],
    supportedFilters: ['period', 'cafeId', 'serviceMode', 'paymentMethod', 'category', 'menuItemId', 'view', 'dateFrom', 'dateTo', 'compare'],
    supportedExports: ['PDF', 'XLSX'],
    supportedVisuals: ['KPI_CARDS', 'HOURLY_CHART', 'TENDER_DONUT', 'SERVICE_BARS', 'SALES_HEATMAP', 'PARETO_CHART', 'CATEGORY_BARS'],
    sourceMetrics: ['GROSS_SALES', 'SALES_BEFORE_TAX', 'NET_SALES', 'ORDER_COUNT', 'AVERAGE_ORDER_VALUE', 'DISCOUNT_AMOUNT', 'CUSTOMER_REFUND_TOTAL', 'PRE_TAX_REFUND', 'TAX_CHARGED', 'NET_TAX', 'MODIFIER_ATTACH_RATE', 'BILL_PENETRATION'],
    drillTargets: ['sales-register', 'tender-breakdown', 'menu-item-pmix'],
  },

  'pl-statement': {
    reportId: 'pl-statement',
    title: 'Profit & Loss Statement & Waterfall',
    description: 'Store-level P&L statement waterfall. Note: authoritative COGS and downstream profitability metrics are currently unavailable.',
    category: 'FINANCE_PROFITABILITY',
    classification: 'CONFIDENTIAL',
    trustLevel: 'DATA_ISSUE',
    actuality: 'ACTUAL',
    availability: 'PARTIAL',
    dataQuality: 'PARTIAL',
    runnable: true,
    endpoint: '/api/v1/reports/finance',
    frontendSubroute: 'finance',
    requiredPermission: 'REPORTS_READ',
    supportedRoles: ['MASTER', 'OWNER'],
    supportedDimensions: ['BUSINESS_DATE', 'CAFE', 'EXPENSE_CATEGORY'],
    supportedFilters: ['period', 'cafeId', 'dateFrom', 'dateTo'],
    supportedExports: ['PDF', 'XLSX'],
    supportedVisuals: ['PL_TABLE', 'WATERFALL', 'MARGIN_CARDS'],
    sourceMetrics: ['GROSS_SALES', 'NET_SALES', 'COGS', 'LABOUR_COST', 'OPERATING_EXPENSE', 'EBITDA', 'EBITDA_MARGIN'],
    drillTargets: ['expense-ledger', 'payroll-run-detail'],
  },

  'cash-book-variance': {
    reportId: 'cash-book-variance',
    title: 'Cash Book & Register Variance',
    description: 'Till session opening floats, cash collections, pay-outs, safe drops, and blind count variances.',
    category: 'CASH_PAYMENTS',
    classification: 'INTERNAL',
    trustLevel: 'OPERATIONAL',
    actuality: 'ACTUAL',
    availability: 'AVAILABLE',
    runnable: true,
    endpoint: '/api/v1/reports/cash-flow',
    frontendSubroute: 'cash',
    requiredPermission: 'REPORTS_READ',
    supportedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'],
    supportedDimensions: ['BUSINESS_DATE', 'CAFE', 'EMPLOYEE'],
    supportedFilters: ['period', 'cafeId', 'dateFrom', 'dateTo'],
    supportedExports: ['PDF', 'XLSX'],
    supportedVisuals: ['TILL_VARIANCE_TABLE', 'CASH_FLOW_CHART'],
    sourceMetrics: ['NET_SALES', 'ORDER_COUNT'],
    drillTargets: ['register-session-detail'],
  },

  'workforce-overview': {
    reportId: 'workforce-overview',
    title: 'Workforce & Headcount Intelligence',
    description: 'Active headcount, café distribution, staffing ratios, and labour productivity metrics.',
    category: 'WORKFORCE',
    classification: 'INTERNAL',
    trustLevel: 'OPERATIONAL',
    actuality: 'ACTUAL',
    availability: 'AVAILABLE',
    runnable: true,
    endpoint: '/api/v1/reports/workforce',
    frontendSubroute: 'workforce',
    requiredPermission: 'REPORTS_READ',
    supportedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'],
    supportedDimensions: ['BUSINESS_DATE', 'CAFE', 'ROLE', 'SHIFT'],
    supportedFilters: ['period', 'cafeId', 'role', 'dateFrom', 'dateTo'],
    supportedExports: ['PDF', 'XLSX'],
    supportedVisuals: ['HEADCOUNT_BAR', 'ROLE_DISTRIBUTION_PIE', 'SPLH_CHART'],
    sourceMetrics: ['HEADCOUNT', 'LABOUR_HOURS', 'SALES_PER_LABOUR_HOUR', 'GROSS_PAYROLL_PERCENT'],
    drillTargets: ['employee-profile', 'attendance-audit-log'],
  },

  'attendance-exceptions': {
    reportId: 'attendance-exceptions',
    title: 'Attendance Exceptions & Labour Trends',
    description: 'Tardiness, missed punches, overtime approvals, and labour productivity ratios.',
    category: 'ATTENDANCE_SHIFTS',
    classification: 'INTERNAL',
    trustLevel: 'OPERATIONAL',
    actuality: 'ACTUAL',
    availability: 'AVAILABLE',
    runnable: true,
    endpoint: '/api/v1/reports/workforce',
    frontendSubroute: 'workforce',
    requiredPermission: 'REPORTS_READ',
    supportedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'],
    supportedDimensions: ['BUSINESS_DATE', 'CAFE', 'ROLE', 'SHIFT'],
    supportedFilters: ['period', 'cafeId', 'role', 'dateFrom', 'dateTo'],
    supportedExports: ['PDF', 'XLSX'],
    supportedVisuals: ['EXCEPTION_TABLE', 'SPLH_CHART'],
    sourceMetrics: ['LABOUR_HOURS', 'SALES_PER_LABOUR_HOUR', 'OVERTIME_HOURS', 'HEADCOUNT'],
    drillTargets: ['attendance-audit-log'],
  },

  'payroll-summary': {
    reportId: 'payroll-summary',
    title: 'Gross Payroll & Labour Cost Allocation',
    description: 'Authoritative gross payroll disbursements by café and role, overtime costs, and labour cost ratio.',
    category: 'PAYROLL',
    classification: 'CONFIDENTIAL',
    trustLevel: 'OPERATIONAL',
    actuality: 'ACTUAL',
    availability: 'AVAILABLE',
    runnable: true,
    endpoint: '/api/v1/reports/workforce',
    frontendSubroute: 'workforce',
    requiredPermission: 'REPORTS_READ',
    supportedRoles: ['MASTER', 'OWNER'],
    supportedDimensions: ['PERIOD', 'CAFE', 'ROLE'],
    supportedFilters: ['period', 'cafeId', 'dateFrom', 'dateTo'],
    supportedExports: ['PDF', 'XLSX'],
    supportedVisuals: ['PAYROLL_BY_CAFE_BAR', 'PAYROLL_BY_ROLE_BAR', 'LABOUR_PCT_CHART'],
    sourceMetrics: ['GROSS_PAYROLL', 'GROSS_PAYROLL_PERCENT', 'OVERTIME_HOURS'],
    drillTargets: ['payroll-run-detail'],
  },

  'customer-retention': {
    reportId: 'customer-retention',
    title: 'Customer Cohorts & Loyalty Repeat Index',
    description: 'New vs repeat customer spending velocity, loyalty redemption rates, and deterministic RFM distributions (PM-02H Activated).',
    category: 'CUSTOMERS_LOYALTY',
    classification: 'INTERNAL',
    trustLevel: 'OPERATIONAL',
    actuality: 'ACTUAL',
    availability: 'AVAILABLE',
    runnable: true,
    endpoint: '/api/v1/reports/customers',
    frontendSubroute: 'customers',
    requiredPermission: 'REPORTS_READ',
    supportedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'],
    supportedDimensions: ['DATE', 'BUSINESS_DATE', 'CAFE'],
    supportedFilters: ['period', 'cafeId', 'dateFrom', 'dateTo'],
    supportedExports: ['PDF', 'XLSX'],
    supportedVisuals: ['COHORT_HEATMAP', 'RFM_DONUT', 'SPEND_HISTOGRAM'],
    sourceMetrics: ['UNIQUE_CUSTOMERS', 'RETURNING_CUSTOMERS', 'AVERAGE_CUSTOMER_SPEND', 'IDENTIFIED_CUSTOMERS', 'NEW_CUSTOMERS', 'REPEAT_CUSTOMERS', 'REPEAT_VISIT_RATE'],
    drillTargets: ['customer-directory'],
  },

  'pos-exceptions': {
    reportId: 'pos-exceptions',
    title: 'POS Exceptions & Cashier Control Audit',
    description: 'Audited voids, high discounts, complimentary orders, reprint logs, offline replays, and cash variances (PM-02H Activated).',
    category: 'POS_BILLING_CONTROL',
    classification: 'INTERNAL',
    trustLevel: 'OPERATIONAL',
    actuality: 'ACTUAL',
    availability: 'AVAILABLE',
    runnable: true,
    endpoint: '/api/v1/reports/customers',
    frontendSubroute: 'customers',
    requiredPermission: 'REPORTS_READ',
    supportedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'],
    supportedDimensions: ['CAFE', 'BUSINESS_DATE', 'OPERATOR'],
    supportedFilters: ['period', 'cafeId', 'dateFrom', 'dateTo', 'operatorId'],
    supportedExports: ['PDF', 'XLSX'],
    supportedVisuals: ['EXCEPTION_TABLE', 'DISCOUNT_BREAKDOWN_BAR', 'VOID_REASON_DONUT'],
    sourceMetrics: ['VOID_COUNT', 'COMPLIMENTARY_COUNT', 'DISCOUNT_AMOUNT', 'POS_EXCEPTION_COUNT'],
    drillTargets: ['bill-detail', 'register-session-detail'],
  },

  'service-speed': {
    reportId: 'service-speed',
    title: 'Speed of Service & Kitchen Prep Analytics',
    description: 'Kitchen Display System prep times, station performance, fulfillment speed, and service mode efficiency (PM-02H Activated).',
    category: 'OPERATIONS_SERVICE',
    classification: 'INTERNAL',
    trustLevel: 'OPERATIONAL',
    actuality: 'ACTUAL',
    availability: 'AVAILABLE',
    runnable: true,
    endpoint: '/api/v1/reports/customers',
    frontendSubroute: 'customers',
    requiredPermission: 'REPORTS_READ',
    supportedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'],
    supportedDimensions: ['CAFE', 'PREP_STATION', 'SERVICE_MODE'],
    supportedFilters: ['period', 'cafeId', 'dateFrom', 'dateTo', 'prepStation', 'serviceMode'],
    supportedExports: ['PDF', 'XLSX'],
    supportedVisuals: ['PREP_TIME_DISTRIBUTION_HISTOGRAM', 'STATION_BAR_CHART', 'MEDIAN_SPEED_LINE'],
    sourceMetrics: ['KITCHEN_PREP_TIME_SECONDS', 'SERVICE_SPEED_MEDIAN_SECONDS', 'GUEST_COUNT'],
    drillTargets: ['kds-ticket-detail'],
  },

  'inventory-valuation': {
    reportId: 'inventory-valuation',
    title: 'Inventory Valuation & Stock Movement',
    description: 'Opening balances, GRN receipts, recipes consumed, transfers, and wastage reconciliation.',
    category: 'INVENTORY_COGS',
    classification: 'CONFIDENTIAL',
    trustLevel: 'OPERATIONAL',
    actuality: 'ACTUAL',
    availability: 'AVAILABLE',
    runnable: true,
    endpoint: '/api/v1/reports/inventory',
    frontendSubroute: 'inventory',
    requiredPermission: 'REPORTS_READ',
    supportedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'],
    supportedDimensions: ['CAFE', 'INVENTORY_CATEGORY'],
    supportedFilters: ['period', 'cafeId', 'category', 'dateFrom', 'dateTo'],
    supportedExports: ['PDF', 'XLSX'],
    supportedVisuals: ['VALUATION_CARDS', 'MOVEMENT_WATERFALL'],
    sourceMetrics: ['INVENTORY_VALUE', 'WASTE_VALUE', 'WASTE_PERCENT', 'STOCK_VARIANCE'],
    drillTargets: ['inventory-lot-ledger'],
  },

  'procurement-spend': {
    reportId: 'procurement-spend',
    title: 'Procurement Spend & 3-Way Match',
    description: 'Purchase order commitments, vendor spend distribution, purchase price variances, and RNI exceptions.',
    category: 'PROCUREMENT_VENDORS',
    classification: 'CONFIDENTIAL',
    trustLevel: 'OPERATIONAL',
    actuality: 'ACTUAL',
    availability: 'AVAILABLE',
    runnable: true,
    endpoint: '/api/v1/reports/procurement',
    frontendSubroute: 'procurement',
    requiredPermission: 'REPORTS_READ',
    supportedRoles: ['MASTER', 'OWNER'],
    supportedDimensions: ['VENDOR', 'CAFE'],
    supportedFilters: ['period', 'vendorId', 'cafeId', 'dateFrom', 'dateTo'],
    supportedExports: ['PDF', 'XLSX'],
    supportedVisuals: ['SPEND_BY_VENDOR_CHART', 'PO_COMMITMENT_TABLE'],
    sourceMetrics: ['OPERATING_EXPENSE'],
    drillTargets: ['purchase-order-detail'],
  },

  'vendor-performance-intelligence': {
    reportId: 'vendor-performance-intelligence',
    title: 'Vendor Performance & Intelligence Suite',
    description: 'Comprehensive supplier scorecard across spend, delivery reliability, item price history, fill rate, quality compliance, and spend concentration (PM-02E Activated).',
    category: 'PROCUREMENT_VENDORS',
    classification: 'CONFIDENTIAL',
    trustLevel: 'OPERATIONAL',
    actuality: 'ACTUAL',
    availability: 'AVAILABLE',
    runnable: true,
    endpoint: '/api/v1/reports/procurement',
    frontendSubroute: 'procurement',
    requiredPermission: 'REPORTS_READ',
    supportedRoles: ['MASTER', 'OWNER'],
    supportedDimensions: ['VENDOR', 'CAFE', 'ITEM'],
    supportedFilters: ['period', 'vendorId', 'cafeId', 'itemId', 'dateFrom', 'dateTo'],
    supportedExports: ['PDF', 'XLSX'],
    supportedVisuals: ['VENDOR_SPEND_BAR', 'PRICE_TREND_LINE', 'DELIVERY_PERFORMANCE_BAR', 'CONCENTRATION_TREEMAP', 'PROCUREMENT_STATUS_BAR'],
    sourceMetrics: ['OPERATING_EXPENSE'],
    drillTargets: ['purchase-order-detail', 'vendor-detail'],
  },

  'menu-engineering': {
    reportId: 'menu-engineering',
    title: 'Menu Performance & Estimated Contribution',
    description: 'Item popularity vs contribution matrix, volume velocity, and category performance.',
    category: 'MENU_PRODUCT',
    classification: 'INTERNAL',
    trustLevel: 'ESTIMATED',
    actuality: 'ESTIMATED',
    availability: 'AVAILABLE',
    runnable: true,
    endpoint: '/api/v1/reports/menu',
    frontendSubroute: 'menu',
    requiredPermission: 'REPORTS_READ',
    supportedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'],
    supportedDimensions: ['MENU_CATEGORY', 'MENU_ITEM', 'CAFE', 'SERVICE_MODE'],
    supportedFilters: ['period', 'cafeId', 'category', 'menuItemId', 'dateFrom', 'dateTo', 'compare'],
    supportedExports: ['PDF', 'XLSX'],
    supportedVisuals: ['BOSTON_MATRIX', 'BUBBLE_SCATTER', 'MARGIN_RANK_LIST', 'PMIX_TABLE', 'VELOCITY_CHART'],
    sourceMetrics: ['GROSS_SALES', 'NET_SALES', 'ORDER_COUNT', 'THEORETICAL_COGS', 'ESTIMATED_CONTRIBUTION', 'ESTIMATED_CONTRIBUTION_PERCENT', 'BILL_PENETRATION'],
    drillTargets: ['menu-item-editor', 'recipe-bom-viewer'],
  },

  'quality-compliance': {
    reportId: 'quality-compliance',
    title: 'Quality, Cold-Chain & FSMS Log',
    description: 'Daily opening/closing food safety checklist compliance, temperature excursions, and active CAPAs.',
    category: 'QUALITY_COMPLIANCE',
    classification: 'INTERNAL',
    trustLevel: 'OPERATIONAL',
    actuality: 'ACTUAL',
    availability: 'AVAILABLE',
    runnable: true,
    endpoint: '/api/v1/reports/quality',
    frontendSubroute: 'quality',
    requiredPermission: 'REPORTS_READ',
    supportedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'],
    supportedDimensions: ['BUSINESS_DATE', 'CAFE'],
    supportedFilters: ['period', 'cafeId', 'dateFrom', 'dateTo'],
    supportedExports: ['PDF', 'XLSX'],
    supportedVisuals: ['COMPLIANCE_GAUGE', 'EXCURSION_LOG'],
    sourceMetrics: ['ORDER_COUNT'],
    drillTargets: ['quality-checklist-viewer'],
  },

  'asset-maintenance': {
    reportId: 'asset-maintenance',
    title: 'Asset Availability & Breakdown Downtime',
    description: 'Critical coffee equipment uptime, preventive service compliance, and repair maintenance expenditure.',
    category: 'ASSETS_MAINTENANCE',
    classification: 'INTERNAL',
    trustLevel: 'OPERATIONAL',
    actuality: 'ACTUAL',
    availability: 'AVAILABLE',
    runnable: true,
    endpoint: '/api/v1/reports/assets',
    frontendSubroute: 'assets',
    requiredPermission: 'REPORTS_READ',
    supportedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'],
    supportedDimensions: ['CAFE'],
    supportedFilters: ['period', 'cafeId', 'dateFrom', 'dateTo'],
    supportedExports: ['PDF', 'XLSX'],
    supportedVisuals: ['UPTIME_CARDS', 'DOWNTIME_CHART'],
    sourceMetrics: ['OPERATING_EXPENSE'],
    drillTargets: ['work-order-detail'],
  },

  'same-store-sales': {
    reportId: 'same-store-sales',
    title: 'Like-for-Like (Same-Store) Sales Growth',
    description: 'Normalized comparative revenue growth across mature branches operating >12 months.',
    category: 'MULTI_CAFE',
    classification: 'CONFIDENTIAL',
    trustLevel: 'OPERATIONAL',
    actuality: 'ACTUAL',
    availability: 'AVAILABLE',
    runnable: true,
    endpoint: '/api/v1/reports/portfolio',
    frontendSubroute: 'portfolio',
    requiredPermission: 'REPORTS_READ',
    supportedRoles: ['MASTER', 'OWNER'],
    supportedDimensions: ['CAFE'],
    supportedFilters: ['period', 'dateFrom', 'dateTo', 'comparison', 'peerGroup', 'comparableOnly', 'metricSelector', 'rankDirection'],
    supportedExports: ['PDF', 'XLSX'],
    supportedVisuals: ['COHORT_BAR_CHART', 'LFL_GROWTH_TABLE', 'COMPARISON_GRID', 'RANKED_BAR_CHART', 'SAME_STORE_WATERFALL', 'CONTRIBUTION_TREEMAP', 'PRODUCTIVITY_SCATTER'],
    sourceMetrics: ['GROSS_SALES', 'NET_SALES', 'SALES_GROWTH'],
    drillTargets: ['daily-sales', 'attendance-exceptions', 'inventory-valuation', 'pl-statement', 'quality-compliance'],
  },

  'multi-cafe-benchmark': {
    reportId: 'multi-cafe-benchmark',
    title: 'Multi-Café Benchmarking & Comparative Intelligence',
    description: 'Cross-branch comparative performance, standard competition ranking, variance analysis, and operational efficiency.',
    category: 'MULTI_CAFE',
    classification: 'CONFIDENTIAL',
    trustLevel: 'OPERATIONAL',
    actuality: 'ACTUAL',
    availability: 'AVAILABLE',
    runnable: true,
    endpoint: '/api/v1/reports/portfolio',
    frontendSubroute: 'portfolio',
    requiredPermission: 'REPORTS_READ',
    supportedRoles: ['MASTER', 'OWNER'],
    supportedDimensions: ['CAFE'],
    supportedFilters: ['period', 'dateFrom', 'dateTo', 'comparison', 'peerGroup', 'comparableOnly', 'metricSelector', 'rankDirection'],
    supportedExports: ['PDF', 'XLSX'],
    supportedVisuals: ['COMPARISON_GRID', 'RANKED_BAR_CHART', 'CONTRIBUTION_TREEMAP', 'PRODUCTIVITY_SCATTER', 'LFL_GROWTH_TABLE'],
    sourceMetrics: ['NET_SALES', 'SALES_GROWTH', 'ORDER_COUNT', 'SPLH', 'GROSS_PAYROLL', 'OPERATING_EXPENSE', 'TOTAL_WASTE_VALUE'],
    drillTargets: ['daily-sales', 'attendance-exceptions', 'inventory-valuation', 'pl-statement', 'quality-compliance'],
  },

  'executive-goals': {
    reportId: 'executive-goals',
    title: 'Executive Goals & KPI Scorecards',
    description: 'Target operating metrics, pace-to-target tracking, and strategic variance radars.',
    category: 'BUDGET_VARIANCE',
    classification: 'INTERNAL',
    trustLevel: 'ESTIMATED',
    actuality: 'ESTIMATED',
    availability: 'AVAILABLE',
    runnable: true,
    endpoint: '/api/v1/reports/goals',
    frontendSubroute: 'goals',
    requiredPermission: 'REPORTS_READ',
    supportedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'],
    supportedDimensions: ['CAFE'],
    supportedFilters: ['period', 'cafeId', 'dateFrom', 'dateTo'],
    supportedExports: ['PDF', 'XLSX'],
    supportedVisuals: ['SCORECARD_GRID', 'RADAR_CHART'],
    sourceMetrics: ['NET_SALES', 'ORDER_COUNT'],
    drillTargets: [],
  },

  'cross-module-reconciliations': {
    reportId: 'cross-module-reconciliations',
    title: 'Cross-Module Reconciliations & Ledger Variance',
    description: 'Cross-subsystem reconciliation ledger audits. Note: 3 controls currently unavailable, 1 control available (PayrollRun-to-Payslip).',
    category: 'AUDIT_EXCEPTIONS',
    classification: 'CONFIDENTIAL',
    trustLevel: 'DATA_ISSUE',
    actuality: 'ACTUAL',
    availability: 'PARTIAL',
    dataQuality: 'PARTIAL',
    runnable: true,
    endpoint: '/api/v1/reports/reconciliations',
    frontendSubroute: 'reconciliations',
    requiredPermission: 'REPORTS_READ',
    supportedRoles: ['MASTER', 'OWNER'],
    supportedDimensions: ['BUSINESS_DATE', 'CAFE'],
    supportedFilters: ['period', 'dateFrom', 'dateTo'],
    supportedExports: ['PDF', 'XLSX'],
    supportedVisuals: ['RECONCILIATION_TABLE'],
    sourceMetrics: ['NET_SALES'],
    drillTargets: [],
  },

  'pipeline-data-quality': {
    reportId: 'pipeline-data-quality',
    title: 'Data Lineage & Pipeline Health',
    description: 'Data freshness SLAs, transformation lineage nodes, replication latencies, and pipeline health checks.',
    category: 'AUDIT_EXCEPTIONS',
    classification: 'INTERNAL',
    trustLevel: 'OPERATIONAL',
    actuality: 'ACTUAL',
    runnable: true,
    endpoint: '/api/v1/reports/data-quality',
    frontendSubroute: 'data_quality',
    requiredPermission: 'REPORTS_READ',
    supportedRoles: ['MASTER', 'OWNER'],
    supportedDimensions: ['DOMAIN'],
    supportedFilters: ['period'],
    supportedExports: ['PDF', 'XLSX'],
    supportedVisuals: ['LINEAGE_GRAPH', 'SLA_CARDS'],
    sourceMetrics: ['ORDER_COUNT'],
    drillTargets: [],
  },

  'scheduled-alerts-report': {
    reportId: 'scheduled-alerts-report',
    title: 'Scheduled Reports & Governance Alerts',
    description: 'Automated executive email digests, anomaly threshold triggers, and dispatch delivery histories.',
    category: 'TASKS_APPROVALS',
    classification: 'INTERNAL',
    trustLevel: 'OPERATIONAL',
    actuality: 'ACTUAL',
    runnable: true,
    endpoint: '/api/v1/reports/scheduled-alerts',
    frontendSubroute: 'scheduled_alerts',
    requiredPermission: 'REPORTS_READ',
    supportedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'],
    supportedDimensions: ['CHANNEL'],
    supportedFilters: ['period'],
    supportedExports: ['PDF', 'XLSX'],
    supportedVisuals: ['ALERT_TABLE'],
    sourceMetrics: ['ORDER_COUNT'],
    drillTargets: [],
  },
};

/**
 * Governed Diagnostic & Exploratory Report Definitions (PM-02J)
 * Maintained in governed registry for role access and contract verification.
 */
const DIAGNOSTIC_REPORTS = {
  'diagnostic-decomposition': {
    reportId: 'diagnostic-decomposition',
    title: 'Diagnostic Decomposition Explorer',
    description: 'Multi-dimensional additive and non-additive metric decomposition across business hierarchies.',
    category: 'EXECUTIVE',
    classification: 'INTERNAL',
    trustLevel: 'OPERATIONAL',
    actuality: 'ACTUAL',
    runnable: true,
    endpoint: '/api/v1/reports/diagnostics/decomposition',
    frontendSubroute: 'explorer',
    requiredPermission: 'REPORTS_READ',
    supportedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'],
    supportedFilters: ['period', 'cafeId', 'serviceMode'],
    supportedExports: ['PDF', 'XLSX'],
    sourceMetrics: ['NET_SALES'],
  },
  'variance-waterfall': {
    reportId: 'variance-waterfall',
    title: 'Variance Waterfall & Bridge Analytics',
    description: 'Variance bridge and gross-to-net bridge reconciliation in exact paise precision.',
    category: 'EXECUTIVE',
    classification: 'INTERNAL',
    trustLevel: 'OPERATIONAL',
    actuality: 'ACTUAL',
    runnable: true,
    endpoint: '/api/v1/reports/diagnostics/waterfall',
    frontendSubroute: 'explorer',
    requiredPermission: 'REPORTS_READ',
    supportedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'],
    supportedFilters: ['period', 'cafeId', 'comparison'],
    supportedExports: ['PDF', 'XLSX'],
    sourceMetrics: ['NET_SALES'],
  },
  'pareto-analytics': {
    reportId: 'pareto-analytics',
    title: 'Pareto Contributor Analytics',
    description: '80/20 contributor ranking and cumulative distribution across menu, categories, and channels.',
    category: 'EXECUTIVE',
    classification: 'INTERNAL',
    trustLevel: 'OPERATIONAL',
    actuality: 'ACTUAL',
    runnable: true,
    endpoint: '/api/v1/reports/diagnostics/pareto',
    frontendSubroute: 'explorer',
    requiredPermission: 'REPORTS_READ',
    supportedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'],
    supportedFilters: ['period', 'cafeId', 'dimension'],
    supportedExports: ['PDF', 'XLSX'],
    sourceMetrics: ['NET_SALES'],
  },
  'distribution-analytics': {
    reportId: 'distribution-analytics',
    title: 'Distribution & Box Plot Analytics',
    description: 'Histogram binning, quartiles, and statistical dispersion analytics without evaluative labels.',
    category: 'EXECUTIVE',
    classification: 'INTERNAL',
    trustLevel: 'OPERATIONAL',
    actuality: 'ACTUAL',
    runnable: true,
    endpoint: '/api/v1/reports/diagnostics/distribution',
    frontendSubroute: 'explorer',
    requiredPermission: 'REPORTS_READ',
    supportedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'],
    supportedFilters: ['period', 'cafeId', 'metric'],
    supportedExports: ['PDF', 'XLSX'],
    sourceMetrics: ['NET_SALES'],
  },
  'correlation-workspace': {
    reportId: 'correlation-workspace',
    title: 'Diagnostic Correlation Workspace',
    description: 'Bivariate association exploration with statistical metadata and causality disclaimers.',
    category: 'EXECUTIVE',
    classification: 'INTERNAL',
    trustLevel: 'OPERATIONAL',
    actuality: 'ACTUAL',
    runnable: true,
    endpoint: '/api/v1/reports/diagnostics/correlation',
    frontendSubroute: 'explorer',
    requiredPermission: 'REPORTS_READ',
    supportedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'],
    supportedFilters: ['period', 'cafeId', 'metricX', 'metricY'],
    supportedExports: ['PDF', 'XLSX'],
    sourceMetrics: ['NET_SALES'],
  },
  'diagnostic-exceptions': {
    reportId: 'diagnostic-exceptions',
    title: 'Diagnostic Exception Centre',
    description: 'Factual cross-domain operational exception ledger.',
    category: 'AUDIT_EXCEPTIONS',
    classification: 'INTERNAL',
    trustLevel: 'OPERATIONAL',
    actuality: 'ACTUAL',
    runnable: true,
    endpoint: '/api/v1/reports/diagnostics/exceptions',
    frontendSubroute: 'explorer',
    requiredPermission: 'REPORTS_READ',
    supportedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'],
    supportedFilters: ['period', 'cafeId'],
    supportedExports: ['PDF', 'XLSX'],
    sourceMetrics: ['NET_SALES'],
  },
};

/**
 * Governed Forecasting & Scenario Report Definitions (PM-02K)
 */
const FORECAST_REPORTS = {
  'sales-forecast': {
    reportId: 'sales-forecast',
    title: 'Sales & Revenue Predictive Forecast',
    description: 'Statistical multi-model baseline and seasonal revenue forecast with prediction intervals.',
    category: 'EXECUTIVE',
    classification: 'INTERNAL',
    trustLevel: 'FORECAST',
    actuality: 'FORECAST',
    runnable: true,
    endpoint: '/api/v1/reports/forecast/run',
    frontendSubroute: 'forecasting',
    requiredPermission: 'REPORTS_READ',
    supportedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'],
    supportedFilters: ['target', 'period', 'cafeId', 'horizon', 'method'],
    supportedExports: ['PDF', 'XLSX'],
    sourceMetrics: ['NET_SALES'],
  },
  'order-workload-forecast': {
    reportId: 'order-workload-forecast',
    title: 'Orders & Service Workload Forecast',
    description: 'Order volume and service workload prediction for operational capacity planning.',
    category: 'OPERATIONS_SERVICE',
    classification: 'INTERNAL',
    trustLevel: 'FORECAST',
    actuality: 'FORECAST',
    runnable: true,
    endpoint: '/api/v1/reports/forecast/run',
    frontendSubroute: 'forecasting',
    requiredPermission: 'REPORTS_READ',
    supportedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'],
    supportedFilters: ['target', 'period', 'cafeId', 'horizon', 'method'],
    supportedExports: ['PDF', 'XLSX'],
    sourceMetrics: ['ORDERS'],
  },
  'menu-demand-forecast': {
    reportId: 'menu-demand-forecast',
    title: 'Menu Item & Product Demand Forecast',
    description: 'Sold quantity projection across individual dishes and menu categories.',
    category: 'MENU_PRODUCT',
    classification: 'INTERNAL',
    trustLevel: 'FORECAST',
    actuality: 'FORECAST',
    runnable: true,
    endpoint: '/api/v1/reports/forecast/run',
    frontendSubroute: 'forecasting',
    requiredPermission: 'REPORTS_READ',
    supportedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'],
    supportedFilters: ['target', 'period', 'cafeId', 'horizon'],
    supportedExports: ['PDF', 'XLSX'],
    sourceMetrics: ['MENU_ITEM_QUANTITY'],
  },
  'ingredient-requirement-forecast': {
    reportId: 'ingredient-requirement-forecast',
    title: 'Theoretical BOM Ingredient Requirement Forecast',
    description: 'Recipe-derived ingredient requirements and projected stock gap without artificial buffers.',
    category: 'INVENTORY_COGS',
    classification: 'INTERNAL',
    trustLevel: 'FORECAST',
    actuality: 'FORECAST',
    runnable: true,
    endpoint: '/api/v1/reports/forecast/run',
    frontendSubroute: 'forecasting',
    requiredPermission: 'REPORTS_READ',
    supportedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'],
    supportedFilters: ['target', 'period', 'cafeId', 'horizon'],
    supportedExports: ['PDF', 'XLSX'],
    sourceMetrics: ['THEORETICAL_INGREDIENT_REQUIREMENT'],
  },
  'whatif-scenario-studio': {
    reportId: 'whatif-scenario-studio',
    title: 'What-If Scenario & Sensitivity Studio',
    description: 'Multi-driver simulated scenario planning with driver conflict validation and sensitivity grid.',
    category: 'EXECUTIVE',
    classification: 'INTERNAL',
    trustLevel: 'FORECAST',
    actuality: 'SIMULATED',
    runnable: true,
    endpoint: '/api/v1/reports/forecast/scenario',
    frontendSubroute: 'forecasting',
    requiredPermission: 'REPORTS_READ',
    supportedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'],
    supportedFilters: ['scenario', 'cafeId'],
    supportedExports: ['PDF', 'XLSX'],
    sourceMetrics: ['NET_SALES', 'ORDERS', 'GROSS_PAYROLL'],
  },
};

class ReportRegistry {
  /**
   * Registers a dynamic or test report definition.
   * @param {object} reportDef
   * @returns {object} registered report definition
   */
  static registerReport(reportDef) {
    if (!reportDef || !reportDef.reportId) {
      throw new Error('Report definition must include a valid reportId.');
    }
    const key = String(reportDef.reportId).toLowerCase();
    CANONICAL_REPORTS[key] = { ...reportDef };
    return CANONICAL_REPORTS[key];
  }

  /**
   * Unregisters a report definition (e.g. for test cleanup).
   * @param {string} reportId
   * @returns {boolean} true if unregistered
   */
  static unregisterReport(reportId) {
    if (!reportId) return false;
    const key = String(reportId).toLowerCase();
    if (CANONICAL_REPORTS[key]) {
      delete CANONICAL_REPORTS[key];
      return true;
    }
    return false;
  }

  /**
   * Retrieves a report definition by ID, resolving compatibility aliases.
   * Checks CANONICAL_REPORTS first, then governed DIAGNOSTIC_REPORTS and FORECAST_REPORTS.
   * @param {string} reportId
   * @returns {object|null}
   */
  static getReport(reportId) {
    if (!reportId) return null;
    const key = String(reportId).toLowerCase();
    const ALIASES = {
      'guest-retention': 'customer-retention',
      'equipment-availability': 'asset-maintenance',
      'portfolio-lfl-growth': 'same-store-sales',
      'reconciliations': 'cross-module-reconciliations',
    };
    const resolvedKey = ALIASES[key] || key;
    return CANONICAL_REPORTS[resolvedKey] || DIAGNOSTIC_REPORTS[resolvedKey] || FORECAST_REPORTS[resolvedKey] || null;
  }

  /**
   * Checks if a report ID is registered.
   * @param {string} reportId
   * @returns {boolean}
   */
  static isValidReport(reportId) {
    return Boolean(ReportRegistry.getReport(reportId));
  }

  /**
   * Returns all registered reports.
   * @returns {Array<object>}
   */
  static getAllReports() {
    return Object.values(CANONICAL_REPORTS);
  }

  static listReports() {
    return Object.values(CANONICAL_REPORTS);
  }

  /**
   * Returns reports filtered by category.
   * @param {string} category
   * @returns {Array<object>}
   */
  static getReportsByCategory(category) {
    const c = String(category || '').toUpperCase();
    return ReportRegistry.getAllReports().filter((r) => r.category === c);
  }

  /**
   * Returns reports authorized for a specific role.
   * @param {string} role
   * @returns {Array<object>}
   */
  static getReportsForRole(role) {
    const upper = String(role || '').toUpperCase();
    return ReportRegistry.getAllReports().filter((r) => r.supportedRoles.includes(upper));
  }

  /**
   * Asserts that an authenticated user has permission to access a specific report.
   * Central runtime enforcement point for ReportRegistry role matrices and permissions.
   * @param {string} reportId
   * @param {object} auth - Authenticated user context (req.auth)
   * @throws {Error} 404 if report not found, 401 if unauthenticated, 403 if role/permission denied.
   * @returns {object} report definition
   */
  static assertReportAccess(reportId, auth) {
    if (!auth || !auth.userId) {
      const err = new Error('Authentication required for report access.');
      err.statusCode = 401;
      err.code = 'AUTHENTICATION_REQUIRED';
      throw err;
    }

    const report = ReportRegistry.getReport(reportId);
    if (!report) {
      const err = new Error(`Report "${reportId}" not found in canonical registry.`);
      err.statusCode = 404;
      err.code = 'REPORT_NOT_FOUND';
      throw err;
    }

    const role = String(auth.role || '').toUpperCase();
    const isPrimaryMaster = auth.isPrimaryMaster === true;

    // Check classification: HIGHLY_CONFIDENTIAL requires PRIMARY_MASTER
    if (report.classification === 'HIGHLY_CONFIDENTIAL' && !isPrimaryMaster) {
      const err = new Error(`Report "${reportId}" is HIGHLY_CONFIDENTIAL and requires Primary Master authorization.`);
      err.statusCode = 403;
      err.code = 'PRIMARY_MASTER_REQUIRED';
      throw err;
    }

    // Role check
    const supportedRoles = Array.isArray(report.supportedRoles)
      ? report.supportedRoles.map((r) => r.toUpperCase())
      : [];

    if (!supportedRoles.includes(role)) {
      if (role === 'STAFF' && report.allowSelfService === true) {
        // Staff self-service permitted for authorized reports
      } else {
        const err = new Error(`Role "${role}" is not authorized to access report "${reportId}". Supported roles: ${supportedRoles.join(', ')}.`);
        err.statusCode = 403;
        err.code = 'REPORT_ROLE_DENIED';
        throw err;
      }
    }

    // Permission check if permissions array is present on auth
    if (report.requiredPermission && Array.isArray(auth.permissions) && auth.permissions.length > 0) {
      if (!isPrimaryMaster && role !== 'MASTER' && !auth.permissions.includes(report.requiredPermission)) {
        const err = new Error(`Missing required permission "${report.requiredPermission}" for report "${reportId}".`);
        err.statusCode = 403;
        err.code = 'PERMISSION_DENIED';
        throw err;
      }
    }

    return report;
  }
}

module.exports = {
  REPORT_CATEGORIES,
  REPORT_CLASSIFICATIONS,
  REPORT_TRUST_LEVELS,
  CANONICAL_REPORTS,
  DIAGNOSTIC_REPORTS,
  FORECAST_REPORTS,
  ReportRegistry,
};
