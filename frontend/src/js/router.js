// =============================================================================
// ZAMORIN CAFE ERP — ROUTER
//
// Enforces the route-layer check from Part B.3: every navigation re-checks
// the current role against NAVIGATION before rendering anything. The shell
// (sidebar + topbar) is mounted once in main.js and never remounted here —
// only #page-content is replaced, which is the direct fix for Part H.3
// ("switching sidebar items must never trigger a full reload").
// =============================================================================

import { state, setState } from "./state.js";
import { NAVIGATION, isRouteAllowed, ROLES } from "./navigation.js";
import { renderSidebar, wireSidebar, renderTopbar, wireBell, updateBellBadge, updateSidebarActive, renderModuleErrorState, wireCafeContextStrip } from "./components.js";
import { renderNotificationCentre, wireNotificationCentre } from "./pages/notificationCentre.js";
import { icon } from "./icons.js";
import { renderMasterDashboard, hydrateMasterDashboard } from "./pages/dashboardMaster.js";
import { renderOwnerDashboard, hydrateOwnerDashboard } from "./pages/dashboardOwner.js";
import { renderAdminDashboard, hydrateAdminDashboard } from "./pages/dashboardAdmin.js";
import { renderStaffHome, wireStaffHome } from "./pages/staffHome.js";
import { renderStaffSettings, wireStaffSettings } from "./pages/staffSettings.js";
import { renderSettingsShared, wireSettingsShared, setSettingsActiveSection } from "./pages/settingsShared.js";
import { renderPOS, wirePOS } from "./pages/posTill.js";
import { renderOwnerBills, wireOwnerBills, setBillsActiveTab } from "./pages/ownerBills.js";
import { renderInventory, wireInventory, setInventoryActiveTab } from "./pages/inventory.js";
import { renderExpenses, wireExpenses, setExpensesActiveTab } from "./pages/expenses.js";
import { renderFinance, wireFinance, setFinanceActiveTab } from "./pages/financeAccounts.js";
import { renderOwnerFinanceSummary, wireOwnerFinanceSummary } from "./pages/ownerFinanceSummary.js";
import { renderLedger, wireLedger } from "./pages/personalLedger.js";
import { renderEmployees, wireEmployees, setEmployeesActiveTab } from "./pages/employees.js";
import { renderEmployeeProfile, wireEmployeeProfile } from "./pages/employeeProfile.js";
import { renderAttendance, wireAttendance, setAttendanceActiveTab } from "./modules/attendance/attendanceShifts.js";
import { renderReports, wireReports, setReportsActiveTab } from "./pages/reportsAnalytics.js";
import { renderAdmin, wireAdmin, setAdminActiveTab } from "./pages/administration.js";
import { renderCashBook, wireCashBook } from "./pages/cashBook.js";
import { renderTasks, wireTasks } from "./pages/tasksApprovals.js";
import { renderPerformance, wirePerformance } from "./pages/cafePerformance.js";
import { renderStaffAttendance, wireStaffAttendance } from "./modules/attendance/staffAttendance.js";
import { renderStaffLeave, wireStaffLeave } from "./pages/staffLeave.js";
import { renderStaffPayslips, wireStaffPayslips } from "./pages/staffPayslips.js";
import { renderStaffLoansAdvances, wireStaffLoansAdvances } from "./pages/staffLoansAdvances.js";
import { renderStaffDocuments, wireStaffDocuments } from "./pages/staffDocuments.js";
import { renderPayrollManagement, wirePayrollManagement, setPayrollActiveTab } from "./pages/payrollManagement.js";
import { renderAnnouncements, wireAnnouncements } from "./pages/announcements.js";
import { renderMailOpsCommandCentre, wireMailOpsCommandCentre } from "./pages/mailOpsCommandCentre.js";
import { renderNotAvailable, renderNotBuiltYet } from "./pages/notAvailable.js";
import { renderVendors, wireVendors, setVendorsActiveTab } from "./pages/vendors.js";
import { renderProcurement, wireProcurement, setProcurementActiveTab } from "./pages/procurement.js";
import { renderMenuManagement, wireMenuManagement, setMenuActiveTab } from "./pages/menuManagement.js";
import { renderCustomers, wireCustomers, setCustomersActiveTab } from "./pages/customers.js";
import { renderQuality, wireQuality, setQualityActiveTab } from "./pages/quality.js";
import { renderAssets, wireAssets, setAssetsActiveTab } from "./pages/assets.js";
import { renderDepartmentOrders, wireDepartmentOrders, setDepartmentOrdersActiveTab } from "./pages/departmentOrders.js";
import { renderTrashBin, wireTrashBin } from "./pages/trashBin.js";
import { CafeAttendanceDisplayPage } from "./pages/cafeAttendanceDisplay.js";
import { renderRevenueShare, wireRevenueShare, setRevenueShareActiveTab } from "./pages/revenueShare.js";
import { renderCafeOperationsDevices, wireCafeOperationsDevices, setCafeDevicesActiveTab } from "./pages/cafeOperationsDevices.js";
import { renderCafeOperatorSignIn, wireCafeOperatorSignIn } from "./pages/cafeOperatorSignIn.js";
import { renderCafeOperationsState, wireCafeOperationsState } from "./pages/cafeOperationsState.js";
import { startCafeOpsInactivityTimer, stopCafeOpsInactivityTimer } from "./cafeOpsInactivity.js";
import { renderPassbook, wirePassbook } from "./pages/passbook.js";
import { cancelPendingRouteReads, clearApiCacheAndInFlight, getCanonicalDeviceId, setCanonicalDeviceId, setCafeOpsDeviceToken, setCafeOpsSessionToken, setSessionId, apiPost } from "./apiClient.js";
import { mountPublicCafeGateway, getActiveGatewayContextToken } from "./pages/cafeGatewayPage.js";
// ── Stage-2 Login Integration: Terminal auth screens (additive, no backend auth change) ──
import { renderCafeMasterSignIn, wireCafeMasterSignIn, resetCafeMasterSignInUi } from "./pages/cafeMasterSignIn.js";
import { renderCafeDeviceEnroll, wireCafeDeviceEnroll, resetCafeDeviceEnrollUi } from "./pages/cafeDeviceEnroll.js";
import { renderCafeTerminalWelcome, wireCafeTerminalWelcome } from "./pages/cafeTerminalWelcome.js";
import { renderOrgIdentity, wireOrgIdentity } from "./pages/organisationIdentity.js";
import { renderSystemHealthPage, initSystemHealthPage } from "./pages/systemHealth.js";
import { renderOwnerFoodSafety, wireOwnerFoodSafety, setOwnerFoodSafetySection } from "./pages/ownerFoodSafety.js";
import { renderOwnerRiskAudit, wireOwnerRiskAudit, setOwnerRiskAuditSection } from "./pages/ownerRiskAudit.js";
import { renderOwnerPlanning, wireOwnerPlanning, setOwnerPlanningSection } from "./pages/ownerPlanning.js";
import { renderOwnerCompliance, wireOwnerCompliance, setOwnerComplianceSection } from "./pages/ownerCompliance.js";
import { renderOwnerSupplierIntelligence, initOwnerSupplierIntelligenceEvents, setOwnerSupplierSection } from "./pages/ownerSupplierIntelligence.js";
import { renderOwnerAcademy, initOwnerAcademyEvents, setOwnerAcademySection } from "./pages/ownerAcademy.js";
import { renderOwnerAssetReliability, initOwnerAssetReliabilityEvents, setOwnerAssetReliabilitySection } from "./pages/ownerAssetReliability.js";
import { renderOwnerPrivacyCyber, initOwnerPrivacyCyberEvents, setOwnerPrivacyCyberSection } from "./pages/ownerPrivacyCyber.js";
import { renderOwnerBcdr, initOwnerBcdrEvents, setOwnerBcdrSection } from "./pages/ownerBcdr.js";
import { renderOwnerMasterData, initOwnerMasterDataEvents, setOwnerMasterDataSection } from "./pages/ownerMasterData.js";
import { renderOwnerComplaints, initOwnerComplaintsEvents, setOwnerComplaintsSection } from "./pages/ownerComplaints.js";
import { renderOwnerMenuPricing, initOwnerMenuPricingEvents, setOwnerMenuPricingSection } from "./pages/ownerMenuPricing.js";
import { renderOwnerCustomerLoyalty, initOwnerCustomerLoyaltyEvents, setOwnerCustomerLoyaltySection } from "./pages/ownerCustomerLoyalty.js";
import { renderOwnerUtilitiesWaste, initOwnerUtilitiesWasteEvents, setOwnerUtilitiesWasteSection } from "./pages/ownerUtilitiesWaste.js";
import { renderOwnerGovernanceDelegation, initOwnerGovernanceDelegationEvents, setOwnerGovernanceDelegationSection } from "./pages/ownerGovernanceDelegation.js";
import { renderForecastsInsights, wireForecastsInsights, setForecastsActiveTab } from "./pages/forecastsInsights.js";
import { renderPortfolioGovernance, initPortfolioGovernance, setPortfolioGovernanceTab } from "./pages/portfolioGovernance.js";
import { renderChannelsFrontService, wireChannelsFrontService, setChannelsActiveTab } from "./pages/channelsFrontService.js";
import { renderOnboardingMigration, initOnboardingMigration, setOnboardingMigrationTab } from "./pages/onboardingMigration.js";
import { renderGuestQrOrdering, wireGuestQrOrdering } from "./pages/guestQrOrdering.js";
import { renderTakeawayTokenDisplay, wireTakeawayTokenDisplay } from "./pages/takeawayTokenDisplay.js";
import { renderWaiterCaptainApp, wireWaiterCaptainApp } from "./pages/waiterCaptainApp.js";
import { renderEmergencyTerminal, wireEmergencyTerminal } from "./pages/emergencyTerminal.js";
import { renderRetailCpg, wireRetailCpg } from "./pages/retailCpgInvoice.js";
import { renderCallCenter, wireCallCenter } from "./pages/centralCallCenter.js";
import { renderMenuBoard, wireMenuBoard } from "./pages/digitalMenuBoard.js";
import { renderDualScreen, wireDualScreen } from "./pages/customerDualScreen.js";

// ROLE_LABELS: display-safe generic labels used only for topbar scope chip
// until /auth/me bootstrap provides the real user's display name.
const ROLE_LABELS = {
  [ROLES.MASTER]: "Master",
  [ROLES.OWNER]: "Owner",
  [ROLES.CAFE_ADMIN]: "Cafe Operations",
  [ROLES.STAFF]: "Staff",
  [ROLES.VENDOR]: "Vendor Portal",
};

export function showNavProgressBar() {
  if (typeof document === "undefined") return;
  let bar = document.getElementById("zamorin-nav-progress");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "zamorin-nav-progress";
    bar.className = "zamorin-nav-progress";
    document.body.appendChild(bar);
  }
  bar.classList.remove("completed");
  bar.classList.add("active");
}

export function hideNavProgressBar() {
  if (typeof document === "undefined") return;
  const bar = document.getElementById("zamorin-nav-progress");
  if (bar) {
    bar.classList.add("completed");
    setTimeout(() => {
      bar.classList.remove("active", "completed");
    }, 250);
  }
}

export function getIsPrimaryMaster() {
  if (state.auth?.user?.isPrimaryMaster !== undefined) return Boolean(state.auth.user.isPrimaryMaster);
  if (state.user?.isPrimaryMaster !== undefined) return Boolean(state.user.isPrimaryMaster);
  if (state.isPrimaryMaster !== undefined) return Boolean(state.isPrimaryMaster);
  return false;
}

export function navigate(route) {
  // Cancel stale read requests from previous route
  cancelPendingRouteReads();
  showNavProgressBar();

  // Route-layer guard: deny by default
  const isPrimary = getIsPrimaryMaster();

  // Normal Master Decommission Invariant:
  // Non-primary master is strictly blocked from all routes.
  if ((state.role === ROLES.MASTER || state.role === "master") && !isPrimary) {
    setState({ route: "__blocked__" });
    renderShell();
    hideNavProgressBar();
    return;
  }

  if (route !== "notifications" && !isRouteAllowed(state.role, route, isPrimary)) {
    setState({ route: "__blocked__" });
    renderShell();
    hideNavProgressBar();
    return;
  }

  // Synchronize hash in URL for back/forward navigation support
  if (typeof window !== "undefined") {
    const targetHash = "#" + route;
    if (window.location.hash !== targetHash) {
      window.history.pushState(null, "", targetHash);
    }
  }

  setState({ route });
  renderShell();
}

if (typeof window !== "undefined") {
  window.zamorinNavigate = navigate;
}

export function renderShell() {
  const app = document.getElementById("app");
  if (!app) return;
  app.classList.remove("auth-screen");

  const existingSidebar = document.getElementById("sidebar");
  const existingTopbar = document.getElementById("topbar");

  if (!existingSidebar || !existingTopbar || app.dataset.shellRole !== state.role) {
    if (app.dataset.shellRole && app.dataset.shellRole !== state.role) {
      clearApiCacheAndInFlight();
    }
    app.dataset.shellRole = state.role;
    app.innerHTML = `
      <div class="app-shell">
        <div id="sidebar-overlay" class="sidebar-overlay" aria-hidden="true"></div>
        <aside id="sidebar" class="sidebar" role="navigation" aria-label="Main Navigation"></aside>
        <main class="main-shell" role="main">
          <header id="topbar" class="topbar" role="banner"></header>
          <div id="page-content" class="page"></div>
        </main>
      </div>
      <div id="modal-root" role="region" aria-label="Modals"></div>
      <div id="toast-root" class="toast-stack" aria-live="polite" aria-atomic="true" role="status"></div>
    `;
    const sb = document.getElementById("sidebar");
    const tb = document.getElementById("topbar");
    if (sb) {
      sb.innerHTML = renderSidebar();
      wireSidebar(sb);
    }
    if (tb) {
      tb.innerHTML = renderTopbar();
      wireBell(tb);
      updateBellBadge();
    }
  } else {
    // STAGE 1 PERSISTENT APP SHELL:
    // Retain mounted sidebar DOM & preserve scrollTop; update active route indicators in place.
    updateSidebarActive(state.route);
  }

  renderPage().catch((err) => {
    console.error("Router error during page mount:", err);
    const content = document.getElementById("page-content");
    if (content) {
      content.innerHTML = renderModuleErrorState({
        title: "Workspace Load Interrupted",
        message: "An unexpected error occurred while preparing this workspace. Please retry.",
        error: err,
        retryActionId: "btn-retry-router-mount",
        retryLabel: "Retry Loading",
      });
      content.querySelector("#btn-retry-router-mount")?.addEventListener("click", () => {
        renderShell();
      });
    }
  }).finally(() => {
    hideNavProgressBar();
  });
}

async function renderPage() {
  const content = document.getElementById("page-content");
  const route = state.route;
  updateBellBadge();

  if (route === "__blocked__") {
    content.innerHTML = renderNotAvailable();
    return;
  }

  // Dedicated Settings Subroutes: #settings and #settings/<section>
  if (route === "settings" || (route && route.startsWith("settings/"))) {
    const sub = route.startsWith("settings/") ? route.slice("settings/".length).toLowerCase() : "overview";
    const sectionMap = {
      "profile": "profile",
      "my-profile": "profile",
      "employment": "employment",
      "my-employment": "employment",
      "access": "access",
      "my-access": "access",
      "delegation": "delegation",
      "delegations": "delegation",
      "security": "security",
      "security-settings": "security",
      "devices": "devices",
      "sessions": "devices",
      "recovery": "recovery",
      "account-recovery": "recovery",
      "notifications": "notifications",
      "notification-preferences": "notifications",
      "language": "language",
      "language-region": "language",
      "appearance": "appearance",
      "themes": "appearance",
      "accessibility": "accessibility",
      "a11y": "accessibility",
      "workspace": "workspace",
      "navigation-workspace": "workspace",
      "privacy": "privacy",
      "privacy-data": "privacy",
      "connected": "connected",
      "connected-apps": "connected",
      "updates": "updates",
      "app-updates": "updates",
      "releases": "updates",
      "version-updates": "updates",
      "help": "help",
      "diagnostics": "help",
      "help-diagnostics": "help",
      "trash": "trash",
      "data-recovery": "trash",
      "admin": "admin",
      "system-administration": "admin",
      "templates": "templates",
      "cafe-templates": "templates",
    };

    const targetSection = sectionMap[sub] || (sub === "" ? "overview" : sub);

    if (targetSection === "trash") {
      if (state.role !== ROLES.MASTER) {
        content.innerHTML = renderNotAvailable();
      } else {
        content.innerHTML = renderTrashBin();
        wireTrashBin(content);
      }
      return;
    }

    if (targetSection === "admin") {
      if (state.role !== ROLES.MASTER) {
        content.innerHTML = renderNotAvailable();
      } else {
        content.innerHTML = renderAdmin();
        await wireAdmin(content);
      }
      return;
    }

    setSettingsActiveSection(targetSection);
    content.innerHTML = renderSettingsShared();
    wireSettingsShared(content);
    return;
  }

  // Universal Module Base Route and Subroute Parsing
  const [routePath] = (route || "").split("?");
  const [baseRoute, ...subSegments] = routePath.split("/");
  const subroute = subSegments.join("/");

  switch (baseRoute) {
    case "dashboard": {
      const normalizedRole = (state.role || "").toLowerCase();
      if (normalizedRole === ROLES.CAFE_ADMIN || normalizedRole === "admin") {
        content.innerHTML = renderAdminDashboard();
        hydrateAdminDashboard(content);
      } else if (normalizedRole === ROLES.OWNER) {
        content.innerHTML = renderOwnerDashboard();
        hydrateOwnerDashboard(content);
      } else if (normalizedRole === ROLES.STAFF || normalizedRole === "employee") {
        content.innerHTML = renderStaffHome();
        wireStaffHome(content);
      } else {
        content.innerHTML = renderMasterDashboard({ roleLabel: ROLE_LABELS[state.role] || "Master" });
        hydrateMasterDashboard(content);
      }
      break;
    }

    case "system-health":
    case "ops":
    case "integration-scope":
      content.innerHTML = renderSystemHealthPage();
      initSystemHealthPage();
      break;

    case "staff-home":
      content.innerHTML = renderStaffHome();
      wireStaffHome(content);
      break;

    case "staff-settings":
      if (subroute) {
        setSettingsActiveSection(subroute);
      }
      content.innerHTML = renderStaffSettings(subroute);
      wireStaffSettings(content, subroute);
      break;

    case "settings":
      setSettingsActiveSection(subroute || "overview");
      content.innerHTML = renderSettingsShared();
      wireSettingsShared(content);
      break;

    case "profile":
    case "my-profile":
      setSettingsActiveSection("profile");
      content.innerHTML = renderSettingsShared();
      wireSettingsShared(content);
      break;

    case "employment":
    case "my-employment":
      setSettingsActiveSection("employment");
      content.innerHTML = renderSettingsShared();
      wireSettingsShared(content);
      break;

    case "pos":
      content.innerHTML = renderPOS();
      await wirePOS(content);
      break;

    case "channels":
    case "channels-front-service":
    case "tables":
    case "reservations":
      setChannelsActiveTab?.(subroute || (route === "reservations" ? "reservations" : (route === "tables" ? "tables" : "tables")));
      content.innerHTML = renderChannelsFrontService(subroute);
      wireChannelsFrontService();
      break;

    case "qr":
    case "qr-order":
      content.innerHTML = renderGuestQrOrdering(subroute);
      await wireGuestQrOrdering(content, subroute);
      break;

    case "token-display":
    case "pickup-display":
      content.innerHTML = renderTakeawayTokenDisplay(subroute);
      wireTakeawayTokenDisplay(content, subroute);
      break;

    case "captain":
    case "waiter":
      content.innerHTML = renderWaiterCaptainApp(subroute);
      await wireWaiterCaptainApp(content, subroute);
      break;

    case "emergency-terminal":
      content.innerHTML = renderEmergencyTerminal(subroute);
      wireEmergencyTerminal(content, subroute);
      break;

    case "retail-cpg":
    case "cpg-invoice":
      content.innerHTML = renderRetailCpg(subroute);
      wireRetailCpg(content, subroute);
      break;

    case "call-center":
    case "phone-orders":
      content.innerHTML = renderCallCenter(subroute);
      wireCallCenter(content, subroute);
      break;

    case "menu-board":
    case "digital-signage":
      content.innerHTML = renderMenuBoard(subroute);
      wireMenuBoard(content, subroute);
      break;

    case "dual-screen":
    case "customer-screen":
      content.innerHTML = renderDualScreen(subroute);
      wireDualScreen(content, subroute);
      break;

    case "bills":
      setBillsActiveTab?.(subroute || "overview");
      content.innerHTML = renderOwnerBills(subroute);
      await wireOwnerBills(content, subroute);
      break;

    case "inventory":
      setInventoryActiveTab?.(subroute || "overview");
      content.innerHTML = renderInventory(subroute);
      wireInventory(content, subroute);
      break;

    case "expenses":
      setExpensesActiveTab?.(subroute || "overview");
      content.innerHTML = renderExpenses(subroute);
      wireExpenses(content, subroute);
      break;

    case "finance":
      if (state.role === ROLES.OWNER) {
        content.innerHTML = renderOwnerFinanceSummary();
        await wireOwnerFinanceSummary(content);
      } else {
        setFinanceActiveTab?.(subroute || "overview");
        content.innerHTML = renderFinance(subroute);
        wireFinance(content, subroute);
      }
      break;

    case "passbook":
    case "passbook-treasury":
      // SCR-PASSBOOK Rule: Primary Master or Owner ONLY.
      // Normal Master, CAFE_ADMIN, STAFF are strictly denied.
      if (
        (state.role === ROLES.MASTER && !getIsPrimaryMaster()) ||
        (state.role !== ROLES.MASTER && state.role !== ROLES.OWNER)
      ) {
        content.innerHTML = renderNotAvailable();
        break;
      }
      content.innerHTML = renderPassbook(subroute);
      await wirePassbook(content, subroute);
      break;

    case "ledger":
    case "personal-ledger":
      // SCR-018 Rule: Primary Master or Owner only. Normal Master, CAFE_ADMIN, STAFF denied.
      if (
        (state.role === ROLES.MASTER && !getIsPrimaryMaster()) ||
        (state.role !== ROLES.MASTER && state.role !== ROLES.OWNER)
      ) {
        content.innerHTML = renderNotAvailable();
        break;
      }
      content.innerHTML = renderLedger();
      wireLedger(content);
      break;

    case "revenue-share":
      // SCR-026 Rule: Primary Master or Owner only. Normal Master, CAFE_ADMIN, STAFF strictly denied.
      if (
        (state.role === ROLES.MASTER && !getIsPrimaryMaster()) ||
        (state.role !== ROLES.MASTER && state.role !== ROLES.OWNER)
      ) {
        content.innerHTML = renderNotAvailable();
        break;
      }
      setRevenueShareActiveTab?.(subroute || "overview");
      content.innerHTML = renderRevenueShare(subroute);
      await wireRevenueShare(content, subroute);
      break;

    case "employees":
      setEmployeesActiveTab?.(subroute || "overview");
      content.innerHTML = renderEmployees(subroute);
      wireEmployees(content, subroute);
      break;

    case "employee-profile":
    case "profile":
    case "my-profile":
    case "employment":
    case "my-employment":
      content.innerHTML = renderEmployeeProfile();
      wireEmployeeProfile(content);
      break;

    case "attendance":
      setAttendanceActiveTab?.(subroute || "overview");
      content.innerHTML = renderAttendance(subroute);
      wireAttendance(content, subroute);
      break;

    case "attendance-qr-scanner":
      setAttendanceActiveTab?.("qrScanner");
      content.innerHTML = renderAttendance("qrScanner");
      wireAttendance(content, "qrScanner");
      break;

    case "reports":
      setReportsActiveTab?.(subroute || "overview");
      content.innerHTML = renderReports(subroute);
      wireReports(content, subroute);
      break;

    case "forecasts-insights":
    case "forecasts":
      setForecastsActiveTab?.(subroute || "sales-forecast");
      content.innerHTML = renderForecastsInsights();
      wireForecastsInsights();
      break;

    case "portfolio-governance":
    case "portfolio":
      setPortfolioGovernanceTab?.(subroute || "decisions");
      content.innerHTML = renderPortfolioGovernance();
      initPortfolioGovernance();
      break;

    case "onboarding-migration":
    case "onboarding":
    case "templates-migration":
      setOnboardingMigrationTab?.(subroute || "onboarding");
      content.innerHTML = renderOnboardingMigration();
      initOnboardingMigration();
      break;

    case "admin":
      setAdminActiveTab?.(subroute || "overview");
      content.innerHTML = renderAdmin(subroute);
      wireAdmin(content, subroute);
      break;

    case "org-identity":
    case "organisation-identity":
      // Section 364–395: Organisation Identity Master — Primary Master or Owner only
      if (
        (state.role === ROLES.MASTER && !getIsPrimaryMaster()) ||
        (state.role !== ROLES.MASTER && state.role !== ROLES.OWNER)
      ) {
        content.innerHTML = renderNotAvailable();
        break;
      }
      content.innerHTML = renderOrgIdentity(subroute);
      await wireOrgIdentity(content, subroute);
      break;

    case "sales-cash":
      // Allowed: MASTER (Primary+Normal), OWNER, CAFE_ADMIN
      // Blocked: STAFF
      if (state.role === ROLES.STAFF) {
        content.innerHTML = renderNotAvailable();
        break;
      }
      content.innerHTML = renderCashBook();
      await wireCashBook(content);
      break;

    case "tasks":
      content.innerHTML = renderTasks({ title: "Tasks & Approvals" });
      wireTasks(content);
      break;

    case "owner-food-safety":
    case "food-safety":
      setOwnerFoodSafetySection(subroute || "overview");
      content.innerHTML = renderOwnerFoodSafety();
      wireOwnerFoodSafety();
      break;

    case "owner-risk-audit":
    case "risk-audit":
      setOwnerRiskAuditSection(subroute || "overview");
      content.innerHTML = renderOwnerRiskAudit();
      wireOwnerRiskAudit();
      break;

    case "owner-planning":
    case "planning":
      setOwnerPlanningSection(subroute || "overview");
      content.innerHTML = renderOwnerPlanning();
      wireOwnerPlanning();
      break;

    case "owner-compliance":
    case "compliance":
      setOwnerComplianceSection(subroute || "overview");
      content.innerHTML = renderOwnerCompliance();
      wireOwnerCompliance();
      break;

    case "owner-supplier-intelligence":
    case "supplier-intelligence":
      setOwnerSupplierSection(subroute || "overview");
      content.innerHTML = renderOwnerSupplierIntelligence();
      initOwnerSupplierIntelligenceEvents();
      break;

    case "owner-academy":
    case "academy":
      setOwnerAcademySection(subroute || "overview");
      content.innerHTML = renderOwnerAcademy();
      initOwnerAcademyEvents();
      break;

    case "owner-asset-reliability":
    case "asset-reliability":
      setOwnerAssetReliabilitySection(subroute || "overview");
      content.innerHTML = renderOwnerAssetReliability();
      initOwnerAssetReliabilityEvents();
      break;

    case "owner-privacy-cyber":
    case "privacy-cyber":
      setOwnerPrivacyCyberSection(subroute || "overview");
      content.innerHTML = renderOwnerPrivacyCyber();
      initOwnerPrivacyCyberEvents();
      break;

    case "owner-bcdr":
    case "bcdr":
      setOwnerBcdrSection(subroute || "overview");
      content.innerHTML = renderOwnerBcdr();
      initOwnerBcdrEvents();
      break;

    case "owner-master-data":
    case "master-data":
      setOwnerMasterDataSection(subroute || "overview");
      content.innerHTML = renderOwnerMasterData();
      initOwnerMasterDataEvents();
      break;

    case "owner-complaints":
    case "complaints":
      setOwnerComplaintsSection(subroute || "overview");
      content.innerHTML = renderOwnerComplaints();
      initOwnerComplaintsEvents();
      break;

    case "owner-menu-pricing":
    case "menu-pricing":
      setOwnerMenuPricingSection(subroute || "matrix");
      content.innerHTML = renderOwnerMenuPricing();
      initOwnerMenuPricingEvents();
      break;

    case "owner-customer-loyalty":
    case "customer-loyalty":
      setOwnerCustomerLoyaltySection(subroute || "analytics");
      content.innerHTML = renderOwnerCustomerLoyalty();
      initOwnerCustomerLoyaltyEvents();
      break;

    case "owner-utilities-waste":
    case "utilities-waste":
      setOwnerUtilitiesWasteSection(subroute || "overview");
      content.innerHTML = renderOwnerUtilitiesWaste();
      initOwnerUtilitiesWasteEvents();
      break;

    case "owner-governance-delegation":
    case "governance-delegation":
      setOwnerGovernanceDelegationSection(subroute || "overview");
      content.innerHTML = renderOwnerGovernanceDelegation();
      initOwnerGovernanceDelegationEvents();
      break;

    case "approvals":
      content.innerHTML = renderTasks({ title: "Approvals Waiting on You" });
      wireTasks(content);
      break;

    case "performance":
      content.innerHTML = renderPerformance();
      wirePerformance(content);
      break;

    case "staff-attendance":
      content.innerHTML = renderStaffAttendance();
      wireStaffAttendance(content);
      break;

    case "staff-leave":
      content.innerHTML = renderStaffLeave();
      wireStaffLeave(content);
      break;

    case "payroll":
      setPayrollActiveTab?.(subroute || "overview");
      content.innerHTML = renderPayrollManagement(subroute);
      wirePayrollManagement(content, subroute);
      break;

    case "staff-payslips":
      content.innerHTML = renderStaffPayslips();
      wireStaffPayslips(content);
      break;

    case "staff-loans":
    case "staff-loans-advances":
      content.innerHTML = renderStaffLoansAdvances();
      wireStaffLoansAdvances(content);
      break;

    case "staff-documents":
      content.innerHTML = renderStaffDocuments();
      wireStaffDocuments(content);
      break;

    case "announcements":
      content.innerHTML = renderAnnouncements();
      wireAnnouncements(content);
      break;

    case "notifications":
      content.innerHTML = renderNotificationCentre();
      await wireNotificationCentre(content);
      break;

    case "vendors":
      setVendorsActiveTab?.(subroute || "overview");
      content.innerHTML = renderVendors(subroute);
      wireVendors(content, subroute);
      break;

    case "procurement":
      setProcurementActiveTab?.(subroute || "overview");
      content.innerHTML = renderProcurement(subroute);
      wireProcurement(content, subroute);
      break;

    case "mailops":
      content.innerHTML = renderMailOpsCommandCentre(subroute);
      wireMailOpsCommandCentre(content, subroute);
      break;

    case "menu":
      setMenuActiveTab?.(subroute || "overview");
      content.innerHTML = renderMenuManagement(subroute);
      wireMenuManagement(content, subroute);
      break;

    case "customers":
      setCustomersActiveTab?.(subroute || "overview");
      content.innerHTML = renderCustomers(subroute);
      wireCustomers(content, subroute);
      break;

    case "quality":
      setQualityActiveTab?.(subroute || "overview");
      content.innerHTML = renderQuality(subroute);
      wireQuality(content, subroute);
      break;

    case "assets":
      setAssetsActiveTab?.(subroute || "overview");
      content.innerHTML = renderAssets(subroute);
      wireAssets(content, subroute);
      break;

    case "dept-orders":
    case "department-orders":
      setDepartmentOrdersActiveTab?.(subroute || "overview");
      content.innerHTML = renderDepartmentOrders(subroute);
      wireDepartmentOrders(content, subroute);
      break;

    case "trash":
      content.innerHTML = renderTrashBin();
      wireTrashBin(content);
      break;

    case "cafe-ops-devices":
    case "devices":
      setCafeDevicesActiveTab?.(subroute || "overview");
      content.innerHTML = renderCafeOperationsDevices(subroute);
      wireCafeOperationsDevices(content, subroute);
      break;

    case "c":
    case "cafe":
    case "cafe-gateway":
    case "cafe-access": {
      stopCafeOpsInactivityTimer();
      let token = "";
      let method = "QR";
      if (subroute.startsWith("qr/")) {
        token = subroute.slice(3);
        method = "QR";
      } else if (subroute.startsWith("link/")) {
        token = subroute.slice(5);
        method = "LINK";
      } else if (subroute) {
        // Form: /c/<public-ref>/login or /c/<public-ref>
        const parts = subroute.split("/").filter(Boolean);
        token = parts[0] || "";
        method = "LINK";
      }
      if (token) {
        mountPublicCafeGateway(content, { method, token });
      } else {
        mountPublicCafeGateway(content);
      }
      break;
    }

    case "cafe-operator-signin":
      // Stop inactivity timer while sign-in UI is visible
      stopCafeOpsInactivityTimer();
      content.innerHTML = renderCafeOperatorSignIn();
      wireCafeOperatorSignIn(content, {
        onSignIn: async ({ employeeId, pin }) => {
          const deviceId = getCanonicalDeviceId();
          const gatewayContextToken = getActiveGatewayContextToken();
          const res = await apiPost('/cafe-operations/operator/signin', {
            deviceId,
            operatorUserId: employeeId,
            pin,
            gatewayContextToken,
          });
          const sessionToken = res?.sessionToken || res?.operatorSession?.sessionToken;
          if (sessionToken) {
            setCafeOpsSessionToken(sessionToken);
          }
          if (res?.trustedDeviceToken) {
            setCafeOpsDeviceToken(res.trustedDeviceToken);
          }
          if (res?.operatorSession) {
            if (res.operatorSession.operatorSessionId) {
              setSessionId(res.operatorSession.operatorSessionId);
            }
            if (res.operatorSession.cafeId) {
              // DISPLAY CACHE ONLY — NEVER AUTHORIZATION AUTHORITY
              try { localStorage.setItem('zamorin_bound_cafe_id', res.operatorSession.cafeId); } catch {}
            }
            if (res.operatorSession.operatorName) {
              // DISPLAY CACHE ONLY — NEVER AUTHORIZATION AUTHORITY
              try { localStorage.setItem('zamorin_bound_cafe_name', res.operatorSession.operatorName); } catch {}
            }
            // Update state with new operator
            setState({
              user: {
                ...state.user,
                userId: res.operatorSession.operatorUserId,
                name: res.operatorSession.operatorName,
              },
              route: 'dashboard',
            });
            // Start inactivity auto-lock after successful sign-in
            startCafeOpsInactivityTimer();
            renderShell();
          }
        },
        onReturnKiosk: () => navigate('kiosk-attendance'),
      });
      break;

    case "cafe-device-state": {
      // Reads state key from URL hash param: #cafe-device-state?s=DEVICE_REVOKED
      const hashParts = (window.location.hash || '').split('?');
      const params = new URLSearchParams(hashParts[1] || window.location.search);
      const stateKey = params.get('s') || 'NO_ACCESS';
      content.innerHTML = renderCafeOperationsState(stateKey);
      wireCafeOperationsState(content, {
        onSignIn: () => navigate('cafe-operator-signin'),
        onUnlock: () => { import('./components.js').then(({ openOperatorLockModal }) => openOperatorLockModal()); },
        onSwitch: () => { import('./components.js').then(({ openSwitchOperatorModal }) => openSwitchOperatorModal()); },
        onKiosk: () => navigate('kiosk-attendance'),
        onRetry: () => renderPage(),
      });
      break;
    }

    case "kiosk-attendance":
      const kioskDisplay = new CafeAttendanceDisplayPage();
      kioskDisplay.init(content, {
        deviceId: getCanonicalDeviceId() || 'ACTIVE_KIOSK',
        boundCafeId: localStorage.getItem('zamorin_bound_cafe_id') || state.currentCafeId || '',
      });
      break;

    case "not-built":
      content.innerHTML = renderNotBuiltYet();
      break;

    case "cafe-master-signin":
      stopCafeOpsInactivityTimer();
      resetCafeMasterSignInUi();
      content.innerHTML = renderCafeMasterSignIn();
      wireCafeMasterSignIn(content, {
        onSignIn: async ({ identifier, password, accessReason }) => {
          const res = await apiPost('/cafe-operations/operator/signin-master', {
            masterUserId: identifier,
            password,
            deviceId: getCanonicalDeviceId(),
            accessReason,
          });
          const sessionToken = res?.sessionToken || res?.operatorSession?.sessionToken;
          if (sessionToken) {
            setCafeOpsSessionToken(sessionToken);
          }
          if (res?.operatorSession) {
            if (res.operatorSession.operatorSessionId) {
              setSessionId(res.operatorSession.operatorSessionId);
            }
            startCafeOpsInactivityTimer();
            navigate('dashboard');
            return { requiresMfa: false };
          }
          return { requiresMfa: false };
        },
        onMfaVerify: async ({ mfaChallengeId, code }) => {
          await apiPost('/auth/mfa/verify', { mfaChallengeId, code });
          startCafeOpsInactivityTimer();
          navigate('dashboard');
        },
        onBack: () => navigate('cafe-operator-signin'),
      });
      break;

    case "cafe-device-enroll":
      stopCafeOpsInactivityTimer();
      resetCafeDeviceEnrollUi();
      content.innerHTML = renderCafeDeviceEnroll();
      wireCafeDeviceEnroll(content, {
        onEnroll: async ({ enrollmentCode, deviceDisplayName }) => {
          const res = await apiPost('/cafe-ops/devices/enroll', {
            enrollmentCode,
            displayName: deviceDisplayName,
            platform: 'Web',
            appVersion: '1.0.0',
            osVersion: navigator.userAgent || 'Unknown',
          });
          const data = res?.data || res;
          if (data?.deviceToken) {
            setCafeOpsDeviceToken(data.deviceToken);
          }
          if (data?.device) {
            if (data.device.id) setCanonicalDeviceId(data.device.id);
            if (data.device.cafeId) {
              // DISPLAY CACHE ONLY — NEVER AUTHORIZATION AUTHORITY
              try { localStorage.setItem('zamorin_bound_cafe_id', data.device.cafeId); } catch {}
            }
            if (data.device.cafeName) {
              // DISPLAY CACHE ONLY — NEVER AUTHORIZATION AUTHORITY
              try { localStorage.setItem('zamorin_bound_cafe_name', data.device.cafeName); } catch {}
            }
            return { device: data.device };
          }
          return { device: data };
        },
        onBack: () => navigate('cafe-operator-signin'),
        onSuccess: () => navigate('cafe-operator-signin'),
      });
      break;

    case "cafe-terminal-welcome":
      stopCafeOpsInactivityTimer();
      content.innerHTML = renderCafeTerminalWelcome();
      wireCafeTerminalWelcome(content, {
        onOperatorSignIn: () => navigate('cafe-operator-signin'),
        onMasterSignIn: () => navigate('cafe-master-signin'),
        onEnroll: () => navigate('cafe-device-enroll'),
        onKiosk: () => navigate('kiosk-attendance'),
      });
      break;
    // ── End Stage-2 Terminal Auth ─────────────────────────────────────────────

    // ── Vendor Portal Routes (Fifth Window — Strictly Read-Only) ─────────────
    case "vendor-dashboard":
    case "vendor-orders":
    case "vendor-deliveries":
    case "vendor-statements":
    case "vendor-profile":
    case "vendor-portal": {
      // Lazy-load vendor portal page
      const { renderVendorPortal, wireVendorPortal } = await import("./pages/vendorPortal.js");
      content.innerHTML = renderVendorPortal(baseRoute, subroute);
      wireVendorPortal(content, baseRoute);
      break;
    }
    // ── End Vendor Portal Routes ──────────────────────────────────────────────

    default:
      content.innerHTML = renderNotAvailable();
  }

  // Auto-wire Global Portfolio Control Context Bar across all mounted pages
  if (content) {
    wireCafeContextStrip(content);
  }
}
