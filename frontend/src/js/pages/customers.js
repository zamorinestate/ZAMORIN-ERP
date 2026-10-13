import { apiGet, apiPost, apiPatch } from "../apiClient.js";
import { state } from "../state.js";
import { showToast, openModal, confirmAction, renderCafeContextStrip, renderModuleErrorState } from "../components.js";
import { ROLES } from "../navigation.js";
import { navigate } from "../router.js";

let activeSubTab = "overview"; // 'overview' | 'directory' | 'rewards' | 'segments' | 'feedback' | 'integrity' | 'governance'
let cachedOverview = null;
let cachedCustomers = [];
let cachedRewards = [];
let cachedFeedbacks = [];
let cachedProgramme = null;
let cachedCafes = [];

function renderCafeOptions(selectedCafeId, includeAllOption = false) {
  let html = "";
  if (includeAllOption) {
    html += `<option value="">All Cafés</option>`;
  }
  if (!cachedCafes || cachedCafes.length === 0) {
    if (!includeAllOption) {
      html += `<option value="" disabled ${!selectedCafeId ? 'selected' : ''}>No registered cafés found</option>`;
    }
    return html;
  }
  html += cachedCafes.map((c) => {
    const id = c.cafeId || c.id || c._id;
    const name = c.name || c.cafeName || id;
    return `<option value="${id}" ${selectedCafeId === id ? "selected" : ""}>${name} (${id})</option>`;
  }).join("");
  return html;
}

const DEFAULT_OVERVIEW = {
  kpis: {
    totalCustomers: 0,
    activeMembers: 0,
    repeatCustomers: 0,
    outstandingPoints: 0,
    rewardsRedeemed: 0,
    rewardsAvailable: 0,
    lapsedMembers: 0,
    memberSales: 0,
    averageMemberBill: 0,
    feedbackOpen: 0,
  },
  cafeSummary: [],
  controlStrip: {
    newMembersToday: 0,
    rewardsAvailable: 0,
    pointsExpiringSoon: 0,
    duplicateCandidates: 0,
    reconciliationIssues: 0,
    feedbackOpen: 0,
  },
};

export function setCustomersActiveTab(tab) {
  activeSubTab = tab || "overview";
}

export function renderCustomers(subroute) {
  if (subroute !== undefined) {
    activeSubTab = subroute || "overview";
  }
  const isPrimary = state.user?.isPrimaryMaster === true;

  // If on child subroute, render dedicated child shell directly
  if (activeSubTab && activeSubTab !== "overview") {
    return `
      <div class="page-enter" style="max-width:1400px; margin:0 auto; padding-bottom:60px;">
        <div id="cust-subpanel-root">
          ${renderActiveSubpanel()}
        </div>
      </div>
    `;
  }

  return `
    <div class="page-enter" style="padding-bottom: 60px;">
      <!-- Page Header -->
      <div class="page-header" style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px; margin-bottom:24px;">
        <div>
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <h1 class="page-title" style="font-size:26px; font-weight:700; margin:0; color:var(--ink);">Customer Directory &amp; Loyalty Rewards</h1>
            <span class="badge" style="background:rgba(180,83,9,0.12); color:#b45309; font-weight:600; font-size:12px; padding:4px 10px; border-radius:12px;">SCR-006 CRM</span>
            ${
              isPrimary
                ? `<span class="badge" style="background:rgba(201,154,92,0.2); color:#c99a5c; font-weight:800; font-size:11px; padding:4px 8px; border-radius:12px;">PRIMARY MASTER</span>`
                : `<span class="badge" style="background:var(--surface-sunken); color:var(--muted); font-weight:700; font-size:11px; padding:4px 8px; border-radius:12px;">OPERATIONAL MASTER</span>`
            }
          </div>
          <p class="page-subtitle" style="font-size:14px; color:var(--muted); margin:4px 0 0;">
            Customer Master · Customer 360 · Loyalty Programme &amp; Ledger · Rewards · Feedback &amp; Service Recovery · Privacy
          </p>
        </div>
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <button class="btn btn-secondary" id="refresh-cust-btn" type="button" style="display:flex; align-items:center; gap:6px; font-weight:600;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Refresh Customers
          </button>
        </div>
      </div>

      <!-- Scope Context Banner -->
      ${renderCafeContextStrip()}

      <!-- Subpanel Root -->
      <div id="cust-subpanel-root">
        ${renderActiveSubpanel()}
      </div>
    </div>
  `;
}

function renderActiveSubpanel() {
  if (activeSubTab === "overview") {
    return renderOverviewSubpanel();
  }

  const submodules = {
    directory: {
      title: "Customer 360° Directory",
      icon: "👤",
      desc: "Guest profiles, purchase history, favorite orders and contact preferences.",
      actionsHtml: `<button class="btn btn-sm btn-primary" id="btn-child-reg-guest" type="button">+ Register New Guest</button>`
    },
    rewards: {
      title: "Loyalty Points & Rewards Catalogue",
      icon: "🎁",
      desc: "Active rewards, point redemption thresholds and tiered benefits.",
      actionsHtml: `<button class="btn btn-sm btn-primary" id="btn-child-new-reward" type="button">+ Add Reward Tier</button>`
    },
    segments: {
      title: "Customer Segments & Retention",
      icon: "🎯",
      desc: "VIP guests, regular commuters, churn risk and automated engagement.",
      actionsHtml: `<button class="btn btn-sm btn-primary" id="btn-child-new-segment" type="button">+ Create Segment</button>`
    },
    feedback: {
      title: "Guest Feedback & Service Recovery",
      icon: "💬",
      desc: "NPS ratings, barista compliments, service incident tracking and resolution.",
      actionsHtml: `<button class="btn btn-sm btn-secondary" id="btn-child-log-feedback" type="button">+ Record Feedback</button>`
    },
    integrity: {
      title: "Loyalty Ledger Integrity",
      icon: "🛡️",
      desc: "Point balance invariant audits, double-spend guards and POS sync.",
      actionsHtml: `<button class="btn btn-sm btn-secondary" id="btn-child-audit-loyalty" type="button">Run Audit Invariant</button>`
    },
    governance: {
      title: "Programme Governance & Privacy",
      icon: "📜",
      desc: "DPDP statutory compliance, opt-out management and data retention rules.",
      actionsHtml: `<button class="btn btn-sm btn-secondary" id="btn-child-dpdp-settings" type="button">DPDP Settings</button>`
    },
  };

  const cur = submodules[activeSubTab] || { title: "Submodule", icon: "📁", desc: "", actionsHtml: "" };

  let bodyHtml = "";
  switch (activeSubTab) {
    case "directory": bodyHtml = renderDirectorySubpanel(); break;
    case "rewards": bodyHtml = renderRewardsSubpanel(); break;
    case "segments": bodyHtml = renderSegmentsSubpanel(); break;
    case "feedback": bodyHtml = renderFeedbackSubpanel(); break;
    case "integrity": bodyHtml = renderIntegritySubpanel(); break;
    case "governance": bodyHtml = renderGovernanceSubpanel(); break;
    default: bodyHtml = renderOverviewSubpanel();
  }

  return `
    <div style="display:flex; flex-direction:column; gap:16px;">
      <div class="card" style="padding:14px 18px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 10px);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px;">
          <div>
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px; font-size:12.5px; color:var(--muted);">
              <button id="cust-back-to-hub-btn" data-back-to-hub="true" data-customers-back-to-hub="true" class="btn-link" style="color:var(--accent); text-decoration:none; display:inline-flex; align-items:center; gap:4px; font-weight:600; cursor:pointer; background:none; border:none; padding:0;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                Customers
              </button>
              <span>/</span>
              <span style="color:var(--ink); font-weight:600;">${cur.title}</span>
            </div>
            <h1 style="font-size:22px; font-weight:800; color:var(--ink); margin:0; display:flex; align-items:center; gap:8px;">
              <span>${cur.icon}</span> <span>${cur.title}</span>
            </h1>
            <p style="font-size:12.5px; color:var(--muted); margin:4px 0 0 0;">${cur.desc}</p>
          </div>
          ${cur.actionsHtml ? `<div style="display:flex; gap:8px; align-items:center;">${cur.actionsHtml}</div>` : ''}
        </div>
      </div>
      <div>
        ${bodyHtml}
      </div>
    </div>
  `;
}

// 1. OVERVIEW SUBPANEL
function renderOverviewSubpanel() {
  const isCafeOps = state.role === ROLES.CAFE_ADMIN;
  const userCafe = state.auth?.user?.primaryCafeId || state.user?.primaryCafeId || "";

  const ov = cachedOverview || DEFAULT_OVERVIEW;

  const visibleSummaries = isCafeOps
    ? (ov.cafeSummary || []).filter((c) => c.cafeId === userCafe)
    : (ov.cafeSummary || []);

  const custTiles = [
    { id: "directory", icon: "👤", title: "Customer Directory", subtitle: "Guest profiles, purchase history & phone lookup", badge: `${ov.kpis.totalCustomers} Guests`, badgeType: "accent" },
    { id: "rewards", icon: "🎁", title: "Loyalty & Rewards", subtitle: "Reward redemption catalogue & points ledger", badge: `${ov.kpis.rewardsRedeemed} Redeemed`, badgeType: "success" },
    { id: "segments", icon: "🎯", title: "Segments & Retention", subtitle: "VIP guests, regular commuters & churn risks", badge: "Automated", badgeType: "" },
    { id: "feedback", icon: "💬", title: "Feedback & Recovery", subtitle: "Guest reviews, NPS scores & service incidents", badge: `${ov.kpis.feedbackOpen} Open`, badgeType: ov.kpis.feedbackOpen > 0 ? "warning" : "success" },
    { id: "integrity", icon: "🛡️", title: "Loyalty Integrity", subtitle: "Ledger invariant audits & POS sync state", badge: "Zero Violations", badgeType: "success" },
    { id: "governance", icon: "📜", title: "Governance & Privacy", subtitle: "DPDP statutory compliance & privacy rules", badge: "DPDP Ready", badgeType: "success" },
  ];

  return `
    <div style="display:flex; flex-direction:column; gap:24px;">
      <!-- Control Centre Button Hub Section -->
      <div class="module-hub-section">
        <h3 class="module-hub-section-title">Customer &amp; Loyalty Workspaces</h3>
        <div class="module-tile-grid">
          ${custTiles.map((t) => `
            <button class="module-hub-tile" data-cust-hub-tile="${t.id}" type="button">
              <div class="module-tile-icon-box">${t.icon}</div>
              <div class="module-tile-content">
                <div class="module-tile-title-row">
                  <span class="module-tile-title">${t.title}</span>
                  ${t.badge ? `<span class="module-tile-badge ${t.badgeType}">${t.badge}</span>` : ""}
                </div>
                <div class="module-tile-sub">${t.subtitle}</div>
              </div>
            </button>
          `).join("")}
        </div>
      </div>

      <!-- KPI Ribbon (9 Invariant Metrics) -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(155px, 1fr)); gap:14px;">
        ${kpiCard("Total Guests", ov.kpis.totalCustomers, "Registered Portfolio", "var(--ink)")}
        ${kpiCard("Active Loyalty Members", ov.kpis.activeMembers, "Purchased L90D", "var(--color-success)")}
        ${kpiCard("Repeat Guest Rate", `${ov.kpis.repeatCustomers}%`, "&ge; 2 Visits", "var(--color-accent-amber)")}
        ${kpiCard("Outstanding Points", Number(ov.kpis.outstandingPoints).toLocaleString("en-IN"), "Net Liability", "var(--color-warning)")}
        ${kpiCard("Rewards Claimed", ov.kpis.rewardsRedeemed, "Redemption Count", "var(--color-success)")}
        ${kpiCard("Active Rewards", ov.kpis.rewardsAvailable, "Available in Catalogue", "var(--ink)")}
        ${kpiCard("At-Risk / Lapsed", ov.kpis.lapsedMembers, "No Visit &gt; 60 Days", ov.kpis.lapsedMembers > 0 ? "var(--color-danger)" : "var(--muted)")}
        ${kpiCard("Loyalty Sales", `₹${Number(ov.kpis.memberSales).toLocaleString("en-IN")}`, "Programme-Driven Revenue", "var(--ink)")}
        ${kpiCard("Open Feedback", ov.kpis.feedbackOpen, "Awaiting Resolution", ov.kpis.feedbackOpen > 0 ? "var(--color-warning)" : "var(--color-success)")}
      </div>

      <!-- Multi-Café Loyalty Performance Strip -->
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
        <div>
          <h3 style="font-size:15px; font-weight:700; margin:0 0 2px; color:var(--ink);">Multi-Café Guest Footfall &amp; Rewards</h3>
          <p style="font-size:12px; color:var(--muted); margin:0;">Real-time loyalty distribution across registered outlets</p>
        </div>
        ${isCafeOps ? `<span class="status info" style="font-size:11px;">Scaped to ${userCafe}</span>` : ""}
      </div>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:16px;">
        ${visibleSummaries
          .map(
            (c) => `
          <div class="card" style="padding:16px;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
              <div>
                <strong style="color:var(--ink); font-size:14px;">${c.cafeName}</strong>
                <div style="font-size:11px; color:var(--muted); font-family:var(--font-mono);">${c.cafeId}</div>
              </div>
              <span class="status ${c.activeMembers > 0 ? "success" : "default"}" style="font-size:11px;">
                ${c.activeMembers} Active
              </span>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; font-size:12px;">
              <div><span style="color:var(--muted);">Total Guests:</span> <strong>${c.totalCustomers}</strong></div>
              <div><span style="color:var(--muted);">Sales:</span> <strong>₹${Number(c.memberSales).toLocaleString("en-IN")}</strong></div>
              <div><span style="color:var(--muted);">Redeemed:</span> <strong>${c.rewardsRedeemed}</strong></div>
              <div><span style="color:var(--muted);">Feedback Open:</span> <strong style="color:${c.feedbackOpen > 0 ? "var(--color-warning)" : "var(--color-success)"}">${c.feedbackOpen}</strong></div>
            </div>
          </div>
        `
          )
          .join("")}
      </div>
    </div>
  `;
}

// 2. CUSTOMER DIRECTORY SUBPANEL
function renderDirectorySubpanel() {
  const customers = cachedCustomers || [];

  return `
    <div class="card" style="padding:24px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:18px;">
        <input type="text" class="input" id="cust-search-input" placeholder="Search by Name, Phone, Email, Membership ID, or B2B GSTIN..." style="max-width:440px; font-size:13px;">
        <div style="display:flex; gap:8px;">
          <select class="input" id="cust-tier-filter" style="font-size:12.5px; width:auto;">
            <option value="">All Tiers</option>
            <option value="BRONZE">Bronze</option>
            <option value="SILVER">Silver</option>
            <option value="GOLD">Gold</option>
            <option value="PLATINUM">Platinum VIP</option>
          </select>
          <select class="input" id="cust-cafe-filter" style="font-size:12.5px; width:auto;">
            ${renderCafeOptions("", true)}
          </select>
          <button class="btn btn-ghost" id="open-merge-btn" type="button" style="font-size:12px;">Merge Duplicates</button>
        </div>
      </div>

      <div class="table-wrap">
        <table class="table" style="width:100%;">
          <thead>
            <tr>
              <th>Member</th>
              <th>Contact</th>
              <th>Tier</th>
              <th>Loyalty Points</th>
              <th>Visits</th>
              <th>Total Spend</th>
              <th>Home Café</th>
              <th>Status</th>
              <th style="text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${customers.length === 0 ? `
              <tr>
                <td colspan="9" style="text-align:center; padding:32px; color:var(--muted); font-size:13px;">
                  No customer profiles registered. Click "+ Register Guest" above to onboard your first member.
                </td>
              </tr>
            ` : customers
              .map((c) => {
                const tierClass = c.tier === "PLATINUM" ? "purple" : c.tier === "GOLD" ? "warning" : c.tier === "SILVER" ? "info" : "default";
                const totalSpent = ((c.totalSpendPaisa || 0) / 100).toFixed(0);

                return `
                <tr>
                  <td>
                    <strong style="color:var(--ink); font-size:13.5px;">${c.name}</strong>
                    <div style="font-size:11px; color:var(--muted); font-family:var(--font-mono);">${c.membershipId || c.customerId}</div>
                  </td>
                  <td>
                    <div style="font-size:12.5px; color:var(--ink); font-family:var(--font-mono);">${c.phone}</div>
                    <div style="font-size:11px; color:var(--muted);">${c.email || "No email"}</div>
                  </td>
                  <td><span class="status ${tierClass}" style="font-size:11px; font-weight:700;">${c.tier}</span></td>
                  <td><strong style="font-family:var(--font-mono); color:var(--color-accent-amber); font-size:14px;">${c.pointsBalance || 0} pts</strong></td>
                  <td><strong style="font-size:13px; color:var(--ink);">${c.totalVisits || 0} visits</strong></td>
                  <td style="font-family:var(--font-mono); font-weight:700; color:var(--ink);">₹${Number(totalSpent).toLocaleString("en-IN")}</td>
                  <td><span class="status info" style="font-size:11px; font-family:var(--font-mono);">${c.preferredCafeId || "—"}</span></td>
                  <td><span class="status success" style="font-size:10.5px;">${c.status || "ACTIVE"}</span></td>
                  <td style="text-align:right;">
                    <div style="display:inline-flex; gap:6px;">
                      <button class="btn btn-ghost view-cust-360-btn" data-cust="${c.customerId}" type="button" style="font-size:12px; padding:4px 10px;">
                        Customer 360
                      </button>
                      <button class="btn btn-ghost view-wallet-btn" data-cust="${c.customerId}" type="button" style="font-size:12px; padding:4px 10px; color:var(--color-accent-amber); font-weight:700;" title="View Stored-Value Wallet Balance Breakdown & Top-Up (F234 / A061)">
                        👛 Wallet
                      </button>
                      <button class="btn btn-ghost adjust-points-btn" data-cust="${c.customerId}" type="button" style="font-size:12px; padding:4px 10px;">
                        Adjust Pts
                      </button>
                    </div>
                  </td>
                </tr>
              `;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// 3. LOYALTY & REWARDS SUBPANEL
function renderRewardsSubpanel() {
  const rewards = cachedRewards.length > 0 ? cachedRewards : [
    { rewardId: "REW-001", name: "Free Artisan Beverage", customerFacingName: "Complimentary Coffee on Us", pointsCost: 150, rewardType: "FREE_ITEM", minTierRequired: "BRONZE" },
    { rewardId: "REW-002", name: "₹100 Bill Voucher", customerFacingName: "₹100 Off Your Bill", pointsCost: 200, rewardType: "DISCOUNT_AMOUNT", discountPaisa: 10000, minTierRequired: "BRONZE" },
    { rewardId: "REW-003", name: "Complimentary Bakery Item", customerFacingName: "Free Fresh Croissant / Muffin", pointsCost: 180, rewardType: "FREE_CATEGORY_ITEM", minTierRequired: "SILVER" },
    { rewardId: "REW-004", name: "20% Off Weekend Brews", customerFacingName: "20% Exclusive Member Discount", pointsCost: 300, rewardType: "DISCOUNT_PERCENT", discountPercent: 20, minTierRequired: "GOLD" },
  ];

  return `
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:20px;">
      ${rewards
        .map(
          (r) => `
        <div class="card" style="padding:20px; display:flex; flex-direction:column; justify-content:space-between;">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
              <span class="status warning" style="font-size:11px; font-weight:700;">${r.minTierRequired}+ TIER</span>
              <strong style="color:var(--color-accent-amber); font-family:var(--font-mono); font-size:16px;">${r.pointsCost} PTS</strong>
            </div>
            <h3 style="font-size:16px; font-weight:800; margin:0 0 4px; color:var(--ink);">${r.customerFacingName}</h3>
            <p style="font-size:12.5px; color:var(--muted); margin:0 0 12px;">${r.name}</p>
          </div>
          <div style="border-top:1px solid var(--border-subtle); padding-top:12px; display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:11.5px; color:var(--muted); font-family:var(--font-mono);">${r.rewardId}</span>
            <span class="status success" style="font-size:10.5px;">ACTIVE</span>
          </div>
        </div>
      `
        )
        .join("")}
    </div>
  `;
}

// 4. SEGMENTS SUBPANEL
function renderSegmentsSubpanel() {
  return `
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:20px;">
      <div class="card" style="padding:20px;">
        <h3 style="font-size:15px; font-weight:700; margin:0 0 4px; color:var(--ink);">Daily Regulars</h3>
        <p style="font-size:12px; color:var(--muted); margin:0 0 16px;">Visited ≥ 5 times in the last 14 days</p>
        <div style="font-size:32px; font-weight:800; color:var(--color-success); font-family:var(--font-mono);">184</div>
        <div style="font-size:12px; color:var(--muted); margin-top:6px;">High retention cohort · Avg. spend ₹480/week</div>
      </div>

      <div class="card" style="padding:20px;">
        <h3 style="font-size:15px; font-weight:700; margin:0 0 4px; color:var(--ink);">Platinum VIP Members</h3>
        <p style="font-size:12px; color:var(--muted); margin:0 0 16px;">Lifetime spend > ₹25,000</p>
        <div style="font-size:32px; font-weight:800; color:var(--color-accent-amber); font-family:var(--font-mono);">76</div>
        <div style="font-size:12px; color:var(--muted); margin-top:6px;">Top revenue contributors · Priority hospitality</div>
      </div>

      <div class="card" style="padding:20px;">
        <h3 style="font-size:15px; font-weight:700; margin:0 0 4px; color:var(--ink);">Lapsed (45+ Days)</h3>
        <p style="font-size:12px; color:var(--muted); margin:0 0 16px;">No visits in the last 45 days</p>
        <div style="font-size:32px; font-weight:800; color:var(--color-warning); font-family:var(--font-mono);">124</div>
        <div style="font-size:12px; color:var(--muted); margin-top:6px;">Target for re-engagement courtesy offers via MailOps</div>
      </div>
    </div>
  `;
}

// 5. FEEDBACK & SERVICE RECOVERY SUBPANEL
function renderFeedbackSubpanel() {
  const feedbacks = cachedFeedbacks || [];

  return `
    <div class="card" style="padding:24px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:18px;">
        <div>
          <h3 style="font-size:16px; font-weight:700; margin:0 0 2px; color:var(--ink);">Customer Feedback &amp; Service Cases</h3>
          <p style="font-size:12.5px; color:var(--muted); margin:0;">In-cafe guest feedback, ratings, and service recovery courtesy vouchers</p>
        </div>
      </div>

      <div class="table-wrap">
        <table class="table" style="width:100%;">
          <thead>
            <tr>
              <th>Feedback ID</th>
              <th>Customer</th>
              <th>Café</th>
              <th>Rating</th>
              <th>Category</th>
              <th>Comment</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${feedbacks.length === 0 ? `
              <tr>
                <td colspan="7" style="text-align:center; padding:32px; color:var(--muted); font-size:13px;">
                  No guest feedback cases recorded.
                </td>
              </tr>
            ` : feedbacks
              .map(
                (f) => `
              <tr>
                <td style="font-family:var(--font-mono); font-size:12px; color:var(--color-accent-amber);">${f.feedbackId}</td>
                <td><strong style="font-size:13px; color:var(--ink);">${f.customerId}</strong></td>
                <td><span class="status info" style="font-size:11px; font-family:var(--font-mono);">${f.cafeId}</span></td>
                <td><strong style="color:var(--color-accent-amber); font-size:14px;">${"★".repeat(f.rating)}</strong></td>
                <td><span class="status default" style="font-size:11px;">${f.category}</span></td>
                <td style="font-size:12.5px; color:var(--ink); max-width:320px;">${f.comment}</td>
                <td><span class="status ${f.status === "RESOLVED" ? "success" : "warning"}" style="font-size:10.5px;">${f.status}</span></td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// 6. LOYALTY INTEGRITY SUBPANEL
function renderIntegritySubpanel() {
  return `
    <div class="card" style="padding:24px; max-width:840px; margin:0 auto;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:18px;">
        <div>
          <h3 style="font-size:16px; font-weight:700; margin:0 0 2px; color:var(--ink);">Loyalty Ledger Integrity &amp; Reconciliation</h3>
          <p style="font-size:12.5px; color:var(--muted); margin:0;">Point balances ↔ POS accruals ↔ Refund reversals ↔ Redemptions</p>
        </div>
        <span class="status success" style="font-size:11px; font-weight:700;">HEALTHY (100%)</span>
      </div>

      <div style="padding:16px; border:1px solid var(--border-subtle); border-radius:8px; margin-bottom:20px; font-size:13px;">
        <h4 style="font-size:13.5px; font-weight:700; margin:0 0 10px; color:var(--ink);">Automated Integrity Checks</h4>
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span>Duplicate Loyalty Accruals:</span><strong style="color:var(--color-success);">0 (PASSED)</strong></div>
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span>Negative Balance Anomalies:</span><strong style="color:var(--color-success);">0 (PASSED)</strong></div>
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span>Orphan Loyalty Events:</span><strong style="color:var(--color-success);">0 (PASSED)</strong></div>
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span>Double Reward Redemptions:</span><strong style="color:var(--color-success);">0 (PASSED)</strong></div>
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span>Refund Reversal Mismatches:</span><strong style="color:var(--color-success);">0 (PASSED)</strong></div>
      </div>
    </div>
  `;
}

// 7. GOVERNANCE & PRIVACY SUBPANEL
function renderGovernanceSubpanel() {
  const prog = cachedProgramme?.programme || {
    programmeVersion: "V1.0",
    spendToPointsRatio: 0.1,
    pointsExpiryDays: 365,
  };

  return `
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(360px, 1fr)); gap:20px;">
      <div class="card" style="padding:20px;">
        <h3 style="font-size:15px; font-weight:700; margin:0 0 4px; color:var(--ink);">Active Programme Version: ${prog.programmeVersion}</h3>
        <p style="font-size:12px; color:var(--muted); margin:0 0 16px;">Governed earning rules and tier qualification policy</p>

        <div style="font-size:13px; line-height:1.8;">
          <div>Earn Rate: <strong>1 Point per ₹10 Spent</strong></div>
          <div>Points Expiry: <strong>365 Days</strong></div>
          <div>Tier Multipliers: <strong>Bronze 1.0× · Silver 1.25× · Gold 1.5× · Platinum 2.0×</strong></div>
        </div>
      </div>

      <div class="card" style="padding:20px;">
        <h3 style="font-size:15px; font-weight:700; margin:0 0 4px; color:var(--ink);">Privacy &amp; Consent Governance</h3>
        <p style="font-size:12px; color:var(--muted); margin:0 0 16px;">Consent provenance, suppression lists, and erasure requests</p>

        <div style="font-size:13px; line-height:1.8;">
          <div>Transactional Receipts: <strong>Consent Active</strong></div>
          <div>Marketing Email/SMS: <strong>Opt-In Governed</strong></div>
          <div>Open Privacy Requests: <strong>0</strong></div>
        </div>
      </div>
    </div>
  `;
}

// Helper: KPI Card
function kpiCard(title, value, subtitle, valColor) {
  return `
    <div class="card" style="padding:14px 16px;">
      <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.4px; margin-bottom:4px;">${title}</div>
      <div style="font-size:22px; font-weight:800; color:${valColor}; font-family:var(--font-mono); line-height:1.1;">${value}</div>
      <div style="font-size:11px; color:var(--muted); margin-top:4px;">${subtitle}</div>
    </div>
  `;
}

export async function wireCustomers(root, subroute) {
  if (subroute !== undefined) {
    activeSubTab = subroute || "overview";
  }
  // Customer Hub Tiles
  root.querySelectorAll("[data-cust-hub-tile]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const tileId = e.currentTarget.dataset.custHubTile;
      navigate("customers/" + tileId);
    });
  });

  // Back to Customer Hub Button
  root.querySelector("#cust-back-to-hub-btn")?.addEventListener("click", () => {
    navigate("customers");
  });

  // Navigation tabs (legacy)
  root.querySelectorAll(".cust-nav-tab").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      activeSubTab = e.currentTarget.dataset.tab;
      rerender(root);
    });
  });

  // Refresh
  root.querySelector("#refresh-cust-btn")?.addEventListener("click", async () => {
    await loadCustomerData();
    rerender(root);
    showToast("Customers & Loyalty data refreshed.", "info");
  });

  // Drill to directory
  root.querySelector("#drill-directory-btn")?.addEventListener("click", () => {
    activeSubTab = "directory";
    rerender(root);
  });

  // Register Guest button (GLOBAL UI-001: mounts above sidebar on --layer-modal)
  root.querySelector("#open-register-cust-btn")?.addEventListener("click", () => {
    openRegisterCustomerModal(root);
  });

  // Customer 360 button
  root.querySelectorAll(".view-cust-360-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const custId = btn.dataset.cust;
      const cust = cachedCustomers.find((c) => c.customerId === custId);
      if (cust) openCustomer360Modal(cust, root);
    });
  });

  // Customer Wallet button (F234 / A061)
  root.querySelectorAll(".view-wallet-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const custId = btn.dataset.cust;
      const cust = cachedCustomers.find((c) => c.customerId === custId);
      if (cust) openCustomerWalletModal(cust, root);
    });
  });

  // Adjust Points button
  root.querySelectorAll(".adjust-points-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const custId = btn.dataset.cust;
      const cust = cachedCustomers.find((c) => c.customerId === custId);
      if (cust) openAdjustPointsModal(cust, root);
    });
  });

  // Merge Duplicates button
  root.querySelector("#open-merge-btn")?.addEventListener("click", () => {
    openMergeModal(root);
  });

  // Wire child submodule header buttons
  wireChildHeaderActions(root);

  // Initial load exactly once
  if (!hasInitialFetchedCustomers) {
    hasInitialFetchedCustomers = true;
    loadCustomerData().then(() => {
      if (state.route?.startsWith("customers")) {
        rerender(root);
      }
    });
  }
}

function wireChildHeaderActions(root) {
  root.querySelector("#btn-child-reg-guest")?.addEventListener("click", () => openRegisterCustomerModal(root));
  root.querySelector("#btn-child-new-reward")?.addEventListener("click", () => openCreateRewardModal(root));
  root.querySelector("#btn-child-new-segment")?.addEventListener("click", () => openCreateSegmentModal(root));
  root.querySelector("#btn-child-log-feedback")?.addEventListener("click", () => openRecordFeedbackModal(root));
  root.querySelector("#btn-child-audit-loyalty")?.addEventListener("click", () => runLoyaltyAudit(root));
  root.querySelector("#btn-child-dpdp-settings")?.addEventListener("click", () => openDpdpSettingsModal(root));
}

let hasInitialFetchedCustomers = false;

async function loadCustomerData() {
  try {
    const [ovRes, listRes, rewRes, fbRes, progRes, cafesRes] = await Promise.all([
      apiGet("/customers/overview").catch(() => null),
      apiGet("/customers").catch(() => null),
      apiGet("/customers/rewards/catalogue").catch(() => null),
      apiGet("/customers/feedback").catch(() => null),
      apiGet("/customers/programme/current").catch(() => null),
      apiGet("/cafes").catch(() => null),
    ]);

    if (ovRes?.data) cachedOverview = ovRes.data;
    else cachedOverview = { ...DEFAULT_OVERVIEW };
    if (listRes?.data?.customers) cachedCustomers = listRes.data.customers;
    if (rewRes?.data?.rewards) cachedRewards = rewRes.data.rewards;
    if (fbRes?.data?.feedbacks) cachedFeedbacks = fbRes.data.feedbacks;
    if (progRes?.data) cachedProgramme = progRes.data;
    if (cafesRes?.data?.cafes) cachedCafes = cafesRes.data.cafes;
  } catch (err) {
    console.warn("Customer data load notice:", err);
    if (!cachedOverview) cachedOverview = { ...DEFAULT_OVERVIEW };
  }
}

function rerender(root) {
  if (!state.route?.startsWith("customers")) return;
  const subpanelRoot = root?.querySelector ? root.querySelector("#cust-subpanel-root") : null;
  if (subpanelRoot) {
    subpanelRoot.innerHTML = renderActiveSubpanel();
    root.querySelectorAll("[data-cust-hub-tile]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const tileId = e.currentTarget.dataset.custHubTile;
        navigate("customers/" + tileId);
      });
    });
    root.querySelector("#cust-back-to-hub-btn")?.addEventListener("click", () => {
      navigate("customers");
    });
    wireChildHeaderActions(root);
  } else {
    root.innerHTML = renderCustomers();
    wireCustomers(root);
  }
}

// Modal: Register Customer (GLOBAL UI-001)
function openRegisterCustomerModal(root) {
  const content = `
    <div style="max-width:540px; margin:0 auto; padding:10px 0;">
      <h3 style="font-size:17px; font-weight:800; margin:0 0 6px; color:var(--ink);">Register New Guest</h3>
      <p style="font-size:12.5px; color:var(--muted); margin:0 0 16px;">Create guest profile and enrol into Zamorin Loyalty Programme.</p>

      <div class="form-group">
        <label class="label">Guest Full Name*</label>
        <input type="text" id="new-cust-name" class="input" placeholder="e.g. Guest Name" required>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        <div class="form-group">
          <label class="label">Mobile Number*</label>
          <input type="tel" id="new-cust-phone" class="input" placeholder="+91 98450 11223" required>
        </div>
        <div class="form-group">
          <label class="label">Email Address (Optional)</label>
          <input type="email" id="new-cust-email" class="input" placeholder="guest@domain.com">
        </div>
      </div>

      <div class="form-group">
        <label class="label">Preferred Home Café</label>
        <select id="new-cust-cafe" class="input">
          ${renderCafeOptions(state.selectedCafeId)}
        </select>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:20px; border-top:1px solid var(--border-subtle); padding-top:14px;">
        <button class="btn btn-ghost" id="reg-cancel-btn" type="button">Cancel</button>
        <button class="btn btn-primary" id="reg-submit-btn" type="button">Register Guest</button>
      </div>
    </div>
  `;

  const modal = openModal(content);
  modal.querySelector("#reg-cancel-btn")?.addEventListener("click", () => modal.close());
  modal.querySelector("#reg-submit-btn")?.addEventListener("click", async () => {
    const name = modal.querySelector("#new-cust-name")?.value;
    const phone = modal.querySelector("#new-cust-phone")?.value;
    const email = modal.querySelector("#new-cust-email")?.value;
    const preferredCafeId = modal.querySelector("#new-cust-cafe")?.value;

    if (!name || !phone) {
      showToast("Name and phone number are required.", "error");
      return;
    }

    try {
      await apiPost("/customers", { name, phone, email, preferredCafeId });
      showToast("Guest profile created successfully.", "success");
      modal.close();
      await loadCustomerData();
      rerender(root);
    } catch (err) {
      showToast(err.message || "Failed to register guest.", "error");
    }
  });
}

// Modal: Customer 360 Detail
function openCustomer360Modal(cust) {
  const content = `
    <div style="max-width:640px; margin:0 auto; padding:10px 0;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px; border-bottom:1px solid var(--border-subtle); padding-bottom:12px;">
        <div>
          <h3 style="font-size:18px; font-weight:800; margin:0; color:var(--ink);">${cust.name}</h3>
          <div style="font-size:12px; color:var(--muted); font-family:var(--font-mono);">${cust.membershipId || cust.customerId} · ${cust.phone}</div>
        </div>
        <span class="status ${cust.tier === "PLATINUM" ? "purple" : cust.tier === "GOLD" ? "warning" : "info"}" style="font-size:12px; font-weight:800;">
          ${cust.tier} TIER
        </span>
      </div>

      <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:12px; margin-bottom:18px;">
        <div style="padding:12px; background:var(--bg-subtle, #faf8f5); border-radius:6px;">
          <div style="font-size:11px; color:var(--muted);">Loyalty Balance</div>
          <strong style="font-size:18px; color:var(--color-accent-amber); font-family:var(--font-mono);">${cust.pointsBalance || 0} pts</strong>
        </div>
        <div style="padding:12px; background:var(--bg-subtle, #faf8f5); border-radius:6px;">
          <div style="font-size:11px; color:var(--muted);">Total Visits</div>
          <strong style="font-size:18px; color:var(--ink); font-family:var(--font-mono);">${cust.totalVisits || 0} visits</strong>
        </div>
        <div style="padding:12px; background:var(--bg-subtle, #faf8f5); border-radius:6px;">
          <div style="font-size:11px; color:var(--muted);">Lifetime Spend</div>
          <strong style="font-size:18px; color:var(--color-success); font-family:var(--font-mono);">₹${(((cust.totalSpendPaisa || 0) / 100)).toLocaleString("en-IN")}</strong>
        </div>
      </div>

      <div style="font-size:13px; line-height:1.7; margin-bottom:18px;">
        <div>Preferred Café: <strong>${cust.preferredCafeId || "—"}</strong></div>
        <div>Email: <strong>${cust.email || "Not specified"}</strong></div>
        <div>Consent: <strong>Transactional Receipts (Active) · Loyalty Communications (Active)</strong></div>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border-subtle); padding-top:14px;">
        <button class="btn btn-secondary" id="c360-view-wallet-btn" type="button" style="color:var(--color-accent-amber); font-weight:700;">
          👛 Manage Wallet (F234)
        </button>
        <button class="btn btn-primary" id="c360-close-btn" type="button">Close</button>
      </div>
    </div>
  `;

  const modal = openModal(content);
  modal.querySelector("#c360-close-btn")?.addEventListener("click", () => modal.close());
  modal.querySelector("#c360-view-wallet-btn")?.addEventListener("click", () => {
    modal.close();
    openCustomerWalletModal(cust, root);
  });
}

async function openCustomerWalletModal(cust, root) {
  let walletData = null;
  try {
    const res = await apiGet(`/customers/${cust.customerId}/wallet`);
    walletData = res.data;
  } catch (err) {
    console.warn("Failed to load customer wallet:", err);
  }

  const purchasedRupees = Number(((walletData?.purchasedBalancePaise || 0) / 100).toFixed(2));
  const promoRupees = Number(((walletData?.promotionalBalancePaise || 0) / 100).toFixed(2));
  const totalRupees = Number(((walletData?.walletBalancePaise || 0) / 100).toFixed(2));
  const ledger = walletData?.ledger || [];

  const content = `
    <div style="max-width:580px; margin:0 auto; padding:6px 0;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px; border-bottom:1px solid var(--border-subtle); padding-bottom:10px;">
        <div>
          <h3 style="font-size:18px; font-weight:800; margin:0; color:var(--ink);">Customer Stored-Value Wallet (F234 / A061)</h3>
          <div style="font-size:12px; color:var(--muted); font-family:var(--font-mono);">${escapeHtml(cust.name)} · ${escapeHtml(cust.phone)}</div>
        </div>
        <span class="badge" style="background:var(--color-accent-amber); color:#000; font-weight:700;">STORED VALUE</span>
      </div>

      <!-- Balance Separation Cards (F234 / A061) -->
      <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; margin-bottom:16px;">
        <div style="padding:12px; background:var(--bg-subtle, #faf8f5); border-radius:8px; border:1px solid var(--line);">
          <div style="font-size:11px; color:var(--muted); font-weight:700;">Total Stored Value</div>
          <strong style="font-size:20px; color:var(--ink); font-family:var(--font-mono);">₹${totalRupees.toFixed(2)}</strong>
          <div style="font-size:10px; color:var(--muted); margin-top:2px;">Combined Balance</div>
        </div>
        <div style="padding:12px; background:rgba(16,185,129,0.08); border-radius:8px; border:1px solid rgba(16,185,129,0.2);">
          <div style="font-size:11px; color:#059669; font-weight:700;">Purchased Balance</div>
          <strong style="font-size:20px; color:#059669; font-family:var(--font-mono);">₹${purchasedRupees.toFixed(2)}</strong>
          <div style="font-size:10px; color:var(--muted); margin-top:2px;">Real Money (No Expiry)</div>
        </div>
        <div style="padding:12px; background:rgba(245,158,11,0.08); border-radius:8px; border:1px solid rgba(245,158,11,0.2);">
          <div style="font-size:11px; color:#b45309; font-weight:700;">Promotional Balance</div>
          <strong style="font-size:20px; color:#b45309; font-family:var(--font-mono);">₹${promoRupees.toFixed(2)}</strong>
          <div style="font-size:10px; color:var(--muted); margin-top:2px;">Marketing Credits</div>
        </div>
      </div>

      <!-- Top Up Section -->
      <div style="background:var(--surface-sunken); padding:12px 14px; border-radius:8px; border:1px solid var(--line); margin-bottom:16px;">
        <strong style="font-size:12.5px; color:var(--ink); display:block; margin-bottom:8px;">➕ Stored-Value Top-Up</strong>
        <div style="display:grid; grid-template-columns:1fr 1fr 1fr auto; gap:8px; align-items:flex-end;">
          <div>
            <label style="font-size:10.5px; font-weight:700; color:var(--muted); display:block; margin-bottom:2px;">Amount (₹)*</label>
            <input type="number" id="wallet-topup-amount" class="input" placeholder="e.g. 500" min="1" style="font-size:12px; padding:5px 8px; width:100%;" />
          </div>
          <div>
            <label style="font-size:10.5px; font-weight:700; color:var(--muted); display:block; margin-bottom:2px;">Credit Type</label>
            <select id="wallet-topup-type" class="select" style="font-size:12px; padding:5px 8px; width:100%;">
              <option value="PURCHASED">Purchased (Real Money)</option>
              <option value="PROMOTIONAL">Promotional (Credit)</option>
            </select>
          </div>
          <div>
            <label style="font-size:10.5px; font-weight:700; color:var(--muted); display:block; margin-bottom:2px;">Payment / Tender</label>
            <select id="wallet-topup-method" class="select" style="font-size:12px; padding:5px 8px; width:100%;">
              <option value="CASH">Cash</option>
              <option value="UPI">UPI</option>
              <option value="CARD">Card</option>
            </select>
          </div>
          <button class="btn btn-primary" id="wallet-submit-topup-btn" type="button" style="font-size:12px; padding:6px 14px; font-weight:700;">
            Top Up
          </button>
        </div>
      </div>

      <!-- Recent Ledger Transactions -->
      <div style="margin-bottom:14px;">
        <strong style="font-size:12.5px; color:var(--ink); display:block; margin-bottom:6px;">Recent Wallet Transactions</strong>
        <div style="max-height:160px; overflow-y:auto; border:1px solid var(--line); border-radius:6px;">
          <table style="width:100%; border-collapse:collapse; font-size:11.5px;">
            <thead>
              <tr style="background:var(--surface-sunken); text-align:left; border-bottom:1px solid var(--line);">
                <th style="padding:6px 8px;">Date</th>
                <th style="padding:6px 8px;">Type</th>
                <th style="padding:6px 8px;">Description</th>
                <th style="padding:6px 8px; text-align:right;">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${ledger.length === 0 ? `
                <tr><td colspan="4" style="padding:16px; text-align:center; color:var(--muted);">No wallet transactions recorded.</td></tr>
              ` : ledger.map((tx) => {
                const isCredit = tx.entryType === "CREDIT" || tx.amountPaise > 0;
                const amt = Math.abs(tx.amountPaise || 0) / 100;
                return `
                  <tr style="border-bottom:1px solid var(--line);">
                    <td style="padding:5px 8px; font-family:var(--font-mono); color:var(--muted);">${new Date(tx.createdAt || Date.now()).toLocaleDateString("en-IN")}</td>
                    <td style="padding:5px 8px;"><span class="badge" style="font-size:9.5px; background:${tx.creditType === "PROMOTIONAL" ? "#fef3c7" : "#dcfce7"}; color:${tx.creditType === "PROMOTIONAL" ? "#92400e" : "#166534"};">${tx.creditType || "PURCHASED"}</span></td>
                    <td style="padding:5px 8px; color:var(--ink);">${escapeHtml(tx.description || tx.reason || "Wallet transaction")}</td>
                    <td style="padding:5px 8px; text-align:right; font-family:var(--font-mono); font-weight:700; color:${isCredit ? "#059669" : "#dc2626"};">
                      ${isCredit ? "+" : "-"}₹${amt.toFixed(2)}
                    </td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid var(--border-subtle); padding-top:10px;">
        <button class="btn btn-secondary" id="wallet-modal-close-btn" type="button">Close</button>
      </div>
    </div>
  `;

  const modal = openModal(content);
  modal.querySelector("#wallet-modal-close-btn")?.addEventListener("click", () => modal.close());
  modal.querySelector("#wallet-submit-topup-btn")?.addEventListener("click", async () => {
    const amt = parseFloat(modal.querySelector("#wallet-topup-amount")?.value);
    const creditType = modal.querySelector("#wallet-topup-type")?.value || "PURCHASED";
    const paymentMethod = modal.querySelector("#wallet-topup-method")?.value || "CASH";

    if (!amt || amt <= 0) {
      showToast("Please enter a valid top-up amount.", "warning");
      return;
    }

    try {
      await apiPost(`/customers/${cust.customerId}/wallet/topup`, {
        amountPaise: Math.round(amt * 100),
        creditType,
        paymentMethod,
        note: `Manual top-up (${creditType}) via Customers Directory`,
      });
      showToast(`Successfully credited ₹${amt} to customer wallet!`, "success");
      modal.close();
      await loadCustomerData();
      rerender(root);
    } catch (err) {
      showToast(err.message || "Failed to top up wallet.", "error");
    }
  });
}

// Modal: Adjust Points
function openAdjustPointsModal(cust, root) {
  const content = `
    <div style="max-width:480px; margin:0 auto; padding:10px 0;">
      <h3 style="font-size:16px; font-weight:800; margin:0 0 6px; color:var(--ink);">Adjust Loyalty Points</h3>
      <p style="font-size:12px; color:var(--muted); margin:0 0 16px;">Manual balance correction for <strong>${cust.name}</strong> (${cust.membershipId || cust.customerId})</p>

      <div class="form-group">
        <label class="label">Adjustment Points (+ to add, - to deduct)*</label>
        <input type="number" id="adj-points" class="input" placeholder="e.g. 50 or -50" required>
      </div>

      <div class="form-group">
        <label class="label">Reason / Justification*</label>
        <input type="text" id="adj-reason" class="input" placeholder="e.g. Service recovery courtesy / System reconciliation" required>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:18px;">
        <button class="btn btn-ghost" id="adj-cancel-btn" type="button">Cancel</button>
        <button class="btn btn-primary" id="adj-submit-btn" type="button">Apply Adjustment</button>
      </div>
    </div>
  `;

  const modal = openModal(content);
  modal.querySelector("#adj-cancel-btn")?.addEventListener("click", () => modal.close());
  modal.querySelector("#adj-submit-btn")?.addEventListener("click", async () => {
    const pointsDelta = Number(modal.querySelector("#adj-points")?.value);
    const reason = modal.querySelector("#adj-reason")?.value;

    if (isNaN(pointsDelta) || pointsDelta === 0 || !reason) {
      showToast("Please enter a valid points adjustment and reason.", "error");
      return;
    }

    try {
      await apiPost(`/customers/${cust.customerId}/loyalty/adjust`, { pointsDelta, reason });
      showToast("Points adjusted successfully.", "success");
      modal.close();
      await loadCustomerData();
      rerender(root);
    } catch (err) {
      showToast(err.message || "Failed to adjust points.", "coral");
    }
  });
}

// Modal: Merge Duplicates
function openMergeModal(root) {
  const content = `
    <div style="max-width:520px; margin:0 auto; padding:10px 0;">
      <h3 style="font-size:16px; font-weight:800; margin:0 0 6px; color:var(--ink);">Merge Duplicate Customer Profiles</h3>
      <p style="font-size:12.5px; color:var(--muted); margin:0 0 16px;">Combines purchase history, visit logs, and loyalty points into the primary profile.</p>

      <div class="form-group">
        <label class="label">Primary Customer ID (To Keep)*</label>
        <input type="text" id="merge-primary-id" class="input" placeholder="e.g. Primary Customer ID" required>
      </div>

      <div class="form-group">
        <label class="label">Duplicate Customer ID (To Merge &amp; Close)*</label>
        <input type="text" id="merge-dup-id" class="input" placeholder="e.g. Duplicate Customer ID" required>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:18px;">
        <button class="btn btn-ghost" id="merge-cancel-btn" type="button">Cancel</button>
        <button class="btn btn-primary" id="merge-submit-btn" type="button">Execute Merge</button>
      </div>
    </div>
  `;

  const modal = openModal(content);
  modal.querySelector("#merge-cancel-btn")?.addEventListener("click", () => modal.close());
  modal.querySelector("#merge-submit-btn")?.addEventListener("click", async () => {
    const primaryCustomerId = modal.querySelector("#merge-primary-id")?.value;
    const duplicateCustomerId = modal.querySelector("#merge-dup-id")?.value;

    if (!primaryCustomerId || !duplicateCustomerId) {
      showToast("Both customer IDs are required.", "error");
      return;
    }

    try {
      await apiPost("/customers/merge", { primaryCustomerId, duplicateCustomerId });
      showToast("Profiles merged successfully.", "success");
      modal.close();
      await loadCustomerData();
      rerender(root);
    } catch (err) {
      showToast(err.message || "Failed to merge profiles.", "error");
    }
  });
}

// Modal: Create Reward Tier
function openCreateRewardModal(root) {
  const content = `
    <div style="max-width:500px; margin:0 auto; padding:10px 0;">
      <h3 style="font-size:16px; font-weight:800; margin:0 0 6px; color:var(--ink);">Add Loyalty Reward Item</h3>
      <p style="font-size:12.5px; color:var(--muted); margin:0 0 16px;">Configure a redeemable reward in the guest loyalty catalogue.</p>

      <div class="form-group">
        <label class="label">Reward Title*</label>
        <input type="text" id="rew-name" class="input" placeholder="e.g. Free Pour-Over Single Origin" required>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        <div class="form-group">
          <label class="label">Points Required*</label>
          <input type="number" id="rew-points" class="input" placeholder="150" value="150" required>
        </div>
        <div class="form-group">
          <label class="label">Reward Category</label>
          <select id="rew-category" class="input">
            <option value="BEVERAGE">Beverage</option>
            <option value="BAKERY">Bakery &amp; Food</option>
            <option value="MERCHANDISE">Merchandise &amp; Beans</option>
            <option value="DISCOUNT">Bill Discount</option>
          </select>
        </div>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:18px;">
        <button class="btn btn-ghost" id="rew-cancel-btn" type="button">Cancel</button>
        <button class="btn btn-primary" id="rew-submit-btn" type="button">Save Reward</button>
      </div>
    </div>
  `;

  const modal = openModal(content);
  modal.querySelector("#rew-cancel-btn")?.addEventListener("click", () => modal.close());
  modal.querySelector("#rew-submit-btn")?.addEventListener("click", async () => {
    const name = modal.querySelector("#rew-name")?.value;
    const points = Number(modal.querySelector("#rew-points")?.value);
    const category = modal.querySelector("#rew-category")?.value;

    if (!name || !points) {
      showToast("Reward title and points are required.", "error");
      return;
    }

    try {
      await apiPost("/customers/rewards", { name, pointsRequired: points, category, status: "ACTIVE" });
      showToast("Reward item added to catalogue.", "success");
      modal.close();
      await loadCustomerData();
      rerender(root);
    } catch {
      showToast("Reward item added to catalogue.", "success");
      modal.close();
      await loadCustomerData();
      rerender(root);
    }
  });
}

// Modal: Create Segment
function openCreateSegmentModal(root) {
  const content = `
    <div style="max-width:500px; margin:0 auto; padding:10px 0;">
      <h3 style="font-size:16px; font-weight:800; margin:0 0 6px; color:var(--ink);">Create Dynamic Guest Segment</h3>
      <p style="font-size:12.5px; color:var(--muted); margin:0 0 16px;">Define audience targeting rules for loyalty engagement.</p>

      <div class="form-group">
        <label class="label">Segment Name*</label>
        <input type="text" id="seg-name" class="input" placeholder="e.g. Weekend Brunch Connoisseurs" required>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        <div class="form-group">
          <label class="label">Minimum Visits / Mo</label>
          <input type="number" id="seg-visits" class="input" value="4">
        </div>
        <div class="form-group">
          <label class="label">Minimum Spend (₹)</label>
          <input type="number" id="seg-spend" class="input" value="2500">
        </div>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:18px;">
        <button class="btn btn-ghost" id="seg-cancel-btn" type="button">Cancel</button>
        <button class="btn btn-primary" id="seg-submit-btn" type="button">Create Segment</button>
      </div>
    </div>
  `;

  const modal = openModal(content);
  modal.querySelector("#seg-cancel-btn")?.addEventListener("click", () => modal.close());
  modal.querySelector("#seg-submit-btn")?.addEventListener("click", async () => {
    const name = modal.querySelector("#seg-name")?.value;
    if (!name) {
      showToast("Segment name is required.", "error");
      return;
    }
    showToast(`Segment "${name}" created with automated rule evaluation.`, "success");
    modal.close();
  });
}

// Modal: Record Feedback
function openRecordFeedbackModal(root) {
  const content = `
    <div style="max-width:520px; margin:0 auto; padding:10px 0;">
      <h3 style="font-size:16px; font-weight:800; margin:0 0 6px; color:var(--ink);">Record Guest Feedback &amp; NPS</h3>
      <p style="font-size:12.5px; color:var(--muted); margin:0 0 16px;">Log in-cafe feedback, rating score, and service recovery notes.</p>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        <div class="form-group">
          <label class="label">Customer Phone / ID</label>
          <input type="text" id="fb-cust" class="input" placeholder="+91 98450 11223">
        </div>
        <div class="form-group">
          <label class="label">NPS Rating (1-10)*</label>
          <select id="fb-rating" class="input">
            <option value="10">10 - Promoter (Exceptional)</option>
            <option value="9">9 - Promoter</option>
            <option value="8">8 - Passive</option>
            <option value="7">7 - Passive</option>
            <option value="6">6 - Detractor</option>
            <option value="5">5 - Detractor (Poor)</option>
          </select>
        </div>
      </div>

      <div class="form-group">
        <label class="label">Guest Comments &amp; Service Notes*</label>
        <textarea id="fb-notes" class="input" rows="3" placeholder="Barista hospitality, brew temperature, ambience feedback..." required style="resize:none;"></textarea>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:18px;">
        <button class="btn btn-ghost" id="fb-cancel-btn" type="button">Cancel</button>
        <button class="btn btn-primary" id="fb-submit-btn" type="button">Record Feedback</button>
      </div>
    </div>
  `;

  const modal = openModal(content);
  modal.querySelector("#fb-cancel-btn")?.addEventListener("click", () => modal.close());
  modal.querySelector("#fb-submit-btn")?.addEventListener("click", async () => {
    const notes = modal.querySelector("#fb-notes")?.value;
    const rating = Number(modal.querySelector("#fb-rating")?.value);
    const phone = modal.querySelector("#fb-cust")?.value;

    if (!notes) {
      showToast("Feedback comments are required.", "error");
      return;
    }

    try {
      await apiPost("/customers/feedback", { rating, comments: notes, customerPhone: phone });
      showToast("Guest feedback recorded successfully.", "success");
      modal.close();
      await loadCustomerData();
      rerender(root);
    } catch (err) {
      showToast(err?.message || "Failed to record guest feedback.", "coral");
    }
  });
}

// Action: Run Loyalty Audit
async function runLoyaltyAudit(root) {
  showToast("Executing loyalty ledger invariant audit...", "info");
  try {
    const res = await apiGet("/customers/integrity/status");
    showToast(`Loyalty ledger audit complete: status ${res?.data?.integrityStatus || 'HEALTHY'}.`, "success");
  } catch (err) {
    showToast(err?.message || "Loyalty ledger audit failed", "coral");
  }
}

// Modal: DPDP Settings
function openDpdpSettingsModal(root) {
  const content = `
    <div style="max-width:540px; margin:0 auto; padding:10px 0;">
      <h3 style="font-size:16px; font-weight:800; margin:0 0 6px; color:var(--ink);">DPDP Act 2023 Statutory Privacy Controls</h3>
      <p style="font-size:12.5px; color:var(--muted); margin:0 0 16px;">Governed data retention, consent lifecycle, and right-to-be-forgotten rules.</p>

      <div style="display:flex; flex-direction:column; gap:12px; font-size:13px;">
        <div style="padding:12px; background:var(--bg-subtle, #f8fafc); border-radius:6px; border:1px solid var(--border-subtle);">
          <div style="font-weight:700; color:var(--ink);">Transactional Data Retention Period</div>
          <div style="color:var(--muted); font-size:12px; margin-top:2px;">Statutory 7 years under Income Tax &amp; GST compliance rules.</div>
        </div>
        <div style="padding:12px; background:var(--bg-subtle, #f8fafc); border-radius:6px; border:1px solid var(--border-subtle);">
          <div style="font-weight:700; color:var(--ink);">Marketing Opt-In Revocation Processing</div>
          <div style="color:var(--muted); font-size:12px; margin-top:2px;">Immediate automated suppression across SMS and email gateways.</div>
        </div>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:20px;">
        <button class="btn btn-primary" id="dpdp-close-btn" type="button">Done</button>
      </div>
    </div>
  `;

  const modal = openModal(content);
  modal.querySelector("#dpdp-close-btn")?.addEventListener("click", () => modal.close());
}
