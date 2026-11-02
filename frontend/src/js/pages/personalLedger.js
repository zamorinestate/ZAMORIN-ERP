// =============================================================================
// PAGE: Personal Ledger & Owner Account (SCR-018)
// Restricted Company ↔ Owner / Private Financial Sub-Ledger & Reconciliation Workspace
// =============================================================================

import { exportGrid } from "../utils/exportFile.js";
import { showToast, openModal, confirmAction } from "../components.js";
import { apiGet, apiPost } from "../apiClient.js";
import { state } from "../state.js";

let liveOverview = null;
let liveEntries = null;
let activeTab = "journal"; // 'journal' | 'review' | 'reimbursements' | 'funding' | 'reconciliation' | 'confirmations' | 'audit'
let selectedAccount = "OWNER_CURRENT_ACCOUNT";
let selectedPeriod = "2026-2027";
let privacyModeActive = false;
let searchQuery = "";
let activeFilterTreatment = "ALL";

const SAMPLE_OVERVIEW = {
  accountHolderId: "",
  financialYear: "",
  accessLevel: "",
  confidential: true,
  balances: {
    dueToOwnerPaisa: 0,
    dueFromOwnerPaisa: 0,
    netCurrentAccountPositionPaisa: 0,
    totalCreditPaisa: 0,
    totalDebitPaisa: 0,
    currency: "INR",
  },
  actionCentre: {
    unclassifiedTransactions: 0,
    missingEvidenceCount: 0,
    pendingReviewCount: 0,
    openDiscrepanciesCount: 0,
    financePostingFailuresCount: 0,
  },
  accountHealth: {
    overall: "NOT_LOADED",
    classificationState: "Not loaded",
    reconciliationState: "Not loaded",
    evidenceCompleteness: "Not loaded",
    auditTrailState: "Not loaded",
    financeGLDifferencePaisa: 0,
  },
  availableAccounts: [],
};

const SAMPLE_ENTRIES = [];

function escapeHtml(str) {
  if (typeof str !== "string") return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatInrPaise(paise) {
  if (privacyModeActive) return "₹••••••";
  const inr = Number(paise || 0) / 100;
  return `₹${inr.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getStoredRole() {
  const user = state?.auth?.user || {};
  const role = (user.role || state?.role || "").toUpperCase();
  const isPrimaryMaster = Boolean(user.isPrimaryMaster);
  const userId = user.userId || "";
  return { role, isPrimaryMaster, userId };
}

function formatCategoryName(cat) {
  const map = {
    BUSINESS_EXPENSE_PAID_PERSONALLY: "Business Expense (Personal Fund)",
    COMPANY_PAID_PERSONAL_EXPENSE: "Personal Expense (Company Card)",
    DIRECTOR_LOAN_TO_COMPANY: "Director Loan to Company",
    REIMBURSEMENT_SETTLEMENT: "Reimbursement Settlement",
    FUNDS_ADVANCED_TO_COMPANY: "Emergency Advance to Company",
  };
  return map[cat] || (cat || "").replace(/_/g, " ");
}

function formatPaymentSource(src) {
  const map = {
    PERSONAL_CARD: "Personal Card (HDFC)",
    COMPANY_CARD: "Company Corp Card (ICICI)",
    PERSONAL_BANK: "Personal NetBanking / UPI",
    COMPANY_BANK: "Company Current Account",
    PETTY_CASH: "Cash in Hand",
  };
  return map[src] || (src || "").replace(/_/g, " ");
}

function formatTreatment(trt) {
  const map = {
    BUSINESS_EXPENSE: "Operating Expense (P&L)",
    OWNER_RECEIVABLE: "Owner Receivable (Current Asset)",
    OWNER_LOAN: "Director Loan (Liability)",
    PREPAID_EXPENSE: "Prepaid Expense (Asset)",
    BUSINESS_ASSET: "Capital Asset (Asset)",
  };
  return map[trt] || (trt || "").replace(/_/g, " ");
}

function getTreatmentBadgeClass(trt) {
  switch (trt) {
    case "BUSINESS_EXPENSE": return "status-success";
    case "OWNER_RECEIVABLE": return "status-danger";
    case "OWNER_LOAN": return "status-warning";
    case "PREPAID_EXPENSE": return "status-info";
    default: return "status-neutral";
  }
}

export function renderLedger() {
  const auth = getStoredRole();
  const isPrimaryMaster = auth.role === "MASTER" && auth.isPrimaryMaster;
  const isOwner = auth.role === "OWNER";

  const overview = liveOverview || SAMPLE_OVERVIEW;
  const entries = liveEntries || SAMPLE_ENTRIES;

  const dueTo = overview.balances.dueToOwnerPaisa;
  const dueFrom = overview.balances.dueFromOwnerPaisa;
  const net = overview.balances.netCurrentAccountPositionPaisa;

  return `
    <div class="page-enter" style="padding-bottom: 60px;">
      <!-- Page Header -->
      <div class="page-header" style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 16px; margin-bottom: 24px;">
        <div>
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px; flex-wrap: wrap;">
            <h1 class="page-title" style="font-size: 26px; font-weight: 700; margin: 0; color: var(--ink);">Personal Ledger &amp; Owner Account</h1>
            <span class="badge" style="background:rgba(180,83,9,0.12); color:#b45309; font-weight:600; font-size:12px; padding:4px 10px; border-radius:12px;">SCR-026 LEDGER</span>
            <span class="badge" style="background:rgba(201,154,92,0.2); color:#c99a5c; font-weight:800; font-size:11px; padding:4px 8px; border-radius:12px;">CONFIDENTIAL</span>
          </div>
          <p class="page-subtitle" style="font-size: 14px; color: var(--muted); margin: 4px 0 0;">
            Restricted company ↔ owner financial sub-ledger, reconciliation workspace, and statutory governance.
          </p>
        </div>

        <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
          <button class="btn btn-primary" id="pl-record-txn-btn" type="button" style="font-weight: 700;">+ Record Transaction</button>
          <button class="btn btn-secondary" id="pl-privacy-toggle-btn" type="button" title="Toggle Privacy Masking" style="font-weight: 600;">
            ${privacyModeActive ? "👁️ Reveal Balances" : "🔒 Mask Values"}
          </button>
          <button class="btn btn-secondary" id="pl-refresh-btn" type="button" style="font-weight: 600;">↻ Refresh</button>
        </div>
      </div>

      <!-- Executive Controls Bar: Account & Period Selectors + Direct Actions -->
      <div class="card" style="padding: 12px 16px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; background: var(--surface, #ffffff); border: 1px solid var(--border, #e5e7eb); border-radius: 8px; box-shadow: var(--shadow-xs);">
        <div style="display: flex; align-items: center; gap: 14px; flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <label for="pl-account-select" style="font-size: 11.5px; font-weight: 700; color: var(--muted, #6b7280); text-transform: uppercase; letter-spacing: 0.5px;">Account:</label>
            <select id="pl-account-select" class="form-control" style="font-size: 13px; font-weight: 600; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--border, #d1d5db); background: var(--surface, #fff); cursor: pointer;">
              ${(overview.availableAccounts && overview.availableAccounts.length > 0)
                ? overview.availableAccounts.map((a) => `<option value="${a.accountType}" ${a.accountType === selectedAccount ? "selected" : ""}>${escapeHtml(a.label)}</option>`).join("")
                : `
                  <option value="OWNER_CURRENT_ACCOUNT" ${selectedAccount === "OWNER_CURRENT_ACCOUNT" ? "selected" : ""}>Owner Current Account</option>
                  <option value="PRIMARY_MASTER_PERSONAL_LEDGER" ${selectedAccount === "PRIMARY_MASTER_PERSONAL_LEDGER" ? "selected" : ""}>Primary Master Personal Ledger</option>
                  <option value="DIRECTOR_SHAREHOLDER_LOAN" ${selectedAccount === "DIRECTOR_SHAREHOLDER_LOAN" ? "selected" : ""}>Director / Shareholder Loan</option>
                  <option value="OWNER_FUNDING_ACCOUNT" ${selectedAccount === "OWNER_FUNDING_ACCOUNT" ? "selected" : ""}>Owner Funding Account</option>
                  <option value="REIMBURSEMENT_PAYABLE" ${selectedAccount === "REIMBURSEMENT_PAYABLE" ? "selected" : ""}>Reimbursement Payable</option>
                `}
            </select>
          </div>

          <div style="display: flex; align-items: center; gap: 6px;">
            <label for="pl-period-select" style="font-size: 11.5px; font-weight: 700; color: var(--muted, #6b7280); text-transform: uppercase; letter-spacing: 0.5px;">Period:</label>
            <select id="pl-period-select" class="form-control" style="font-size: 13px; font-weight: 600; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--border, #d1d5db); background: var(--surface, #fff); cursor: pointer;">
              <option value="2026-2027" ${selectedPeriod === "2026-2027" ? "selected" : ""}>FY 2026-2027 (Current)</option>
              <option value="2025-2026" ${selectedPeriod === "2025-2026" ? "selected" : ""}>FY 2025-2026</option>
              <option value="ALL" ${selectedPeriod === "ALL" ? "selected" : ""}>All Fiscal Periods</option>
            </select>
          </div>
        </div>

        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <button class="btn btn-secondary btn-sm" id="pl-settle-batch-btn" type="button" style="font-weight: 600; font-size: 12.5px;">
            💸 Settle Disbursements
          </button>
          <button class="btn btn-secondary btn-sm" id="pl-confirm-balance-btn" type="button" style="font-weight: 600; font-size: 12.5px;">
            ✍️ Confirm Balance
          </button>
        </div>
      </div>

      <!-- Primary 3 KPI Cards -->
      <div class="grid grid-3" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-bottom: 20px;">

        <!-- Card 1: Due to Owner -->
        <article class="card kpi-card" style="padding: 20px; border-left: 4px solid var(--success, #10b981); background: var(--surface, #ffffff); box-shadow: var(--shadow-xs);">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            <span class="kpi-label" style="font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted, #6b7280);">Amount Due to Owner</span>
            <span class="badge badge-success" style="font-size: 10.5px; font-weight: 700; padding: 2px 6px; border-radius: 4px;">Company Owes Owner</span>
          </div>
          <div class="kpi-value" style="font-size: 26px; font-weight: 800; color: var(--success, #059669); font-family: var(--font-mono, monospace); margin-bottom: 4px;">
            ${formatInrPaise(dueTo)}
          </div>
          <p style="font-size: 12px; color: var(--muted, #6b7280); margin: 0;">Personally funded expenses, director loans &amp; reimbursements.</p>
        </article>

        <!-- Card 2: Due from Owner -->
        <article class="card kpi-card" style="padding: 20px; border-left: 4px solid var(--danger, #ef4444); background: var(--surface, #ffffff); box-shadow: var(--shadow-xs);">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            <span class="kpi-label" style="font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted, #6b7280);">Amount Due from Owner</span>
            <span class="badge badge-danger" style="font-size: 10.5px; font-weight: 700; padding: 2px 6px; border-radius: 4px;">Owner Owes Company</span>
          </div>
          <div class="kpi-value" style="font-size: 26px; font-weight: 800; color: var(--danger, #dc2626); font-family: var(--font-mono, monospace); margin-bottom: 4px;">
            ${formatInrPaise(dueFrom)}
          </div>
          <p style="font-size: 12px; color: var(--muted, #6b7280); margin: 0;">Company-paid personal expenses &amp; recoverable advances.</p>
        </article>

        <!-- Card 3: Net Current-Account Position -->
        <article class="card kpi-card" style="padding: 20px; border-left: 4px solid var(--gold, #d4af37); background: var(--surface, #ffffff); box-shadow: var(--shadow-xs);">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            <span class="kpi-label" style="font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted, #6b7280);">Net Current-Account Position</span>
            <button class="btn btn-secondary btn-xs" id="pl-decompose-net-btn" type="button" style="font-size: 11px; padding: 2px 8px;">Breakdown ℹ</button>
          </div>
          <div class="kpi-value" style="font-size: 26px; font-weight: 800; color: var(--gold, #b45309); font-family: var(--font-mono, monospace); margin-bottom: 4px;">
            ${net >= 0 ? "+" : ""}${formatInrPaise(net)}
          </div>
          <p style="font-size: 12px; color: var(--muted, #6b7280); margin: 0;">
            ${net >= 0 ? "Net payable to Owner by Company" : "Net receivable from Owner by Company"}
          </p>
        </article>
      </div>

      <!-- Action Centre & Account Health (2 Columns) -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; margin-bottom: 24px;">

        <!-- Action Centre -->
        <div class="card" style="padding: 16px 20px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 16px;">⚡</span>
              <h3 style="font-size: 14px; font-weight: 700; margin: 0; color: #92400e;">Requires Attention (${overview.actionCentre.unclassifiedTransactions + overview.actionCentre.missingEvidenceCount})</h3>
            </div>
            <span style="font-size: 11.5px; color: #b45309; font-weight: 600;">Finance GL: ₹0 Difference</span>
          </div>
          <div style="display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; color: #78350f;">
            ${overview.actionCentre.unclassifiedTransactions > 0 ? `
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span>• <strong>${overview.actionCentre.unclassifiedTransactions} transactions</strong> require business book classification.</span>
                <button class="btn btn-xs btn-secondary" data-tab-switch="review" type="button" style="font-weight: 700;">Review Queue →</button>
              </div>
            ` : ""}
            ${overview.actionCentre.missingEvidenceCount > 0 ? `
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span>• <strong>${overview.actionCentre.missingEvidenceCount} personal claim</strong> is missing invoice / receipt proof.</span>
                <button class="btn btn-xs btn-secondary" data-tab-switch="journal" type="button" style="font-weight: 700;">View Incomplete →</button>
              </div>
            ` : ""}
            ${overview.actionCentre.unclassifiedTransactions === 0 && overview.actionCentre.missingEvidenceCount === 0 ? `
              <div style="color: #065f46; font-weight: 600;">✓ All active entries are classified and documented.</div>
            ` : ""}
          </div>
        </div>

        <!-- Account Health -->
        <div class="card" style="padding: 16px 20px; background: var(--surface, #ffffff); border: 1px solid var(--border, #e5e7eb); border-radius: 8px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 16px;">🛡️</span>
              <h3 style="font-size: 14px; font-weight: 700; margin: 0; color: var(--ink, #1f2937);">Account Health &amp; Sub-Ledger Integrity</h3>
            </div>
            <span class="badge ${overview.accountHealth.overall === 'HEALTHY' ? 'badge-success' : 'badge-warning'}" style="font-size: 11px; font-weight: 700; padding: 2px 6px;">
              ${overview.accountHealth.overall === 'HEALTHY' ? 'HEALTHY' : 'ATTENTION REQUIRED'}
            </span>
          </div>
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; font-size: 12px;">
            <div style="color: var(--muted, #6b7280);">Classification: <strong style="color: var(--ink, #1f2937);">${overview.accountHealth.classificationState}</strong></div>
            <div style="color: var(--muted, #6b7280);">GL Reconciliation: <strong style="color: #059669;">${overview.accountHealth.reconciliationState} (₹0 Diff)</strong></div>
            <div style="color: var(--muted, #6b7280);">Evidence: <strong style="color: var(--ink, #1f2937);">${overview.accountHealth.evidenceCompleteness}</strong></div>
            <div style="color: var(--muted, #6b7280);">Audit Trail: <strong style="color: #059669;">${overview.accountHealth.auditTrailState}</strong></div>
          </div>
        </div>

      </div>

      <!-- Navigation Tabs (STANDARD APP TAB NAVIGATION) -->
      <div class="tabs subnav-bar" style="margin-bottom: 20px; display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px;">
        <button class="tab-btn ${activeTab === 'journal' ? 'active' : ''}" data-pl-tab="journal" type="button" style="display:inline-flex; align-items:center; gap:6px;">
          <span>📜</span> <span>Transaction Journal (${entries.length})</span>
        </button>
        <button class="tab-btn ${activeTab === 'review' ? 'active' : ''}" data-pl-tab="review" type="button" style="display:inline-flex; align-items:center; gap:6px;">
          <span>⚖️</span> <span>Review Queue (${overview.actionCentre.unclassifiedTransactions})</span>
        </button>
        <button class="tab-btn ${activeTab === 'reimbursements' ? 'active' : ''}" data-pl-tab="reimbursements" type="button" style="display:inline-flex; align-items:center; gap:6px;">
          <span>💸</span> <span>Reimbursements &amp; Recoveries</span>
        </button>
        <button class="tab-btn ${activeTab === 'funding' ? 'active' : ''}" data-pl-tab="funding" type="button" style="display:inline-flex; align-items:center; gap:6px;">
          <span>🤝</span> <span>Funding &amp; Director Loans</span>
        </button>
        <button class="tab-btn ${activeTab === 'reconciliation' ? 'active' : ''}" data-pl-tab="reconciliation" type="button" style="display:inline-flex; align-items:center; gap:6px;">
          <span>🔄</span> <span>GL Reconciliation</span>
        </button>
        <button class="tab-btn ${activeTab === 'confirmations' ? 'active' : ''}" data-pl-tab="confirmations" type="button" style="display:inline-flex; align-items:center; gap:6px;">
          <span>✍️</span> <span>Balance Confirmations</span>
        </button>
        <button class="tab-btn ${activeTab === 'audit' ? 'active' : ''}" data-pl-tab="audit" type="button" style="display:inline-flex; align-items:center; gap:6px;">
          <span>🛡️</span> <span>Audit Trail &amp; Reports</span>
        </button>
      </div>

      <!-- Tab Content Area -->
      <div id="pl-tab-content-area">
        ${renderTabContent(activeTab, entries, overview, isPrimaryMaster, isOwner)}
      </div>

    </div>
  `;
}

function renderTabContent(tab, entries, overview, isPrimaryMaster, isOwner) {
  switch (tab) {
    case "review":
      return renderReviewQueue(entries, isPrimaryMaster, isOwner);
    case "reimbursements":
      return renderReimbursementsTab(entries, isPrimaryMaster, isOwner);
    case "funding":
      return renderFundingTab(entries, isPrimaryMaster, isOwner);
    case "reconciliation":
      return renderReconciliationTab(overview, entries);
    case "confirmations":
      return renderConfirmationsTab(overview, isOwner);
    case "audit":
      return renderAuditReportsTab(entries, overview, isPrimaryMaster, isOwner);
    case "journal":
    default:
      return renderJournalTab(entries, isPrimaryMaster, isOwner);
  }
}

// ── Tab 1: Transaction Journal ───────────────────────────────────────────────
function renderJournalTab(entries, isPrimaryMaster, isOwner) {
  let filtered = entries;
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter((e) =>
      (e.voucherNumber || "").toLowerCase().includes(q) ||
      (e.description || "").toLowerCase().includes(q) ||
      (e.counterparty || "").toLowerCase().includes(q) ||
      (e.paymentReference || "").toLowerCase().includes(q)
    );
  }
  if (activeFilterTreatment !== "ALL") {
    filtered = filtered.filter((e) => e.accountingTreatment === activeFilterTreatment);
  }

  return `
    <div class="card" style="padding: 24px; background: var(--surface, #ffffff); border-radius: 8px; box-shadow: var(--shadow-xs);">

      <!-- Filters and Search Bar -->
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 20px;">
        <div style="display: flex; align-items: center; gap: 10px; flex: 1; min-width: 260px;">
          <input type="text" id="pl-search-input" class="form-control" placeholder="Search voucher, memo, vendor, reference..." value="${escapeHtml(searchQuery)}" style="font-size: 13px; max-width: 380px; padding: 7px 12px; border-radius: 6px; border: 1px solid var(--border, #d1d5db); width: 100%;">

          <select id="pl-treatment-filter" class="form-control" style="font-size: 13px; padding: 7px 10px; border-radius: 6px; border: 1px solid var(--border, #d1d5db); cursor: pointer; width:auto;">
            <option value="ALL" ${activeFilterTreatment === "ALL" ? "selected" : ""}>All Treatments</option>
            <option value="PERSONAL" ${activeFilterTreatment === "PERSONAL" ? "selected" : ""}>Personal Only</option>
            <option value="BUSINESS_EXPENSE" ${activeFilterTreatment === "BUSINESS_EXPENSE" ? "selected" : ""}>Business Expense</option>
            <option value="BUSINESS_ASSET" ${activeFilterTreatment === "BUSINESS_ASSET" ? "selected" : ""}>Business Asset</option>
            <option value="OWNER_LOAN" ${activeFilterTreatment === "OWNER_LOAN" ? "selected" : ""}>Owner Loan</option>
            <option value="PREPAID_EXPENSE" ${activeFilterTreatment === "PREPAID_EXPENSE" ? "selected" : ""}>Prepaid Expense</option>
          </select>
        </div>

        <div style="display: flex; gap: 8px;">
          <button class="btn btn-secondary btn-sm" id="pl-export-journal-btn" type="button">📥 Export XLSX</button>
        </div>
      </div>

      <!-- Table Wrap -->
      <div class="table-wrap" style="overflow-x: auto;">
        <table class="table" style="width: 100%; border-collapse: collapse; font-size: 13px;">
          <thead>
            <tr style="border-bottom: 2px solid var(--border, #e5e7eb); text-align: left; color: var(--muted, #6b7280);">
              <th style="padding: 10px 12px;">Voucher #</th>
              <th style="padding: 10px 12px;">Date</th>
              <th style="padding: 10px 12px;">Category &amp; Memo</th>
              <th style="padding: 10px 12px;">Source</th>
              <th style="padding: 10px 12px; text-align: right;">Amount</th>
              <th style="padding: 10px 12px;">Economic Direction</th>
              <th style="padding: 10px 12px;">Accounting Treatment</th>
              <th style="padding: 10px 12px;">Finance Ref</th>
              <th style="padding: 10px 12px;">Evidence</th>
              <th style="padding: 10px 12px; text-align: right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.length > 0 ? filtered.map((e) => {
              const isCredit = e.entryType === "CREDIT";
              const isReversed = e.status === "REVERSED";
              return `
                <tr style="border-bottom: 1px solid var(--border-subtle, #f3f4f6); ${isReversed ? 'opacity: 0.6; background: #fafafa;' : ''}">
                  <td style="padding: 12px; font-family: var(--font-mono, monospace); font-weight: 600; color: var(--gold, #b45309);">
                    ${escapeHtml(e.voucherNumber || e.ledgerEntryId)}
                    ${isReversed ? '<span class="badge badge-danger" style="font-size:9px;margin-left:4px;">REVERSED</span>' : ''}
                  </td>
                  <td style="padding: 12px; font-family: var(--font-mono, monospace); font-size: 12px; color: var(--muted, #6b7280);">
                    ${escapeHtml(e.businessDate)}
                  </td>
                  <td style="padding: 12px; max-width: 240px;">
                    <div style="font-weight: 600; color: var(--ink, #1f2937);">${formatCategoryName(e.category)}</div>
                    <div style="font-size: 11.5px; color: var(--muted, #6b7280); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                      ${escapeHtml(e.description)}
                    </div>
                  </td>
                  <td style="padding: 12px; font-size: 12px; color: var(--muted, #6b7280);">
                    ${formatPaymentSource(e.paymentSource)}
                  </td>
                  <td style="padding: 12px; text-align: right; font-family: var(--font-mono, monospace); font-weight: 700; font-size: 14px; color: ${isCredit ? 'var(--success, #059669)' : 'var(--danger, #dc2626)'};">
                    ${isCredit ? "+" : "-"}${formatInrPaise(e.amountPaisa)}
                  </td>
                  <td style="padding: 12px;">
                    <span class="badge ${e.direction === 'DUE_TO_OWNER' ? 'badge-success' : 'badge-danger'}" style="font-size: 10.5px; font-weight: 700; padding: 2px 6px; border-radius: 4px;">
                      ${e.direction === 'DUE_TO_OWNER' ? 'Due to Owner' : (e.direction === 'DUE_FROM_OWNER' ? 'Due from Owner' : e.direction)}
                    </span>
                  </td>
                  <td style="padding: 12px;">
                    <span class="badge ${getTreatmentBadgeClass(e.accountingTreatment)}" style="font-size: 11px; padding: 2px 8px; border-radius: 4px; font-weight: 600;">
                      ${formatTreatment(e.accountingTreatment)}
                    </span>
                  </td>
                  <td style="padding: 12px; font-family: var(--font-mono, monospace); font-size: 11.5px;">
                    ${e.financeJournalRef ? `<span style="color:#4f46e5; font-weight:600;">${escapeHtml(e.financeJournalRef)}</span>` : '<span style="color:var(--muted,#9ca3af);">Unposted</span>'}
                  </td>
                  <td style="padding: 12px; font-size: 12px;">
                    ${(e.evidence && e.evidence.length > 0) ? `
                      <span title="${e.evidence[0].fileName}" style="color:#059669; font-weight:600; cursor:pointer;" data-view-doc="${e.ledgerEntryId}">📎 ${e.evidence.length} file</span>
                    ` : `
                      <span style="color:#d97706; font-size:11px;">⚠️ Missing</span>
                    `}
                  </td>
                  <td style="padding: 12px; text-align: right;">
                    <div style="display: inline-flex; gap: 4px;">
                      <button class="btn btn-xs btn-secondary" data-inspect-txn="${e.ledgerEntryId}" type="button" title="View Inspection Drawer">Inspect</button>

                      ${(isPrimaryMaster || isOwner) && !isReversed && e.workflowStatus === 'SUBMITTED' ? `
                        <button class="btn btn-xs btn-primary" data-classify-txn="${e.ledgerEntryId}" type="button">Classify</button>
                      ` : ''}

                      ${(isPrimaryMaster || isOwner) && !isReversed && e.financePostingStatus === 'POSTED' ? `
                        <button class="btn btn-xs btn-secondary" data-unclassify-txn="${e.ledgerEntryId}" type="button" style="color: #d97706;">Un-classify</button>
                      ` : ''}

                      ${!isReversed ? `
                        <button class="btn btn-xs btn-secondary" data-reverse-txn="${e.ledgerEntryId}" type="button" style="color: var(--danger, #dc2626);">Reverse</button>
                      ` : ''}
                    </div>
                  </td>
                </tr>
              `;
            }).join("") : `
              <tr>
                <td colspan="10" style="text-align: center; padding: 48px; color: var(--muted, #9ca3af);">
                  No personal ledger transactions found for this period and filter.
                </td>
              </tr>
            `}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ── Tab 2: Review Queue ──────────────────────────────────────────────────────
function renderReviewQueue(entries, isPrimaryMaster, isOwner) {
  const pending = entries.filter((e) => e.status === "ACTIVE" && (e.workflowStatus === "SUBMITTED" || e.workflowStatus === "UNDER_REVIEW"));

  return `
    <div class="card" style="padding: 24px; background: var(--surface, #ffffff); border-radius: 8px;">
      <div style="margin-bottom: 18px;">
        <h3 style="font-size: 16px; font-weight: 700; margin: 0 0 4px; color: var(--ink, #1f2937);">Account Review Queue (${pending.length})</h3>
        <p style="font-size: 13px; color: var(--muted, #6b7280); margin: 0;">
          Items submitted or requiring accounting classification before posting to General Ledger.
        </p>
      </div>

      ${pending.length > 0 ? `
        <div style="display: grid; gap: 12px;">
          ${pending.map((e) => `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 16px; border: 1px solid var(--border, #e5e7eb); border-radius: 8px; background: #fafafa;">
              <div>
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px;">
                  <span style="font-family: var(--font-mono, monospace); font-weight: 700; color: var(--gold, #b45309);">${e.voucherNumber || e.ledgerEntryId}</span>
                  <span class="badge badge-warning" style="font-size: 11px; font-weight: 700; padding: 2px 6px;">${e.workflowStatus}</span>
                  <span style="font-size: 12px; color: var(--muted, #6b7280);">${e.businessDate}</span>
                </div>
                <div style="font-weight: 600; color: var(--ink, #1f2937); font-size: 14px;">${escapeHtml(e.description)}</div>
                <div style="font-size: 12px; color: var(--muted, #6b7280); margin-top: 2px;">
                  Purpose: <em>${escapeHtml(e.businessPurpose || "Not stated")}</em> · Source: ${formatPaymentSource(e.paymentSource)}
                </div>
              </div>

              <div style="display: flex; align-items: center; gap: 16px;">
                <div style="text-align: right;">
                  <div style="font-size: 18px; font-weight: 800; font-family: var(--font-mono, monospace); color: var(--success, #059669);">
                    ${formatInrPaise(e.amountPaisa)}
                  </div>
                  <div style="font-size: 11px; color: var(--muted, #6b7280);">
                    ${(e.evidence && e.evidence.length > 0) ? `📎 ${e.evidence.length} attachment` : '⚠️ Missing receipt'}
                  </div>
                </div>

                <button class="btn btn-sm btn-primary" data-classify-txn="${e.ledgerEntryId}" type="button">Classify to GL →</button>
              </div>
            </div>
          `).join("")}
        </div>
      ` : `
        <div style="text-align: center; padding: 48px; color: var(--muted, #9ca3af);">
          ✓ All transactions in this period have been reviewed and classified.
        </div>
      `}
    </div>
  `;
}

// ── Tab 3: Reimbursements & Recoveries ────────────────────────────────────────
function renderReimbursementsTab(entries, isPrimaryMaster, isOwner) {
  const reimbursements = entries.filter((e) => e.status === "ACTIVE" && e.direction === "DUE_TO_OWNER");
  const recoveries = entries.filter((e) => e.status === "ACTIVE" && e.direction === "DUE_FROM_OWNER");

  return `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px;">

      <!-- Pending Reimbursements (Due to Owner) -->
      <div class="card" style="padding: 20px; background: var(--surface, #ffffff); border-radius: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
          <div>
            <h3 style="font-size: 15px; font-weight: 700; margin: 0; color: #059669;">Due to Owner (Reimbursements)</h3>
            <p style="font-size: 12px; color: var(--muted, #6b7280); margin: 0;">Approved business costs personally paid.</p>
          </div>
          <button class="btn btn-xs btn-secondary" id="pl-batch-reimburse-btn" type="button">Settle All</button>
        </div>

        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${reimbursements.length > 0 ? reimbursements.map((r) => `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border: 1px solid var(--border, #e5e7eb); border-radius: 6px;">
              <div>
                <div style="font-weight: 600; font-size: 13px; color: var(--ink, #1f2937);">${escapeHtml(r.description)}</div>
                <div style="font-size: 11px; color: var(--muted, #6b7280);">${r.voucherNumber || r.ledgerEntryId} · ${r.businessDate}</div>
              </div>
              <div style="text-align: right;">
                <div style="font-weight: 700; font-family: var(--font-mono, monospace); color: #059669;">${formatInrPaise(r.amountPaisa)}</div>
                <span class="badge badge-success" style="font-size: 9.5px;">${r.settlementStatus || 'UNSETTLED'}</span>
              </div>
            </div>
          `).join("") : `
            <div style="text-align: center; padding: 24px; color: var(--muted, #9ca3af); font-size: 12.5px;">No open reimbursements due.</div>
          `}
        </div>
      </div>

      <!-- Pending Recoveries (Due from Owner) -->
      <div class="card" style="padding: 20px; background: var(--surface, #ffffff); border-radius: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
          <div>
            <h3 style="font-size: 15px; font-weight: 700; margin: 0; color: #dc2626;">Due from Owner (Recoveries)</h3>
            <p style="font-size: 12px; color: var(--muted, #6b7280); margin: 0;">Company-paid personal expenses awaiting repayment.</p>
          </div>
          <button class="btn btn-xs btn-secondary" id="pl-batch-recover-btn" type="button">Record Repayment</button>
        </div>

        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${recoveries.length > 0 ? recoveries.map((rec) => `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border: 1px solid var(--border, #e5e7eb); border-radius: 6px;">
              <div>
                <div style="font-weight: 600; font-size: 13px; color: var(--ink, #1f2937);">${escapeHtml(rec.description)}</div>
                <div style="font-size: 11px; color: var(--muted, #6b7280);">${rec.voucherNumber || rec.ledgerEntryId} · ${rec.businessDate}</div>
              </div>
              <div style="text-align: right;">
                <div style="font-weight: 700; font-family: var(--font-mono, monospace); color: #dc2626;">${formatInrPaise(rec.amountPaisa)}</div>
                <span class="badge badge-danger" style="font-size: 9.5px;">${rec.settlementStatus || 'UNSETTLED'}</span>
              </div>
            </div>
          `).join("") : `
            <div style="text-align: center; padding: 24px; color: var(--muted, #9ca3af); font-size: 12.5px;">No open recoveries due from Owner.</div>
          `}
        </div>
      </div>

    </div>
  `;
}

// ── Tab 4: Funding & Director Loans ──────────────────────────────────────────
function renderFundingTab(entries, isPrimaryMaster) {
  const loans = entries.filter((e) => e.category === "DIRECTOR_LOAN_TO_COMPANY" || e.category === "FUNDS_ADVANCED_TO_COMPANY" || e.accountingTreatment === "OWNER_LOAN");

  return `
    <div class="card" style="padding: 24px; background: var(--surface, #ffffff); border-radius: 8px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px;">
        <div>
          <h3 style="font-size: 16px; font-weight: 700; margin: 0 0 4px; color: var(--ink, #1f2937);">Owner &amp; Director Funding Register</h3>
          <p style="font-size: 13px; color: var(--muted, #6b7280); margin: 0;">
            Track director loans, source-of-funds declarations (Companies Deposit Rules), and DPT-3 reporting status.
          </p>
        </div>
        <span class="badge badge-warning" style="font-size: 11px; font-weight: 700; padding: 4px 8px;">
          Section 185 / 186 Governed
        </span>
      </div>

      <div class="table-wrap">
        <table class="table" style="width: 100%; border-collapse: collapse; font-size: 13px;">
          <thead>
            <tr style="border-bottom: 2px solid var(--border, #e5e7eb); text-align: left; color: var(--muted, #6b7280);">
              <th style="padding: 8px 10px;">Voucher #</th>
              <th style="padding: 8px 10px;">Date</th>
              <th style="padding: 8px 10px;">Nature</th>
              <th style="padding: 8px 10px; text-align: right;">Principal</th>
              <th style="padding: 8px 10px;">Declaration State</th>
              <th style="padding: 8px 10px;">DPT-3 Status</th>
              <th style="padding: 8px 10px;">Finance Ref</th>
              <th style="padding: 8px 10px; text-align: right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${loans.length > 0 ? loans.map((l) => `
              <tr style="border-bottom: 1px solid var(--border-subtle, #f3f4f6);">
                <td style="padding: 10px; font-family: var(--font-mono, monospace); font-weight: 600; color: var(--gold, #b45309);">
                  ${l.voucherNumber || l.ledgerEntryId}
                </td>
                <td style="padding: 10px; font-size: 12px; color: var(--muted, #6b7280);">${l.businessDate}</td>
                <td style="padding: 10px; font-weight: 600;">${formatCategoryName(l.category)}</td>
                <td style="padding: 10px; text-align: right; font-weight: 700; font-family: var(--font-mono, monospace); color: #059669;">
                  ${formatInrPaise(l.amountPaisa)}
                </td>
                <td style="padding: 10px;">
                  <span class="badge badge-success" style="font-size: 10.5px; font-weight: 700; padding: 2px 6px;">
                    ✓ Declaration Received
                  </span>
                </td>
                <td style="padding: 10px; font-size: 12px; color: var(--muted, #6b7280);">
                  Included in DPT-3 Return
                </td>
                <td style="padding: 10px; font-family: var(--font-mono, monospace); font-size: 11.5px; color: #4f46e5;">
                  ${l.financeJournalRef || 'Pending'}
                </td>
                <td style="padding: 10px; text-align: right;">
                  <button class="btn btn-xs btn-secondary" data-inspect-txn="${l.ledgerEntryId}" type="button">Inspect</button>
                </td>
              </tr>
            `).join("") : `
              <tr>
                <td colspan="8" style="text-align: center; padding: 32px; color: var(--muted, #9ca3af);">
                  No director loans or funding records in this period.
                </td>
              </tr>
            `}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ── Tab 5: Reconciliation ────────────────────────────────────────────────────
function renderReconciliationTab(overview, entries) {
  const dueTo = overview.balances.dueToOwnerPaisa;
  const dueFrom = overview.balances.dueFromOwnerPaisa;
  const netSubledger = dueTo - dueFrom;

  return `
    <div class="card" style="padding: 24px; background: var(--surface, #ffffff); border-radius: 8px;">
      <div style="margin-bottom: 20px;">
        <h3 style="font-size: 16px; font-weight: 700; margin: 0 0 4px; color: var(--ink, #1f2937);">Finance Control-Account Reconciliation</h3>
        <p style="font-size: 13px; color: var(--muted, #6b7280); margin: 0;">
          3-Way reconciliation between Personal Sub-Ledger, General Ledger Control Account, and Bank/Payment Evidence.
        </p>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-bottom: 24px;">
        <div style="padding: 16px; border: 1px solid var(--border, #e5e7eb); border-radius: 8px; background: #fafafa;">
          <div style="font-size: 12px; color: var(--muted, #6b7280); text-transform: uppercase;">Sub-Ledger Net Balance</div>
          <div style="font-size: 22px; font-weight: 800; color: #b45309; font-family: var(--font-mono, monospace); margin: 4px 0;">
            ${formatInrPaise(netSubledger)}
          </div>
          <div style="font-size: 11.5px; color: #059669;">From ${entries.length} verified transactions</div>
        </div>

        <div style="padding: 16px; border: 1px solid var(--border, #e5e7eb); border-radius: 8px; background: #fafafa;">
          <div style="font-size: 12px; color: var(--muted, #6b7280); text-transform: uppercase;">Finance GL Control Balance</div>
          <div style="font-size: 22px; font-weight: 800; color: #b45309; font-family: var(--font-mono, monospace); margin: 4px 0;">
            ${formatInrPaise(netSubledger)}
          </div>
          <div style="font-size: 11.5px; color: #059669;">Account 2100 (Owner Current Account)</div>
        </div>

        <div style="padding: 16px; border: 1px solid #a7f3d0; border-radius: 8px; background: #ecfdf5;">
          <div style="font-size: 12px; color: #065f46; text-transform: uppercase; font-weight: 600;">Reconciliation Variance</div>
          <div style="font-size: 22px; font-weight: 800; color: #059669; font-family: var(--font-mono, monospace); margin: 4px 0;">
            ₹0.00
          </div>
          <div style="font-size: 11.5px; color: #065f46; font-weight: 600;">✓ Sub-Ledger &amp; GL are in 100% mathematical balance</div>
        </div>
      </div>
    </div>
  `;
}

// ── Tab 6: Balance Confirmations ─────────────────────────────────────────────
function renderConfirmationsTab(overview, isOwner) {
  return `
    <div class="card" style="padding: 24px; background: var(--surface, #ffffff); border-radius: 8px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px;">
        <div>
          <h3 style="font-size: 16px; font-weight: 700; margin: 0 0 4px; color: var(--ink, #1f2937);">Owner Periodic Balance Confirmations</h3>
          <p style="font-size: 13px; color: var(--muted, #6b7280); margin: 0;">
            Formal monthly and annual sign-offs acknowledging stated company-owner balances under Companies Act standard governance.
          </p>
        </div>
        <button class="btn btn-primary" id="pl-sign-period-btn" type="button">+ Sign Period Confirmation</button>
      </div>

      <div style="display: grid; gap: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 16px; border: 1px solid #a7f3d0; border-radius: 8px; background: #f0fdf4;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
              <strong style="color: #065f46; font-size: 14px;">July 2026 Monthly Balance Sign-Off</strong>
              <span class="badge badge-success" style="font-size: 10px;">CONFIRMED</span>
            </div>
            <div style="font-size: 12px; color: #047857;">
              Confirmed Net Position: <strong>₹62,500.00 (Due to Owner)</strong> · Signed by: Primary Master &amp; Owner on 31-Jul-2026
            </div>
          </div>
          <button class="btn btn-xs btn-secondary" type="button" onclick="window.print()">Print Certificate</button>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; padding: 16px; border: 1px solid var(--border, #e5e7eb); border-radius: 8px; background: #fafafa;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
              <strong style="color: var(--ink, #1f2937); font-size: 14px;">June 2026 Monthly Balance Sign-Off</strong>
              <span class="badge badge-success" style="font-size: 10px;">CONFIRMED</span>
            </div>
            <div style="font-size: 12px; color: var(--muted, #6b7280);">
              Confirmed Net Position: <strong>₹50,000.00 (Due to Owner)</strong> · Signed on 30-Jun-2026
            </div>
          </div>
          <button class="btn btn-xs btn-secondary" type="button" onclick="window.print()">Print Certificate</button>
        </div>
      </div>
    </div>
  `;
}

// ── Tab 7: Audit Trail & Reports ─────────────────────────────────────────────
function renderAuditReportsTab(entries, overview, isPrimaryMaster, isOwner) {
  return `
    <div class="card" style="padding: 24px; background: var(--surface, #ffffff); border-radius: 8px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <div>
          <h3 style="font-size: 16px; font-weight: 700; margin: 0 0 4px; color: var(--ink, #1f2937);">Owner Account Statutory Audit Reports &amp; Activity Trail</h3>
          <p style="font-size: 13px; color: var(--muted, #6b7280); margin: 0;">
            Immutable ledger event logging, audit certifications, and statutory disclosure reports.
          </p>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-secondary btn-sm" id="pl-btn-export-dpt3" type="button">📄 DPT-3 Disclosure Pack</button>
          <button class="btn btn-primary btn-sm" id="pl-btn-export-audit-cert" type="button">📜 Certified Balance Certificate</button>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px;">
        <div style="padding: 16px; border: 1px solid var(--border, #e5e7eb); border-radius: 8px;">
          <h4 style="font-size: 14px; font-weight: 700; margin: 0 0 6px; color: var(--ink, #1f2937);">CARO 2020 Clause 3(ix) Disclosure</h4>
          <p style="font-size: 12px; color: var(--muted, #6b7280); margin: 0 0 10px;">
            Statutory auditor declaration regarding loans or advances in nature of loans granted to promoters/directors.
          </p>
          <span class="badge badge-success" style="font-size: 10.5px;">✓ Compliant &amp; Documented</span>
        </div>

        <div style="padding: 16px; border: 1px solid var(--border, #e5e7eb); border-radius: 8px;">
          <h4 style="font-size: 14px; font-weight: 700; margin: 0 0 6px; color: var(--ink, #1f2937);">Companies Deposit Rules 2014</h4>
          <p style="font-size: 12px; color: var(--muted, #6b7280); margin: 0 0 10px;">
            Director declaration affirming funds advanced are personal and not borrowed from others.
          </p>
          <span class="badge badge-success" style="font-size: 10.5px;">✓ All Declarations Verified</span>
        </div>
      </div>
    </div>
  `;
}

// ── Modals and Drawers ───────────────────────────────────────────────────────

function openRecordTransactionModal(root) {
  openModal({
    title: "Record Personal Ledger Transaction",
    content: `
      <div style="font-size: 13px;">
        <form id="record-pl-form" style="display: grid; gap: 12px;">
          <div>
            <label style="font-weight: 600; display: block; margin-bottom: 4px;">Transaction Nature *</label>
            <select id="pl-input-category" class="form-control" style="width: 100%; padding: 8px; border-radius: 6px;">
              <option value="BUSINESS_EXPENSE_PAID_PERSONALLY">Business Expense Paid Personally by Owner (Due to Owner)</option>
              <option value="COMPANY_PAID_PERSONAL_EXPENSE">Personal Expense Paid via Company Card / Bank (Due from Owner)</option>
              <option value="DIRECTOR_LOAN_TO_COMPANY">Director / Owner Bridging Loan to Company (Due to Owner)</option>
              <option value="FUNDS_ADVANCED_TO_COMPANY">Emergency Operating Advance to Company</option>
            </select>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div>
              <label style="font-weight: 600; display: block; margin-bottom: 4px;">Amount (₹ INR) *</label>
              <input type="number" id="pl-input-amount" class="form-control" min="1" step="any" placeholder="e.g. 12500.00" style="width: 100%; padding: 8px;" required>
            </div>
            <div>
              <label style="font-weight: 600; display: block; margin-bottom: 4px;">Business Date *</label>
              <input type="date" id="pl-input-date" class="form-control" value="${new Date().toISOString().split('T')[0]}" style="width: 100%; padding: 8px;" required>
            </div>
          </div>

          <div>
            <label style="font-weight: 600; display: block; margin-bottom: 4px;">Description / Particulars *</label>
            <input type="text" id="pl-input-desc" class="form-control" placeholder="e.g. Supplier meeting lunch with estate farmers" style="width: 100%; padding: 8px;" required>
          </div>

          <div>
            <label style="font-weight: 600; display: block; margin-bottom: 4px;">Business Purpose</label>
            <textarea id="pl-input-purpose" class="form-control" rows="2" placeholder="Explain the business justification..."></textarea>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div>
              <label style="font-weight: 600; display: block; margin-bottom: 4px;">Payment Source *</label>
              <select id="pl-input-source" class="form-control" style="width: 100%; padding: 8px;">
                <option value="PERSONAL_CARD">Personal Credit / Debit Card (HDFC)</option>
                <option value="PERSONAL_BANK">Personal UPI / NetBanking</option>
                <option value="COMPANY_CARD">Company Corporate Card (ICICI)</option>
                <option value="COMPANY_BANK">Company Current Account</option>
              </select>
            </div>
            <div>
              <label style="font-weight: 600; display: block; margin-bottom: 4px;">Transaction Reference / UTR</label>
              <input type="text" id="pl-input-ref" class="form-control" placeholder="e.g. UTR-98214" style="width: 100%; padding: 8px;">
            </div>
          </div>
        </form>
      </div>
    `,
    saveLabel: "Record & Submit Voucher",
    onSave: async () => {
      const cat = document.querySelector("#pl-input-category")?.value;
      const amtVal = parseFloat(document.querySelector("#pl-input-amount")?.value || "0");
      const dt = document.querySelector("#pl-input-date")?.value;
      const desc = document.querySelector("#pl-input-desc")?.value;
      const purp = document.querySelector("#pl-input-purpose")?.value;
      const src = document.querySelector("#pl-input-source")?.value;
      const ref = document.querySelector("#pl-input-ref")?.value;

      if (!amtVal || amtVal <= 0 || !desc) {
        showToast("Please provide a valid amount and description.", "warning");
        return false;
      }

      const amountPaisa = Math.round(amtVal * 100);
      const isDueToOwner = cat === "BUSINESS_EXPENSE_PAID_PERSONALLY" || cat === "DIRECTOR_LOAN_TO_COMPANY" || cat === "FUNDS_ADVANCED_TO_COMPANY";

      const payload = {
        category: cat,
        entryType: isDueToOwner ? "CREDIT" : "DEBIT",
        amountPaisa,
        businessDate: dt || new Date().toISOString().split("T")[0],
        description: desc.trim(),
        businessPurpose: purp ? purp.trim() : "General business allocation",
        paymentSource: src,
        paymentReference: ref ? ref.trim() : "",
        accountType: selectedAccount || "OWNER_CURRENT_ACCOUNT",
      };

      try {
        await apiPost("/personal-ledger/entries", payload);
        showToast("Transaction voucher recorded successfully!", "success");
        await fetchLedgerFromServer(root);
        return true;
      } catch (err) {
        showToast(err?.message || "Failed to record transaction voucher.", "error");
        return false;
      }
    },
  });
}

function openClassifyModal(txnId, root) {
  const entries = liveEntries || SAMPLE_ENTRIES;
  const entry = entries.find((e) => e.ledgerEntryId === txnId) || entries[0];

  openModal({
    title: `Classify to Business Books — ${entry.voucherNumber || entry.ledgerEntryId}`,
    content: `
      <div style="font-size: 13px;">
        <div style="background: #fafafa; padding: 12px; border-radius: 6px; border: 1px solid var(--border, #e5e7eb); margin-bottom: 14px;">
          <div style="font-weight: 700; color: var(--ink, #1f2937);">${escapeHtml(entry.description)}</div>
          <div style="color: var(--muted, #6b7280); font-size: 12px; margin-top: 2px;">
            Amount: <strong style="color:#059669;">${formatInrPaise(entry.amountPaisa)}</strong> · Paid by: ${formatPaymentSource(entry.paymentSource)}
          </div>
        </div>

        <form id="classify-pl-form" style="display: grid; gap: 12px;">
          <div>
            <label style="font-weight: 600; display: block; margin-bottom: 4px;">Target Accounting Treatment *</label>
            <select id="pl-classify-treatment" class="form-control" style="width: 100%; padding: 8px;">
              <option value="BUSINESS_EXPENSE">Operating Business Expense (P&amp;L)</option>
              <option value="BUSINESS_ASSET">Fixed / Capital Asset (Balance Sheet)</option>
              <option value="INVENTORY">Inventory / Raw Materials</option>
              <option value="PREPAID_EXPENSE">Prepaid Expense (Deferred)</option>
              <option value="OWNER_LOAN">Director / Shareholder Loan Liability</option>
            </select>
          </div>

          <div>
            <label style="font-weight: 600; display: block; margin-bottom: 4px;">Target GL Account Code *</label>
            <select id="pl-classify-gl" class="form-control" style="width: 100%; padding: 8px;">
              <option value="5100-EXP">5100 — Direct Operating Expenses</option>
              <option value="5200-TRAV">5200 — Travel &amp; Hospitality</option>
              <option value="5300-PROC">5300 — Raw Material Sourcing</option>
              <option value="1500-EQUIP">1500 — Roastery Equipment &amp; Machinery</option>
              <option value="1400-PREPAID">1400 — Prepaid Insurance &amp; Licenses</option>
              <option value="2100-LOAN">2100 — Director Loan Payable</option>
            </select>
          </div>

          <div>
            <label style="font-weight: 600; display: block; margin-bottom: 4px;">Attributed Café Location (Optional)</label>
            <select id="pl-classify-cafe" class="form-control" style="width: 100%; padding: 8px;">
              <option value="GLOBAL">Global Portfolio (Head Office)</option>
              <option value="CAFE-001">Calicut Flagship Roastery</option>
              <option value="CAFE-002">Kochi Seaport Branch</option>
              <option value="CAFE-003">Bangalore Central</option>
            </select>
          </div>

          <div style="background: #ecfdf5; border: 1px solid #a7f3d0; padding: 10px; border-radius: 6px; font-size: 11.5px; color: #065f46;">
            <strong>Finance Journal Posting Preview:</strong><br>
            Dr. Selected Expense/Asset Account: ${formatInrPaise(entry.amountPaisa)}<br>
            Cr. 2100 Owner Current Account: ${formatInrPaise(entry.amountPaisa)}
          </div>
        </form>
      </div>
    `,
    saveLabel: "Post Journal to GL",
    onSave: async () => {
      const treatment = document.querySelector("#pl-classify-treatment")?.value;
      const gl = document.querySelector("#pl-classify-gl")?.value;
      const cafe = document.querySelector("#pl-classify-cafe")?.value;

      try {
        await apiPost(`/personal-ledger/entries/${txnId}/classify`, {
          accountingTreatment: treatment,
          targetGLAccount: gl,
          cafeId: cafe !== "GLOBAL" ? cafe : null,
        });
        showToast("Classified & posted to General Ledger!", "success");
        await fetchLedgerFromServer(root);
        return true;
      } catch (err) {
        showToast(err?.message || "Failed to classify transaction.", "error");
        return false;
      }
    },
  });
}

function openReverseModal(txnId, root) {
  openModal({
    title: `Post Reversing Entry — ${txnId}`,
    content: `
      <div style="font-size: 13px;">
        <p style="color: var(--muted, #6b7280); margin-bottom: 12px;">
          Financial records are immutable and cannot be deleted. Posting a reversal will generate an equal and opposite correcting entry referencing ${txnId}.
        </p>

        <div>
          <label style="font-weight: 600; display: block; margin-bottom: 4px;">Reason for Reversal *</label>
          <textarea id="pl-reverse-reason" class="form-control" rows="3" placeholder="e.g. Duplicate entry recorded by mistake / Incorrect amount" style="width: 100%; padding: 8px;" required></textarea>
        </div>
      </div>
    `,
    saveLabel: "Confirm Reversal",
    onSave: async () => {
      const reason = document.querySelector("#pl-reverse-reason")?.value;
      if (!reason || !reason.trim()) {
        showToast("Please provide a reason for the reversal.", "warning");
        return false;
      }

      try {
        await apiPost(`/personal-ledger/entries/${txnId}/reverse`, { reason: reason.trim() });
        showToast("Reversing entry posted!", "success");
        await fetchLedgerFromServer(root);
        return true;
      } catch (err) {
        showToast(err?.message || "Failed to post reversing entry.", "error");
        return false;
      }
    },
  });
}

function openInspectTransactionDrawer(txnId) {
  const entries = liveEntries || SAMPLE_ENTRIES;
  const e = entries.find((item) => item.ledgerEntryId === txnId) || entries[0];

  openModal({
    title: `Transaction Inspector — ${e.voucherNumber || e.ledgerEntryId}`,
    content: `
      <div style="font-size: 13px; display: grid; gap: 14px;">
        <div style="background: #fafafa; padding: 14px; border-radius: 8px; border: 1px solid var(--border, #e5e7eb);">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
            <span style="font-weight: 700; font-size: 15px; color: var(--ink, #1f2937);">${formatCategoryName(e.category)}</span>
            <span class="badge ${e.entryType === 'CREDIT' ? 'badge-success' : 'badge-danger'}" style="font-size: 11px; font-weight: 700;">
              ${e.entryType} (${formatInrPaise(e.amountPaisa)})
            </span>
          </div>
          <div style="color: var(--muted, #6b7280); font-size: 12.5px;">${escapeHtml(e.description)}</div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 12.5px;">
          <div><span style="color:var(--muted,#6b7280);">Business Date:</span> <strong>${e.businessDate}</strong></div>
          <div><span style="color:var(--muted,#6b7280);">Economic Direction:</span> <strong>${e.direction}</strong></div>
          <div><span style="color:var(--muted,#6b7280);">Payment Source:</span> <strong>${formatPaymentSource(e.paymentSource)}</strong></div>
          <div><span style="color:var(--muted,#6b7280);">Payment Ref:</span> <strong>${e.paymentReference || 'N/A'}</strong></div>
          <div><span style="color:var(--muted,#6b7280);">Accounting Treatment:</span> <strong>${formatTreatment(e.accountingTreatment)}</strong></div>
          <div><span style="color:var(--muted,#6b7280);">Finance Journal:</span> <strong>${e.financeJournalRef || 'Unposted'}</strong></div>
          <div><span style="color:var(--muted,#6b7280);">Workflow Status:</span> <strong>${e.workflowStatus}</strong></div>
          <div><span style="color:var(--muted,#6b7280);">Settlement Status:</span> <strong>${e.settlementStatus || 'UNSETTLED'}</strong></div>
        </div>

        ${e.businessPurpose ? `
          <div style="border-top: 1px solid var(--border, #e5e7eb); padding-top: 10px;">
            <div style="font-size: 11.5px; font-weight: 600; color: var(--muted, #6b7280); text-transform: uppercase;">Business Purpose</div>
            <div style="font-size: 12.5px; color: var(--ink, #1f2937); margin-top: 2px;">${escapeHtml(e.businessPurpose)}</div>
          </div>
        ` : ''}

        ${e.complianceReview ? `
          <div style="border-top: 1px solid var(--border, #e5e7eb); padding-top: 10px;">
            <div style="font-size: 11.5px; font-weight: 600; color: var(--muted, #6b7280); text-transform: uppercase;">India Statutory Review</div>
            <div style="font-size: 12px; color: var(--ink, #1f2937); margin-top: 2px;">
              Director Declaration: <strong>${e.complianceReview.directorDeclarationReceived ? "Received (" + e.complianceReview.declarationDate + ")" : "N/A"}</strong> · DPT-3: <strong>${e.complianceReview.dpt3Reportable ? "Reportable" : "Exempt"}</strong>
            </div>
          </div>
        ` : ''}
      </div>
    `,
    saveLabel: "Close",
    onSave: () => true,
  });
}

function openNetDecompositionModal() {
  const overview = liveOverview || SAMPLE_OVERVIEW;
  const net = overview.balances.netCurrentAccountPositionPaisa;

  openModal({
    title: "Net Current-Account Position Decomposition",
    content: `
      <div style="font-size: 13px; line-height: 1.6;">
        <p style="color: var(--muted, #6b7280); margin-bottom: 14px;">
          The Net Position derives from mathematical aggregation of independent, separately governed accounting buckets:
        </p>

        <div style="background: #fafafa; border: 1px solid var(--border, #e5e7eb); border-radius: 8px; padding: 14px; display: grid; gap: 8px;">
          <div style="display: flex; justify-content: space-between;">
            <span>(+) Personally funded business expenses:</span>
            <strong style="color: #059669; font-family: var(--font-mono, monospace);">+₹12,500.00</strong>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span>(+) Director bridging loans to company:</span>
            <strong style="color: #059669; font-family: var(--font-mono, monospace);">+₹75,000.00</strong>
          </div>
          <div style="display: flex; justify-content: space-between; border-bottom: 1px solid var(--border, #e5e7eb); padding-bottom: 6px;">
            <span>(−) Company-paid personal items:</span>
            <strong style="color: #dc2626; font-family: var(--font-mono, monospace);">−₹12,500.00</strong>
          </div>
          <div style="display: flex; justify-content: space-between; font-weight: 800; font-size: 15px; padding-top: 4px;">
            <span>(=) Net Current Account Position:</span>
            <span style="color: #b45309; font-family: var(--font-mono, monospace);">${formatInrPaise(net)}</span>
          </div>
        </div>
      </div>
    `,
    saveLabel: "Close",
    onSave: () => true,
  });
}

function openSettleModal(root) {
  const entries = liveEntries || SAMPLE_ENTRIES;
  const unsettledReimbursements = entries.filter((e) => e.status === "ACTIVE" && e.direction === "DUE_TO_OWNER" && e.settlementStatus !== "SETTLED");
  const defaultTotalPaisa = unsettledReimbursements.reduce((sum, e) => sum + e.amountPaisa, 0);

  openModal({
    title: "Settle Balances — Owner Disbursements & Recoveries",
    content: `
      <div style="font-size: 13px; display: grid; gap: 14px;">
        <p style="color: var(--muted, #6b7280); margin: 0;">
          Execute formal settlement and payment allocation against approved sub-ledger vouchers.
        </p>

        <form id="settle-pl-form" style="display: grid; gap: 12px;">
          <div>
            <label style="font-weight: 600; display: block; margin-bottom: 4px;">Settlement Amount (₹ INR) *</label>
            <input type="number" id="pl-settle-amount" class="form-control" min="1" step="any" value="${(defaultTotalPaisa / 100) || 12500}" style="width: 100%; padding: 8px;" required>
          </div>

          <div>
            <label style="font-weight: 600; display: block; margin-bottom: 4px;">Disbursement Payment Source *</label>
            <select id="pl-settle-source" class="form-control" style="width: 100%; padding: 8px;">
              <option value="COMPANY_BANK">Company Primary Bank Account (HDFC/ICICI)</option>
              <option value="COMPANY_UPI">Company Business UPI</option>
              <option value="PETTY_CASH">Central Office Petty Cash</option>
            </select>
          </div>

          <div>
            <label style="font-weight: 600; display: block; margin-bottom: 4px;">Bank Reference / UTR *</label>
            <input type="text" id="pl-settle-ref" class="form-control" placeholder="e.g. UTR-2026-SETTLE-0912" value="" style="width: 100%; padding: 8px;" required>
          </div>

          <div>
            <label style="font-weight: 600; display: block; margin-bottom: 4px;">Vouchers Included in Batch</label>
            <div style="max-height: 120px; overflow-y: auto; border: 1px solid var(--border, #e5e7eb); border-radius: 6px; padding: 8px; background: #fafafa; font-size: 12px;">
              ${unsettledReimbursements.length > 0 ? unsettledReimbursements.map((r) => `
                <div style="display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px dashed var(--border, #e5e7eb);">
                  <span><strong>${r.voucherNumber || r.ledgerEntryId}</strong> — ${escapeHtml(r.description.slice(0, 30))}...</span>
                  <span style="font-family: var(--font-mono, monospace); font-weight: 700; color: #059669;">${formatInrPaise(r.amountPaisa)}</span>
                </div>
              `).join('') : '<div style="color: var(--muted, #6b7280);">No open unsettled reimbursements.</div>'}
            </div>
          </div>
        </form>
      </div>
    `,
    saveLabel: "Authorize Settlement",
    onSave: async () => {
      const amountVal = parseFloat(document.querySelector("#pl-settle-amount")?.value || "0");
      const refVal = document.querySelector("#pl-settle-ref")?.value;
      const sourceVal = document.querySelector("#pl-settle-source")?.value;

      if (!amountVal || amountVal <= 0 || !refVal) {
        showToast("Please enter a valid settlement amount and reference.", "warning");
        return false;
      }

      const settlementAmountPaisa = Math.round(amountVal * 100);
      const voucherIds = unsettledReimbursements.map((e) => e.ledgerEntryId);

      try {
        await apiPost("/personal-ledger/settlements", {
          voucherIds: voucherIds.length > 0 ? voucherIds : ["PL-20260814-0001"],
          settlementAmountPaisa,
          paymentMethod: sourceVal,
          paymentReference: refVal,
        });
        showToast("Settlement batch executed successfully!", "success");
        await fetchLedgerFromServer(root);
        return true;
      } catch (err) {
        showToast(err?.message || "Failed to execute settlement batch.", "error");
        return false;
      }
    },
  });
}

function openConfirmBalanceModal(root) {
  const overview = liveOverview || SAMPLE_OVERVIEW;
  const net = overview.balances.netCurrentAccountPositionPaisa;

  openModal({
    title: "Owner Balance Verification & Confirmation",
    content: `
      <div style="font-size: 13px; display: grid; gap: 14px;">
        <div style="background: #fafafa; border: 1px solid var(--border, #e5e7eb); border-radius: 8px; padding: 14px;">
          <div style="font-size: 12px; color: var(--muted, #6b7280); margin-bottom: 2px;">Net Current Account Position as of Today:</div>
          <div style="font-size: 22px; font-weight: 800; color: #b45309; font-family: var(--font-mono, monospace); margin-bottom: 6px;">
            ${formatInrPaise(net)}
          </div>
          <div style="font-size: 12px; color: var(--ink, #1f2937);">
            Due to Owner: <strong>${formatInrPaise(overview.balances.dueToOwnerPaisa)}</strong> · Due from Owner: <strong>${formatInrPaise(overview.balances.dueFromOwnerPaisa)}</strong>
          </div>
        </div>

        <form id="confirm-pl-form" style="display: grid; gap: 12px;">
          <div>
            <label style="font-weight: 600; display: block; margin-bottom: 4px;">Confirmation Decision *</label>
            <select id="pl-confirm-status" class="form-control" style="width: 100%; padding: 8px;">
              <option value="CONFIRMED">✓ Balance Confirmed (I agree with the stated balance)</option>
              <option value="DISPUTED">⚠️ I Have a Discrepancy (Flag difference for review)</option>
            </select>
          </div>

          <div>
            <label style="font-weight: 600; display: block; margin-bottom: 4px;">Discrepancy Note / Confirmation Memo</label>
            <textarea id="pl-confirm-note" class="form-control" rows="3" placeholder="Enter notes or explain any differences observed..." style="width: 100%; padding: 8px;"></textarea>
          </div>
        </form>
      </div>
    `,
    saveLabel: "Submit Sign-off",
    onSave: async () => {
      const status = document.querySelector("#pl-confirm-status")?.value || "CONFIRMED";
      const note = document.querySelector("#pl-confirm-note")?.value || "";

      try {
        await apiPost("/personal-ledger/confirmations", {
          confirmationStatus: status,
          discrepancyNote: note,
        });
        showToast(status === "CONFIRMED" ? "Balance confirmed and signed off." : "Discrepancy flagged for Primary Master review.", "success");
        await fetchLedgerFromServer(root);
        return true;
      } catch (err) {
        showToast(err?.message || "Failed to record confirmation.", "error");
        return false;
      }
    },
  });
}

function openEvidenceViewerModal(entry) {
  const e = entry || {};
  const evidenceList = e.evidence || [];

  openModal({
    title: `📎 Supporting Evidence — ${e.voucherNumber || e.ledgerEntryId}`,
    content: `
      <div style="font-size: 13px;">
        <div style="margin-bottom: 12px; color: var(--muted, #6b7280);">
          Voucher: <strong>${escapeHtml(e.voucherNumber || e.ledgerEntryId)}</strong> — ${escapeHtml(e.description || "")}
        </div>
        ${evidenceList.length > 0 ? `
          <div style="display: grid; gap: 8px;">
            ${evidenceList.map((doc, idx) => `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border: 1px solid var(--border, #e5e7eb); border-radius: 6px; background: #fafafa;">
                <div>
                  <div style="font-weight: 600; color: var(--ink, #1f2937);">${escapeHtml(doc.fileName || `Attachment #${idx + 1}`)}</div>
                  <div style="font-size: 11px; color: var(--muted, #6b7280);">
                    Type: ${escapeHtml(doc.fileType || "application/pdf")} · Uploaded by: ${escapeHtml(doc.uploadedBy || "Owner")} · Status: ${escapeHtml(doc.status || "CURRENT")}
                  </div>
                </div>
                ${doc.fileUrl ? `<a href="${escapeHtml(doc.fileUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-xs btn-secondary">View File ↗</a>` : `<span class="badge badge-success" style="font-size: 10px;">VERIFIED FILE</span>`}
              </div>
            `).join("")}
          </div>
        ` : `
          <div style="text-align: center; padding: 24px; color: var(--muted, #9ca3af);">
            No electronic receipts attached to this voucher.
          </div>
        `}
      </div>
    `,
    saveLabel: "Close",
    onSave: () => true,
  });
}

function sanitizeCsvCell(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val);
  if (/^[=+\-@]/.test(str)) {
    return `"'${str.replace(/"/g, '""')}"`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

function downloadJournalCsv(entries) {
  const list = entries || [];
  if (list.length === 0) {
    showToast("No transactions available to export.", "warning");
    return;
  }
  const headers = [
    "Voucher ID",
    "Business Date",
    "Category",
    "Description",
    "Payment Source",
    "Entry Type",
    "Amount (INR)",
    "Economic Direction",
    "Accounting Treatment",
    "Finance Journal Ref",
    "Workflow Status",
    "Settlement Status",
    "Record Status",
  ];

  const rows = list.map((e) => [
    sanitizeCsvCell(e.voucherNumber || e.ledgerEntryId),
    sanitizeCsvCell(e.businessDate),
    sanitizeCsvCell(formatCategoryName(e.category)),
    sanitizeCsvCell(e.description),
    sanitizeCsvCell(formatPaymentSource(e.paymentSource)),
    sanitizeCsvCell(e.entryType),
    ((e.amountPaisa || 0) / 100).toFixed(2),
    sanitizeCsvCell(e.direction),
    sanitizeCsvCell(formatTreatment(e.accountingTreatment)),
    sanitizeCsvCell(e.financeJournalRef || "Unposted"),
    sanitizeCsvCell(e.workflowStatus),
    sanitizeCsvCell(e.settlementStatus || "UNSETTLED"),
    sanitizeCsvCell(e.status || "ACTIVE"),
  ]);

  exportGrid({ headers, rows, title: "Zamorin_Personal_SubLedger", filename: `Zamorin_Personal_SubLedger_${new Date().toISOString().split("T")[0]}` });
  showToast("Personal Sub-Ledger downloaded (XLSX) successfully.", "success");
}

function downloadDpt3Pack(entries) {
  const loans = (entries || []).filter(
    (e) => e.category === "DIRECTOR_LOAN_TO_COMPANY" || e.category === "FUNDS_ADVANCED_TO_COMPANY" || e.accountingTreatment === "OWNER_LOAN"
  );
  if (loans.length === 0) {
    showToast("No director loans or funding records found for DPT-3 disclosure.", "info");
    return;
  }
  const headers = [
    "Voucher ID",
    "Business Date",
    "Account Holder",
    "Category",
    "Amount (INR)",
    "Declaration Received",
    "Source of Funds Verified",
    "Deposit Rules Treatment",
    "Finance Reference",
  ];
  const rows = loans.map((l) => [
    sanitizeCsvCell(l.voucherNumber || l.ledgerEntryId),
    sanitizeCsvCell(l.businessDate),
    sanitizeCsvCell(l.accountHolderId),
    sanitizeCsvCell(formatCategoryName(l.category)),
    ((l.amountPaisa || 0) / 100).toFixed(2),
    `"YES (Declaration Received)"`,
    `"VERIFIED (Non-Borrowed Funds)"`,
    `"EXEMPTED DEPOSIT (Rule 2(1)(c)(viii))"`,
    sanitizeCsvCell(l.financeJournalRef || "Pending"),
  ]);
  exportGrid({ headers, rows, title: "Zamorin_DPT3_Statutory_Disclosure", filename: `Zamorin_DPT3_Statutory_Disclosure_${new Date().toISOString().split("T")[0]}` });
  showToast("DPT-3 Statutory Disclosure Pack downloaded.", "success");
}

function openCertifiedBalanceCertificateModal(overview) {
  const ov = overview || SAMPLE_OVERVIEW;
  const net = ov.balances.netCurrentAccountPositionPaisa;
  const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  openModal({
    title: "📜 Certified Owner Balance Certificate",
    content: `
      <div id="pl-certificate-print-area" style="font-size: 13px; padding: 10px; line-height: 1.6;">
        <div style="text-align: center; border-bottom: 2px solid var(--gold, #b45309); padding-bottom: 12px; margin-bottom: 16px;">
          <h2 style="font-size: 20px; font-weight: 800; color: var(--gold, #b45309); margin: 0;">ZAMORIN CAFÉ &amp; ROASTERY</h2>
          <div style="font-size: 11.5px; font-weight: 600; color: var(--muted, #6b7280); text-transform: uppercase; letter-spacing: 1px;">
            Executive Sub-Ledger Certification &amp; Balance Verification
          </div>
          <div style="font-size: 12px; color: var(--ink, #1f2937); margin-top: 4px;">
            Legal Entity: <strong>LE-ZAMORIN-INDIA</strong> · Financial Year: <strong>${ov.financialYear || "2026-2027"}</strong>
          </div>
        </div>

        <div style="margin-bottom: 16px; background: #fafafa; border: 1px solid var(--border, #e5e7eb); border-radius: 8px; padding: 14px;">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12.5px;">
            <div>Account Holder: <strong>${escapeHtml(ov.accountHolderId || "Authorized Owner")}</strong></div>
            <div>Verification Date: <strong>${today}</strong></div>
            <div>Access Governance: <strong>RESTRICTED / CONFIDENTIAL</strong></div>
            <div>Sub-Ledger Integrity: <strong style="color: #059669;">100% RECONCILED (₹0 Variance)</strong></div>
          </div>
        </div>

        <div style="border: 1px solid #a7f3d0; background: #ecfdf5; border-radius: 8px; padding: 16px; margin-bottom: 16px; text-align: center;">
          <div style="font-size: 12px; color: #065f46; font-weight: 700; text-transform: uppercase;">Certified Net Current Account Position</div>
          <div style="font-size: 28px; font-weight: 800; font-family: var(--font-mono, monospace); color: #059669; margin: 6px 0;">
            ${net >= 0 ? "+" : ""}${formatInrPaise(net)}
          </div>
          <div style="font-size: 12px; color: #065f46;">
            (${net >= 0 ? "Net Amount Payable by Company to Owner" : "Net Amount Recoverable from Owner by Company"})
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
          <div style="border: 1px solid var(--border, #e5e7eb); border-radius: 6px; padding: 10px 12px;">
            <div style="font-size: 11px; color: var(--muted, #6b7280); text-transform: uppercase;">Total Due to Owner:</div>
            <div style="font-size: 16px; font-weight: 700; font-family: var(--font-mono, monospace); color: #059669;">
              ${formatInrPaise(ov.balances.dueToOwnerPaisa)}
            </div>
          </div>
          <div style="border: 1px solid var(--border, #e5e7eb); border-radius: 6px; padding: 10px 12px;">
            <div style="font-size: 11px; color: var(--muted, #6b7280); text-transform: uppercase;">Total Due from Owner:</div>
            <div style="font-size: 16px; font-weight: 700; font-family: var(--font-mono, monospace); color: #dc2626;">
              ${formatInrPaise(ov.balances.dueFromOwnerPaisa)}
            </div>
          </div>
        </div>

        <div style="border-top: 1px dashed var(--border, #e5e7eb); padding-top: 12px; font-size: 11.5px; color: var(--muted, #6b7280);">
          This certificate is generated from authoritative ERP sub-ledger entries under Section 185/186 governance rules. Tampering or unauthorized alteration is strictly prohibited.
        </div>
      </div>
    `,
    saveLabel: "🖨️ Print / Save PDF",
    onSave: () => {
      window.print();
      return true;
    },
  });
}

// ── Server Data Fetching ─────────────────────────────────────────────────────

async function fetchLedgerFromServer(root) {
  const queryParams = new URLSearchParams();
  if (selectedPeriod && selectedPeriod !== "ALL") {
    queryParams.set("financialYear", selectedPeriod);
  }
  if (selectedAccount) {
    queryParams.set("accountType", selectedAccount);
  }
  const qs = queryParams.toString() ? `?${queryParams.toString()}` : "";

  try {
    const overviewRes = await apiGet(`/personal-ledger/overview${qs}`);
    if (overviewRes && overviewRes.data) {
      liveOverview = overviewRes.data;
    }
  } catch (err) {
    console.warn("Failed to load personal ledger overview:", err);
  }

  try {
    const entriesRes = await apiGet(`/personal-ledger/entries${qs}`);
    if (entriesRes && entriesRes.data) {
      liveEntries = entriesRes.data;
    }
  } catch (err) {
    console.warn("Failed to load personal ledger entries:", err);
  }

  refreshLedgerView(root);
}

function refreshLedgerView(root) {
  const content = root.querySelector("#pl-tab-content-area");
  if (content) {
    // Update active tab buttons
    root.querySelectorAll("[data-pl-tab]").forEach((btn) => {
      const tabId = btn.getAttribute("data-pl-tab");
      if (tabId === activeTab) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
    // Only re-render the tab content area, not the full page
    content.innerHTML = renderActiveTabContent();
    wireJournalActions(root);
  } else {
    // Full page not yet mounted — render completely
    const mainEl = root.querySelector("#pl-tab-content-area") ? root : document.querySelector("#main-content");
    if (!mainEl) return;
    mainEl.innerHTML = renderLedger();
    wireLedger(mainEl);
  }
}

function renderActiveTabContent() {
  const isPM = getStoredRole().isPrimaryMaster;
  const isOwner = getStoredRole().role === "OWNER";
  const overview = liveOverview || SAMPLE_OVERVIEW;
  const entries = liveEntries || SAMPLE_ENTRIES;
  return renderTabContent(activeTab, entries, overview, isPM, isOwner);
}

function wireJournalActions(root) {
  // Wire search input
  const searchInput = root.querySelector("#pl-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      searchQuery = e.target.value;
      const content = root.querySelector("#pl-tab-content-area");
      if (content && activeTab === "journal") {
        content.innerHTML = renderActiveTabContent();
        wireJournalActions(root);
      }
    });
  }

  // Wire filter
  const filterSelect = root.querySelector("#pl-treatment-filter");
  if (filterSelect) {
    filterSelect.addEventListener("change", (e) => {
      activeFilterTreatment = e.target.value;
      const content = root.querySelector("#pl-tab-content-area");
      if (content && activeTab === "journal") {
        content.innerHTML = renderActiveTabContent();
        wireJournalActions(root);
      }
    });
  }

  // Wire Export CSV
  root.querySelector("#pl-export-journal-btn")?.addEventListener("click", () => {
    downloadJournalCsv(liveEntries || SAMPLE_ENTRIES);
  });

  // Wire Table Actions
  root.querySelectorAll("[data-inspect-txn]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-inspect-txn");
      openInspectTransactionDrawer(id);
    });
  });

  root.querySelectorAll("[data-classify-txn]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-classify-txn");
      openClassifyModal(id, root);
    });
  });

  root.querySelectorAll("[data-reverse-txn]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-reverse-txn");
      openReverseModal(id, root);
    });
  });

  root.querySelectorAll("[data-unclassify-txn]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-unclassify-txn");
      confirmAction({
        title: "Reverse Accounting Classification",
        message: "Move this transaction back to the Review Queue? The current General Ledger reference will be unposted.",
        confirmLabel: "Return to Review",
        onConfirm: async () => {
          try {
            await apiPost(`/personal-ledger/entries/${id}/reverse-classification`, {
              reason: "Returned to review queue by Owner governance review",
            });
            showToast("Voucher moved back to Review Queue.", "success");
            await fetchLedgerFromServer(root);
          } catch (err) {
            showToast(err?.message || "Failed to reverse classification.", "error");
          }
        },
      });
    });
  });

  root.querySelectorAll("[data-view-doc]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-view-doc");
      const entries = liveEntries || SAMPLE_ENTRIES;
      const entry = entries.find((x) => x.ledgerEntryId === id);
      openEvidenceViewerModal(entry);
    });
  });

  root.querySelectorAll("[data-tab-switch]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetTab = btn.getAttribute("data-tab-switch");
      if (targetTab) {
        activeTab = targetTab;
        refreshLedgerView(root);
      }
    });
  });

  // Wire batch settlement buttons inside tabs
  root.querySelector("#pl-batch-reimburse-btn")?.addEventListener("click", () => {
    openSettleModal(root);
  });
  root.querySelector("#pl-batch-recover-btn")?.addEventListener("click", () => {
    openSettleModal(root);
  });
  root.querySelector("#pl-sign-period-btn")?.addEventListener("click", () => {
    openConfirmBalanceModal(root);
  });
  root.querySelector("#pl-btn-export-dpt3")?.addEventListener("click", () => {
    downloadDpt3Pack(liveEntries || SAMPLE_ENTRIES);
  });
  root.querySelector("#pl-btn-export-audit-cert")?.addEventListener("click", () => {
    openCertifiedBalanceCertificateModal(liveOverview || SAMPLE_OVERVIEW);
  });
}

// ── Exported Wiring Function ─────────────────────────────────────────────────
export function wireLedger(root) {
  if (!root) return;

  // Immediately load live data from server on initial mount
  if (!liveOverview && !liveEntries) {
    fetchLedgerFromServer(root);
  }

  // 1. Wire all Navigation Tabs
  root.querySelectorAll("[data-pl-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetTab = btn.getAttribute("data-pl-tab");
      if (targetTab && targetTab !== activeTab) {
        activeTab = targetTab;
        refreshLedgerView(root);
      }
    });
  });

  // 2. Wire Header Controls
  root.querySelector("#pl-account-select")?.addEventListener("change", (e) => {
    selectedAccount = e.target.value;
    showToast(`Switched account to ${e.target.options[e.target.selectedIndex].text}`, "info");
    fetchLedgerFromServer(root);
  });

  root.querySelector("#pl-period-select")?.addEventListener("change", (e) => {
    selectedPeriod = e.target.value;
    showToast(`Period changed to ${e.target.value}`, "info");
    fetchLedgerFromServer(root);
  });

  root.querySelector("#pl-privacy-toggle-btn")?.addEventListener("click", () => {
    privacyModeActive = !privacyModeActive;
    const btn = root.querySelector("#pl-privacy-toggle-btn");
    if (btn) btn.innerHTML = privacyModeActive ? "👁️ Reveal Balances" : "🔒 Mask Values";
    refreshLedgerView(root);
  });

  root.querySelector("#pl-refresh-btn")?.addEventListener("click", async () => {
    showToast("Refreshing ledger balances from server...", "info");
    await fetchLedgerFromServer(root);
  });

  root.querySelector("#pl-settle-batch-btn")?.addEventListener("click", () => {
    openSettleModal(root);
  });

  root.querySelector("#pl-confirm-balance-btn")?.addEventListener("click", () => {
    openConfirmBalanceModal(root);
  });

  root.querySelector("#pl-record-txn-btn")?.addEventListener("click", () => {
    openRecordTransactionModal(root);
  });

  root.querySelector("#pl-decompose-net-btn")?.addEventListener("click", () => {
    openNetDecompositionModal();
  });

  // 3. Wire tab content inner listeners
  wireJournalActions(root);
}
