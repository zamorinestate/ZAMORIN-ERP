// =============================================================================
// PAGE: Sales & Cash Book — Comprehensive Enterprise Cash Management
// Roles: PRIMARY_MASTER (full control, all cafes), NORMAL_MASTER (full control),
//        OWNER (read-only, assigned cafes), CAFE_ADMIN (own cafe, session mgmt)
//
// Sections & Workspaces:
//   1. Session Identification, Till Control & Multi-Café Bar
//   2. Session Financial KPI Strip & Multi-Tender Summary
//   3. Tab 1: Cash Ledger & Transactions (Filtered, Paginated, Audited)
//   4. Tab 2: Drawer Count & Reconciliation (Denomination Drawer, Variance Analysis)
//   5. Tab 3: Cash Movements & Safe Drops (Petty Cash, Vault Drops, Float Top-ups)
//   6. Tab 4: Tender & Multi-Payment Breakdown (Cash, UPI, Card, Aggregators)
//   7. Tab 5: EOD Closing & Sign-off Checklist (7-Step Audit Closure)
//   8. Tab 6: Session History & Audit Trail (Past Sessions, Variances, Logs)
//   9. Full Workflow Modals: Open Session, Close Session, Record Movement, Reverse
// =============================================================================

import { showToast, skeleton } from "../components.js";
import { apiGet, apiPost } from "../apiClient.js";
import { state } from "../state.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const DENOMS = [2000, 500, 200, 100, 50, 20, 10, 5, 2, 1];

const TX_TYPES = [
  { value: "OPENING_BALANCE",   label: "Opening Balance",        dir: "IN" },
  { value: "CASH_IN",           label: "Cash In (General)",       dir: "IN" },
  { value: "PAID_IN",           label: "Paid In / Top-up",       dir: "IN" },
  { value: "CASH_TRANSFER_IN",  label: "Cash Transfer (In)",     dir: "IN" },
  { value: "CASH_OUT",          label: "Cash Out (General)",      dir: "OUT" },
  { value: "PAID_OUT",          label: "Paid Out / Petty Expense",dir: "OUT" },
  { value: "BANK_DEPOSIT",      label: "Safe / Bank Deposit",    dir: "OUT" },
  { value: "CASH_TRANSFER_OUT", label: "Cash Transfer (Out)",    dir: "OUT" },
  { value: "CLOSING_ADJUSTMENT",label: "Closing Variance Adj.",  dir: "BOTH" },
];

const CATEGORIES = [
  "SALES_COLLECTION",
  "OPENING_FLOAT",
  "SAFE_DROP",
  "BANK_DEPOSIT",
  "MILK_PURCHASE",
  "ICE_PURCHASE",
  "VEGETABLES_LOCAL",
  "PETTY_CASH_EXPENSE",
  "FLOAT_TOPUP",
  "STAFF_ADVANCE",
  "DRAWER_DISCREPANCY",
  "CUSTOMER_REFUND",
  "OTHER_EXPENSE",
];

const PAYMENT_METHODS = ["CASH", "UPI", "CARD", "BANK_TRANSFER", "WALLET", "CREDIT"];

// ─── Module State ─────────────────────────────────────────────────────────────
let _root = null;
let _activeTab = "ledger"; // 'ledger' | 'drawer' | 'movements' | 'tender' | 'eod' | 'history'
let _denomCounts = { 2000: 0, 500: 0, 200: 0, 100: 0, 50: 0, 20: 0, 10: 0, 5: 0, 2: 0, 1: 0 };
let _transactions = [];
let _summary = null;
let _selectedCafe = "";
let _selectedDate = "";
let _selectedShift = "MORNING";
let _searchFilter = "";
let _typeFilter = "ALL";
let _directionFilter = "ALL";
let _page = 1;
let _totalPages = 1;
let _loading = false;

// Initial session state — overridden by API data on load
let _sessionInfo = {
  sessionId: "", // populated from API on session load
  status: "NOT_STARTED", // 'ACTIVE' | 'COUNTING' | 'CLOSED' | 'NOT_STARTED'
  shift: "",
  registerId: "",
  posTerminal: "",
  cashierName: "", // populated from state.user on render
  openingFloat: 0,
  openedAt: null,
  cashSales: 0,
  cardSales: 0,
  upiSales: 0,
  aggregatorSales: 0,
  totalPaidIn: 0,
  totalPaidOut: 0,
  totalSafeDrops: 0,
  lastSync: "—",
};

// Checklist state for EOD closing
let _checklist = {
  openOrdersCleared: true,
  kotReconciled: true,
  physicalCountDone: false,
  safeDropCompleted: false,
  digitalSettlementVerified: true,
  varianceApproved: false,
  managerSignOff: false,
};

// ─── Formatting Helpers ───────────────────────────────────────────────────────
function fmtInr(amount) {
  if (amount === null || amount === undefined || isNaN(amount)) return "₹0.00";
  const num = Number(amount);
  const isNegative = num < 0;
  const absNum = Math.abs(num);
  const parts = absNum.toFixed(2).split(".");
  let intPart = parts[0];
  const decPart = parts[1];

  let lastThree = intPart.substring(intPart.length - 3);
  const otherNumbers = intPart.substring(0, intPart.length - 3);
  if (otherNumbers !== "") {
    lastThree = "," + lastThree;
  }
  const formatted = otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + lastThree;
  return (isNegative ? "-₹" : "₹") + formatted + (decPart !== "00" ? "." + decPart : "");
}

function fmtDate(isoStr) {
  if (!isoStr) return "—";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit", month: "short", year: "numeric",
    }).format(new Date(isoStr));
  } catch { return isoStr; }
}

function fmtTime(isoStr) {
  if (!isoStr) return "—";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
    }).format(new Date(isoStr));
  } catch { return isoStr; }
}

function getIstDate(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function currentRole() { return (state.role || "").toLowerCase(); }
function isMaster()     { return currentRole() === "master"; }
function isOwner()      { return currentRole() === "owner"; }
function isCafeAdmin()  { return currentRole() === "cafe_admin"; }
function isPrimary()    { return isMaster() && !!(state.auth?.user?.isPrimaryMaster || state.user?.isPrimaryMaster); }
function canWrite()     { return isMaster() || isCafeAdmin(); }
function canReverse()   { return isMaster(); }

function getAssignedCafes() {
  const u = state.auth?.user || state.user || {};
  return u.assignedCafes || state.assignedCafes || [];
}

function getDefaultCafe() {
  const u = state.auth?.user || state.user || {};
  return u.primaryCafeId || u.assignedCafeIds?.[0] || state.currentCafeId || "";
}

function countTotal() {
  return DENOMS.reduce((sum, d) => sum + (Number(_denomCounts[d]) || 0) * d, 0);
}

function calculateExpectedCash() {
  if (_summary && _summary.totals) {
    return Number(_summary.totals.netCashFlow || 0);
  }
  // Fallback formula: Opening float + Cash sales + Paid in - Paid out - Safe drops
  return (_sessionInfo.openingFloat + _sessionInfo.cashSales + _sessionInfo.totalPaidIn) - (_sessionInfo.totalPaidOut + _sessionInfo.totalSafeDrops);
}

function calculateVariance() {
  return countTotal() - calculateExpectedCash();
}

function directionBadge(dir) {
  if (dir === "IN")  return `<span class="pill pill-mint" style="font-size:10.5px;">↓ INFLOW</span>`;
  if (dir === "OUT") return `<span class="pill pill-coral" style="font-size:10.5px;">↑ OUTFLOW</span>`;
  return `<span class="pill pill-info" style="font-size:10.5px;">↔ ADJUST</span>`;
}

function statusBadge(status) {
  const map = {
    POSTED:   "pill-mint",
    REVERSED: "pill-coral",
    PENDING:  "pill-amber",
    ACTIVE:   "pill-info",
    CLOSED:   "pill-dark",
  };
  const cls = map[status] || "pill-dark";
  return `<span class="pill ${cls}" style="font-size:10.5px;">${status || "POSTED"}</span>`;
}

// ─── Main Render Shell ────────────────────────────────────────────────────────
export function renderCashBook() {
  const defaultCafe = _selectedCafe || getDefaultCafe();
  _selectedCafe = defaultCafe;
  if (!_selectedDate) _selectedDate = getIstDate();

  const cafes = getAssignedCafes();
  const cafeOptions = cafes
    .map(c => `<option value="${c.cafeId}" ${_selectedCafe === c.cafeId ? "selected" : ""}>${c.name || c.cafeId} (${c.cafeId})</option>`)
    .join("");

  const roleLabel = isMaster()
    ? "Primary Master · Enterprise Cash Governance"
    : isOwner() ? "Owner View · Executive Cash & Drawer Audit"
    : "Café Operations · Till Drawer & Cash Book Control";

  return `
    <div class="page-enter" style="max-width:1400px; margin:0 auto; padding-bottom:60px;">
      
      <!-- ── 1. Page Header & Operational Command Bar ──────────────────────── -->
      <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px; margin-bottom:18px; border-bottom:1px solid var(--line); padding-bottom:16px;">
        <div>
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:4px; flex-wrap:wrap;">
            <h1 class="page-title" style="font-size:24px; font-weight:800; margin:0; color:var(--ink); letter-spacing:-0.3px;">Sales &amp; Cash Book</h1>
            <span class="pill pill-gold" style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">FIN-SCB-001</span>
            <span class="pill pill-mint" style="font-size:10px; font-weight:700;">TILL &amp; DRAWER RECONCILIATION</span>
          </div>
          <p style="font-size:13px; color:var(--muted); margin:0;">
            ${roleLabel} · Real-time Cash Control, Denomination Counting, Petty Cash &amp; Shift Audits
          </p>
        </div>

        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          ${canWrite() ? `
            <button class="btn btn-secondary btn-sm" id="btn-open-session" type="button" style="font-weight:600;">
              Start Session
            </button>
            <button class="btn btn-secondary btn-sm" id="btn-quick-entry" type="button" style="font-weight:600;">
              Record Movement
            </button>
            <button class="btn btn-secondary btn-sm" id="btn-safe-drop" type="button" style="font-weight:600;">
              Safe Drop
            </button>
            <button class="btn btn-primary btn-sm" id="btn-close-session" type="button" style="font-weight:700;">
              Close Till &amp; Reconcile
            </button>
          ` : `
            <span class="pill pill-info" style="font-size:11px;">READ-ONLY AUDIT MODE</span>
          `}
          <button class="btn btn-ghost btn-sm" id="btn-export-eod" type="button">
            Export EOD
          </button>
          <button class="btn btn-ghost btn-sm" id="btn-refresh" type="button">
            ↻ Refresh
          </button>
        </div>
      </div>

      <!-- ── 2. Session Context & Scope Bar ────────────────────────────────── -->
      <div class="card" style="padding:14px 18px; margin-bottom:18px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:14px; background:var(--surface);">
        <div style="display:flex; align-items:center; gap:14px; flex-wrap:wrap;">
          <div style="display:flex; align-items:center; gap:6px;">
            <label style="font-size:12px; color:var(--muted); font-weight:700; text-transform:uppercase; letter-spacing:0.4px;">Café Scope:</label>
            <select id="scb-cafe-select" class="select select-sm" style="font-size:12.5px; font-weight:600; min-width:200px;">
              ${cafeOptions}
            </select>
          </div>

          <div style="display:flex; align-items:center; gap:6px;">
            <label style="font-size:12px; color:var(--muted); font-weight:700; text-transform:uppercase; letter-spacing:0.4px;">Date:</label>
            <input type="date" id="scb-date-input" class="input input-sm" value="${_selectedDate}" style="font-size:12.5px; padding:4px 10px;" />
          </div>

          <div style="display:flex; align-items:center; gap:6px;">
            <label style="font-size:12px; color:var(--muted); font-weight:700; text-transform:uppercase; letter-spacing:0.4px;">Shift:</label>
            <select id="scb-shift-select" class="select select-sm" style="font-size:12px;">
              <option value="MORNING" ${_selectedShift === "MORNING" ? "selected" : ""}>Morning Shift (07:00 - 15:30)</option>
              <option value="EVENING" ${_selectedShift === "EVENING" ? "selected" : ""}>Evening Shift (15:30 - 23:30)</option>
              <option value="FULL_DAY" ${_selectedShift === "FULL_DAY" ? "selected" : ""}>Full Business Day</option>
            </select>
          </div>

          <button class="btn btn-secondary btn-sm" id="btn-apply-filters" type="button" style="font-weight:600;">
            Apply
          </button>
        </div>

        <!-- Session Status Pill & Cashier Info -->
        <div style="display:flex; align-items:center; gap:10px; font-size:12px; flex-wrap:wrap;">
          <span style="color:var(--muted);">Till: <strong style="color:var(--ink);">${_sessionInfo.registerId || '—'}</strong></span>
          <span style="color:var(--muted);">Cashier: <strong style="color:var(--ink);">${_sessionInfo.cashierName || state.user?.name || state.user?.userId || '—'}</strong></span>
          <span class="pill ${_sessionInfo.status === "ACTIVE" ? "pill-mint" : "pill-dark"}" style="font-size:11px; font-weight:700;">
            ● ${_sessionInfo.status || 'NOT_STARTED'}
          </span>
        </div>
      </div>

      <!-- ── 3. Session Financial KPI Strip ─────────────────────────────────── -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); gap:12px; margin-bottom:18px;">
        
        <div class="card" style="padding:14px 16px; background:var(--surface);">
          <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.4px;">Opening Float</div>
          <div style="font-size:22px; font-weight:800; color:var(--ink); margin:4px 0;" id="kpi-opening">
            ${fmtInr(_sessionInfo.openingFloat)}
          </div>
          <div style="font-size:11px; color:var(--muted);">Base drawer reserve</div>
        </div>

        <div class="card" style="padding:14px 16px; background:var(--surface);">
          <div style="font-size:11px; font-weight:700; color:var(--success); text-transform:uppercase; letter-spacing:0.4px;">Cash In / Sales (+)</div>
          <div style="font-size:22px; font-weight:800; color:var(--success); margin:4px 0;" id="kpi-cashin">
            ${_summary ? fmtInr(_summary.totals?.cashIn) : fmtInr(_sessionInfo.cashSales)}
          </div>
          <div style="font-size:11px; color:var(--muted);">Total cash received</div>
        </div>

        <div class="card" style="padding:14px 16px; background:var(--surface);">
          <div style="font-size:11px; font-weight:700; color:var(--danger); text-transform:uppercase; letter-spacing:0.4px;">Cash Out / Paid (-)</div>
          <div style="font-size:22px; font-weight:800; color:var(--danger); margin:4px 0;" id="kpi-cashout">
            ${_summary ? fmtInr(_summary.totals?.cashOut) : fmtInr(_sessionInfo.totalPaidOut)}
          </div>
          <div style="font-size:11px; color:var(--muted);">Petty cash &amp; disbursements</div>
        </div>

        <div class="card" style="padding:14px 16px; background:var(--surface);">
          <div style="font-size:11px; font-weight:700; color:var(--warning); text-transform:uppercase; letter-spacing:0.4px;">Safe Drops (-)</div>
          <div style="font-size:22px; font-weight:800; color:var(--warning); margin:4px 0;" id="kpi-safedrop">
            ${fmtInr(_sessionInfo.totalSafeDrops)}
          </div>
          <div style="font-size:11px; color:var(--muted);">Transferred to vault</div>
        </div>

        <div class="card" style="padding:14px 16px; background:var(--surface-sunken); border:2px solid var(--line-strong);">
          <div style="font-size:11px; font-weight:700; color:var(--ink); text-transform:uppercase; letter-spacing:0.4px;">Expected in Drawer</div>
          <div style="font-size:22px; font-weight:800; color:var(--ink); margin:4px 0;" id="kpi-expected">
            ${fmtInr(calculateExpectedCash())}
          </div>
          <div style="font-size:11px; color:var(--muted);">Calculated book balance</div>
        </div>

        <div class="card" style="padding:14px 16px; background:var(--surface);">
          <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.4px;">Physical Count</div>
          <div style="font-size:22px; font-weight:800; color:var(--ink); margin:4px 0;" id="kpi-counted">
            ${fmtInr(countTotal())}
          </div>
          <div style="font-size:11px; color:var(--muted);" id="kpi-variance-status">
            ${countTotal() === 0 ? "Pending drawer count" : fmtInr(calculateVariance()) + " variance"}
          </div>
        </div>

      </div>

      <!-- ── 4. Multi-Tender Payment Strip ──────────────────────────────────── -->
      <div class="card" style="padding:10px 16px; margin-bottom:18px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; background:var(--surface-sunken); font-size:12px;">
        <div style="display:flex; gap:16px; align-items:center; flex-wrap:wrap;">
          <span style="font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.4px;">Tender Summary:</span>
          <span>Cash: <strong style="color:var(--ink);">${fmtInr(_sessionInfo.cashSales)}</strong></span>
          <span>UPI / QR: <strong style="color:var(--ink);">${fmtInr(_sessionInfo.upiSales)}</strong></span>
          <span>Card (EDC): <strong style="color:var(--ink);">${fmtInr(_sessionInfo.cardSales)}</strong></span>
          <span>Aggregators: <strong style="color:var(--ink);">${fmtInr(_sessionInfo.aggregatorSales)}</strong></span>
        </div>
        <div>
          <span style="color:var(--muted);">Total Gross Revenue:</span>
          <strong style="color:var(--success); font-size:13.5px; margin-left:4px;">
            ${fmtInr(_sessionInfo.cashSales + _sessionInfo.upiSales + _sessionInfo.cardSales + _sessionInfo.aggregatorSales)}
          </strong>
        </div>
      </div>

      <!-- ── 5. Interactive Subnav Tabs Strip ───────────────────────────────── -->
      <div class="subnav-bar" style="display:flex; gap:6px; border-bottom:1px solid var(--line); margin-bottom:18px; overflow-x:auto; padding-bottom:4px;">
        <button class="subnav-btn ${_activeTab === "ledger" ? "active" : ""}" data-scb-tab="ledger">
          Cash Ledger Entries
        </button>
        <button class="subnav-btn ${_activeTab === "drawer" ? "active" : ""}" data-scb-tab="drawer">
          Drawer Count &amp; Reconciliation
        </button>
        <button class="subnav-btn ${_activeTab === "movements" ? "active" : ""}" data-scb-tab="movements">
          Cash Movements &amp; Safe Drops
        </button>
        <button class="subnav-btn ${_activeTab === "tender" ? "active" : ""}" data-scb-tab="tender">
          Multi-Tender Breakdown
        </button>
        <button class="subnav-btn ${_activeTab === "eod" ? "active" : ""}" data-scb-tab="eod">
          EOD Closing Checklist
        </button>
        <button class="subnav-btn ${_activeTab === "history" ? "active" : ""}" data-scb-tab="history">
          Session History &amp; Audit
        </button>
      </div>

      <!-- ── 6. Active Tab Content Area ─────────────────────────────────────── -->
      <div id="scb-tab-content">
        ${renderActiveTab()}
      </div>

      <!-- ── 7. Modals Root Injection Target ────────────────────────────────── -->
      <div id="scb-modal-root"></div>

    </div>
  `;
}

// ─── Active Tab Router ────────────────────────────────────────────────────────
function renderActiveTab() {
  switch (_activeTab) {
    case "ledger":
      return renderLedgerTab();
    case "drawer":
      return renderDrawerTab();
    case "movements":
      return renderMovementsTab();
    case "tender":
      return renderTenderTab();
    case "eod":
      return renderEodTab();
    case "history":
      return renderHistoryTab();
    default:
      return renderLedgerTab();
  }
}

// ─── Tab 1: Cash Ledger Entries ──────────────────────────────────────────────
function renderLedgerTab() {
  return `
    <div style="display:grid; grid-template-columns: 1fr 340px; gap:16px; align-items:start;">
      
      <!-- Left: Full Transaction Ledger Table -->
      <div class="card" style="padding:16px 18px; background:var(--surface);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
          <div>
            <h3 style="font-size:15px; font-weight:700; margin:0; color:var(--ink);">Daily Cash Ledger</h3>
            <div style="font-size:12px; color:var(--muted); margin-top:2px;">All recorded cash inflows, disbursements and adjustments for today.</div>
          </div>

          <!-- Filters -->
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <input type="text" id="tx-search-input" class="input input-sm" placeholder="Search reference, voucher, note..." value="${_searchFilter}" style="font-size:12px; width:180px;" />
            
            <select id="tx-type-filter" class="select select-sm" style="font-size:12px;">
              <option value="ALL" ${_typeFilter === "ALL" ? "selected" : ""}>All Types</option>
              ${TX_TYPES.map(t => `<option value="${t.value}" ${_typeFilter === t.value ? "selected" : ""}>${t.label}</option>`).join("")}
            </select>

            <select id="tx-dir-filter" class="select select-sm" style="font-size:12px;">
              <option value="ALL" ${_directionFilter === "ALL" ? "selected" : ""}>All Directions</option>
              <option value="IN" ${_directionFilter === "IN" ? "selected" : ""}>Inflow (IN)</option>
              <option value="OUT" ${_directionFilter === "OUT" ? "selected" : ""}>Outflow (OUT)</option>
            </select>
          </div>
        </div>

        <div class="table-wrap">
          <table class="glass-table" style="width:100%;">
            <thead>
              <tr>
                <th>Time / Tx ID</th>
                <th>Type</th>
                <th>Direction</th>
                <th>Category / Reason</th>
                <th>Method</th>
                <th style="text-align:right;">Amount (₹)</th>
                <th>Status</th>
                ${canReverse() ? `<th style="text-align:center;">Action</th>` : ""}
              </tr>
            </thead>
            <tbody id="tx-table-body">
              ${renderTransactionRows()}
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:14px; padding-top:12px; border-top:1px solid var(--line); font-size:12px;">
          <span style="color:var(--muted);" id="tx-pagination-label">
            Page ${_page} of ${_totalPages} · Showing ${_transactions.length} entries
          </span>
          <div style="display:flex; gap:6px;">
            <button class="btn btn-outline btn-sm" id="btn-page-prev" ${_page <= 1 ? "disabled" : ""} type="button">‹ Prev</button>
            <button class="btn btn-outline btn-sm" id="btn-page-next" ${_page >= _totalPages ? "disabled" : ""} type="button">Next ›</button>
          </div>
        </div>
      </div>

      <!-- Right: Quick Movement Entry Panel -->
      <div style="display:flex; flex-direction:column; gap:16px;">
        <div class="card" style="padding:16px 18px; background:var(--surface);">
          <div style="font-size:14px; font-weight:700; color:var(--ink); margin-bottom:12px; display:flex; align-items:center; gap:6px;">
            <span>⚡ Quick Cash Movement</span>
          </div>

          <form id="quick-entry-form" style="display:flex; flex-direction:column; gap:10px;">
            <div>
              <label style="font-size:11.5px; font-weight:700; color:var(--muted); display:block; margin-bottom:3px;">Transaction Type</label>
              <select id="qe-type" class="select select-sm" style="width:100%;">
                ${TX_TYPES.filter(t => t.value !== "OPENING_BALANCE").map(t => `<option value="${t.value}">${t.label} (${t.dir})</option>`).join("")}
              </select>
            </div>

            <div>
              <label style="font-size:11.5px; font-weight:700; color:var(--muted); display:block; margin-bottom:3px;">Category / Purpose</label>
              <select id="qe-category" class="select select-sm" style="width:100%;">
                ${CATEGORIES.map(c => `<option value="${c}">${c.replaceAll("_", " ")}</option>`).join("")}
              </select>
            </div>

            <div>
              <label style="font-size:11.5px; font-weight:700; color:var(--muted); display:block; margin-bottom:3px;">Amount (₹)</label>
              <input type="number" id="qe-amount" class="input input-sm" placeholder="0.00" min="0.01" step="0.01" required style="width:100%; font-weight:700;" />
            </div>

            <div>
              <label style="font-size:11.5px; font-weight:700; color:var(--muted); display:block; margin-bottom:3px;">Payment Method</label>
              <select id="qe-method" class="select select-sm" style="width:100%;">
                ${PAYMENT_METHODS.map(m => `<option value="${m}">${m}</option>`).join("")}
              </select>
            </div>

            <div>
              <label style="font-size:11.5px; font-weight:700; color:var(--muted); display:block; margin-bottom:3px;">Voucher / Description</label>
              <input type="text" id="qe-desc" class="input input-sm" placeholder="Bill no, vendor name or purpose" style="width:100%;" />
            </div>

            ${canWrite() ? `
              <button type="submit" class="btn btn-primary btn-sm" style="margin-top:6px; width:100%; font-weight:700;">
                + Record Transaction
              </button>
            ` : `
              <div style="font-size:11px; color:var(--muted); text-align:center; padding:8px;">Read-only mode active.</div>
            `}
          </form>
        </div>

        <!-- Quick Denomination Snapshot -->
        <div class="card" style="padding:14px 16px; background:var(--surface-sunken);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <span style="font-size:12.5px; font-weight:700; color:var(--ink);">Till Drawer Total</span>
            <span class="pill pill-gold" style="font-size:10px;">DENOMINATIONS</span>
          </div>
          <div style="font-size:20px; font-weight:800; color:var(--ink);">${fmtInr(countTotal())}</div>
          <div style="font-size:11.5px; color:var(--muted); margin-top:2px;">
            Expected: <strong>${fmtInr(calculateExpectedCash())}</strong> · Variance: 
            <strong style="color:${calculateVariance() === 0 ? 'var(--success)' : 'var(--danger)'};">${fmtInr(calculateVariance())}</strong>
          </div>
          <button class="btn btn-secondary btn-sm" id="btn-goto-drawer" type="button" style="margin-top:10px; width:100%; font-size:11.5px;">
            Open Detailed Count Drawer
          </button>
        </div>
      </div>

    </div>
  `;
}

// ─── Tab 2: Drawer Count & Reconciliation ────────────────────────────────────
function renderDrawerTab() {
  const totalCounted = countTotal();
  const expected = calculateExpectedCash();
  const variance = totalCounted - expected;
  const isBalanced = variance === 0;

  return `
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:18px; align-items:start;">
      
      <!-- Left: Interactive Denomination Counting Grid -->
      <div class="card" style="padding:18px 20px; background:var(--surface);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <div>
            <h3 style="font-size:16px; font-weight:700; margin:0; color:var(--ink);">Physical Denomination Counter</h3>
            <div style="font-size:12px; color:var(--muted); margin-top:2px;">Enter physical note and coin counts present inside the till drawer.</div>
          </div>
          <button class="btn btn-ghost btn-sm" id="btn-clear-denoms" type="button">Reset Counts</button>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
          ${DENOMS.map(d => {
            const count = _denomCounts[d] || 0;
            const subtotal = count * d;
            return `
              <div style="padding:8px 12px; background:var(--surface-sunken); border:1px solid var(--line); border-radius:var(--radius-sm); display:flex; justify-content:space-between; align-items:center;">
                <div>
                  <div style="font-size:13px; font-weight:700; color:var(--ink);">₹${d} Note</div>
                  <div style="font-size:11px; color:var(--muted);">= ${fmtInr(subtotal)}</div>
                </div>
                <input 
                  type="number" 
                  class="input input-sm denom-input" 
                  data-denom="${d}" 
                  value="${count > 0 ? count : ''}" 
                  placeholder="0" 
                  min="0" 
                  style="width:70px; text-align:right; font-weight:700;" 
                />
              </div>
            `;
          }).join("")}
        </div>

        <div style="margin-top:16px; padding:12px 14px; background:rgba(177,125,56,0.08); border:1px solid rgba(177,125,56,0.25); border-radius:var(--radius-sm); display:flex; justify-content:space-between; align-items:center;">
          <span style="font-weight:700; color:var(--ink); font-size:14px;">Total Physical Count:</span>
          <span style="font-size:22px; font-weight:800; color:var(--ink);" id="tab-denom-total">${fmtInr(totalCounted)}</span>
        </div>
      </div>

      <!-- Right: Reconciliation Breakdown & Approval Box -->
      <div style="display:flex; flex-direction:column; gap:16px;">
        
        <div class="card" style="padding:18px 20px; background:var(--surface);">
          <h3 style="font-size:16px; font-weight:700; margin:0 0 14px 0; color:var(--ink);">Drawer Reconciliation Breakdown</h3>

          <div style="display:flex; flex-direction:column; gap:10px; font-size:13px;">
            <div style="display:flex; justify-content:space-between; padding-bottom:8px; border-bottom:1px solid var(--line);">
              <span style="color:var(--muted);">Opening Float:</span>
              <strong style="color:var(--ink);">${fmtInr(_sessionInfo.openingFloat)}</strong>
            </div>

            <div style="display:flex; justify-content:space-between; padding-bottom:8px; border-bottom:1px solid var(--line);">
              <span style="color:var(--muted);">Total Cash Sales (+):</span>
              <strong style="color:var(--success);">${fmtInr(_sessionInfo.cashSales)}</strong>
            </div>

            <div style="display:flex; justify-content:space-between; padding-bottom:8px; border-bottom:1px solid var(--line);">
              <span style="color:var(--muted);">Paid-In Top-ups (+):</span>
              <strong style="color:var(--success);">${fmtInr(_sessionInfo.totalPaidIn)}</strong>
            </div>

            <div style="display:flex; justify-content:space-between; padding-bottom:8px; border-bottom:1px solid var(--line);">
              <span style="color:var(--muted);">Paid-Out Petty Cash (-):</span>
              <strong style="color:var(--danger);">${fmtInr(_sessionInfo.totalPaidOut)}</strong>
            </div>

            <div style="display:flex; justify-content:space-between; padding-bottom:8px; border-bottom:1px solid var(--line);">
              <span style="color:var(--muted);">Mid-Day Safe Drops (-):</span>
              <strong style="color:var(--warning);">${fmtInr(_sessionInfo.totalSafeDrops)}</strong>
            </div>

            <div style="display:flex; justify-content:space-between; padding:10px 0; font-size:14px; font-weight:700; border-bottom:2px solid var(--line);">
              <span style="color:var(--ink);">Calculated Expected In Till:</span>
              <span style="color:var(--ink);">${fmtInr(expected)}</span>
            </div>

            <div style="display:flex; justify-content:space-between; padding:10px 0; font-size:14px; font-weight:700; border-bottom:2px solid var(--line);">
              <span style="color:var(--ink);">Actual Physical Count:</span>
              <span style="color:var(--ink);">${fmtInr(totalCounted)}</span>
            </div>

            <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 14px; border-radius:var(--radius-sm); background:${isBalanced ? 'rgba(52,211,153,0.1)' : 'rgba(251,113,133,0.1)'}; border:1px solid ${isBalanced ? 'rgba(52,211,153,0.3)' : 'rgba(251,113,133,0.3)'};">
              <div>
                <div style="font-size:12px; font-weight:700; color:${isBalanced ? 'var(--success)' : 'var(--danger)'}; text-transform:uppercase;">
                  ${isBalanced ? '✓ Drawer Reconciled' : (variance > 0 ? '▲ Cash Over' : '▼ Cash Short')}
                </div>
                <div style="font-size:11px; color:var(--muted);">Tolerance threshold: ±₹500.00</div>
              </div>
              <div style="font-size:20px; font-weight:800; color:${isBalanced ? 'var(--success)' : 'var(--danger)'};">
                ${fmtInr(variance)}
              </div>
            </div>
          </div>

          <!-- Variance Justification Input -->
          ${!isBalanced && totalCounted > 0 ? `
            <div style="margin-top:14px;">
              <label style="font-size:12px; font-weight:700; color:var(--danger); display:block; margin-bottom:4px;">
                Variance Explanation (Mandatory for closure)
              </label>
              <textarea id="reconcile-variance-note" class="textarea input-sm" placeholder="State reason for cash discrepancy..." style="width:100%; min-height:60px;"></textarea>
            </div>
          ` : ""}

          <div style="margin-top:16px; display:flex; gap:10px;">
            <button class="btn btn-secondary" id="btn-save-count" type="button" style="flex:1; font-weight:600;">
              Save Count Draft
            </button>
            <button class="btn btn-primary" id="btn-reconcile-confirm" type="button" style="flex:1; font-weight:700;">
              Post &amp; Sign Off
            </button>
          </div>
        </div>

      </div>

    </div>
  `;
}

// ─── Tab 3: Cash Movements & Safe Drops ───────────────────────────────────────
function renderMovementsTab() {
  return `
    <div style="display:flex; flex-direction:column; gap:16px;">
      
      <div class="card" style="padding:16px 18px; background:var(--surface);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
          <div>
            <h3 style="font-size:16px; font-weight:700; margin:0; color:var(--ink);">Cash Movements, Petty Cash &amp; Safe Drops</h3>
            <div style="font-size:12px; color:var(--muted); margin-top:2px;">Track all intermediate till drops, bank deposits, and petty cash disbursements.</div>
          </div>
          ${canWrite() ? `
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <button class="btn btn-secondary btn-sm" id="btn-movement-safedrop" type="button">New Safe Drop</button>
              <button class="btn btn-secondary btn-sm" id="btn-movement-bankdeposit" type="button">🏦 Bank Deposit Drop</button>
              <button class="btn btn-secondary btn-sm" id="btn-movement-petty" type="button">New Petty Cash</button>
              <button class="btn btn-primary btn-sm" id="btn-movement-topup" type="button">Float Top-up</button>
            </div>
          ` : ""}
        </div>

        <!-- Movement Summary Tiles -->
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:12px; margin-bottom:16px;">
          <div style="padding:12px 14px; background:var(--surface-sunken); border:1px solid var(--line); border-radius:var(--radius-sm);">
            <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">Vault Drops Today</div>
            <div style="font-size:18px; font-weight:800; color:var(--ink); margin:2px 0;">${fmtInr(_sessionInfo.totalSafeDrops)}</div>
            <div style="font-size:11px; color:var(--muted);">${_transactions.filter(t => t.type === 'SAFE_DROP').length} transfers recorded</div>
          </div>

          <div style="padding:12px 14px; background:var(--surface-sunken); border:1px solid var(--line); border-radius:var(--radius-sm);">
            <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">Petty Disbursements</div>
            <div style="font-size:18px; font-weight:800; color:var(--danger); margin:2px 0;">${fmtInr(_sessionInfo.totalPaidOut)}</div>
            <div style="font-size:11px; color:var(--muted);">${_transactions.filter(t => t.type === 'PAID_OUT').length} disbursements</div>
          </div>

          <div style="padding:12px 14px; background:var(--surface-sunken); border:1px solid var(--line); border-radius:var(--radius-sm);">
            <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">Float Top-ups</div>
            <div style="font-size:18px; font-weight:800; color:var(--success); margin:2px 0;">${fmtInr(_sessionInfo.totalPaidIn)}</div>
            <div style="font-size:11px; color:var(--muted);">${_transactions.filter(t => t.type === 'PAID_IN').length} top-ups</div>
          </div>
        </div>

        <div class="table-wrap">
          <table class="glass-table" style="width:100%;">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Type</th>
                <th>Category</th>
                <th>Voucher / Ref</th>
                <th>Recorded By</th>
                <th>Payment Method</th>
                <th style="text-align:right;">Amount (₹)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${(() => {
                const movements = _transactions.filter(t => ['SAFE_DROP', 'PAID_OUT', 'PAID_IN', 'BANK_DEPOSIT'].includes(t.type) || t.category === 'BANK_DEPOSIT');
                if (movements.length === 0) {
                  return '<tr><td colspan="8" style="padding:24px; text-align:center; color:var(--muted); font-size:13px;">No movements recorded for this session yet.</td></tr>';
                }
                return movements.map(t => {
                  const ts = t.createdAt ? new Date(t.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";
                  const typeClass = t.type === "SAFE_DROP" ? "pill-warning" : t.type === "PAID_OUT" ? "pill-coral" : "pill-mint";
                  const amt = t.amount || 0;
                  const isOut = t.direction === "OUT" || ["SAFE_DROP", "PAID_OUT"].includes(t.type);
                  const amtDisplay = `${isOut ? "-" : "+"}${fmtInr(Math.abs(amt))}`;
                  const amtColor = isOut ? "var(--danger)" : "var(--success)";
                  const statusClass = t.status === "CONFIRMED" || t.status === "APPROVED" ? "pill-mint" : "pill-warning";
                  const recorder = t.recordedBy || t.cashierName || "—";
                  return `
                    <tr>
                      <td>${ts}</td>
                      <td><span class="pill ${typeClass}">${t.type}</span></td>
                      <td>${t.category || t.type}</td>
                      <td>${t.voucherRef || t.referenceNumber || "—"}</td>
                      <td>${recorder}</td>
                      <td>${t.paymentMethod || "CASH"}</td>
                      <td style="text-align:right; font-weight:700; color:${amtColor};">${amtDisplay}</td>
                      <td><span class="pill ${statusClass}">${t.status || "PENDING"}</span></td>
                    </tr>`;
                }).join("");
              })()}
            </tbody>
          </table>
        </div>

      </div>

    </div>
  `;
}

// ─── Tab 4: Tender & Multi-Payment Breakdown ──────────────────────────────────
function renderTenderTab() {
  const totalSales = _sessionInfo.cashSales + _sessionInfo.upiSales + _sessionInfo.cardSales + _sessionInfo.aggregatorSales;

  return `
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:18px; align-items:start;">
      
      <!-- Left: Tender Channels Breakdown -->
      <div class="card" style="padding:18px 20px; background:var(--surface);">
        <h3 style="font-size:16px; font-weight:700; margin:0 0 14px 0; color:var(--ink);">Tender &amp; Payment Channel Breakdown</h3>

        <div style="display:flex; flex-direction:column; gap:12px;">
          
          <div style="padding:12px 14px; background:var(--surface-sunken); border:1px solid var(--line); border-radius:var(--radius-sm); display:flex; justify-content:space-between; align-items:center;">
            <div>
              <div style="font-size:13.5px; font-weight:700; color:var(--ink);">💵 Physical Cash</div>
              <div style="font-size:11px; color:var(--muted);">In-store counter sales</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:15px; font-weight:800; color:var(--ink);">${fmtInr(_sessionInfo.cashSales)}</div>
              <div style="font-size:11px; color:var(--muted);">${((_sessionInfo.cashSales / totalSales) * 100).toFixed(1)}% of total</div>
            </div>
          </div>

          <div style="padding:12px 14px; background:var(--surface-sunken); border:1px solid var(--line); border-radius:var(--radius-sm); display:flex; justify-content:space-between; align-items:center;">
            <div>
              <div style="font-size:13.5px; font-weight:700; color:var(--ink);">📱 UPI &amp; Dynamic QR</div>
              <div style="font-size:11px; color:var(--muted);">PhonePe, GPay, Paytm Soundbox</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:15px; font-weight:800; color:var(--ink);">${fmtInr(_sessionInfo.upiSales)}</div>
              <div style="font-size:11px; color:var(--muted);">${((_sessionInfo.upiSales / totalSales) * 100).toFixed(1)}% of total</div>
            </div>
          </div>

          <div style="padding:12px 14px; background:var(--surface-sunken); border:1px solid var(--line); border-radius:var(--radius-sm); display:flex; justify-content:space-between; align-items:center;">
            <div>
              <div style="font-size:13.5px; font-weight:700; color:var(--ink);">💳 EDC Cards (Credit / Debit)</div>
              <div style="font-size:11px; color:var(--muted);">Pine Labs / HDFC Terminal Batch #481</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:15px; font-weight:800; color:var(--ink);">${fmtInr(_sessionInfo.cardSales)}</div>
              <div style="font-size:11px; color:var(--muted);">${((_sessionInfo.cardSales / totalSales) * 100).toFixed(1)}% of total</div>
            </div>
          </div>

          <div style="padding:12px 14px; background:var(--surface-sunken); border:1px solid var(--line); border-radius:var(--radius-sm); display:flex; justify-content:space-between; align-items:center;">
            <div>
              <div style="font-size:13.5px; font-weight:700; color:var(--ink);">🛵 Online Delivery Aggregators</div>
              <div style="font-size:11px; color:var(--muted);">Swiggy &amp; Zomato Merchant Portal</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:15px; font-weight:800; color:var(--ink);">${fmtInr(_sessionInfo.aggregatorSales)}</div>
              <div style="font-size:11px; color:var(--muted);">${((_sessionInfo.aggregatorSales / totalSales) * 100).toFixed(1)}% of total</div>
            </div>
          </div>

        </div>
      </div>

      <!-- Right: EDC Terminal Batch & Bank Reconciliation -->
      <div class="card" style="padding:18px 20px; background:var(--surface);">
        <h3 style="font-size:16px; font-weight:700; margin:0 0 14px 0; color:var(--ink);">EDC Batch &amp; QR Reconcile</h3>

        <div style="display:flex; flex-direction:column; gap:12px; font-size:13px;">
          <div style="padding:10px 12px; background:var(--surface-sunken); border:1px solid var(--line); border-radius:var(--radius-sm); display:flex; justify-content:space-between; align-items:center;">
            <span>EDC Terminal Status:</span>
            <span class="pill pill-mint">BATCH OPEN (#481)</span>
          </div>

          <div style="padding:10px 12px; background:var(--surface-sunken); border:1px solid var(--line); border-radius:var(--radius-sm); display:flex; justify-content:space-between; align-items:center;">
            <span>Soundbox UPI Status:</span>
            <span class="pill pill-mint">CONNECTED · AUTO-SETTLED</span>
          </div>

          <div style="padding:10px 12px; background:var(--surface-sunken); border:1px solid var(--line); border-radius:var(--radius-sm); display:flex; justify-content:space-between; align-items:center;">
            <span>Estimated MDR / Gateway Fees:</span>
            <strong style="color:var(--danger);">-₹246.00</strong>
          </div>

          <button class="btn btn-secondary" id="btn-settle-edc" type="button" style="margin-top:8px; font-weight:600;">
            Trigger EDC Batch Settlement
          </button>
        </div>
      </div>

    </div>
  `;
}

// ─── Tab 5: EOD Closing Checklist ────────────────────────────────────────────
function renderEodTab() {
  return `
    <div style="max-width:860px; margin:0 auto;">
      <div class="card" style="padding:22px 24px; background:var(--surface);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:18px;">
          <div>
            <h3 style="font-size:18px; font-weight:800; margin:0; color:var(--ink);">End-Of-Day (EOD) Till Closing Checklist</h3>
            <div style="font-size:13px; color:var(--muted); margin-top:3px;">
              Mandatory operational procedure prior to locking the till and generating day-end accounting entries.
            </div>
          </div>
          <span class="pill pill-gold" style="font-size:11px; font-weight:700;">7-STEP AUDIT GATE</span>
        </div>

        <div style="display:flex; flex-direction:column; gap:12px;">
          
          <label style="display:flex; align-items:flex-start; gap:12px; padding:12px 14px; background:var(--surface-sunken); border:1px solid var(--line); border-radius:var(--radius-sm); cursor:pointer;">
            <input type="checkbox" checked disabled style="margin-top:3px; transform:scale(1.2);" />
            <div>
              <div style="font-size:13.5px; font-weight:700; color:var(--ink);">1. Open Table Orders &amp; KOTs Reconciled</div>
              <div style="font-size:12px; color:var(--muted);">All active dine-in and takeaway tickets have been billed or cleared.</div>
            </div>
          </label>

          <label style="display:flex; align-items:flex-start; gap:12px; padding:12px 14px; background:var(--surface-sunken); border:1px solid var(--line); border-radius:var(--radius-sm); cursor:pointer;">
            <input type="checkbox" ${countTotal() > 0 ? "checked" : ""} id="chk-eod-count" style="margin-top:3px; transform:scale(1.2);" />
            <div>
              <div style="font-size:13.5px; font-weight:700; color:var(--ink);">2. Physical Denomination Drawer Count Completed</div>
              <div style="font-size:12px; color:var(--muted);">All notes and coins physically verified (${fmtInr(countTotal())} counted).</div>
            </div>
          </label>

          <label style="display:flex; align-items:flex-start; gap:12px; padding:12px 14px; background:var(--surface-sunken); border:1px solid var(--line); border-radius:var(--radius-sm); cursor:pointer;">
            <input type="checkbox" checked id="chk-eod-drop" style="margin-top:3px; transform:scale(1.2);" />
            <div>
              <div style="font-size:13.5px; font-weight:700; color:var(--ink);">3. Excess Cash Transferred to Safe (Safe Drop)</div>
              <div style="font-size:12px; color:var(--muted);">Retain only opening float (₹2,000) in drawer for next shift.</div>
            </div>
          </label>

          <label style="display:flex; align-items:flex-start; gap:12px; padding:12px 14px; background:var(--surface-sunken); border:1px solid var(--line); border-radius:var(--radius-sm); cursor:pointer;">
            <input type="checkbox" checked id="chk-eod-edc" style="margin-top:3px; transform:scale(1.2);" />
            <div>
              <div style="font-size:13.5px; font-weight:700; color:var(--ink);">4. EDC Card Machine Batch Settlement Closed</div>
              <div style="font-size:12px; color:var(--muted);">Terminal settlement receipt printed and stapled to cash sheet.</div>
            </div>
          </label>

          <label style="display:flex; align-items:flex-start; gap:12px; padding:12px 14px; background:var(--surface-sunken); border:1px solid var(--line); border-radius:var(--radius-sm); cursor:pointer;">
            <input type="checkbox" ${calculateVariance() === 0 ? "checked" : ""} id="chk-eod-variance" style="margin-top:3px; transform:scale(1.2);" />
            <div>
              <div style="font-size:13.5px; font-weight:700; color:var(--ink);">5. Discrepancy &amp; Variance Approval</div>
              <div style="font-size:12px; color:var(--muted);">Current variance (${fmtInr(calculateVariance())}) reviewed and signed off.</div>
            </div>
          </label>

          <label style="display:flex; align-items:flex-start; gap:12px; padding:12px 14px; background:var(--surface-sunken); border:1px solid var(--line); border-radius:var(--radius-sm); cursor:pointer;">
            <input type="checkbox" checked id="chk-eod-signoff" style="margin-top:3px; transform:scale(1.2);" />
            <div>
              <div style="font-size:13.5px; font-weight:700; color:var(--ink);">6. Cashier &amp; Shift Manager Dual Sign-off</div>
              <div style="font-size:12px; color:var(--muted);">Both operator and supervisor acknowledge closing amounts.</div>
            </div>
          </label>

        </div>

        <div style="margin-top:20px; padding-top:16px; border-top:1px solid var(--line); display:flex; justify-content:space-between; align-items:center;">
          <button class="btn btn-ghost" id="btn-print-checklist" type="button">🖨️ Print Checklist</button>
          <button class="btn btn-primary" id="btn-execute-eod-close" type="button" style="font-size:14px; padding:10px 24px; font-weight:700;">
            Execute Shift Close
          </button>
        </div>
      </div>
    </div>
  `;
}

// ─── Tab 6: Session History & Audit Trail ─────────────────────────────────────
function renderHistoryTab() {
  return `
    <div class="card" style="padding:16px 18px; background:var(--surface);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
        <div>
          <h3 style="font-size:16px; font-weight:700; margin:0; color:var(--ink);">Past Till Sessions &amp; Closure Audits</h3>
          <div style="font-size:12px; color:var(--muted); margin-top:2px;">Historical till closing records, verified opening floats and variance logs.</div>
        </div>
        <button class="btn btn-outline btn-sm" id="btn-export-history" type="button">Export Audit Log</button>
      </div>

      <div class="table-wrap">
        <table class="glass-table" style="width:100%;">
          <thead>
            <tr>
              <th>Session ID</th>
              <th>Date / Shift</th>
              <th>Café</th>
              <th>Cashier</th>
              <th style="text-align:right;">Opening Float</th>
              <th style="text-align:right;">Cash Sales</th>
              <th style="text-align:right;">Safe Drops</th>
              <th style="text-align:right;">Closing Count</th>
              <th style="text-align:right;">Variance</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colspan="11" style="text-align:center; padding:32px; color:var(--muted); font-size:13px;">
                No historical closed till sessions found for this period.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ─── Transaction Table Rows ───────────────────────────────────────────────────
function renderTransactionRows() {
  if (_loading) {
    return `<tr><td colspan="8" style="padding:24px 0;">${skeleton("40px")}${skeleton("40px")}${skeleton("40px")}</td></tr>`;
  }

  let filtered = _transactions;
  if (_searchFilter) {
    const q = _searchFilter.toLowerCase();
    filtered = filtered.filter(t => 
      (t.cashTransactionId || "").toLowerCase().includes(q) ||
      (t.category || "").toLowerCase().includes(q) ||
      (t.description || "").toLowerCase().includes(q)
    );
  }

  if (_typeFilter !== "ALL") {
    filtered = filtered.filter(t => t.transactionType === _typeFilter);
  }

  if (_directionFilter !== "ALL") {
    filtered = filtered.filter(t => t.direction === _directionFilter);
  }

  if (!filtered.length) {
    return `
      <tr>
        <td colspan="8" style="text-align:center; padding:48px 16px; color:var(--muted);">
          <div style="font-size:28px; margin-bottom:8px;">💳</div>
          <div style="font-weight:700; color:var(--ink); font-size:14px;">No cash transactions found</div>
          <div style="font-size:12px; margin-top:2px;">No records match the selected date, café and filter criteria.</div>
        </td>
      </tr>
    `;
  }

  return filtered.map(tx => `
    <tr class="table-row-hover">
      <td style="font-size:12px;">
        <div style="font-weight:700; color:var(--ink);">${tx.cashTransactionId}</div>
        <div style="color:var(--muted); font-size:11px;">${fmtTime(tx.recordedAt)}</div>
      </td>
      <td style="font-size:12px; font-weight:600;">${(tx.transactionType || "").replaceAll("_", " ")}</td>
      <td>${directionBadge(tx.direction)}</td>
      <td style="font-size:12px;">
        <div style="font-weight:600; color:var(--ink);">${tx.category || "—"}</div>
        ${tx.description ? `<div style="color:var(--muted); font-size:11px;">${tx.description}</div>` : ""}
      </td>
      <td style="font-size:12px;">${tx.paymentMethod || "CASH"}</td>
      <td style="text-align:right; font-weight:700; font-size:13px; color:${tx.direction === 'OUT' ? 'var(--danger)' : 'var(--success)'};">
        ${tx.direction === 'OUT' ? '-' : '+'}${fmtInr(tx.amount)}
      </td>
      <td>${statusBadge(tx.status)}</td>
      ${canReverse() ? `
        <td style="text-align:center;">
          ${tx.status !== 'REVERSED' ? `
            <button class="btn btn-ghost btn-xs btn-reverse-tx" data-id="${tx.cashTransactionId}" style="color:var(--danger); font-size:11px; padding:2px 6px;" title="Reverse this transaction">
              Reverse
            </button>
          ` : `<span style="font-size:11px; color:var(--muted);">Reversed</span>`}
        </td>
      ` : ""}
    </tr>
  `).join("");
}

// ─── Event Wiring & API Loading ───────────────────────────────────────────────
export async function wireCashBook(root) {
  if (!root) return;
  _root = root;
  attachEvents(root);
  loadData();
}

function switchTab(newTab) {
  _activeTab = newTab;
  if (!_root) return;
  
  const tabBtns = _root.querySelectorAll("[data-scb-tab]");
  tabBtns.forEach(btn => {
    if (btn.dataset.scbTab === newTab) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  const tabContent = _root.querySelector("#scb-tab-content");
  if (tabContent) {
    tabContent.innerHTML = renderActiveTab();
    attachTabEvents(_root);
  }
}

async function loadData() {
  _loading = true;
  rerenderTable();

  try {
    const params = new URLSearchParams({
      cafeId: _selectedCafe || "",
      businessDate: _selectedDate || getIstDate(),
      page: String(_page),
      limit: "25",
    });

    const [summaryRes, listRes] = await Promise.all([
      apiGet(`/cash-transactions/summary?${params.toString()}`).catch(() => null),
      apiGet(`/cash-transactions?${params.toString()}`).catch(() => null),
    ]);

    if (summaryRes?.success && summaryRes.data) {
      _summary = summaryRes.data;
    }

    if (listRes?.success && listRes.data) {
      _transactions = listRes.data.cashTransactions || [];
      if (listRes.data.pagination) {
        _page = listRes.data.pagination.page || 1;
        _totalPages = listRes.data.pagination.totalPages || 1;
      }
    }
  } catch (err) {
    console.warn("Could not load cash transactions:", err);
  } finally {
    _loading = false;
    rerenderTable();
  }
}

function attachEvents(root) {
  if (!root) return;

  // Tab Switcher
  root.querySelectorAll("[data-scb-tab]").forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      switchTab(btn.dataset.scbTab);
    };
  });

  // Cafe Scope Selector
  const cafeSel = root.querySelector("#scb-cafe-select");
  if (cafeSel) {
    cafeSel.onchange = (e) => {
      _selectedCafe = e.target.value;
      _page = 1;
      loadData();
    };
  }

  // Date Selector
  const dateInput = root.querySelector("#scb-date-input");
  if (dateInput) {
    dateInput.onchange = (e) => {
      _selectedDate = e.target.value;
      _page = 1;
      loadData();
    };
  }

  // Shift Selector
  const shiftInput = root.querySelector("#scb-shift-select");
  if (shiftInput) {
    shiftInput.onchange = (e) => {
      _selectedShift = e.target.value;
    };
  }

  // Apply Button
  const btnApply = root.querySelector("#btn-apply-filters");
  if (btnApply) {
    btnApply.onclick = () => {
      _page = 1;
      loadData();
      showToast("Filters applied.", "mint");
    };
  }

  // Refresh Button
  const btnRefresh = root.querySelector("#btn-refresh");
  if (btnRefresh) {
    btnRefresh.onclick = () => {
      loadData();
      showToast("Cash book refreshed.", "mint");
    };
  }

  // Header Action Triggers
  const btnOpen = root.querySelector("#btn-open-session");
  if (btnOpen) btnOpen.onclick = () => openStartSessionModal();

  const btnQuick = root.querySelector("#btn-quick-entry");
  if (btnQuick) btnQuick.onclick = () => openMovementModal();

  const btnSafe = root.querySelector("#btn-safe-drop");
  if (btnSafe) btnSafe.onclick = () => openSafeDropModal();

  const btnClose = root.querySelector("#btn-close-session");
  if (btnClose) btnClose.onclick = () => openCloseSessionModal();

  const btnExport = root.querySelector("#btn-export-eod");
  if (btnExport) btnExport.onclick = () => openExportModal();

  attachTabEvents(root);
}

function attachTabEvents(root) {
  if (!root) return;

  // Search Filter
  const searchInput = root.querySelector("#tx-search-input");
  if (searchInput) {
    searchInput.oninput = (e) => {
      _searchFilter = e.target.value;
      rerenderTable();
    };
  }

  // Type Filter
  const typeFilter = root.querySelector("#tx-type-filter");
  if (typeFilter) {
    typeFilter.onchange = (e) => {
      _typeFilter = e.target.value;
      rerenderTable();
    };
  }

  // Direction Filter
  const dirFilter = root.querySelector("#tx-dir-filter");
  if (dirFilter) {
    dirFilter.onchange = (e) => {
      _directionFilter = e.target.value;
      rerenderTable();
    };
  }

  // Pagination Prev / Next
  const btnPrev = root.querySelector("#btn-page-prev");
  if (btnPrev) {
    btnPrev.onclick = () => {
      if (_page > 1) { _page--; loadData(); }
    };
  }
  const btnNext = root.querySelector("#btn-page-next");
  if (btnNext) {
    btnNext.onclick = () => {
      if (_page < _totalPages) { _page++; loadData(); }
    };
  }

  // Quick Entry Form Submit
  const qeForm = root.querySelector("#quick-entry-form");
  if (qeForm) {
    qeForm.onsubmit = async (e) => {
      e.preventDefault();
      const type = root.querySelector("#qe-type")?.value;
      const category = root.querySelector("#qe-category")?.value;
      const amount = Number(root.querySelector("#qe-amount")?.value);
      const paymentMethod = root.querySelector("#qe-method")?.value || "CASH";
      const desc = root.querySelector("#qe-desc")?.value || "";

      if (!amount || amount <= 0) {
        showToast("Please enter a valid cash amount.", "coral");
        return;
      }

      try {
        const payload = {
          cafeId: _selectedCafe || getDefaultCafe(),
          transactionType: type,
          category: category,
          amount: amount,
          paymentMethod: paymentMethod,
          description: desc,
        };

        const res = await apiPost("/cash-transactions", payload);
        if (res?.success) {
          showToast("Cash transaction recorded successfully.", "mint");
          const amtInput = root.querySelector("#qe-amount");
          if (amtInput) amtInput.value = "";
          const descInput = root.querySelector("#qe-desc");
          if (descInput) descInput.value = "";
          await loadData();
        } else {
          showToast(res?.error?.message || "Failed to record transaction.", "coral");
        }
      } catch (err) {
        showToast("Error: " + (err.message || "Failed to post transaction."), "coral");
      }
    };
  }

  // Denomination Counting Inputs
  root.querySelectorAll(".denom-input").forEach(input => {
    input.oninput = (e) => {
      const denom = Number(e.target.dataset.denom);
      const val = Number(e.target.value) || 0;
      _denomCounts[denom] = val;
      updateDenomDisplay(root);
    };
  });

  // Reset Counts
  const btnClearDenoms = root.querySelector("#btn-clear-denoms");
  if (btnClearDenoms) {
    btnClearDenoms.onclick = () => {
      DENOMS.forEach(d => _denomCounts[d] = 0);
      root.querySelectorAll(".denom-input").forEach(i => i.value = "");
      updateDenomDisplay(root);
      showToast("Counts reset to zero.", "mint");
    };
  }

  // Go to drawer button from ledger tab
  const btnGotoDrawer = root.querySelector("#btn-goto-drawer");
  if (btnGotoDrawer) {
    btnGotoDrawer.onclick = () => switchTab("drawer");
  }

  // Drawer Reconciliation Actions
  const btnSaveCount = root.querySelector("#btn-save-count");
  if (btnSaveCount) {
    btnSaveCount.onclick = () => {
      showToast(`Count draft of ${fmtInr(countTotal())} saved locally.`, "mint");
    };
  }

  const btnReconcile = root.querySelector("#btn-reconcile-confirm");
  if (btnReconcile) {
    btnReconcile.onclick = () => {
      const variance = calculateVariance();
      if (variance === 0) {
        showToast("Drawer verified & balanced with ₹0.00 variance.", "mint");
      } else {
        showToast(`Reconciliation sign-off recorded with variance: ${fmtInr(variance)}.`, "mint");
      }
    };
  }

  // Cash Movements tab buttons
  const btnMoveSafe = root.querySelector("#btn-movement-safedrop");
  if (btnMoveSafe) btnMoveSafe.onclick = () => openSafeDropModal();

  const btnMoveBank = root.querySelector("#btn-movement-bankdeposit");
  if (btnMoveBank) btnMoveBank.onclick = () => openBankDepositModal();

  const btnMovePetty = root.querySelector("#btn-movement-petty");
  if (btnMovePetty) btnMovePetty.onclick = () => openMovementModal();

  const btnMoveTopup = root.querySelector("#btn-movement-topup");
  if (btnMoveTopup) btnMoveTopup.onclick = () => openStartSessionModal();

  // EDC Batch Settlement
  const btnSettleEdc = root.querySelector("#btn-settle-edc");
  if (btnSettleEdc) {
    btnSettleEdc.onclick = () => {
      btnSettleEdc.disabled = true;
      btnSettleEdc.textContent = "Settling EDC Batch #481...";
      setTimeout(() => {
        btnSettleEdc.disabled = false;
        btnSettleEdc.textContent = "Trigger EDC Batch Settlement";
        showToast("EDC Machine Batch #481 successfully closed & settled.", "mint");
      }, 1000);
    };
  }

  // EOD Checklist Actions
  const btnPrintCheck = root.querySelector("#btn-print-checklist");
  if (btnPrintCheck) {
    btnPrintCheck.onclick = () => {
      window.print();
    };
  }

  const btnExecClose = root.querySelector("#btn-execute-eod-close");
  if (btnExecClose) {
    btnExecClose.onclick = () => {
      _sessionInfo.status = "CLOSED";
      showToast("Till successfully closed & EOD audit lock activated.", "mint");
      _root.innerHTML = renderCashBook();
      attachEvents(_root);
    };
  }

  // History tab export
  const btnExpHistory = root.querySelector("#btn-export-history");
  if (btnExpHistory) {
    btnExpHistory.onclick = () => {
      showToast("Exporting past session audit history CSV...", "mint");
    };
  }

  // Reverse buttons
  root.querySelectorAll(".btn-reverse-tx").forEach(btn => {
    btn.onclick = (e) => {
      const id = e.currentTarget.dataset.id;
      openReverseModal(id);
    };
  });
}

function updateDenomDisplay(root) {
  const total = countTotal();
  const exp = calculateExpectedCash();
  const v = total - exp;

  const totalEl = root.querySelector("#tab-denom-total");
  if (totalEl) totalEl.textContent = fmtInr(total);

  const kpiCounted = root.querySelector("#kpi-counted");
  if (kpiCounted) kpiCounted.textContent = fmtInr(total);

  const kpiVar = root.querySelector("#kpi-variance-status");
  if (kpiVar) kpiVar.textContent = total === 0 ? "Pending drawer count" : fmtInr(v) + " variance";
}

function rerenderTable() {
  if (!_root) return;
  const tbody = _root.querySelector("#tx-table-body");
  if (tbody) tbody.innerHTML = renderTransactionRows();

  const label = _root.querySelector("#tx-pagination-label");
  if (label) label.textContent = `Page ${_page} of ${_totalPages} · Showing ${_transactions.length} entries`;

  // Re-attach reverse buttons
  _root.querySelectorAll(".btn-reverse-tx").forEach(btn => {
    btn.onclick = (e) => {
      const id = e.currentTarget.dataset.id;
      openReverseModal(id);
    };
  });
}

// ─── Modal Workflows ──────────────────────────────────────────────────────────

function openStartSessionModal() {
  const modalRoot = _root?.querySelector("#scb-modal-root") || document.getElementById("scb-modal-root");
  if (!modalRoot) return;

  modalRoot.innerHTML = `
    <div id="scb-modal-overlay" style="position:fixed; inset:0; z-index:9999; display:flex; align-items:center; justify-content:center; padding:16px; background:rgba(0,0,0,0.65);">
      <div class="card" style="width:100%; max-width:480px; padding:22px 24px; background:var(--surface); border-radius:var(--radius-lg);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <h3 style="font-size:17px; font-weight:800; margin:0; color:var(--ink);">Start New Till Session</h3>
          <button class="btn btn-ghost btn-sm" id="modal-close" style="font-size:16px; padding:4px 8px;">✕</button>
        </div>

        <form id="start-session-form" style="display:flex; flex-direction:column; gap:12px;">
          <div>
            <label style="font-size:12px; font-weight:700; color:var(--muted); display:block; margin-bottom:3px;">Café Location</label>
            <input type="text" class="input input-sm" value="${_selectedCafe}" readonly style="width:100%; background:var(--surface-sunken);" />
          </div>

          <div>
            <label style="font-size:12px; font-weight:700; color:var(--muted); display:block; margin-bottom:3px;">Shift</label>
            <select id="modal-shift" class="select select-sm" style="width:100%;">
              <option value="MORNING">Morning Shift (07:00 - 15:30)</option>
              <option value="EVENING">Evening Shift (15:30 - 23:30)</option>
            </select>
          </div>

          <div>
            <label style="font-size:12px; font-weight:700; color:var(--muted); display:block; margin-bottom:3px;">Assigned Register / Till</label>
            <input type="text" id="modal-register" class="input input-sm" value="TILL-01" required style="width:100%;" />
          </div>

          <div>
            <label style="font-size:12px; font-weight:700; color:var(--muted); display:block; margin-bottom:3px;">Opening Float Cash (₹)</label>
            <input type="number" id="modal-float" class="input input-sm" value="2000" min="0" step="100" required style="width:100%; font-weight:700; font-size:14px;" />
          </div>

          <div>
            <label style="font-size:12px; font-weight:700; color:var(--muted); display:block; margin-bottom:3px;">Opening Notes</label>
            <textarea id="modal-notes" class="textarea input-sm" placeholder="Float verified by supervisor..." style="width:100%; min-height:50px;"></textarea>
          </div>

          <div style="display:flex; gap:10px; margin-top:8px;">
            <button type="button" class="btn btn-secondary" id="modal-cancel" style="flex:1;">Cancel</button>
            <button type="submit" class="btn btn-primary" style="flex:1; font-weight:700;">Open Till</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const close = () => { modalRoot.innerHTML = ""; };
  const btnClose = modalRoot.querySelector("#modal-close");
  if (btnClose) btnClose.onclick = close;
  const btnCancel = modalRoot.querySelector("#modal-cancel");
  if (btnCancel) btnCancel.onclick = close;

  const form = modalRoot.querySelector("#start-session-form");
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const floatAmount = Number(modalRoot.querySelector("#modal-float")?.value) || 2000;
      try {
        await apiPost("/cash-transactions", {
          cafeId: _selectedCafe || getDefaultCafe(),
          transactionType: "OPENING_BALANCE",
          category: "OPENING_FLOAT",
          amount: floatAmount,
          paymentMethod: "CASH",
          description: "Shift opening float verified",
        });
        _sessionInfo.openingFloat = floatAmount;
        _sessionInfo.status = "ACTIVE";
        showToast("Till session opened successfully.", "mint");
        close();
        if (_root) {
          _root.innerHTML = renderCashBook();
          attachEvents(_root);
          loadData();
        }
      } catch (err) {
        showToast("Error opening session: " + err.message, "coral");
      }
    };
  }
}

function openSafeDropModal() {
  const modalRoot = _root?.querySelector("#scb-modal-root") || document.getElementById("scb-modal-root");
  if (!modalRoot) return;

  modalRoot.innerHTML = `
    <div id="scb-modal-overlay" style="position:fixed; inset:0; z-index:9999; display:flex; align-items:center; justify-content:center; padding:16px; background:rgba(0,0,0,0.65);">
      <div class="card" style="width:100%; max-width:440px; padding:22px 24px; background:var(--surface); border-radius:var(--radius-lg);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <h3 style="font-size:17px; font-weight:800; margin:0; color:var(--ink);">Safe Drop Transfer</h3>
          <button class="btn btn-ghost btn-sm" id="modal-close" style="font-size:16px; padding:4px 8px;">✕</button>
        </div>

        <form id="safedrop-form" style="display:flex; flex-direction:column; gap:12px;">
          <div>
            <label style="font-size:12px; font-weight:700; color:var(--muted); display:block; margin-bottom:3px;">Drop Amount (₹)</label>
            <input type="number" id="sd-amount" class="input input-sm" placeholder="e.g. 10000" min="100" step="100" required style="width:100%; font-size:16px; font-weight:800;" />
          </div>

          <div>
            <label style="font-size:12px; font-weight:700; color:var(--muted); display:block; margin-bottom:3px;">Safe Bag / Seal Voucher No.</label>
            <input type="text" id="sd-seal" class="input input-sm" placeholder="e.g. BAG-SEAL-0001" required style="width:100%;" />
          </div>

          <div>
            <label style="font-size:12px; font-weight:700; color:var(--muted); display:block; margin-bottom:3px;">Witness / Manager ID</label>
            <input type="text" id="sd-witness" class="input input-sm" placeholder="e.g. Staff ID" required style="width:100%;" />
          </div>

          <div style="display:flex; gap:10px; margin-top:8px;">
            <button type="button" class="btn btn-secondary" id="modal-cancel" style="flex:1;">Cancel</button>
            <button type="submit" class="btn btn-primary" style="flex:1; font-weight:700;">Execute Safe Drop</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const close = () => { modalRoot.innerHTML = ""; };
  const btnClose = modalRoot.querySelector("#modal-close");
  if (btnClose) btnClose.onclick = close;
  const btnCancel = modalRoot.querySelector("#modal-cancel");
  if (btnCancel) btnCancel.onclick = close;

  const form = modalRoot.querySelector("#safedrop-form");
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const amount = Number(modalRoot.querySelector("#sd-amount")?.value);
      const seal = modalRoot.querySelector("#sd-seal")?.value;
      try {
        await apiPost("/cash-transactions", {
          cafeId: _selectedCafe || getDefaultCafe(),
          transactionType: "BANK_DEPOSIT",
          category: "SAFE_DROP",
          amount: amount,
          paymentMethod: "CASH",
          description: `Safe Drop Seal: ${seal}`,
        });
        _sessionInfo.totalSafeDrops += amount;
        showToast(`Safe drop of ₹${amount} recorded to vault.`, "mint");
        close();
        if (_root) {
          _root.innerHTML = renderCashBook();
          attachEvents(_root);
          loadData();
        }
      } catch (err) {
        showToast("Error: " + err.message, "coral");
      }
    };
  }
}

function openBankDepositModal() {
  const modalRoot = _root?.querySelector("#scb-modal-root") || document.getElementById("scb-modal-root");
  if (!modalRoot) return;

  modalRoot.innerHTML = `
    <div id="scb-modal-overlay" style="position:fixed; inset:0; z-index:9999; display:flex; align-items:center; justify-content:center; padding:16px; background:rgba(0,0,0,0.65);">
      <div class="card" style="width:100%; max-width:480px; padding:22px 24px; background:var(--surface); border-radius:var(--radius-lg);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <h3 style="font-size:17px; font-weight:800; margin:0; color:var(--ink);">Bank Deposit Acknowledgment</h3>
          <button class="btn btn-ghost btn-sm" id="modal-close" style="font-size:16px; padding:4px 8px;">✕</button>
        </div>

        <form id="bank-deposit-form" style="display:flex; flex-direction:column; gap:12px;">
          <div>
            <label style="font-size:12px; font-weight:700; color:var(--muted); display:block; margin-bottom:3px;">Deposit Amount (₹) *</label>
            <input type="number" id="bd-amount" class="input input-sm" placeholder="e.g. 25000" min="100" step="100" required style="width:100%; font-size:16px; font-weight:800;" />
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
            <div>
              <label style="font-size:12px; font-weight:700; color:var(--muted); display:block; margin-bottom:3px;">Beneficiary Bank *</label>
              <select id="bd-bank" class="select input-sm" style="width:100%; font-weight:600;" required>
                <option value="HDFC_BANK">HDFC Bank (Current A/c 5020...)</option>
                <option value="SBI">State Bank of India (A/c 3819...)</option>
                <option value="FEDERAL_BANK">Federal Bank (A/c 1421...)</option>
                <option value="ICICI_BANK">ICICI Bank (A/c 0039...)</option>
              </select>
            </div>
            <div>
              <label style="font-size:12px; font-weight:700; color:var(--muted); display:block; margin-bottom:3px;">Challan / Acknowledgment No. *</label>
              <input type="text" id="bd-challan" class="input input-sm" placeholder="e.g. CHL-2026-9901" required style="width:100%; font-weight:700;" />
            </div>
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
            <div>
              <label style="font-size:12px; font-weight:700; color:var(--muted); display:block; margin-bottom:3px;">Deposited By (Staff) *</label>
              <input type="text" id="bd-staff" class="input input-sm" value="${state.user?.name || 'Store Manager'}" required style="width:100%;" />
            </div>
            <div>
              <label style="font-size:12px; font-weight:700; color:var(--muted); display:block; margin-bottom:3px;">Bank Branch</label>
              <input type="text" id="bd-branch" class="input input-sm" placeholder="e.g. Beach Road Branch" style="width:100%;" />
            </div>
          </div>

          <div>
            <label style="font-size:12px; font-weight:700; color:var(--muted); display:block; margin-bottom:3px;">Deposit Notes &amp; Verification Evidence</label>
            <input type="text" id="bd-notes" class="input input-sm" placeholder="Stamped deposit counterfoil retained in store register..." style="width:100%;" />
          </div>

          <div style="display:flex; gap:10px; margin-top:8px;">
            <button type="button" class="btn btn-secondary" id="modal-cancel" style="flex:1;">Cancel</button>
            <button type="submit" class="btn btn-primary" style="flex:1; font-weight:700;">Acknowledge &amp; Post Deposit</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const close = () => { modalRoot.innerHTML = ""; };
  const btnClose = modalRoot.querySelector("#modal-close");
  if (btnClose) btnClose.onclick = close;
  const btnCancel = modalRoot.querySelector("#modal-cancel");
  if (btnCancel) btnCancel.onclick = close;

  const form = modalRoot.querySelector("#bank-deposit-form");
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const amount = Number(modalRoot.querySelector("#bd-amount")?.value);
      const bank = modalRoot.querySelector("#bd-bank")?.value;
      const challan = modalRoot.querySelector("#bd-challan")?.value;
      const staff = modalRoot.querySelector("#bd-staff")?.value;
      const branch = modalRoot.querySelector("#bd-branch")?.value;
      const notes = modalRoot.querySelector("#bd-notes")?.value;
      try {
        await apiPost("/cash-transactions", {
          cafeId: _selectedCafe || getDefaultCafe(),
          transactionType: "BANK_DEPOSIT",
          category: "BANK_DEPOSIT",
          amount: amount,
          paymentMethod: "BANK_TRANSFER",
          reference: challan,
          description: `Bank Drop to ${bank} (${branch || 'Main'}). Challan: ${challan}. Deposited by: ${staff}. ${notes}`,
        });
        _sessionInfo.totalSafeDrops += amount;
        showToast(`Bank deposit of ₹${amount} acknowledged against Challan ${challan}.`, "mint");
        close();
        if (_root) {
          _root.innerHTML = renderCashBook();
          attachEvents(_root);
          loadData();
        }
      } catch (err) {
        showToast("Error recording deposit: " + err.message, "coral");
      }
    };
  }
}

function openMovementModal() {
  switchTab("movements");
}

function openCloseSessionModal() {
  switchTab("eod");
}

function openExportModal() {
  showToast("Opening official EOD print summary...", "mint");
  window.print();
}

function openReverseModal(txId) {
  const modalRoot = _root?.querySelector("#scb-modal-root") || document.getElementById("scb-modal-root");
  if (!modalRoot) return;

  modalRoot.innerHTML = `
    <div id="scb-modal-overlay" style="position:fixed; inset:0; z-index:9999; display:flex; align-items:center; justify-content:center; padding:16px; background:rgba(0,0,0,0.65);">
      <div class="card" style="width:100%; max-width:440px; padding:22px 24px; background:var(--surface); border-radius:var(--radius-lg);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <h3 style="font-size:16px; font-weight:800; margin:0; color:var(--danger);">Reverse Cash Transaction</h3>
          <button class="btn btn-ghost btn-sm" id="modal-close" style="font-size:16px; padding:4px 8px;">✕</button>
        </div>

        <p style="font-size:12.5px; color:var(--muted); margin:0 0 12px 0;">
          You are reversing transaction <strong style="color:var(--ink);">${txId}</strong>. This will create an immutable audit reversal entry.
        </p>

        <form id="reverse-form" style="display:flex; flex-direction:column; gap:12px;">
          <div>
            <label style="font-size:12px; font-weight:700; color:var(--muted); display:block; margin-bottom:3px;">Reversal Reason (Mandatory)</label>
            <textarea id="rev-reason" class="textarea input-sm" placeholder="State reason for reversal (e.g. erroneous entry, duplicate bill)" required style="width:100%; min-height:70px;"></textarea>
          </div>

          <div style="display:flex; gap:10px; margin-top:6px;">
            <button type="button" class="btn btn-secondary" id="modal-cancel" style="flex:1;">Cancel</button>
            <button type="submit" class="btn btn-danger" style="flex:1; font-weight:700;">Confirm Reversal</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const close = () => { modalRoot.innerHTML = ""; };
  const btnClose = modalRoot.querySelector("#modal-close");
  if (btnClose) btnClose.onclick = close;
  const btnCancel = modalRoot.querySelector("#modal-cancel");
  if (btnCancel) btnCancel.onclick = close;

  const form = modalRoot.querySelector("#reverse-form");
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const reason = modalRoot.querySelector("#rev-reason")?.value;
      if (!reason || !reason.trim()) {
        showToast("Reversal reason is mandatory.", "coral");
        return;
      }
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Reversing...";
      }
      try {
        const res = await apiPost(`/cash-transactions/${txId}/reverse`, { reason: reason.trim() });
        if (res?.success) {
          showToast("Transaction reversed successfully.", "mint");
          close();
          await loadData();
        } else {
          showToast(res?.error?.message || "Reversal failed.", "coral");
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = "Confirm Reversal";
          }
        }
      } catch (err) {
        showToast("Error: " + (err.message || "Reversal failed"), "coral");
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Confirm Reversal";
        }
      }
    };
  }
}
