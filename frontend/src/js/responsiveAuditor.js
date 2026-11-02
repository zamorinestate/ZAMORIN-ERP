// =============================================================================
// ZAMORIN CAFE ERP — PROGRAMMATIC RESPONSIVE & OVERFLOW AUDITOR (DEV ONLY)
// =============================================================================

import { state, setState } from "./state.js";
import { navigate } from "./router.js";
import { NAVIGATION, ROLES } from "./navigation.js";

export async function runZamorinResponsiveAudit() {
  console.log("=== STARTING ZAMORIN ADVERSARIAL RESPONSIVE AUDIT ===");

  const results = {
    totalRoutesTested: 0,
    totalStatesTested: 0,
    overflowDefects: [],
    clippedElements: [],
    outOfBoundsControls: [],
    matrixLog: []
  };

  const themes = ["azure", "pearl", "paper", "verdigris", "midnight", "noir"];
  const viewports = [
    { width: 1920, height: 1080, name: "Desktop 1080p" },
    { width: 1440, height: 900, name: "Laptop HD" },
    { width: 1240, height: 800, name: "Compact Desktop" },
    { width: 1024, height: 768, name: "Tablet Landscape" },
    { width: 768, height: 1024, name: "Tablet Portrait" },
    { width: 430, height: 932, name: "Mobile Large" },
    { width: 375, height: 667, name: "Mobile Medium" },
    { width: 320, height: 568, name: "Mobile Smallest" }
  ];

  const allowedOverflowContainers = [
    ".table-wrap",
    ".data-table-wrap",
    ".zamorin-tabs",
    ".subnav-bar",
    ".subnav",
    ".tab-strip",
    ".rs-tab-bar",
    ".stepper-wrap",
    ".lifecycle-stepper",
    ".workflow-stepper",
    ".bar-chart",
    ".quick-actions"
  ];

  function isContainedScroller(el) {
    let cur = el;
    while (cur && cur !== document.body) {
      for (const sel of allowedOverflowContainers) {
        if (cur.matches && cur.matches(sel)) return true;
      }
      cur = cur.parentElement;
    }
    return false;
  }

  const roleRoutes = {
    [ROLES.MASTER]: Object.keys(NAVIGATION[ROLES.MASTER] || {}),
    [ROLES.OWNER]: Object.keys(NAVIGATION[ROLES.OWNER] || {}),
    [ROLES.CAFE_ADMIN]: Object.keys(NAVIGATION[ROLES.CAFE_ADMIN] || {}),
    [ROLES.STAFF]: Object.keys(NAVIGATION[ROLES.STAFF] || {})
  };

  // Add notification centre (universal route)
  roleRoutes[ROLES.MASTER].push("notifications");
  roleRoutes[ROLES.OWNER].push("notifications");
  roleRoutes[ROLES.CAFE_ADMIN].push("notifications");
  roleRoutes[ROLES.STAFF].push("notifications");

  for (const role of [ROLES.MASTER, ROLES.OWNER, ROLES.CAFE_ADMIN, ROLES.STAFF]) {
    // Set authenticated state
    setState({
      role,
      user: {
        id: "USER_AUDIT",
        name: "Auditor",
        role,
        isPrimaryMaster: role === ROLES.MASTER
      },
      auth: {
        isAuthenticated: true,
        user: {
          id: "USER_AUDIT",
          name: "Auditor",
          role,
          isPrimaryMaster: role === ROLES.MASTER
        }
      }
    });

    const routes = roleRoutes[role];
    for (const route of routes) {
      if (route === "login" || route === "cafeOperatorSignIn") continue;

      navigate(route);
      await new Promise(r => setTimeout(r, 60));

      results.totalRoutesTested++;

      // Test all themes
      for (const theme of themes) {
        document.documentElement.setAttribute("data-theme", theme);

        // Check document client vs scroll width
        const docScrollW = document.documentElement.scrollWidth;
        const docClientW = document.documentElement.clientWidth;
        const bodyScrollW = document.body.scrollWidth;
        const bodyClientW = document.body.clientWidth;

        const hasDocOverflow = docScrollW > docClientW + 2;
        const hasBodyOverflow = bodyScrollW > bodyClientW + 2;

        if (hasDocOverflow || hasBodyOverflow) {
          results.overflowDefects.push({
            role,
            route,
            theme,
            docScrollW,
            docClientW,
            bodyScrollW,
            bodyClientW
          });
        }

        // Check visible elements for bounds overflow
        const allVisible = Array.from(document.querySelectorAll("#page-content *")).filter(el => {
          const style = window.getComputedStyle(el);
          return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
        });

        for (const el of allVisible) {
          if (isContainedScroller(el)) continue;

          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            // Check if protruding beyond window
            if (rect.right > window.innerWidth + 4 && !isContainedScroller(el)) {
              results.outOfBoundsControls.push({
                role,
                route,
                theme,
                tagName: el.tagName,
                className: el.className,
                rectRight: rect.right,
                windowWidth: window.innerWidth,
                snippet: el.outerHTML.slice(0, 100)
              });
            }
          }
        }

        // Test tabs on page if any
        const tabs = Array.from(document.querySelectorAll("[data-tab], .tab, .subnav-btn, .rs-tab-btn, .bills-nav-tab"));
        for (const tab of tabs) {
          results.totalStatesTested++;
          try {
            tab.click();
            await new Promise(r => setTimeout(r, 20));
          } catch (e) {
            // ignore click errors
          }
        }
      }
    }
  }

  // Restore default azure theme
  document.documentElement.setAttribute("data-theme", "azure");

  console.log("=== AUDIT SUMMARY ===");
  console.log("Total Routes Tested:", results.totalRoutesTested);
  console.log("Total States / Tabs Tested:", results.totalStatesTested);
  console.log("Overflow Defects Count:", results.overflowDefects.length);
  console.log("Out of Bounds Controls Count:", results.outOfBoundsControls.length);

  return results;
}

if (typeof window !== "undefined") {
  window.runZamorinResponsiveAudit = runZamorinResponsiveAudit;
}
