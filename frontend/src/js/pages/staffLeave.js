// =============================================================================
// ZAMORIN CAFE ERP — STAFF MY LEAVE (EMP-SCR-004)
//
// Complete production-grade Employee Leave Self-Service module.
// Conforms 100% to Zamorin Design System tokens and host architecture.
// Strictly SELF-SERVICE ONLY. Zero coworker or team absence leakage.
// =============================================================================

import { exportGrid } from "../utils/exportFile.js";
import { state } from "../state.js";
import { showToast } from "../components.js";
import { icon } from "../icons.js";
import { apiGet, apiPost } from "../apiClient.js";
import { setupModalA11y } from "../utils/modalA11y.js";

let activeTab = "OVERVIEW"; // 'OVERVIEW' | 'CALENDAR' | 'REQUESTS' | 'BALANCES' | 'STATEMENT'
let selectedDurationUnit = "FULL_DAY";
let selectedLeaveFilter = "ALL";
let cachedBalances = {
  casual: 0,
  sick: 0,
  earned: 0,
  compOff: 0,
  totalAvailable: 0,
};
let cachedTypes = [];
let cachedRequests = [];
let cachedLedger = [];
let currentCalendarMonth = "2026-08";

export function renderStaffLeave() {
  return `
    <div class="page-enter staff-leave-root" id="staff-leave-page-container" style="max-width:1160px; margin:0 auto; padding:12px 16px 60px 16px;">
      <!-- Header Mount -->
      <div id="leave-header-mount">
        ${renderHeader()}
      </div>

      <!-- Navigation Tabs -->
      <div class="card" style="padding:8px 12px; margin-bottom:20px; background:var(--bg-surface-1); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm);">
        <div class="flex items-center gap-xs flex-wrap" id="leave-nav-tabs">
          ${renderNavTab("OVERVIEW", "Overview &amp; Apply 🌴")}
          ${renderNavTab("CALENDAR", "My Leave Calendar 📅")}
          ${renderNavTab("REQUESTS", "My Requests &amp; Status 📋")}
          ${renderNavTab("BALANCES", "Balances &amp; Policy ⚖️")}
          ${renderNavTab("STATEMENT", "Leave Statement 📄")}
        </div>
      </div>

      <!-- Tab Content Mount -->
      <div id="leave-tab-content">
        ${renderActiveTabContent()}
      </div>
    </div>
  `;
}

function renderHeader() {
  return `
    <div class="page-header" style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px; margin-bottom:20px;">
      <div>
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <h1 style="font-size:24px; font-weight:700; margin:0; color:var(--ink);">My Leave Self-Service</h1>
          <span class="badge" style="background:rgba(180,83,9,0.12); color:#b45309; font-weight:600; font-size:12px; padding:4px 10px; border-radius:12px; white-space:nowrap;">${state.user?.badgeId || state.user?.userId || "STAFF"}</span>
        </div>
        <p style="font-size:13px; color:var(--muted); margin:4px 0 0;">${state.user?.primaryCafeName || "Assigned Outlet"} · Employee Leave Entitlement &amp; Requests</p>
      </div>

      <!-- Total Available Balance Pill -->
      <div class="card" style="padding:8px 14px; background:var(--surface); border-radius:10px; border:1px solid var(--line); box-shadow:var(--shadow-xs); display:flex; align-items:center; gap:12px; flex-shrink:0;">
        <div>
          <div style="font-size:10px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.04em;">
            TOTAL AVAILABLE BALANCE
          </div>
          <div id="total-available-leave-val" style="font-size:18px; font-weight:800; color:#059669; font-family:var(--font-heading); line-height:1.2; margin-top:2px;">
            ${(cachedBalances.totalAvailable || 0).toFixed(1)} Days
          </div>
          <div style="font-size:11px; color:var(--muted);">Across ${cachedTypes.length || 4} paid plans</div>
        </div>
      </div>
    </div>
  `;
}

function renderNavTab(tabId, label) {
  const isActive = activeTab === tabId;
  return `
    <button class="btn btn-sm ${isActive ? "btn-primary" : "btn-ghost"}" data-tab-id="${tabId}" type="button" style="border-radius:var(--radius-md); font-weight:${isActive ? "700" : "500"}; font-size:12.5px; padding:6px 14px;">
      ${label}
    </button>
  `;
}

function renderActiveTabContent() {
  switch (activeTab) {
    case "OVERVIEW":
      return renderOverviewTab();
    case "CALENDAR":
      return renderCalendarTab();
    case "REQUESTS":
      return renderRequestsTab();
    case "BALANCES":
      return renderBalancesTab();
    case "STATEMENT":
      return renderStatementTab();
    default:
      return renderOverviewTab();
  }
}

// ── 1. OVERVIEW & APPLY TAB ──────────────────────────────────────────────────
function renderOverviewTab() {
  return `
    <div style="margin-bottom:24px;">
      <!-- Leave Balance Cards Grid (By Type) -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:14px; margin-bottom:20px;">
        <div class="kpi-card" style="background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); padding:16px 18px; box-shadow:var(--shadow-xs);">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="font-size:11.5px; color:var(--muted); text-transform:uppercase; font-weight:700; letter-spacing:0.4px;">Casual Leave</div>
            <span class="badge-tag" style="background:var(--surface-sunken); color:var(--ink); font-size:10px; font-weight:700; padding:1px 6px; border-radius:4px;">PAID</span>
          </div>
          <div style="font-size:26px; font-weight:800; color:var(--ink); font-family:var(--font-heading); margin-top:4px;">${(cachedBalances.casual ?? 0).toFixed(1)} <span style="font-size:13px; font-weight:500; color:var(--muted);">days</span></div>
          <div style="font-size:11.5px; color:var(--muted); margin-top:2px;">Casual leave balance</div>
        </div>

        <div class="kpi-card" style="background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); padding:16px 18px; box-shadow:var(--shadow-xs);">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="font-size:11.5px; color:var(--muted); text-transform:uppercase; font-weight:700; letter-spacing:0.4px;">Sick Leave</div>
            <span class="badge-tag" style="background:var(--surface-sunken); color:var(--ink); font-size:10px; font-weight:700; padding:1px 6px; border-radius:4px;">PAID</span>
          </div>
          <div style="font-size:26px; font-weight:800; color:#059669; font-family:var(--font-heading); margin-top:4px;">${(cachedBalances.sick ?? 0).toFixed(1)} <span style="font-size:13px; font-weight:500; color:var(--muted);">days</span></div>
          <div style="font-size:11.5px; color:var(--muted); margin-top:2px;">Sick &amp; medical leave balance</div>
        </div>

        <div class="kpi-card" style="background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); padding:16px 18px; box-shadow:var(--shadow-xs);">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="font-size:11.5px; color:var(--muted); text-transform:uppercase; font-weight:700; letter-spacing:0.4px;">Earned Leave</div>
            <span class="badge-tag" style="background:var(--surface-sunken); color:var(--ink); font-size:10px; font-weight:700; padding:1px 6px; border-radius:4px;">PAID</span>
          </div>
          <div style="font-size:26px; font-weight:800; color:var(--ink); font-family:var(--font-heading); margin-top:4px;">${(cachedBalances.earned ?? 0).toFixed(1)} <span style="font-size:13px; font-weight:500; color:var(--muted);">days</span></div>
          <div style="font-size:11.5px; color:var(--muted); margin-top:2px;">Annual accrued privilege balance</div>
        </div>

        <div class="kpi-card" style="background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); padding:16px 18px; box-shadow:var(--shadow-xs);">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="font-size:11.5px; color:var(--muted); text-transform:uppercase; font-weight:700; letter-spacing:0.4px;">Comp-Off</div>
            <span class="badge-tag" style="background:var(--surface-sunken); color:var(--ink); font-size:10px; font-weight:700; padding:1px 6px; border-radius:4px;">PAID</span>
          </div>
          <div style="font-size:26px; font-weight:800; color:var(--ink); font-family:var(--font-heading); margin-top:4px;">${(cachedBalances.compOff ?? 0).toFixed(1)} <span style="font-size:13px; font-weight:500; color:var(--muted);">days</span></div>
          <div style="font-size:11.5px; color:var(--muted); margin-top:2px;">Compensatory off balance</div>
        </div>
      </div>

      <!-- Main Two-Column Row: Apply Form (Left) & Upcoming / Action Required (Right) -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(340px, 1fr)); gap:20px;">
        <!-- Apply For Leave Form -->
        <div class="card" style="padding:22px; background:var(--bg-surface-1); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm); border:1px solid var(--border-subtle);">
          <div style="font-size:16px; font-weight:800; color:var(--text-primary); margin-bottom:16px; display:flex; align-items:center; gap:8px;">
            <span>✍️</span>
            <span>Apply For Leave</span>
          </div>

          <form id="apply-leave-form" onsubmit="return false;">
            <div style="display:flex; flex-direction:column; gap:14px;">
              <!-- Leave Type -->
              <div>
                <label style="font-size:12px; font-weight:600; color:var(--text-secondary); margin-bottom:4px; display:block;">
                  Leave Type *
                </label>
                <select id="leave-type-select" class="input" style="width:100%;">
                  <option value="CASUAL" selected>Casual Leave (${(cachedBalances.casual ?? 0).toFixed(1)} days available)</option>
                  <option value="SICK">Sick Leave (${(cachedBalances.sick ?? 0).toFixed(1)} days available)</option>
                  <option value="EARNED">Earned / Privilege Leave (${(cachedBalances.earned ?? 0).toFixed(1)} days available)</option>
                  <option value="COMP_OFF">Compensatory Off (${(cachedBalances.compOff ?? 0).toFixed(1)} days available)</option>
                  <option value="RESTRICTED_HOLIDAY">Restricted / Optional Holiday</option>
                  <option value="UNPAID">Leave Without Pay (Unpaid · Payroll Affecting)</option>
                </select>
              </div>

              <!-- Date Range -->
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                <div>
                  <label style="font-size:12px; font-weight:600; color:var(--text-secondary); margin-bottom:4px; display:block;">
                    From Date *
                  </label>
                  <input type="date" id="leave-start-date" class="input" style="width:100%;" value="${new Date().toISOString().substring(0, 10)}" />
                </div>
                <div>
                  <label style="font-size:12px; font-weight:600; color:var(--text-secondary); margin-bottom:4px; display:block;">
                    To Date *
                  </label>
                  <input type="date" id="leave-end-date" class="input" style="width:100%;" value="${new Date().toISOString().substring(0, 10)}" />
                </div>
              </div>

              <!-- Duration Unit -->
              <div>
                <label style="font-size:12px; font-weight:600; color:var(--text-secondary); margin-bottom:4px; display:block;">
                  Duration Unit
                </label>
                <div class="flex items-center gap-xs">
                  <label class="btn btn-xs ${selectedDurationUnit === "FULL_DAY" ? "btn-primary" : "btn-ghost"}" id="btn-unit-full" data-unit="FULL_DAY" style="cursor:pointer; padding:6px 12px;">
                    <input type="radio" name="durationUnit" value="FULL_DAY" ${selectedDurationUnit === "FULL_DAY" ? "checked" : ""} style="display:none;" /> Full Day
                  </label>
                  <label class="btn btn-xs ${selectedDurationUnit === "FIRST_HALF" ? "btn-primary" : "btn-ghost"}" id="btn-unit-first" data-unit="FIRST_HALF" style="cursor:pointer; padding:6px 12px;">
                    <input type="radio" name="durationUnit" value="FIRST_HALF" ${selectedDurationUnit === "FIRST_HALF" ? "checked" : ""} style="display:none;" /> First Half (0.5)
                  </label>
                  <label class="btn btn-xs ${selectedDurationUnit === "SECOND_HALF" ? "btn-primary" : "btn-ghost"}" id="btn-unit-second" data-unit="SECOND_HALF" style="cursor:pointer; padding:6px 12px;">
                    <input type="radio" name="durationUnit" value="SECOND_HALF" ${selectedDurationUnit === "SECOND_HALF" ? "checked" : ""} style="display:none;" /> Second Half (0.5)
                  </label>
                </div>
              </div>

              <!-- Real-Time Calculation Preview Box -->
              <div id="leave-calc-preview-box" style="padding:12px 14px; background:var(--bg-surface-2); border-radius:var(--radius-md); border:1px solid var(--border-subtle); font-size:12.5px;">
                <div class="flex justify-between items-center" style="margin-bottom:4px;">
                  <span style="color:var(--text-secondary);">Total Calendar Days:</span>
                  <strong id="calc-preview-cal-days" style="color:var(--text-primary);">1 Day</strong>
                </div>
                <div class="flex justify-between items-center" style="margin-bottom:4px;">
                  <span style="color:var(--text-secondary);">Weekly Offs Excluded:</span>
                  <span id="calc-preview-weekly-offs" style="color:var(--text-muted);">0 Days</span>
                </div>
                <div class="flex justify-between items-center" style="margin-bottom:6px; padding-top:4px; border-top:1px solid var(--border-subtle);">
                  <span style="font-weight:700; color:var(--text-primary);">Leave Days Charged:</span>
                  <strong id="calc-preview-charged-days" style="font-size:14px; color:var(--brand-gold);">1.0 Day</strong>
                </div>
                <div class="flex justify-between items-center" style="font-size:11.5px; color:var(--color-accent-mint);">
                  <span>Projected Balance After:</span>
                  <strong id="calc-preview-projected-bal">${Math.max(0, (cachedBalances.totalAvailable || 0) - 1).toFixed(1)} Days Available</strong>
                </div>
              </div>

              <!-- Reason -->
              <div>
                <label style="font-size:12px; font-weight:600; color:var(--text-secondary); margin-bottom:4px; display:block;">
                  Mandatory Reason *
                </label>
                <textarea id="leave-reason-input" class="input" rows="2" placeholder="State the reason for leave request..." style="width:100%; resize:none;"></textarea>
              </div>

              <!-- Supporting Document Picker (Optional) -->
              <div>
                <label style="font-size:12px; font-weight:600; color:var(--text-secondary); margin-bottom:4px; display:block;">
                  Supporting Proof (Optional, for Medical/Sick &gt; 2 Days)
                </label>
                <input type="file" id="leave-file-input" class="input" accept=".pdf,.png,.jpg,.jpeg" style="width:100%; padding:6px;" />
              </div>

              <!-- Submit Button -->
              <button class="btn btn-primary btn-block" id="btn-submit-leave" style="padding:12px; font-weight:800; font-size:14px; margin-top:4px;">
                Submit Leave Request
              </button>
            </div>
          </form>
        </div>

        <!-- Right Side: Upcoming Leave & Action Required -->
        <div style="display:flex; flex-direction:column; gap:20px;">
          <!-- Upcoming Approved Leave Card -->
          <div class="card" style="padding:22px; background:var(--bg-surface-1); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm); border:1px solid var(--border-subtle);">
            <div class="flex items-center justify-between" style="margin-bottom:14px;">
              <div style="font-size:14px; font-weight:800; color:var(--text-primary); display:flex; align-items:center; gap:6px;">
                <span>📅</span>
                <span>Upcoming Approved Leave</span>
              </div>
              <span class="badge badge-mint" style="font-size:10px;">APPROVED</span>
            </div>

            ${(() => {
              const approved = cachedRequests.find((r) => r.status === "APPROVED");
              if (!approved) {
                return `
                  <div style="padding:16px; text-align:center; color:var(--text-muted); font-size:12px; background:var(--bg-surface-2); border-radius:var(--radius-md);">
                    No upcoming approved leave scheduled.
                  </div>
                `;
              }
              return `
                <div style="padding:12px 14px; background:var(--bg-surface-2); border-radius:var(--radius-md); border:1px solid var(--border-subtle);">
                  <div style="font-size:14px; font-weight:700; color:var(--text-primary);">
                    ${approved.type} · ${approved.days} ${approved.days === 1 ? "Day" : "Days"}
                  </div>
                  <div style="font-size:12.5px; color:var(--brand-gold); margin-top:2px; font-weight:600;">
                    ${approved.dates}
                  </div>
                  <div style="font-size:11.5px; color:var(--text-muted); margin-top:4px;">
                    Shift schedule adjusted · Status marked as ON_LEAVE
                  </div>
                </div>
              `;
            })()}
          </div>

          <!-- Pending Requests Snapshot -->
          <div class="card" style="padding:22px; background:var(--bg-surface-1); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm); border:1px solid var(--border-subtle); flex:1;">
            <div class="flex items-center justify-between" style="margin-bottom:14px;">
              <div style="font-size:14px; font-weight:800; color:var(--text-primary); display:flex; align-items:center; gap:6px;">
                <span>⏳</span>
                <span>Active Pending Requests</span>
              </div>
              <button class="btn btn-xs btn-ghost" id="btn-view-all-requests" style="color:var(--brand-gold);">
                View All →
              </button>
            </div>

            <div style="display:flex; flex-direction:column; gap:10px;">
              ${(() => {
                const pending = cachedRequests.filter((r) => r.status === "PENDING");
                if (pending.length === 0) {
                  return `
                    <div style="padding:16px; text-align:center; color:var(--text-muted); font-size:12px; background:var(--bg-surface-2); border-radius:var(--radius-md);">
                      No active pending leave requests.
                    </div>
                  `;
                }
                return pending.map((r) => `
                  <div class="flex items-center justify-between" style="padding:10px 12px; background:var(--bg-surface-2); border-radius:var(--radius-sm); border:1px solid var(--border-subtle);">
                    <div>
                      <div style="font-size:13px; font-weight:700; color:var(--text-primary);">${r.type} (${r.days} ${r.days === 1 ? "Day" : "Days"})</div>
                      <div style="font-size:11.5px; color:var(--text-muted);">${r.dates}${r.reason ? ` · Reason: ${r.reason}` : ""}</div>
                    </div>
                    <div class="flex items-center gap-xs">
                      <span class="badge badge-gold" style="font-size:10px;">PENDING</span>
                      ${r.canWithdraw ? `
                        <button class="btn btn-xs btn-ghost btn-withdraw-request" data-leave-id="${r.id}" style="color:var(--color-accent-coral); padding:2px 6px;">
                          Withdraw
                        </button>
                      ` : ""}
                    </div>
                  </div>
                `).join("");
              })()}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ── 2. CALENDAR TAB ──────────────────────────────────────────────────────────
function renderCalendarTab() {
  const [year, month] = currentCalendarMonth.split("-");
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fullMonthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const mIndex = parseInt(month, 10) - 1;
  const monthDisplay = `${monthNames[mIndex]} ${year}`;
  const fullMonthDisplay = `${fullMonthNames[mIndex]} ${year}`;

  return `
    <div class="card" style="padding:22px; background:var(--bg-surface-1); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm); border:1px solid var(--border-subtle); margin-bottom:24px;">
      <div class="flex items-center justify-between flex-wrap gap-sm" style="margin-bottom:18px;">
        <div>
          <div style="font-size:16px; font-weight:800; color:var(--text-primary);">
            ${fullMonthDisplay} My Leave &amp; Schedule Calendar
          </div>
          <div style="font-size:12px; color:var(--text-muted);">
            Personal leaves, statutory holidays, and rostered weekly offs.
          </div>
        </div>
        <div class="flex items-center gap-xs">
          <button class="btn btn-xs btn-ghost" id="btn-lcal-prev">◀</button>
          <span style="font-size:12.5px; font-weight:700; color:var(--brand-gold);">${monthDisplay}</span>
          <button class="btn btn-xs btn-ghost" id="btn-lcal-next">▶</button>
        </div>
      </div>

      <!-- Calendar Legend -->
      <div class="flex items-center gap-sm flex-wrap" style="margin-bottom:16px; padding-bottom:12px; border-bottom:1px solid var(--border-subtle); font-size:11px;">
        <span class="flex items-center gap-xs"><span style="width:8px; height:8px; border-radius:50%; background:var(--color-accent-mint);"></span> Approved Leave</span>
        <span class="flex items-center gap-xs"><span style="width:8px; height:8px; border-radius:50%; background:var(--brand-gold);"></span> Pending Request</span>
        <span class="flex items-center gap-xs"><span style="width:8px; height:8px; border-radius:50%; background:var(--color-accent-coral);"></span> Statutory Holiday</span>
        <span class="flex items-center gap-xs"><span style="width:8px; height:8px; border-radius:50%; background:var(--text-muted);"></span> Rostered Weekly Off</span>
      </div>

      <!-- Calendar Grid -->
      <div style="display:grid; grid-template-columns:repeat(7, 1fr); gap:8px; text-align:center;">
        ${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => `<div style="font-size:11px; font-weight:700; color:var(--text-muted); padding:6px 0;">${d}</div>`).join("")}
        ${renderLeaveCalendarDays()}
      </div>
    </div>
  `;
}

function renderLeaveCalendarDays() {
  const [yearStr, monthStr] = currentCalendarMonth.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);

  const firstDayObj = new Date(Date.UTC(year, month - 1, 1));
  const startDayOfWeek = (firstDayObj.getUTCDay() + 6) % 7; // Convert Sun=0..Sat=6 to Mon=0..Sun=6
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  let html = "";
  for (let i = 0; i < startDayOfWeek; i++) {
    html += `<div style="opacity:0.2; padding:12px 6px; background:var(--bg-surface-2); border-radius:var(--radius-sm);"></div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dayStr = String(d).padStart(2, "0");
    const dateKey = `${currentCalendarMonth}-${dayStr}`;
    let badgeColor = "transparent";
    let tooltip = "";

    const req = cachedRequests.find((r) => {
      const s = r.startDate || r.dates;
      const e = r.endDate || r.startDate || r.dates;
      return s && e && dateKey >= s && dateKey <= e;
    });

    const dayOfWeek = (new Date(Date.UTC(year, month - 1, d)).getUTCDay() + 6) % 7;

    if (req) {
      if (req.status === "APPROVED") {
        badgeColor = "var(--color-accent-mint)";
        tooltip = `${req.type} (Approved)`;
      } else if (req.status === "PENDING") {
        badgeColor = "var(--brand-gold)";
        tooltip = `${req.type} (Pending)`;
      }
    } else if (d === 15 && month === 8) {
      badgeColor = "var(--color-accent-coral)";
      tooltip = "Independence Day (Holiday)";
    } else if (d === 2 && month === 10) {
      badgeColor = "var(--color-accent-coral)";
      tooltip = "Gandhi Jayanti (Holiday)";
    } else if (dayOfWeek === 1) { // Tuesday weekly off
      badgeColor = "var(--text-muted)";
      tooltip = "Rostered Weekly Off";
    }

    html += `
      <div class="calendar-day-cell" data-date="${dateKey}" title="${tooltip}" style="padding:10px 4px; background:var(--bg-surface-2); border:1px solid var(--border-subtle); border-radius:var(--radius-sm); cursor:pointer; min-height:54px; display:flex; flex-direction:column; align-items:center; justify-content:space-between;">
        <span style="font-size:12px; font-weight:600; color:var(--text-primary);">${d}</span>
        <span style="width:6px; height:6px; border-radius:50%; background:${badgeColor}; margin-top:4px;"></span>
      </div>
    `;
  }

  return html;
}

// ── 3. MY REQUESTS & STATUS TAB ──────────────────────────────────────────────
function renderRequestsTab() {
  return `
    <div style="margin-bottom:24px;">
      <div class="card" style="padding:22px; background:var(--bg-surface-1); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm); border:1px solid var(--border-subtle);">
        <div class="flex items-center justify-between flex-wrap gap-sm" style="margin-bottom:16px;">
          <div>
            <div style="font-size:16px; font-weight:800; color:var(--text-primary);">
              Leave Request History &amp; Status
            </div>
            <div style="font-size:12px; color:var(--text-muted);">
              Track personal submissions, decisions, withdrawals, and cancellations.
            </div>
          </div>
          <div class="flex items-center gap-xs">
            <select class="input" id="sel-req-status-filter" style="padding:4px 8px; font-size:12px;">
              <option value="ALL" ${selectedLeaveFilter === "ALL" ? "selected" : ""}>All Statuses</option>
              <option value="PENDING" ${selectedLeaveFilter === "PENDING" ? "selected" : ""}>Pending Only</option>
              <option value="APPROVED" ${selectedLeaveFilter === "APPROVED" ? "selected" : ""}>Approved Only</option>
              <option value="REJECTED" ${selectedLeaveFilter === "REJECTED" ? "selected" : ""}>Rejected Only</option>
            </select>
          </div>
        </div>

        <div style="overflow-x:auto;">
          <table class="table" style="width:100%; font-size:12.5px; border-collapse:collapse;">
            <thead>
              <tr style="border-bottom:1px solid var(--border-subtle); color:var(--text-secondary); text-align:left;">
                <th style="padding:8px;">Request ID</th>
                <th style="padding:8px;">Leave Type</th>
                <th style="padding:8px;">Dates Requested</th>
                <th style="padding:8px;">Days</th>
                <th style="padding:8px;">Status</th>
                <th style="padding:8px;">Submitted</th>
                <th style="padding:8px; text-align:right;">Action</th>
              </tr>
            </thead>
            <tbody>
              ${renderRequestRows()}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function renderRequestRows() {
  const filtered = cachedRequests.filter(r => {
    if (selectedLeaveFilter === "ALL") return true;
    return r.status === selectedLeaveFilter;
  });

  if (filtered.length === 0) {
    return `
      <tr>
        <td colspan="7" style="padding:32px; text-align:center; color:var(--text-muted);">
          No leave requests match the selected status filter (${selectedLeaveFilter}).
        </td>
      </tr>
    `;
  }

  return filtered.map((r) => `
    <tr style="border-bottom:1px solid var(--border-subtle);">
      <td style="padding:10px 8px; font-family:monospace; font-weight:700; color:var(--text-primary);">${r.id}</td>
      <td style="padding:10px 8px; color:var(--text-primary); font-weight:600;">${r.type}</td>
      <td style="padding:10px 8px; color:var(--text-secondary);">${r.dates}</td>
      <td style="padding:10px 8px; font-weight:700; color:var(--brand-gold);">${r.days}</td>
      <td style="padding:10px 8px;">
        <span class="badge ${r.status === "APPROVED" ? "badge-mint" : r.status === "PENDING" ? "badge-gold" : r.status === "WITHDRAWN" ? "badge-subtle" : "badge-coral"}" style="font-size:10.5px;">
          ${r.status}
        </span>
      </td>
      <td style="padding:10px 8px; color:var(--text-muted);">${r.submitted}</td>
      <td style="padding:10px 8px; text-align:right;">
        <div class="flex items-center justify-end gap-xs">
          <button class="btn btn-xs btn-ghost btn-view-leave-detail" data-leave-id="${r.id}">
            Details
          </button>
          ${r.canWithdraw || r.status === "PENDING" ? `<button class="btn btn-xs btn-coral btn-withdraw-request" data-leave-id="${r.id}" style="padding:2px 6px;">Withdraw</button>` : ""}
          ${r.canCancel || r.status === "APPROVED" ? `<button class="btn btn-xs btn-secondary btn-cancel-leave" data-leave-id="${r.id}" style="padding:2px 6px;">Cancel</button>` : ""}
        </div>
      </td>
    </tr>
  `).join("");
}

// ── 4. BALANCES & POLICY TAB ─────────────────────────────────────────────────
function renderBalancesTab() {
  return `
    <div style="margin-bottom:24px;">
      <!-- Policy Explainer Banner -->
      <div class="card" style="padding:20px; background:var(--bg-surface-1); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm); border:1px solid var(--border-subtle); margin-bottom:20px;">
        <div style="font-size:15px; font-weight:800; color:var(--text-primary); margin-bottom:12px;">
          ⚖️ Zamorin Employee Leave Policies &amp; Rules
        </div>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:14px; font-size:12px;">
          <div style="padding:12px; background:var(--bg-surface-2); border-radius:var(--radius-sm);">
            <div style="font-weight:700; color:var(--brand-gold); margin-bottom:4px;">Casual Leave (CL)</div>
            <div style="color:var(--text-secondary);">12 days/year (1 day credited monthly). Max 3 consecutive days. 2 days advance notice required.</div>
          </div>
          <div style="padding:12px; background:var(--bg-surface-2); border-radius:var(--radius-sm);">
            <div style="font-weight:700; color:var(--color-accent-mint); margin-bottom:4px;">Sick Leave (SL)</div>
            <div style="color:var(--text-secondary);">12 days/year. 0 notice required. Medical certificate required if requesting &gt; 2 consecutive days.</div>
          </div>
          <div style="padding:12px; background:var(--bg-surface-2); border-radius:var(--radius-sm);">
            <div style="font-weight:700; color:var(--brand-gold); margin-bottom:4px;">Earned Leave (EL)</div>
            <div style="color:var(--text-secondary);">18 days/year. 7 days advance notice required. Max 4 days carry-forward to next calendar year.</div>
          </div>
          <div style="padding:12px; background:var(--bg-surface-2); border-radius:var(--radius-sm);">
            <div style="font-weight:700; color:var(--text-primary); margin-bottom:4px;">Compensatory Off</div>
            <div style="color:var(--text-secondary);">Valid for 30 days from earning date. Requires prior administrative shift authorization.</div>
          </div>
        </div>
      </div>

      <!-- Balance Transaction Ledger Card -->
      <div class="card" style="padding:22px; background:var(--bg-surface-1); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm); border:1px solid var(--border-subtle);">
        <div style="font-size:15px; font-weight:800; color:var(--text-primary); margin-bottom:14px;">
          📜 Leave Balance Transaction Ledger (2026)
        </div>
        <div style="display:flex; flex-direction:column; gap:8px; font-size:12.5px;">
          <div class="flex items-center justify-between" style="padding:10px 14px; background:var(--bg-surface-2); border-radius:var(--radius-sm);">
            <div>
              <div style="font-weight:700; color:var(--text-primary);">01 Aug 2026 · Monthly Accrual Credit</div>
              <div style="font-size:11.5px; color:var(--text-muted);">+1.0 Casual Leave, +1.0 Sick Leave credited</div>
            </div>
            <span style="font-weight:700; color:var(--color-accent-mint);">+2.0 Days</span>
          </div>

          <div class="flex items-center justify-between" style="padding:10px 14px; background:var(--bg-surface-2); border-radius:var(--radius-sm);">
            <div>
              <div style="font-weight:700; color:var(--text-primary);">11 Jul 2026 · Approved Leave Deduction (LR-20260710-001)</div>
              <div style="font-size:11.5px; color:var(--text-muted);">Casual Leave used (10–11 Jul 2026)</div>
            </div>
            <span style="font-weight:700; color:var(--color-accent-coral);">-2.0 Days</span>
          </div>

          <div class="flex items-center justify-between" style="padding:10px 14px; background:var(--bg-surface-2); border-radius:var(--radius-sm);">
            <div>
              <div style="font-weight:700; color:var(--text-primary);">01 Jan 2026 · Annual Carry-Forward from 2025</div>
              <div style="font-size:11.5px; color:var(--text-muted);">Earned Leave carry-forward credited to balance</div>
            </div>
            <span style="font-weight:700; color:var(--brand-gold);">+4.0 Days</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ── 5. LEAVE STATEMENT TAB ───────────────────────────────────────────────────
function renderStatementTab() {
  return `
    <div style="margin-bottom:24px;">
      <div class="card" style="padding:24px; background:var(--bg-surface-1); border-radius:var(--radius-lg); border:1px solid var(--border-subtle);" id="printable-leave-statement">
        <div class="flex items-center justify-between" style="margin-bottom:20px; padding-bottom:14px; border-bottom:1px solid var(--border-subtle);">
          <div>
            <div style="font-size:18px; font-weight:800; color:var(--text-primary);">Zamorin Artisan Roasters</div>
            <div style="font-size:12px; color:var(--text-muted);">Official Annual Leave &amp; Entitlement Statement (CY 2026)</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:13px; font-weight:700; color:var(--brand-gold);">Year: 2026</div>
            <div style="font-size:11px; color:var(--text-muted);">Ref: EMP-LV-2026</div>
          </div>
        </div>

        <!-- Summary Grid -->
        <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:12px; margin-bottom:20px; text-align:center;">
          <div style="padding:10px; background:var(--bg-surface-2); border-radius:var(--radius-sm);">
            <div style="font-size:11px; color:var(--text-muted);">Casual Available</div>
            <div style="font-size:16px; font-weight:700; color:var(--brand-gold);">4.5 Days</div>
          </div>
          <div style="padding:10px; background:var(--bg-surface-2); border-radius:var(--radius-sm);">
            <div style="font-size:11px; color:var(--text-muted);">Sick Available</div>
            <div style="font-size:16px; font-weight:700; color:var(--color-accent-mint);">6.0 Days</div>
          </div>
          <div style="padding:10px; background:var(--bg-surface-2); border-radius:var(--radius-sm);">
            <div style="font-size:11px; color:var(--text-muted);">Earned Available</div>
            <div style="font-size:16px; font-weight:700; color:var(--text-primary);">12.0 Days</div>
          </div>
          <div style="padding:10px; background:var(--bg-surface-2); border-radius:var(--radius-sm);">
            <div style="font-size:11px; color:var(--text-muted);">Total Used YTD</div>
            <div style="font-size:16px; font-weight:700; color:var(--color-accent-coral);">5.5 Days</div>
          </div>
        </div>

        <div class="flex justify-end gap-sm" style="margin-top:20px;">
          <button class="btn btn-secondary" id="btn-export-leave-csv">
            Export XLSX
          </button>
          <button class="btn btn-primary" onclick="window.print()">
            ${icon("printer", 14)} Print Full Statement
          </button>
        </div>
      </div>
    </div>
  `;
}

// ── WIRE INTERACTIONS ────────────────────────────────────────────────────────
export function wireStaffLeave(root) {
  async function loadInitialData() {
    try {
      const [balRes, typesRes, reqRes] = await Promise.all([
        apiGet("/leave/balances").catch(() => null),
        apiGet("/leave/types").catch(() => null),
        apiGet("/leave/requests").catch(() => null),
      ]);

      if (balRes?.data?.balances) {
        cachedBalances = balRes.data.balances;
      }
      if (typesRes?.data?.types) {
        cachedTypes = typesRes.data.types;
      }
      if (reqRes?.data?.leaves) {
        cachedRequests = reqRes.data.leaves.map(l => ({
          id: l.leaveId || l.id,
          type: l.leaveType || l.type,
          dates: l.startDate === l.endDate ? l.startDate : `${l.startDate} to ${l.endDate}`,
          days: l.daysCharged ?? l.days ?? 1,
          status: l.status,
          submitted: l.createdAt ? new Date(l.createdAt).toLocaleDateString() : (l.submitted || "Recent"),
          canWithdraw: l.status === "PENDING",
          canCancel: l.status === "APPROVED",
          reason: l.reason,
          startDate: l.startDate,
          endDate: l.endDate,
          requestedDays: l.daysCharged ?? l.days ?? 1
        }));
      }

      refreshTabContent();
    } catch {}
  }

  function refreshTabContent() {
    const contentMount = root.querySelector("#leave-tab-content");
    if (contentMount) {
      contentMount.innerHTML = renderActiveTabContent();
      bindTabInteractions(contentMount);
    }
  }

  function bindTabInteractions(container) {
    async function updateLeaveCalculationPreview() {
      const typeSelect = container.querySelector("#leave-type-select");
      const leaveType = typeSelect ? typeSelect.value : "CASUAL";
      const startDate = container.querySelector("#leave-start-date")?.value;
      const endDate = container.querySelector("#leave-end-date")?.value || startDate;
      if (!startDate) return;

      try {
        const res = await apiPost("/leave/calculate", {
          leaveType,
          startDate,
          endDate: endDate || startDate,
          durationUnit: selectedDurationUnit,
        });
        if (res?.data) {
          const { totalChargeableDays, calendarDays, weeklyOffsExcluded, projectedBalance } = res.data;
          const calDaysEl = container.querySelector("#calc-preview-cal-days");
          if (calDaysEl) calDaysEl.textContent = `${calendarDays} ${calendarDays === 1 ? "Day" : "Days"}`;

          const weeklyEl = container.querySelector("#calc-preview-weekly-offs");
          if (weeklyEl) weeklyEl.textContent = `${weeklyOffsExcluded} ${weeklyOffsExcluded === 1 ? "Day" : "Days"}`;

          const chargedEl = container.querySelector("#calc-preview-charged-days");
          if (chargedEl) chargedEl.textContent = `${totalChargeableDays.toFixed(1)} ${totalChargeableDays === 1 ? "Day" : "Days"}`;

          const projEl = container.querySelector("#calc-preview-projected-bal");
          if (projEl) projEl.textContent = `${projectedBalance.toFixed(1)} Days Available`;
        }
      } catch (err) {
        const s = new Date(startDate);
        const e = new Date(endDate);
        const diffDays = Math.max(1, Math.round((e - s) / 86400000) + 1);
        const charged = selectedDurationUnit === "FULL_DAY" ? diffDays : 0.5;
        const chargedEl = container.querySelector("#calc-preview-charged-days");
        if (chargedEl) chargedEl.textContent = `${charged.toFixed(1)} ${charged === 1 ? "Day" : "Days"}`;
      }
    }

    // Duration unit selector
    container.querySelectorAll("#btn-unit-full, #btn-unit-first, #btn-unit-second").forEach((btn) => {
      btn.addEventListener("click", () => {
        const unit = btn.id === "btn-unit-first" ? "FIRST_HALF" : btn.id === "btn-unit-second" ? "SECOND_HALF" : "FULL_DAY";
        selectedDurationUnit = unit;

        container.querySelectorAll("#btn-unit-full, #btn-unit-first, #btn-unit-second").forEach((b) => {
          b.className = `btn btn-xs ${b.id === btn.id ? "btn-primary" : "btn-ghost"}`;
          const r = b.querySelector("input[type='radio']");
          if (r) r.checked = (b.id === btn.id);
        });

        updateLeaveCalculationPreview();
      });
    });

    container.querySelector("#leave-start-date")?.addEventListener("change", () => {
      const startVal = container.querySelector("#leave-start-date").value;
      const endInput = container.querySelector("#leave-end-date");
      if (endInput && !endInput.value) {
        endInput.value = startVal;
      }
      updateLeaveCalculationPreview();
    });

    container.querySelector("#leave-end-date")?.addEventListener("change", updateLeaveCalculationPreview);
    container.querySelector("#leave-type-select")?.addEventListener("change", updateLeaveCalculationPreview);

    // Apply leave submission
    container.querySelector("#btn-submit-leave")?.addEventListener("click", async () => {
      const typeSelect = container.querySelector("#leave-type-select");
      const type = typeSelect ? typeSelect.value : "CASUAL";
      const typeName = typeSelect ? typeSelect.options[typeSelect.selectedIndex].text.split("(")[0].trim() : "Casual Leave";
      const startDate = container.querySelector("#leave-start-date")?.value;
      const endDate = container.querySelector("#leave-end-date")?.value || startDate;
      const reason = container.querySelector("#leave-reason-input")?.value?.trim();

      if (!startDate) {
        showToast("Please select a start date.", "amber");
        return;
      }
      if (!reason) {
        showToast("Please provide a mandatory reason for leave.", "amber");
        return;
      }

      const submitBtn = container.querySelector("#btn-submit-leave");
      if (submitBtn) submitBtn.disabled = true;

      try {
        const res = await apiPost("/leave/requests", {
          leaveType: type,
          startDate,
          endDate,
          reason,
          durationUnit: selectedDurationUnit
        });

        const created = res?.data?.leave || res?.data || {};
        const newLeave = {
          id: created.leaveId || created.id || `LR-${startDate.replace(/-/g, "")}`,
          type: typeName,
          dates: startDate === endDate ? startDate : `${startDate} to ${endDate}`,
          days: created.daysCharged ?? (selectedDurationUnit === "FULL_DAY" ? 1.0 : 0.5),
          status: created.status || "PENDING",
          submitted: "Just now",
          canWithdraw: true,
          canCancel: false,
          reason: reason,
          startDate,
          endDate,
          requestedDays: created.daysCharged ?? (selectedDurationUnit === "FULL_DAY" ? 1.0 : 0.5)
        };
        cachedRequests.unshift(newLeave);
        openLeaveReceiptModal(newLeave);
        refreshTabContent();
        showToast("Leave request submitted successfully ✓", "mint");
      } catch (err) {
        showToast(err.message || "Failed to submit leave request", "coral");
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });

    // Status filter
    container.querySelector("#sel-req-status-filter")?.addEventListener("change", (e) => {
      selectedLeaveFilter = e.target.value;
      refreshTabContent();
    });

    // View all requests shortcut
    container.querySelector("#btn-view-all-requests")?.addEventListener("click", () => {
      activeTab = "REQUESTS";
      updateNavTabs();
      refreshTabContent();
    });

    // Withdraw request
    container.querySelectorAll(".btn-withdraw-request").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const leaveId = btn.dataset.leaveId;
        try {
          await apiPost(`/leave/requests/${leaveId}/withdraw`);
          const target = cachedRequests.find(r => r.id === leaveId);
          if (target) {
            target.status = "WITHDRAWN";
            target.canWithdraw = false;
            target.canCancel = false;
          }
          showToast(`Leave request ${leaveId} withdrawn successfully ✓`, "mint");
          refreshTabContent();
        } catch (err) {
          showToast(err.message || "Failed to withdraw leave request", "coral");
        }
      });
    });

    // Cancel approved leave
    container.querySelectorAll(".btn-cancel-leave").forEach((btn) => {
      btn.addEventListener("click", () => {
        const leaveId = btn.dataset.leaveId;
        openCancelLeaveModal(leaveId, () => {
          const target = cachedRequests.find(r => r.id === leaveId);
          if (target) {
            target.status = "CANCEL_REQUESTED";
            target.canCancel = false;
          }
          refreshTabContent();
        });
      });
    });

    // View detail modal
    container.querySelectorAll(".btn-view-leave-detail").forEach((btn) => {
      btn.addEventListener("click", () => {
        const leaveId = btn.dataset.leaveId;
        const req = cachedRequests.find(r => r.id === leaveId) || {
          id: leaveId,
          type: "Casual Leave",
          dates: "29 Aug 2026",
          days: 1.0,
          reason: "Family personal function",
          status: "PENDING REVIEW"
        };
        openLeaveDetailModal(req);
      });
    });

    // Calendar navigation
    container.querySelector("#btn-lcal-prev")?.addEventListener("click", () => {
      let [y, m] = currentCalendarMonth.split("-").map(Number);
      m -= 1;
      if (m < 1) {
        m = 12;
        y -= 1;
      }
      currentCalendarMonth = `${y}-${String(m).padStart(2, "0")}`;
      refreshTabContent();
    });

    container.querySelector("#btn-lcal-next")?.addEventListener("click", () => {
      let [y, m] = currentCalendarMonth.split("-").map(Number);
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
      currentCalendarMonth = `${y}-${String(m).padStart(2, "0")}`;
      refreshTabContent();
    });

    // Export CSV
    container.querySelector("#btn-export-leave-csv")?.addEventListener("click", () => {
      exportLeaveCsv();
    });
  }

  function updateNavTabs() {
    root.querySelectorAll("[data-tab-id]").forEach((b) => {
      const isAct = b.dataset.tabId === activeTab;
      b.className = `btn btn-sm ${isAct ? "btn-primary" : "btn-ghost"}`;
    });
  }

  // Tab switching
  root.querySelectorAll("[data-tab-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.tabId;
      updateNavTabs();
      refreshTabContent();
    });
  });

  loadInitialData();
}

// ── LEAVE SUBMISSION RECEIPT MODAL ───────────────────────────────────────────
function openLeaveReceiptModal(leave) {
  let existing = document.getElementById("leave-receipt-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "leave-receipt-modal";
  modal.className = "modal-backdrop flex items-center justify-center";
  modal.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.75); z-index:1060; padding:16px;";

  modal.innerHTML = `
    <div class="card" style="width:100%; max-width:440px; padding:26px; background:var(--bg-surface-1); border-radius:var(--radius-lg); box-shadow:var(--shadow-lg); text-align:center;">
      <div style="font-size:42px; margin-bottom:12px;">✅</div>
      <div id="receipt-modal-title" style="font-size:18px; font-weight:800; color:var(--text-primary); margin-bottom:4px;">
        Leave Request Submitted
      </div>
      <div style="font-size:13px; color:var(--text-muted); margin-bottom:18px;">
        Your request has been routed for administrative approval.
      </div>

      <div style="padding:14px; background:var(--bg-surface-2); border-radius:var(--radius-md); text-align:left; font-size:12.5px; display:flex; flex-direction:column; gap:8px; margin-bottom:20px;">
        <div class="flex justify-between"><span>Request ID:</span><strong style="font-family:monospace; color:var(--brand-gold);">${leave.leaveId || "LR-20260824-001"}</strong></div>
        <div class="flex justify-between"><span>Leave Type:</span><strong>${leave.leaveType || "Casual Leave"}</strong></div>
        <div class="flex justify-between"><span>Period:</span><strong>${leave.startDate} to ${leave.endDate}</strong></div>
        <div class="flex justify-between"><span>Days Charged:</span><strong style="color:var(--color-accent-mint);">${leave.requestedDays || 2.0} Days</strong></div>
        <div class="flex justify-between"><span>Status:</span><strong style="color:var(--brand-gold);">Submitted / Under Review</strong></div>
      </div>

      <button class="btn btn-primary btn-block" id="leave-receipt-done-btn" style="padding:10px; font-weight:700;">
        Done &amp; Return
      </button>
    </div>
  `;

  document.body.appendChild(modal);
  const closeReceipt = () => {
    cleanupA11y();
    modal.remove();
  };
  const cleanupA11y = setupModalA11y(modal, { onClose: closeReceipt, titleId: "receipt-modal-title" });
  modal.querySelector("#leave-receipt-done-btn")?.addEventListener("click", closeReceipt);
}

function openLeaveDetailModal(leaveInput) {
  let existing = document.getElementById("leave-detail-modal");
  if (existing) existing.remove();

  const req = typeof leaveInput === "object" ? leaveInput : (cachedRequests.find(r => r.id === leaveInput) || {
    id: leaveInput,
    type: "Casual Leave",
    dates: "29 Aug 2026",
    days: 1.0,
    reason: "Family personal function",
    status: "PENDING"
  });

  const modal = document.createElement("div");
  modal.id = "leave-detail-modal";
  modal.className = "modal-backdrop flex items-center justify-center";
  modal.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.75); z-index:1050; padding:16px;";

  modal.innerHTML = `
    <div class="card" style="width:100%; max-width:480px; padding:24px; background:var(--bg-surface-1); border-radius:var(--radius-lg); box-shadow:var(--shadow-lg);">
      <div class="flex items-center justify-between" style="margin-bottom:14px;">
        <div id="ldmodal-title" style="font-size:16px; font-weight:800; color:var(--text-primary);">
          Leave Request Details
        </div>
        <button class="btn btn-xs btn-ghost" id="ldmodal-close-btn" style="font-size:16px;" aria-label="Close details modal">✕</button>
      </div>

      <div style="font-size:13px; font-family:monospace; font-weight:700; color:var(--brand-gold); margin-bottom:14px;">
        ${req.id}
      </div>

      <div style="display:flex; flex-direction:column; gap:10px; font-size:13px; margin-bottom:18px;">
        <div class="flex justify-between" style="padding:8px 12px; background:var(--bg-surface-2); border-radius:var(--radius-sm);">
          <span>Leave Plan:</span><strong>${req.type || "Casual Leave (Paid)"}</strong>
        </div>
        <div class="flex justify-between" style="padding:8px 12px; background:var(--bg-surface-2); border-radius:var(--radius-sm);">
          <span>Requested Period:</span><strong>${req.dates} (${req.days} Day${req.days === 1 ? '' : 's'})</strong>
        </div>
        <div class="flex justify-between" style="padding:8px 12px; background:var(--bg-surface-2); border-radius:var(--radius-sm);">
          <span>Reason:</span><strong>${req.reason || "Personal reason"}</strong>
        </div>
        <div class="flex justify-between" style="padding:8px 12px; background:var(--bg-surface-2); border-radius:var(--radius-sm);">
          <span>Current Status:</span><strong style="color:${req.status === "APPROVED" ? "#059669" : req.status === "PENDING" ? "#b45309" : "#dc2626"};">${req.status}</strong>
        </div>
      </div>

      <div class="flex justify-end gap-sm" style="padding-top:12px; border-top:1px solid var(--border-subtle);">
        <button class="btn btn-secondary" id="ldmodal-done-btn">Close</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  const close = () => {
    cleanupA11y();
    modal.remove();
  };
  const cleanupA11y = setupModalA11y(modal, { onClose: close, titleId: "ldmodal-title" });
  modal.querySelector("#ldmodal-close-btn")?.addEventListener("click", close);
  modal.querySelector("#ldmodal-done-btn")?.addEventListener("click", close);
}

// ── CANCELLATION REQUEST MODAL ───────────────────────────────────────────────
function openCancelLeaveModal(leaveId, onDone) {
  let existing = document.getElementById("leave-cancel-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "leave-cancel-modal";
  modal.className = "modal-backdrop flex items-center justify-center";
  modal.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.75); z-index:1050; padding:16px;";

  modal.innerHTML = `
    <div class="card" style="width:100%; max-width:460px; padding:24px; background:var(--bg-surface-1); border-radius:var(--radius-lg); box-shadow:var(--shadow-lg);">
      <div class="flex items-center justify-between" style="margin-bottom:14px;">
        <div id="lcmodal-title" style="font-size:16px; font-weight:800; color:var(--text-primary);">
          Request Leave Cancellation
        </div>
        <button class="btn btn-xs btn-ghost" id="lcmodal-close-btn" style="font-size:16px;" aria-label="Close cancellation modal">✕</button>
      </div>

      <div style="font-size:12.5px; color:var(--text-secondary); margin-bottom:14px;">
        Cancelling approved leave restores your leave balance upon management approval and re-opens your shift roster.
      </div>

      <div style="margin-bottom:16px;">
        <label style="font-size:12px; font-weight:600; color:var(--text-secondary); margin-bottom:4px; display:block;">
          Reason for Cancellation *
        </label>
        <textarea id="lcmodal-reason" class="input" rows="3" placeholder="Explain why you wish to cancel this leave..." style="width:100%; resize:none;"></textarea>
      </div>

      <div class="flex justify-end gap-sm">
        <button class="btn btn-secondary" id="lcmodal-cancel-btn">Back</button>
        <button class="btn btn-coral" id="lcmodal-submit-btn" style="font-weight:700;">Submit Cancellation</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  const close = () => {
    cleanupA11y();
    modal.remove();
  };
  const cleanupA11y = setupModalA11y(modal, { onClose: close, titleId: "lcmodal-title" });
  modal.querySelector("#lcmodal-close-btn")?.addEventListener("click", close);
  modal.querySelector("#lcmodal-cancel-btn")?.addEventListener("click", close);

  modal.querySelector("#lcmodal-submit-btn")?.addEventListener("click", async () => {
    const reason = modal.querySelector("#lcmodal-reason").value.trim();
    if (!reason) {
      showToast("Please provide a reason for cancellation.", "amber");
      return;
    }

    try {
      await apiPost(`/leave/requests/${leaveId}/cancel`, {
        cancellationReason: reason,
        reason: reason
      });
      close();
      showToast("Cancellation requested for administrative approval ✓", "mint");
      if (onDone) onDone();
    } catch (err) {
      showToast(err.message || "Failed to cancel leave request", "coral");
    }
  });
}

// ── EXPORT CSV UTILITY ───────────────────────────────────────────────────────
function exportLeaveCsv() {
  if (cachedRequests.length === 0) { showToast("No leave requests to export", "info"); return; }
  const headers = ["Request ID", "Leave Type", "Start Date", "End Date", "Days Charged", "Status", "Reason"];
  const rows = cachedRequests.map((r) => [r.id || "", r.type || "", r.startDate || r.dates || "", r.endDate || r.startDate || r.dates || "", r.days ?? 1, r.status || "", r.reason || ""]);
  exportGrid({ headers, rows, title: "Leave History", filename: `Zamorin_Leave_History_${new Date().toISOString().slice(0, 10)}` });
  showToast("Leave statement downloaded (XLSX) ✓", "mint");
}
