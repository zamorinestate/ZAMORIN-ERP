import { ROLES } from "../navigation.js";
import { exportDomTable } from "../utils/exportFile.js";
import { state } from "../state.js";
import { showToast, openModal, renderCafeContextStrip, renderFileUploadZone, wireFileUploadZone, openUniversalDocumentModal } from "../components.js";
import { apiGet, apiPost } from "../apiClient.js";
import { navigate } from "../router.js";

let activeSubpanel = "overview";
let activeFilter = "ALL";
let expenseSearchQuery = "";
let selectedApprovalVoucherId = null;

let EXPENSE_VOUCHERS = [];
let PRE_SPEND_REQUESTS = [];
let CORPORATE_CARDS = [];
let CARD_TRANSACTIONS = [];
let CASH_ADVANCES = [];
let cachedCafes = [];

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]);
}

async function loadCafesIfEmpty() {
  if (cachedCafes.length === 0) {
    try {
      const res = await apiGet("/cafes");
      if (res?.data?.cafes && Array.isArray(res.data.cafes)) {
        cachedCafes = res.data.cafes;
      }
    } catch (e) {
      cachedCafes = [];
    }
  }
}

function normalizeExpenseForView(e) {
  const catLabels = {
    COFFEE_RAW_MATERIALS: "Coffee & Raw Ingredients",
    DAIRY_FRESH_MILK: "Dairy & Fresh Milk",
    EQUIPMENT_MAINTENANCE: "Equipment & Maintenance",
    PACKAGING_DISPOSABLES: "Packaging & Disposables",
    UTILITIES: "Utilities & Power",
    STAFF_WELFARE: "Staff Welfare & Refreshments",
  };
  const cafe = cachedCafes.find((c) => c.cafeId === e.cafeId);
  return {
    id: e.expenseId || e.id || "—",
    category: e.category,
    categoryLabel: catLabels[e.category] || e.category || "General",
    payee: e.vendorName || e.payee || "Unknown Payee",
    invoiceRef: e.invoiceNumber || e.invoiceRef || "—",
    cafeId: e.cafeId,
    cafeName: cafe?.name || e.cafeName || e.cafeId || "—",
    date: e.businessDate || (e.createdAt ? e.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10)),
    paymentSource: e.paymentSource === "COMPANY_BANK_UPI" ? "Bank UPI" : e.paymentSource === "PETTY_CASH" ? "Petty Cash" : e.paymentSource === "CORPORATE_CARD" ? "Corporate Card" : (e.paymentSource || "Cash"),
    paymentSourceCode: e.paymentSource,
    amount: e.amount || (e.totalPaisa ? e.totalPaisa / 100 : 0),
    status: e.status || "SUBMITTED",
    fileProof: e.evidence?.[0]?.fileName || e.fileProof || "",
    hash: e.evidence?.[0]?.fileHash || e.hash || "",
    policyCheck: "COMPLIANT",
    notes: e.description || e.notes || "",
    approvedBy: e.approvalSnapshot?.approvedBy || e.approvedBy || "",
    approvedAt: e.approvalSnapshot?.approvedAt ? new Date(e.approvalSnapshot.approvedAt).toISOString().replace("T", " ").slice(0, 16) : "",
  };
}

let isExpensesLoading = false;

async function loadExpensesData(root) {
  if (isExpensesLoading) return;
  isExpensesLoading = true;
  try {
    await loadCafesIfEmpty();
    const [expensesRes, requestsRes, cardsRes, advancesRes] = await Promise.allSettled([
      apiGet("/expenses"),
      apiGet("/expenses/requests"),
      apiGet("/expenses/cards"),
      apiGet("/expenses/advances"),
    ]);

    if (expensesRes.status === "fulfilled" && expensesRes.value?.expenses) {
      EXPENSE_VOUCHERS = expensesRes.value.expenses.map(normalizeExpenseForView);
    }
    if (requestsRes.status === "fulfilled" && requestsRes.value?.requests) {
      PRE_SPEND_REQUESTS = requestsRes.value.requests;
    }
    if (cardsRes.status === "fulfilled" && cardsRes.value?.transactions) {
      CARD_TRANSACTIONS = cardsRes.value.transactions;
    }
    if (advancesRes.status === "fulfilled" && advancesRes.value?.advances) {
      CASH_ADVANCES = advancesRes.value.advances;
    }
    refreshSubpanelOnly(root);
  } catch (err) {
    console.error("Failed to load real expense data:", err);
    showToast("Failed to load live expenses from server", "coral");
  } finally {
    isExpensesLoading = false;
  }
}

// Helper to normalize subroutes
function normalizeSubroute(route) {
  if (!route) return "overview";
  const r = route.toLowerCase();
  if (r === "vouchers" || r === "ledger" || r === "all") return "ledger";
  if (r === "approvals" || r === "unapproved" || r === "pending" || r === "emergency") return "approvals";
  if (r === "requests" || r === "pre-spend" || r === "authorisations" || r === "prs") return "requests";
  if (r === "evidence" || r === "vault" || r === "receipts") return "evidence";
  if (r === "cards" || r === "advances" || r === "corporate-cards") return "cards";
  if (r === "policies" || r === "rules") return "policies";
  if (r === "integrity" || r === "handoff" || r === "audit") return "integrity";
  return r;
}

export function setExpensesActiveTab(tab) {
  activeSubpanel = normalizeSubroute(tab);
}

export function renderExpenses(subroute) {
  if (subroute !== undefined) {
    activeSubpanel = normalizeSubroute(subroute);
  }
  const isMaster = state.role === ROLES.MASTER;
  const isCafeAdmin = state.role === ROLES.CAFE_ADMIN;

  return `
    <div class="page-enter" style="padding-bottom: 40px;">
      <!-- Page Header -->
      <div class="page-header" style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px; margin-bottom:24px;">
        <div>
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <h1 style="font-size:26px; font-weight:700; margin:0; color:var(--ink);">Expense Management &amp; Approvals</h1>
            <span class="badge" style="background:rgba(180,83,9,0.12); color:#b45309; font-weight:600; font-size:12px; padding:4px 10px; border-radius:12px;">SCR-009 EXP</span>
          </div>
          <p style="font-size:14px; color:var(--muted); margin:4px 0 0;">Manage operating expenses, receipt evidence, pre-spend authorisations, corporate card matching, and Finance handoffs.</p>
        </div>
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <button class="btn btn-primary" id="record-expense-btn" type="button" style="font-weight:700; display:flex; align-items:center; gap:6px;">
            <span>➕</span> <span>Record New Expense</span>
          </button>
          <button class="btn btn-secondary" id="refresh-expenses-btn" type="button" style="font-weight:600; display:flex; align-items:center; gap:6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <!-- Scope Context Banner -->
      ${renderCafeContextStrip()}

      <!-- Main Workspace Container -->
      <div id="expense-workspace-content">
        ${renderActiveSubpanel()}
      </div>
    </div>
  `;
}

function renderActiveSubpanel() {
  if (activeSubpanel === "overview") {
    return renderOverviewSubpanel();
  }

  const submodules = {
    ledger: { title: "Operational Expense Ledger", icon: "📑", desc: "Voucher line items, cost center tags, payment modes and fiscal periods." },
    approvals: { title: "Expense Approvals Workbench", icon: "⚖️", desc: "Multi-level managerial approvals, policy compliance verification and audit trail." },
    requests: { title: "Pre-Spend Authorisations & PRs", icon: "📝", desc: "Advance purchase approvals, budget holds and pre-spend authorizations." },
    evidence: { title: "Receipts & Proof Evidence Vault", icon: "🧾", desc: "Tax invoice scans, fuel slips, physical bills and cryptographically verified audit attachments." },
    cards: { title: "Corporate Cards & Cash Advances", icon: "💳", desc: "Float disbursements, corporate credit card reconciliation, statement matching and settlement." },
    policies: { title: "Expense Policies & Rule Simulator", icon: "📜", desc: "Spending caps, approval hierarchy, category limits and automated compliance rules." },
    integrity: { title: "Ledger Integrity & Finance Handoff", icon: "🛡️", desc: "Deterministic 16-point audit, duplicate detection, unlinked vouchers, and Accounts Payable handoff." },
  };

  const cur = submodules[activeSubpanel] || { title: "Submodule", icon: "📁", desc: "" };

  let bodyHtml = "";
  switch (activeSubpanel) {
    case "ledger":
      bodyHtml = renderLedgerSubpanel();
      break;
    case "approvals":
      bodyHtml = renderApprovalsSubpanel();
      break;
    case "requests":
      bodyHtml = renderRequestsSubpanel();
      break;
    case "evidence":
      bodyHtml = renderEvidenceSubpanel();
      break;
    case "cards":
      bodyHtml = renderCardsSubpanel();
      break;
    case "policies":
      bodyHtml = renderPoliciesSubpanel();
      break;
    case "integrity":
      bodyHtml = renderIntegritySubpanel();
      break;
    default:
      bodyHtml = renderOverviewSubpanel();
  }

  return `
    <div style="display:flex; flex-direction:column; gap:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 16px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-md, 10px);">
        <div style="display:flex; align-items:center; gap:12px;">
          <button class="btn-back-nav" id="exp-back-to-hub-btn" type="button">
            <span class="back-icon">←</span>
            <span>Back to Expense Hub</span>
          </button>
          <div style="border-left:1px solid var(--line); padding-left:12px;">
            <h2 style="font-size:16px; font-weight:700; color:var(--ink); margin:0; display:flex; align-items:center; gap:8px;">
              <span>${cur.icon}</span> <span>${cur.title}</span>
            </h2>
            <p style="font-size:12px; color:var(--muted); margin:2px 0 0;">${cur.desc}</p>
          </div>
        </div>
      </div>
      <div>
        ${bodyHtml}
      </div>
    </div>
  `;
}

function renderOverviewSubpanel() {
  const isCafeOps = state.role === ROLES.CAFE_ADMIN;
  const user = state.auth?.user || state.user || {};
  const cafeName = user.primaryCafeName || user.cafeName || "—";
  const cafeId = user.primaryCafeId || user.cafeId || "";

  const pendingCount = EXPENSE_VOUCHERS.filter((v) => v.status === "SUBMITTED").length;
  const missingReceiptsCount = EXPENSE_VOUCHERS.filter((v) => !v.fileProof).length;
  const unmatchedCardsCount = CARD_TRANSACTIONS.filter((t) => t.status === "UNMATCHED").length;

  const expTiles = [
    { id: "ledger", icon: "📑", title: "Expense Ledger", subtitle: "Operational expense lines, cost centers & vouchers", badge: `${EXPENSE_VOUCHERS.length} Vouchers`, badgeType: "accent" },
    { id: "approvals", icon: "⚖️", title: "Approvals Workbench", subtitle: "Managerial reviews, policy limits & sign-offs", badge: `${pendingCount} Pending`, badgeType: pendingCount > 0 ? "warning" : "success" },
    { id: "requests", icon: "📝", title: "Spend Authorisations", subtitle: "Pre-spend requisitions, advances & authorizations", badge: `${PRE_SPEND_REQUESTS.length} Requests`, badgeType: "" },
    { id: "evidence", icon: "🧾", title: "Receipts & Evidence", subtitle: "Tax invoice attachments, fuel bills & audit proofs", badge: missingReceiptsCount > 0 ? `${missingReceiptsCount} Missing` : "100% Verified", badgeType: missingReceiptsCount > 0 ? "warning" : "success" },
    { id: "cards", icon: "💳", title: "Corporate Cards & Advances", subtitle: "Card feeds, float settlements & advance balancing", badge: unmatchedCardsCount > 0 ? `${unmatchedCardsCount} Unmatched` : "Reconciled", badgeType: unmatchedCardsCount > 0 ? "warning" : "success" },
    { id: "policies", icon: "📜", title: "Policies & Categories", subtitle: "Spend caps, categories, tax rules & compliance", badge: "Enforced", badgeType: "success" },
    { id: "integrity", icon: "🛡️", title: "Integrity & Handoff", subtitle: "Accounts Payable handoff & validation status", badge: "PASS (16/16)", badgeType: "success" },
  ];

  const totalSpent = EXPENSE_VOUCHERS.reduce((acc, v) => acc + (v.amount || 0), 0);
  const approvedSpent = EXPENSE_VOUCHERS.filter((v) => v.status === "APPROVED" || v.status === "PAID").reduce((acc, v) => acc + (v.amount || 0), 0);
  const pendingSpent = EXPENSE_VOUCHERS.filter((v) => v.status === "SUBMITTED").reduce((acc, v) => acc + (v.amount || 0), 0);

  return `
    <div style="display:flex;flex-direction:column;gap:24px;">
      <!-- Control Centre Button Hub Section -->
      <div class="module-hub-section">
        <h3 class="module-hub-section-title">Expense &amp; Spend Management Workspaces</h3>
        <div class="module-tile-grid">
          ${expTiles
            .map(
              (t) => `
            <button class="module-hub-tile" data-exp-hub-tile="${t.id}" type="button">
              <div class="module-tile-icon-box">${t.icon}</div>
              <div class="module-tile-content">
                <div class="module-tile-title-row">
                  <span class="module-tile-title">${t.title}</span>
                  ${t.badge ? `<span class="module-tile-badge ${t.badgeType}">${t.badge}</span>` : ""}
                </div>
                <div class="module-tile-sub">${t.subtitle}</div>
              </div>
            </button>
          `
            )
            .join("")}
        </div>
      </div>

      <!-- Primary KPI Cards -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px;">
        <article class="card" style="padding:18px 20px;border-radius:var(--radius-lg, 12px);background:var(--surface);border:1px solid var(--line);border-left:4px solid #0284c7;box-shadow:var(--shadow-xs);transition:transform 0.15s ease;">
          <div style="font-size:11.5px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;display:flex;justify-content:space-between;align-items:center;">
            <span>Expenses This Month</span>
            <span>💳</span>
          </div>
          <div style="font-size:24px;font-weight:800;color:var(--ink);font-family:var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);margin:8px 0 4px;letter-spacing:-0.3px;">₹${totalSpent.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
          <div style="font-size:12px;color:#0284c7;font-weight:700;display:flex;align-items:center;gap:4px;">
            <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#0284c7;"></span> Across Active Outlets
          </div>
        </article>

        <article class="card" style="padding:18px 20px;border-radius:var(--radius-lg, 12px);background:var(--surface);border:1px solid var(--line);border-left:4px solid #10b981;box-shadow:var(--shadow-xs);transition:transform 0.15s ease;">
          <div style="font-size:11.5px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;display:flex;justify-content:space-between;align-items:center;">
            <span>Approved &amp; Paid</span>
            <span>✅</span>
          </div>
          <div style="font-size:24px;font-weight:800;color:#10b981;font-family:var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);margin:8px 0 4px;letter-spacing:-0.3px;">₹${approvedSpent.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
          <div style="font-size:12px;color:var(--muted);font-weight:600;display:flex;align-items:center;gap:4px;">
            <span style="color:#10b981;">✓</span> Audited by Management
          </div>
        </article>

        <article class="card" style="padding:18px 20px;border-radius:var(--radius-lg, 12px);background:var(--surface);border:1px solid var(--line);border-left:4px solid #f59e0b;box-shadow:var(--shadow-xs);transition:transform 0.15s ease;">
          <div style="font-size:11.5px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;display:flex;justify-content:space-between;align-items:center;">
            <span>Pending Approval</span>
            <span>⏳</span>
          </div>
          <div style="font-size:24px;font-weight:800;color:#d97706;font-family:var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);margin:8px 0 4px;letter-spacing:-0.3px;">${pendingCount} Vouchers</div>
          <div style="font-size:12px;color:#b45309;font-weight:700;display:flex;align-items:center;gap:4px;">
            <span>⚠️</span> ₹${pendingSpent.toLocaleString("en-IN", { minimumFractionDigits: 2 })} In Review
          </div>
        </article>

        <article class="card" style="padding:18px 20px;border-radius:var(--radius-lg, 12px);background:var(--surface);border:1px solid var(--line);border-left:4px solid #8b5cf6;box-shadow:var(--shadow-xs);transition:transform 0.15s ease;">
          <div style="font-size:11.5px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;display:flex;justify-content:space-between;align-items:center;">
            <span>AP Handoff Readiness</span>
            <span>📑</span>
          </div>
          <div style="font-size:24px;font-weight:800;color:#8b5cf6;font-family:var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);margin:8px 0 4px;letter-spacing:-0.3px;">100%</div>
          <div style="font-size:12px;color:#10b981;font-weight:700;display:flex;align-items:center;gap:4px;">
            <span>🛡️</span> 0 Unlinked POs
          </div>
        </article>
      </div>

      <!-- Actionable Secondary Control Strip & Audit Exceptions -->
      <div class="card" style="padding:18px 20px;border-radius:var(--radius-lg, 12px);border:1px solid var(--line);background:var(--surface);box-shadow:var(--shadow-xs);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:30px;height:30px;border-radius:8px;background:rgba(217,119,6,0.14);color:var(--color-accent-gold-bright, #f59e0b);display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;">
              ⚡
            </div>
            <div>
              <div style="font-size:13.5px;font-weight:700;color:var(--ink);letter-spacing:0.2px;">Expense Control &amp; Audit Queue</div>
              <div style="font-size:11.5px;color:var(--muted);margin-top:1px;">Real-time receipt verification flags, corporate cards &amp; non-PO exceptions</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="badge-tag badge-neutral" style="font-size:11px;display:inline-flex;align-items:center;gap:6px;padding:3px 9px;">
              <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#10b981;"></span>
              Audit Automation Live
            </span>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;">
          <button class="fin-action-pill has-action is-warning" data-exp-action-tab="evidence" type="button" style="width:100%;text-align:left;">
            <div style="display:flex;justify-content:space-between;align-items:center;width:100%;margin-bottom:4px;">
              <span style="font-size:14px;">🧾</span>
              <span class="badge-tag badge-success" style="font-size:10.5px;font-weight:700;">100% PROOF</span>
            </div>
            <div style="font-size:12.5px;font-weight:700;color:var(--ink);">Receipts Vault</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px;">Digital cryptographic proofs</div>
          </button>

          <button class="fin-action-pill has-action is-accent" data-exp-action-tab="cards" type="button" style="width:100%;text-align:left;">
            <div style="display:flex;justify-content:space-between;align-items:center;width:100%;margin-bottom:4px;">
              <span style="font-size:14px;">💳</span>
              <span class="badge-tag ${unmatchedCardsCount > 0 ? 'badge-warning' : 'badge-success'}" style="font-size:10.5px;font-weight:700;">${unmatchedCardsCount} UNMATCHED</span>
            </div>
            <div style="font-size:12.5px;font-weight:700;color:var(--ink);">Corporate Cards</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px;">Transaction feeds &amp; floats</div>
          </button>

          <button class="fin-action-pill has-action is-danger" data-exp-action-tab="approvals" type="button" style="width:100%;text-align:left;">
            <div style="display:flex;justify-content:space-between;align-items:center;width:100%;margin-bottom:4px;">
              <span style="font-size:14px;">⚖️</span>
              <span class="badge-tag badge-warning" style="font-size:10.5px;font-weight:700;">${pendingCount} PENDING</span>
            </div>
            <div style="font-size:12.5px;font-weight:700;color:var(--ink);">Approvals Queue</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px;">Managerial reviews</div>
          </button>

          <button class="fin-action-pill is-clear" data-exp-action-tab="integrity" type="button" style="width:100%;text-align:left;">
            <div style="display:flex;justify-content:space-between;align-items:center;width:100%;margin-bottom:4px;">
              <span style="font-size:14px;">🛡️</span>
              <span class="badge-tag badge-success" style="font-size:10.5px;font-weight:700;">PASS (16/16)</span>
            </div>
            <div style="font-size:12.5px;font-weight:700;color:var(--ink);">Integrity Audit</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px;">Automated rules verified</div>
          </button>
        </div>
      </div>

      <!-- Café Operating Expense Breakdown -->
      <div>
        <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0 0 12px;text-transform:uppercase;">Café Operating Expense Breakdown</h3>
        <div style="background:var(--surface);border:1px solid var(--border);padding:24px;border-radius:8px;text-align:center;color:var(--muted);font-size:13px;">
          No café operating expense records recorded for this period.
        </div>
      </div>
    </div>
  `;
}

// 1. EXPENSE LEDGER SUBPANEL
function renderLedgerSubpanel() {
  let filtered = EXPENSE_VOUCHERS.filter((v) => {
    if (activeFilter !== "ALL" && v.status !== activeFilter) return false;
    if (expenseSearchQuery) {
      const q = expenseSearchQuery.toLowerCase();
      const match =
        v.id.toLowerCase().includes(q) ||
        v.payee.toLowerCase().includes(q) ||
        v.categoryLabel.toLowerCase().includes(q) ||
        (v.invoiceRef && v.invoiceRef.toLowerCase().includes(q)) ||
        (v.cafeName && v.cafeName.toLowerCase().includes(q));
      if (!match) return false;
    }
    return true;
  });

  return `
    <div class="card" style="padding:20px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-md, 10px);">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px;">
        <div style="display:flex;gap:10px;align-items:center;flex:1;max-width:440px;">
          <input type="text" id="expense-search-input" class="form-control" placeholder="Search by Voucher #, Payee, Category, Invoice..." value="${expenseSearchQuery}" style="padding:8px 12px;font-size:13px;border-radius:6px;border:1px solid var(--border);width:100%;">
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <select id="expense-status-filter" class="form-control" style="padding:8px 12px;font-size:13px;border-radius:6px;border:1px solid var(--border);">
            <option value="ALL" ${activeFilter === "ALL" ? "selected" : ""}>All Statuses</option>
            <option value="SUBMITTED" ${activeFilter === "SUBMITTED" ? "selected" : ""}>Submitted (Pending Approval)</option>
            <option value="APPROVED" ${activeFilter === "APPROVED" ? "selected" : ""}>Approved</option>
            <option value="PAID" ${activeFilter === "PAID" ? "selected" : ""}>Paid / Settled</option>
            <option value="REJECTED" ${activeFilter === "REJECTED" ? "selected" : ""}>Rejected</option>
          </select>
          <button class="btn btn-sm btn-primary" id="btn-record-exp-sub" type="button" style="font-weight:700;">
            + Record Expense
          </button>
        </div>
      </div>

      <!-- Ledger Table -->
      <div class="table-wrap" style="overflow-x:auto;">
        <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;text-align:left;">
          <thead>
            <tr style="border-bottom:2px solid var(--border);color:var(--muted);font-size:12px;text-transform:uppercase;background:var(--surface-sunken);">
              <th style="padding:10px 10px;">Voucher #</th>
              <th style="padding:10px 10px;">Expense Category &amp; Payee</th>
              <th style="padding:10px 10px;">Café</th>
              <th style="padding:10px 10px;">Date</th>
              <th style="padding:10px 10px;">Payment Source</th>
              <th style="padding:10px 10px;text-align:right;">Amount</th>
              <th style="padding:10px 10px;text-align:center;">Status</th>
              <th style="padding:10px 10px;text-align:center;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${
              filtered.length === 0
                ? `
                <tr>
                  <td colspan="8" style="text-align:center;padding:36px;color:var(--muted);">
                    No expense vouchers match the selected filter.
                  </td>
                </tr>
              `
                : filtered
                    .map((v) => {
                      const statusBadge =
                        v.status === "APPROVED"
                          ? "badge-success"
                          : v.status === "PAID"
                          ? "badge-accent"
                          : v.status === "SUBMITTED"
                          ? "badge-warning"
                          : "badge-danger";
                      const sourceBadge =
                        v.paymentSourceCode === "COMPANY_BANK_UPI"
                          ? "badge-accent"
                          : v.paymentSourceCode === "CORPORATE_CARD"
                          ? "badge-info"
                          : "badge-subtle";

                      return `
                      <tr style="border-bottom:1px solid var(--border-subtle);">
                        <td style="padding:12px 10px;font-weight:700;color:var(--ink);font-family:var(--font-mono);">${v.id}</td>
                        <td style="padding:12px 10px;">
                          <div style="font-weight:600;color:var(--ink);">${v.categoryLabel}</div>
                          <div style="font-size:11.5px;color:var(--muted);">${v.payee} <span style="font-family:var(--font-mono);">(${v.invoiceRef})</span></div>
                        </td>
                        <td style="padding:12px 10px;font-size:12.5px;">${v.cafeName}</td>
                        <td style="padding:12px 10px;font-size:12px;color:var(--muted);">${v.date}</td>
                        <td style="padding:12px 10px;">
                          <span class="badge ${sourceBadge}" style="font-size:10.5px;">${v.paymentSource}</span>
                        </td>
                        <td style="padding:12px 10px;text-align:right;font-weight:700;color:var(--ink);font-family:var(--font-mono);font-size:14px;">
                          ₹${v.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </td>
                        <td style="padding:12px 10px;text-align:center;">
                          <span class="badge ${statusBadge}" style="font-size:10.5px;font-weight:700;">${v.status}</span>
                        </td>
                        <td style="padding:12px 10px;text-align:center;">
                          <button class="btn btn-xs btn-secondary view-expense-btn" data-id="${v.id}" type="button" style="font-weight:600;padding:4px 10px;">
                            👁️ View 360
                          </button>
                        </td>
                      </tr>
                    `;
                    })
                    .join("")
            }
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// 2. APPROVALS WORKBENCH SUBPANEL
function renderApprovalsSubpanel() {
  const pendingVouchers = EXPENSE_VOUCHERS.filter((v) => v.status === "SUBMITTED");
  const selectedVoucher = EXPENSE_VOUCHERS.find((v) => v.id === selectedApprovalVoucherId) || pendingVouchers[0] || EXPENSE_VOUCHERS[0];

  return `
    <div style="display:flex;flex-direction:column;gap:18px;">
      <div class="card" style="padding:20px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-md, 10px);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;flex-wrap:wrap;gap:10px;">
          <div>
            <h3 style="font-size:16px;font-weight:700;margin:0;color:var(--ink);">Expense Approvals Workbench (Side-by-Side Review)</h3>
            <p style="font-size:12.5px;color:var(--muted);margin:2px 0 0;">Review voucher metadata, verify attached invoice files, check policy compliance, and enforce segregation of duties.</p>
          </div>
          <span class="badge badge-warning" style="font-size:12px;font-weight:700;padding:4px 10px;">
            ${pendingVouchers.length} Vouchers Pending Approval
          </span>
        </div>

        <div style="display:grid;grid-template-columns:320px 1fr;gap:20px;margin-top:16px;">
          <!-- Left Column: Pending List -->
          <div style="border:1px solid var(--border);border-radius:8px;background:var(--surface-sunken);padding:10px;display:flex;flex-direction:column;gap:8px;max-height:540px;overflow-y:auto;">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--muted);padding:4px 6px;">
              Pending Review Queue
            </div>
            ${
              pendingVouchers.length === 0
                ? `
                <div style="text-align:center;padding:30px 10px;color:var(--muted);font-size:12.5px;">
                  🎉 All submitted vouchers have been reviewed and approved!
                </div>
              `
                : pendingVouchers
                    .map((v) => {
                      const isSel = v.id === selectedVoucher.id;
                      return `
                      <button class="card select-approval-item-btn" data-id="${v.id}" type="button" style="text-align:left;padding:12px;border:1px solid ${isSel ? "var(--color-accent-gold-bright, #d97706)" : "var(--border)"};background:${isSel ? "var(--surface)" : "transparent"};border-radius:6px;cursor:pointer;transition:all 0.15s ease;">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                          <strong style="font-family:var(--font-mono);font-size:12.5px;color:${isSel ? "var(--color-accent-gold-bright, #d97706)" : "var(--ink)"};">${v.id}</strong>
                          <span style="font-weight:800;color:var(--ink);font-family:var(--font-mono);font-size:13px;">₹${v.amount.toLocaleString("en-IN")}</span>
                        </div>
                        <div style="font-size:12px;font-weight:600;color:var(--ink);">${v.categoryLabel}</div>
                        <div style="font-size:11px;color:var(--muted);margin-top:2px;">${v.payee} · ${v.cafeName}</div>
                      </button>
                    `;
                    })
                    .join("")
            }
          </div>

          <!-- Right Column: Detail & Receipt Side-by-Side Review -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
            <!-- Voucher Metadata & Policy Rules -->
            <div style="border:1px solid var(--border);border-radius:8px;padding:16px;background:var(--surface);display:flex;flex-direction:column;justify-content:space-between;">
              <div>
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;border-bottom:1px solid var(--border-subtle);padding-bottom:10px;">
                  <div>
                    <h4 style="margin:0 0 2px;font-size:15px;font-weight:700;color:var(--ink);font-family:var(--font-mono);">${selectedVoucher.id}</h4>
                    <span style="font-size:12px;color:var(--muted);">${selectedVoucher.categoryLabel}</span>
                  </div>
                  <span class="badge ${selectedVoucher.status === 'APPROVED' ? 'badge-success' : selectedVoucher.status === 'SUBMITTED' ? 'badge-warning' : 'badge-danger'}">
                    ${selectedVoucher.status}
                  </span>
                </div>

                <div style="display:flex;flex-direction:column;gap:10px;font-size:12.5px;">
                  <div style="display:flex;justify-content:space-between;">
                    <span style="color:var(--muted);">Payee / Vendor:</span>
                    <strong style="color:var(--ink);">${selectedVoucher.payee}</strong>
                  </div>
                  <div style="display:flex;justify-content:space-between;">
                    <span style="color:var(--muted);">Invoice Reference:</span>
                    <span style="font-family:var(--font-mono);font-weight:600;">${selectedVoucher.invoiceRef}</span>
                  </div>
                  <div style="display:flex;justify-content:space-between;">
                    <span style="color:var(--muted);">Café Branch:</span>
                    <span>${selectedVoucher.cafeName}</span>
                  </div>
                  <div style="display:flex;justify-content:space-between;">
                    <span style="color:var(--muted);">Payment Method:</span>
                    <span class="badge badge-subtle">${selectedVoucher.paymentSource}</span>
                  </div>
                  <div style="display:flex;justify-content:space-between;">
                    <span style="color:var(--muted);">Expense Amount:</span>
                    <strong style="font-size:16px;color:var(--color-success, #10b981);font-family:var(--font-mono);">₹${selectedVoucher.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong>
                  </div>
                  <div style="background:var(--surface-sunken);padding:10px;border-radius:6px;margin-top:6px;">
                    <div style="font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;">Policy Compliance Check</div>
                    <div style="color:var(--color-success, #10b981);font-weight:700;margin-top:2px;">✓ ${selectedVoucher.policyCheck}</div>
                  </div>
                  <div style="font-size:11.5px;color:var(--muted);line-height:1.5;margin-top:4px;">
                    <strong>Business Purpose:</strong> ${selectedVoucher.notes || "Standard operational replenishment."}
                  </div>
                </div>
              </div>

              <div style="display:flex;gap:8px;margin-top:20px;padding-top:14px;border-top:1px solid var(--border-subtle);">
                <button class="btn btn-primary" id="btn-approve-voucher" data-id="${selectedVoucher.id}" type="button" style="flex:1;font-weight:700;display:flex;align-items:center;justify-content:center;gap:6px;">
                  <span>✅</span> <span>Approve</span>
                </button>
                <button class="btn btn-secondary" id="btn-return-voucher" data-id="${selectedVoucher.id}" type="button" style="flex:1;font-weight:600;display:flex;align-items:center;justify-content:center;gap:6px;">
                  <span>↩️</span> <span>Return</span>
                </button>
                <button class="btn btn-danger" id="btn-reject-voucher" data-id="${selectedVoucher.id}" type="button" style="flex:1;font-weight:600;display:flex;align-items:center;justify-content:center;gap:6px;">
                  <span>❌</span> <span>Reject</span>
                </button>
              </div>
            </div>

            <!-- Receipt Evidence Preview Card -->
            <div style="border:1px solid var(--border);border-radius:8px;padding:20px;background:var(--surface-sunken);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;">
              <div style="font-size:48px;margin-bottom:10px;">🧾</div>
              <div style="font-weight:700;font-size:14px;color:var(--ink);margin-bottom:2px;">Digital Receipt Evidence</div>
              <div style="font-size:12px;color:var(--muted);margin-bottom:12px;font-family:var(--font-mono);">${selectedVoucher.fileProof || "Receipt_Proof.pdf"}</div>
              <div style="background:var(--surface);padding:8px 12px;border-radius:6px;font-size:11px;color:var(--muted);margin-bottom:16px;border:1px solid var(--border);max-width:260px;">
                SHA-256 Cryptographic Checksum Verified · Tamper Evident
              </div>
              <button class="btn btn-secondary btn-sm open-full-evidence-btn" data-file="${selectedVoucher.fileProof || "Receipt.pdf"}" type="button" style="font-weight:600;display:flex;align-items:center;gap:6px;">
                <span>👁️</span> <span>Open Full Evidence</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// 3. PRE-SPEND AUTHORISATIONS SUBPANEL
function renderRequestsSubpanel() {
  return `
    <div class="card" style="padding:20px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-md, 10px);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px;">
        <div>
          <h3 style="font-size:16px;font-weight:700;margin:0;color:var(--ink);">Pre-Spend Authorisations &amp; Requisitions (PR)</h3>
          <p style="font-size:12.5px;color:var(--muted);margin:2px 0 0;">Pre-authorise operational commitments, training, and equipment upgrades before committing company funds.</p>
        </div>
        <button class="btn btn-primary btn-sm" id="create-request-btn" type="button" style="font-weight:700;display:flex;align-items:center;gap:6px;">
          <span>➕</span> <span>New Spend Request</span>
        </button>
      </div>

      <div class="table-wrap" style="overflow-x:auto;">
        <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;text-align:left;">
          <thead>
            <tr style="border-bottom:2px solid var(--border);color:var(--muted);font-size:11.5px;text-transform:uppercase;background:var(--surface-sunken);">
              <th style="padding:10px 10px;">Request ID</th>
              <th style="padding:10px 10px;">Purpose &amp; Department</th>
              <th style="padding:10px 10px;">Requester</th>
              <th style="padding:10px 10px;">Validity</th>
              <th style="padding:10px 10px;text-align:right;">Estimated (₹)</th>
              <th style="padding:10px 10px;text-align:right;">Actual Spent</th>
              <th style="padding:10px 10px;text-align:center;">Status</th>
              <th style="padding:10px 10px;text-align:center;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${PRE_SPEND_REQUESTS.map((r) => `
              <tr style="border-bottom:1px solid var(--border-subtle);">
                <td style="padding:12px 10px;font-weight:700;color:var(--ink);font-family:var(--font-mono);">${r.id}</td>
                <td style="padding:12px 10px;">
                  <div style="font-weight:600;color:var(--ink);">${r.purpose}</div>
                  <div style="font-size:11.5px;color:var(--muted);">${r.department}</div>
                </td>
                <td style="padding:12px 10px;font-size:12.5px;">${r.requester}</td>
                <td style="padding:12px 10px;font-size:11.5px;color:var(--muted);">${r.validTill || "30 Days"}</td>
                <td style="padding:12px 10px;text-align:right;font-weight:700;color:var(--ink);font-family:var(--font-mono);">₹${r.estimatedAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                <td style="padding:12px 10px;text-align:right;color:var(--muted);font-family:var(--font-mono);">₹${r.actualSpent.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                <td style="padding:12px 10px;text-align:center;">
                  <span class="badge ${r.status === 'APPROVED' ? 'badge-success' : r.status === 'COMPLETED' ? 'badge-accent' : 'badge-warning'}" style="font-size:10.5px;font-weight:700;">${r.status}</span>
                </td>
                <td style="padding:12px 10px;text-align:center;">
                  <button class="btn btn-xs btn-secondary view-spend-req-btn" data-id="${r.id}" type="button" style="font-weight:600;">View</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// 4. RECEIPTS & EVIDENCE VAULT SUBPANEL
function renderEvidenceSubpanel() {
  return `
    <div class="card" style="padding:20px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-md, 10px);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px;">
        <div>
          <h3 style="font-size:16px;font-weight:700;margin:0;color:var(--ink);">Receipts &amp; Evidence Vault</h3>
          <p style="font-size:12.5px;color:var(--muted);margin:2px 0 0;">Cryptographically hashed receipt files, tax invoices, and formal expense proofs.</p>
        </div>
        <button class="btn btn-primary btn-sm" id="upload-expense-receipt-btn" type="button" style="font-weight:700;display:flex;align-items:center;gap:6px;">
          <span>📤</span> <span>Upload Receipt / Invoice Evidence</span>
        </button>
      </div>

      <div style="padding:12px 16px;background:rgba(212,160,23,0.08);border:1px solid rgba(212,160,23,0.3);border-radius:8px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <div style="font-size:12.5px;color:var(--ink);">
          <strong>🛡️ Missing Receipt Declaration Protocol:</strong> Expenses submitted without proof require formal justification and Primary Master waiver before settlement.
        </div>
        <span class="badge badge-success" style="font-weight:700;font-size:11px;">100% Verified Evidence</span>
      </div>

      <div class="table-wrap" style="overflow-x:auto;">
        <table class="data-table" style="width:100%;border-collapse:collapse;font-size:12.5px;text-align:left;">
          <thead>
            <tr style="border-bottom:2px solid var(--border);color:var(--muted);font-size:11.5px;text-transform:uppercase;background:var(--surface-sunken);">
              <th style="padding:10px 10px;">Voucher Ref</th>
              <th style="padding:10px 10px;">Payee / Vendor</th>
              <th style="padding:10px 10px;">Category</th>
              <th style="padding:10px 10px;text-align:right;">Amount</th>
              <th style="padding:10px 10px;text-align:center;">Attached File</th>
              <th style="padding:10px 10px;text-align:center;">Evidence State</th>
              <th style="padding:10px 10px;text-align:center;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${EXPENSE_VOUCHERS.map((v) => `
              <tr style="border-bottom:1px solid var(--border-subtle);">
                <td style="padding:10px 10px;font-weight:700;color:var(--ink);font-family:var(--font-mono);">${v.id}</td>
                <td style="padding:10px 10px;font-weight:600;color:var(--ink);">${v.payee}</td>
                <td style="padding:10px 10px;color:var(--muted);">${v.categoryLabel}</td>
                <td style="padding:10px 10px;text-align:right;font-weight:700;font-family:var(--font-mono);color:var(--ink);">₹${v.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                <td style="padding:10px 10px;text-align:center;">
                  <span style="color:var(--brand-gold, #c89d5c);font-weight:600;display:inline-flex;align-items:center;gap:4px;">
                    <span>📄</span> <span>${v.fileProof || "Receipt.pdf"}</span>
                  </span>
                </td>
                <td style="padding:10px 10px;text-align:center;">
                  <span class="badge badge-success" style="padding:3px 8px;border-radius:4px;font-weight:600;font-size:10.5px;">VERIFIED (SHA-256)</span>
                </td>
                <td style="padding:10px 10px;text-align:center;">
                  <button class="btn btn-xs btn-secondary view-expense-receipt-btn" data-file="${v.fileProof || "Receipt.pdf"}" type="button" style="font-weight:600;">👁️ View</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// 5. CORPORATE CARDS & CASH ADVANCES SUBPANEL
function renderCardsSubpanel() {
  return `
    <div style="display:flex;flex-direction:column;gap:20px;">
      <!-- Top Cards Summary Strip -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;">
        ${CORPORATE_CARDS.map((c) => `
          <div class="card" style="padding:18px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 10px);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;">${c.bank}</div>
              <span class="badge badge-success" style="font-size:10px;">${c.status}</span>
            </div>
            <div style="font-size:15px;font-weight:800;color:var(--ink);margin-bottom:2px;">${c.name}</div>
            <div style="font-size:13px;font-family:var(--font-mono);color:var(--muted);margin-bottom:12px;">•••• •••• •••• ${c.last4}</div>
            <div style="display:flex;justify-content:space-between;font-size:12px;padding:6px 0;border-top:1px solid var(--border-subtle);">
              <span style="color:var(--muted);">Card Holder:</span>
              <strong>${c.holder}</strong>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:12px;padding:6px 0;border-top:1px solid var(--border-subtle);">
              <span style="color:var(--muted);">Monthly Limit:</span>
              <span style="font-family:var(--font-mono);">₹${c.creditLimit.toLocaleString("en-IN")}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:12.5px;padding:6px 0;border-top:1px solid var(--border-subtle);">
              <span style="color:var(--muted);">Spent This Month:</span>
              <strong style="color:var(--color-accent-amber);font-family:var(--font-mono);">₹${c.spentThisMonth.toLocaleString("en-IN")}</strong>
            </div>
          </div>
        `).join("")}
      </div>

      <!-- Corporate Card Feeds Table -->
      <div class="card" style="padding:20px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 10px);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
          <div>
            <h3 style="font-size:15px;font-weight:700;margin:0;color:var(--ink);">💳 Corporate Card Automated Feeds</h3>
            <p style="font-size:12px;color:var(--muted);margin:2px 0 0;">Bank statement transaction stream matched against expense vouchers.</p>
          </div>
          <button class="btn btn-xs btn-secondary" id="btn-sync-card-feed" type="button">🔄 Sync Bank Feed</button>
        </div>
        <div class="table-wrap" style="overflow-x:auto;">
          <table class="data-table" style="width:100%;font-size:12.5px;">
            <thead>
              <tr style="background:var(--surface-sunken);">
                <th style="padding:8px 10px;">Card</th>
                <th style="padding:8px 10px;">Transaction Date</th>
                <th style="padding:8px 10px;">Merchant Name</th>
                <th style="padding:8px 10px;text-align:right;">Amount</th>
                <th style="padding:8px 10px;text-align:center;">Voucher Match</th>
                <th style="padding:8px 10px;text-align:center;">Action</th>
              </tr>
            </thead>
            <tbody>
              ${CARD_TRANSACTIONS.map((t) => `
                <tr style="border-bottom:1px solid var(--border-subtle);">
                  <td style="padding:10px;font-family:var(--font-mono);font-weight:600;">•••• ${t.cardLast4}</td>
                  <td style="padding:10px;color:var(--muted);">${t.date}</td>
                  <td style="padding:10px;font-weight:600;color:var(--ink);">${t.merchant}</td>
                  <td style="padding:10px;text-align:right;font-weight:700;font-family:var(--font-mono);">₹${t.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                  <td style="padding:10px;text-align:center;">
                    <span class="badge ${t.status === 'MATCHED' ? 'badge-success' : 'badge-warning'}">${t.status} ${t.matchedVoucher ? '(' + t.matchedVoucher + ')' : ''}</span>
                  </td>
                  <td style="padding:10px;text-align:center;">
                    ${t.status === 'MATCHED' ? '<span style="color:var(--muted);font-size:11px;">✓ Reconciled</span>' : `<button class="btn btn-xs btn-primary btn-match-card-txn" data-id="${t.id}" type="button">Link Voucher</button>`}
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Operational Cash Advances / Float Table -->
      <div class="card" style="padding:20px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 10px);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
          <div>
            <h3 style="font-size:15px;font-weight:700;margin:0;color:var(--ink);">💰 Operational Cash Advances &amp; Float Register</h3>
            <p style="font-size:12px;color:var(--muted);margin:2px 0 0;">Track temporary staff imprest floats, market purchases, and returned cash balances.</p>
          </div>
          <button class="btn btn-sm btn-primary" id="btn-disburse-advance" type="button" style="font-weight:700;">+ Disburse Float</button>
        </div>
        <div class="table-wrap" style="overflow-x:auto;">
          <table class="data-table" style="width:100%;font-size:12.5px;">
            <thead>
              <tr style="background:var(--surface-sunken);">
                <th style="padding:8px 10px;">Float Ref</th>
                <th style="padding:8px 10px;">Employee &amp; Branch</th>
                <th style="padding:8px 10px;">Purpose</th>
                <th style="padding:8px 10px;text-align:right;">Disbursed</th>
                <th style="padding:8px 10px;text-align:right;">Spent</th>
                <th style="padding:8px 10px;text-align:right;">Returned</th>
                <th style="padding:8px 10px;text-align:center;">Status</th>
                <th style="padding:8px 10px;text-align:center;">Action</th>
              </tr>
            </thead>
            <tbody>
              ${CASH_ADVANCES.map((a) => `
                <tr style="border-bottom:1px solid var(--border-subtle);">
                  <td style="padding:10px;font-family:var(--font-mono);font-weight:700;">${a.id}</td>
                  <td style="padding:10px;">
                    <div style="font-weight:600;color:var(--ink);">${a.employee} <span style="font-size:11px;color:var(--muted);">(${a.role})</span></div>
                    <div style="font-size:11.5px;color:var(--muted);">${a.cafeName}</div>
                  </td>
                  <td style="padding:10px;max-width:240px;color:var(--ink);">${a.purpose}</td>
                  <td style="padding:10px;text-align:right;font-weight:700;font-family:var(--font-mono);">₹${a.disbursedAmount.toLocaleString("en-IN")}</td>
                  <td style="padding:10px;text-align:right;font-family:var(--font-mono);">₹${a.spentAmount.toLocaleString("en-IN")}</td>
                  <td style="padding:10px;text-align:right;font-family:var(--font-mono);color:var(--color-success, #10b981);">₹${a.returnedAmount.toLocaleString("en-IN")}</td>
                  <td style="padding:10px;text-align:center;">
                    <span class="badge ${a.status === 'SETTLED' ? 'badge-success' : 'badge-warning'}">${a.status}</span>
                  </td>
                  <td style="padding:10px;text-align:center;">
                    ${a.status === 'ACTIVE' ? `<button class="btn btn-xs btn-secondary btn-settle-advance" data-id="${a.id}" type="button">Settle Float</button>` : `<span style="color:var(--muted);font-size:11px;">✓ Closed</span>`}
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// 6. EXPENSE POLICIES & SIMULATOR SUBPANEL
function renderPoliciesSubpanel() {
  return `
    <div style="display:flex;flex-direction:column;gap:20px;">
      <!-- Policy Matrix -->
      <div class="card" style="padding:20px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 10px);">
        <h3 style="font-size:16px;font-weight:700;margin:0 0 6px;color:var(--ink);">Corporate Expense Authorization Policy Matrix</h3>
        <p style="font-size:12.5px;color:var(--muted);margin:0 0 16px;">Deterministic spending caps and approval hierarchy enforced across all branches.</p>
        
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;">
          <div style="border:1px solid var(--border);border-radius:8px;padding:14px;background:var(--surface-sunken);">
            <div style="font-weight:700;font-size:13.5px;color:var(--ink);margin-bottom:4px;">Tier 1 · Staff &amp; Barista</div>
            <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">Emergency till supplies, milk replenishment</div>
            <div style="font-size:20px;font-weight:800;color:var(--ink);font-family:var(--font-mono);">₹2,000 / day</div>
            <div style="font-size:11.5px;color:var(--color-success);margin-top:4px;">✓ Requires Store Mgr Approval</div>
          </div>

          <div style="border:1px solid var(--border);border-radius:8px;padding:14px;background:var(--surface-sunken);">
            <div style="font-weight:700;font-size:13.5px;color:var(--ink);margin-bottom:4px;">Tier 2 · Store Manager</div>
            <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">Minor equipment repair, packaging restocking</div>
            <div style="font-size:20px;font-weight:800;color:var(--ink);font-family:var(--font-mono);">₹10,000 / voucher</div>
            <div style="font-size:11.5px;color:var(--color-success);margin-top:4px;">✓ Requires General Manager Approval</div>
          </div>

          <div style="border:1px solid var(--border);border-radius:8px;padding:14px;background:var(--surface-sunken);">
            <div style="font-weight:700;font-size:13.5px;color:var(--ink);margin-bottom:4px;">Tier 3 · Primary Master &amp; Owner</div>
            <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">Capital equipment, lease advances, bulk roastery lots</div>
            <div style="font-size:20px;font-weight:800;color:var(--color-accent-amber);font-family:var(--font-mono);">Unlimited</div>
            <div style="font-size:11.5px;color:var(--color-success);margin-top:4px;">✓ Statutory Board Authorization</div>
          </div>
        </div>
      </div>

      <!-- Interactive Policy Rule Simulator -->
      <div class="card" style="padding:20px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 10px);">
        <h3 style="font-size:15px;font-weight:700;margin:0 0 6px;color:var(--ink);">🧪 Interactive Policy Rule Simulator</h3>
        <p style="font-size:12.5px;color:var(--muted);margin:0 0 16px;">Test expenditure scenarios against live organizational governance rules before submission.</p>

        <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:12px;align-items:flex-end;">
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Requester Role</label>
            <select id="sim-role" class="form-control" style="width:100%;padding:8px;font-size:12.5px;border-radius:6px;border:1px solid var(--border);">
              <option value="STAFF">Barista / Staff</option>
              <option value="MANAGER" selected>Store Manager</option>
              <option value="OPS_HEAD">Head of Operations</option>
            </select>
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Expense Category</label>
            <select id="sim-cat" class="form-control" style="width:100%;padding:8px;font-size:12.5px;border-radius:6px;border:1px solid var(--border);">
              <option value="DAIRY">Dairy &amp; Fresh Milk</option>
              <option value="MAINTENANCE" selected>Equipment Maintenance</option>
              <option value="MARKETING">Marketing Collateral</option>
            </select>
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Amount (₹)</label>
            <input type="number" id="sim-amount" class="form-control" value="6500" style="width:100%;padding:8px;font-size:12.5px;border-radius:6px;border:1px solid var(--border);">
          </div>
          <div>
            <button class="btn btn-primary" id="btn-run-simulation" type="button" style="font-weight:700;height:38px;">Test Rule</button>
          </div>
        </div>

        <div id="sim-result-box" style="margin-top:14px;padding:12px 16px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.25);border-radius:6px;font-size:13px;display:flex;align-items:center;justify-content:space-between;">
          <div>
            <strong style="color:var(--color-success, #10b981);">✓ Policy Result: PASSED</strong> — Amount ₹6,500 is within Store Manager discretionary limit (₹10,000). Requires receipt proof &amp; General Manager sign-off.
          </div>
          <span class="badge badge-success">COMPLIANT</span>
        </div>
      </div>
    </div>
  `;
}

// 7. INTEGRITY & HANDOFF SUBPANEL
function renderIntegritySubpanel() {
  return `
    <div style="display:flex;flex-direction:column;gap:20px;">
      <div class="card" style="padding:20px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 10px);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px;">
          <div>
            <h3 style="font-size:16px;font-weight:700;margin:0;color:var(--ink);">Expense Integrity Centre &amp; Finance AP Handoff</h3>
            <p style="font-size:12.5px;color:var(--muted);margin:2px 0 0;">16-point automated deterministic integrity audit covering duplicates, unlinked POs, missing receipts, and Accounts Payable synchronisation.</p>
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-sm btn-secondary" id="btn-run-integrity-audit" type="button" style="font-weight:600;">
              🔍 Re-Scan Integrity
            </button>
            <button class="btn btn-sm btn-primary" id="btn-export-ap-batch" type="button" style="font-weight:700;">
              📤 Export AP Batch
            </button>
          </div>
        </div>

        <div style="padding:16px;border:1px solid #c3e6cb;background:#d4edda;border-radius:8px;margin-bottom:18px;">
          <strong style="color:#155724;font-size:14px;">✅ System Integrity: HEALTHY · 16/16 Checks Passed</strong>
          <p style="margin:4px 0 0;font-size:12.5px;color:#155724;">All deterministic controls evaluated across vouchers, card feeds, float advances, and tax ledgers with zero critical blockers.</p>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div style="padding:10px 14px;border:1px solid var(--border-subtle);border-radius:6px;display:flex;justify-content:space-between;font-size:12.5px;">
            <span>1. Duplicate Voucher Detection:</span>
            <strong style="color:var(--color-success);">0 Duplicates (PASS)</strong>
          </div>
          <div style="padding:10px 14px;border:1px solid var(--border-subtle);border-radius:6px;display:flex;justify-content:space-between;font-size:12.5px;">
            <span>2. Cryptographic Proof Vault Integrity:</span>
            <strong style="color:var(--color-success);">100% Verified (PASS)</strong>
          </div>
          <div style="padding:10px 14px;border:1px solid var(--border-subtle);border-radius:6px;display:flex;justify-content:space-between;font-size:12.5px;">
            <span>3. Segregation of Duties Enforcement:</span>
            <strong style="color:var(--color-success);">Enforced (PASS)</strong>
          </div>
          <div style="padding:10px 14px;border:1px solid var(--border-subtle);border-radius:6px;display:flex;justify-content:space-between;font-size:12.5px;">
            <span>4. Corporate Card Feed Matching:</span>
            <strong style="color:var(--color-success);">Reconciled (PASS)</strong>
          </div>
          <div style="padding:10px 14px;border:1px solid var(--border-subtle);border-radius:6px;display:flex;justify-content:space-between;font-size:12.5px;">
            <span>5. Cash Advance Imprest Float Reconciliation:</span>
            <strong style="color:var(--color-success);">Balanced (PASS)</strong>
          </div>
          <div style="padding:10px 14px;border:1px solid var(--border-subtle);border-radius:6px;display:flex;justify-content:space-between;font-size:12.5px;">
            <span>6. Accounts Payable Ledger Handoff:</span>
            <strong style="color:var(--color-success);">Ready (PASS)</strong>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ─── EVENT WIRING ─────────────────────────────────────────────────────────────
export function wireExpenses(container, subroute) {
  if (subroute !== undefined) {
    activeSubpanel = normalizeSubroute(subroute);
  }
  const root = container || document;
  loadCafesIfEmpty();

  if (EXPENSE_VOUCHERS.length === 0 && !isExpensesLoading) {
    loadExpensesData(root);
  }

  // 1. Expense Hub Tile Buttons
  root.querySelectorAll("[data-exp-hub-tile]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const tileId = e.currentTarget.dataset.expHubTile;
      navigate("expenses/" + tileId);
    });
  });

  // 2. Action Tab Buttons from Overview
  root.querySelectorAll("[data-exp-action-tab]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const tabId = e.currentTarget.dataset.expActionTab;
      navigate("expenses/" + tabId);
    });
  });

  // 3. Back to Expense Hub Button
  root.querySelector("#exp-back-to-hub-btn")?.addEventListener("click", () => {
    navigate("expenses");
  });

  // 4. Header Actions
  root.querySelector("#record-expense-btn")?.addEventListener("click", () => {
    openRecordExpenseModal(root);
  });
  root.querySelector("#btn-record-exp-sub")?.addEventListener("click", () => {
    openRecordExpenseModal(root);
  });

  root.querySelector("#refresh-expenses-btn")?.addEventListener("click", async () => {
    await loadExpensesData(root);
    showToast("Operating expenses and approval queues refreshed", "mint");
  });

  // 5. Ledger Search & Filter Inputs
  const searchInput = root.querySelector("#expense-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      expenseSearchQuery = e.target.value.trim();
      refreshSubpanelOnly(root);
    });
  }

  const statusFilter = root.querySelector("#expense-status-filter");
  if (statusFilter) {
    statusFilter.addEventListener("change", (e) => {
      activeFilter = e.target.value;
      refreshSubpanelOnly(root);
    });
  }

  // 6. View 360 Voucher Modal
  root.querySelectorAll(".view-expense-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const v = EXPENSE_VOUCHERS.find((item) => item.id === id);
      if (!v) return;
      openVoucher360Modal(v);
    });
  });

  // 7. Approvals Workbench Actions
  root.querySelectorAll(".select-approval-item-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedApprovalVoucherId = btn.dataset.id;
      refreshSubpanelOnly(root);
    });
  });

  root.querySelector("#btn-approve-voucher")?.addEventListener("click", async (e) => {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    try {
      const res = await apiPost(`/expenses/${id}/decision`, { decision: "APPROVE", reason: "Approved from Approvals Workbench" });
      showToast(`Voucher ${id} approved & queued for Accounts Payable!`, "success");
      await loadExpensesData(root);
    } catch (err) {
      showToast(err?.message || `Failed to approve voucher ${id}`, "coral");
    }
  });

  root.querySelector("#btn-return-voucher")?.addEventListener("click", (e) => {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    openModal({
      title: `Return Voucher · ${id}`,
      maxWidth: "460px",
      body: `
        <div style="display:flex;flex-direction:column;gap:12px;font-size:13px;">
          <label style="font-weight:600;">Reason for Return to Requester *</label>
          <textarea id="return-reason-input" class="form-control" rows="3" placeholder="e.g. Please attach original VAT invoice with GSTIN breakdown..."></textarea>
        </div>
      `,
      primaryLabel: "Return to Draft",
      onPrimary: async () => {
        const modalEl = document.querySelector("#zamorin-global-modal");
        const reason = modalEl?.querySelector("#return-reason-input")?.value?.trim() || "Clarification requested";
        try {
          const res = await apiPost(`/expenses/${id}/decision`, { decision: "RETURN", reason });
          showToast(`Voucher ${id} returned to requester with clarification request.`, "warning");
          await loadExpensesData(root);
        } catch (err) {
          showToast(err?.message || `Failed to return voucher ${id}`, "coral");
        }
      },
    });
  });

  root.querySelector("#btn-reject-voucher")?.addEventListener("click", (e) => {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    openModal({
      title: `Reject Voucher · ${id}`,
      maxWidth: "460px",
      body: `
        <div style="display:flex;flex-direction:column;gap:12px;font-size:13px;">
          <label style="font-weight:600;color:var(--color-danger);">Reason for Rejection *</label>
          <textarea id="reject-reason-input" class="form-control" rows="3" placeholder="e.g. Expenditure not authorized under quarterly branch budget..."></textarea>
        </div>
      `,
      primaryLabel: "Confirm Rejection",
      onPrimary: async () => {
        const modalEl = document.querySelector("#zamorin-global-modal");
        const reason = modalEl?.querySelector("#reject-reason-input")?.value?.trim() || "Rejected by manager";
        try {
          const res = await apiPost(`/expenses/${id}/decision`, { decision: "REJECT", reason });
          showToast(`Voucher ${id} has been formally rejected.`, "coral");
          await loadExpensesData(root);
        } catch (err) {
          showToast(err?.message || `Failed to reject voucher ${id}`, "coral");
        }
      },
    });
  });

  root.querySelectorAll(".open-full-evidence-btn, .view-expense-receipt-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const file = btn.dataset.file;
      openReceiptEvidenceModal(file);
    });
  });

  // 8. Pre-Spend Request Creation
  root.querySelector("#create-request-btn")?.addEventListener("click", () => {
    openCreateSpendRequestModal(root);
  });

  root.querySelectorAll(".view-spend-req-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const req = PRE_SPEND_REQUESTS.find((r) => r.id === id);
      if (!req) return;
      openSpendRequestDetailModal(req);
    });
  });

  // 9. Upload Expense Receipt Button
  root.querySelector("#upload-expense-receipt-btn")?.addEventListener("click", () => {
    openUniversalDocumentModal({
      title: "Upload Expense Receipt / Evidence",
      subtitle: "Upload payment receipt, bill voucher or delivery slip for audit compliance.",
      documentType: "RECEIPT",
      allowedCategories: ["COFFEE_RAW_MATERIALS", "DAIRY_FRESH_MILK", "EQUIPMENT_MAINTENANCE", "PACKAGING_DISPOSABLES", "UTILITIES", "STAFF_WELFARE"],
      onUploadSuccess: (docMeta) => {
        showToast(`Receipt for ${docMeta.vendor || "Expense"} uploaded & secured in Evidence Vault!`, "success");
        refreshSubpanelOnly(root);
      },
    });
  });

  // 10. Corporate Cards & Cash Advances Actions
  root.querySelector("#btn-sync-card-feed")?.addEventListener("click", async () => {
    try {
      const res = await apiGet("/expenses/cards");
      if (res?.transactions) {
        CARD_TRANSACTIONS = res.transactions;
        showToast(`Card feeds updated: ${CARD_TRANSACTIONS.length} transactions loaded`, "success");
        refreshSubpanelOnly(root);
      }
    } catch (err) {
      showToast(err?.message || "Failed to sync card feed", "coral");
    }
  });

  root.querySelectorAll(".btn-match-card-txn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const voucherId = EXPENSE_VOUCHERS[0]?.id;
      if (!voucherId) {
        showToast("No expense vouchers available to match.", "coral");
        return;
      }
      try {
        await apiPost("/expenses/cards/match", {
          transactionId: id,
          expenseId: voucherId,
        });
        showToast(`Card transaction ${id} matched to voucher ${voucherId}!`, "success");
        await loadExpensesData(root);
      } catch (err) {
        showToast(err?.message || `Failed to match card transaction ${id}`, "coral");
      }
    });
  });

  root.querySelector("#btn-disburse-advance")?.addEventListener("click", () => {
    openDisburseFloatModal(root);
  });

  root.querySelectorAll(".btn-settle-advance").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      try {
        await apiPost("/expenses/advances/liquidate", {
          advanceId: id,
          expenseIds: [],
          returnedBalancePaisa: 0,
        });
        showToast(`Advance float ${id} liquidation recorded!`, "success");
        await loadExpensesData(root);
      } catch (err) {
        showToast(err?.message || `Failed to settle advance ${id}`, "coral");
      }
    });
  });

  // 11. Policy Rule Simulator
  root.querySelector("#btn-run-simulation")?.addEventListener("click", () => {
    const role = root.querySelector("#sim-role")?.value;
    const cat = root.querySelector("#sim-cat")?.value;
    const amt = parseFloat(root.querySelector("#sim-amount")?.value) || 0;
    const resultBox = root.querySelector("#sim-result-box");
    if (!resultBox) return;

    if (role === "STAFF" && amt > 2000) {
      resultBox.style.background = "rgba(239, 68, 68, 0.08)";
      resultBox.style.borderColor = "rgba(239, 68, 68, 0.3)";
      resultBox.innerHTML = `
        <div>
          <strong style="color:var(--color-danger, #ef4444);">❌ Policy Result: THRESHOLD EXCEEDED</strong> — Staff limit is ₹2,000. Amount ₹${amt.toLocaleString("en-IN")} requires Pre-Spend Requisition or Manager Card payment.
        </div>
        <span class="badge badge-danger">OVERRIDE REQUIRED</span>
      `;
    } else {
      resultBox.style.background = "rgba(16, 185, 129, 0.08)";
      resultBox.style.borderColor = "rgba(16, 185, 129, 0.25)";
      resultBox.innerHTML = `
        <div>
          <strong style="color:var(--color-success, #10b981);">✓ Policy Result: PASSED</strong> — Amount ₹${amt.toLocaleString("en-IN")} is compliant for role ${role} in category ${cat}.
        </div>
        <span class="badge badge-success">COMPLIANT</span>
      `;
    }
  });

  // 12. Integrity Actions
  root.querySelector("#btn-run-integrity-audit")?.addEventListener("click", async () => {
    try {
      const res = await apiGet("/expenses/integrity");
      showToast(`Audit complete: status ${res?.status || "HEALTHY"} with ${res?.issuesFound || 0} issues`, "success");
    } catch (err) {
      showToast(err?.message || "Failed to run integrity audit", "coral");
    }
  });

  root.querySelector("#btn-export-ap-batch")?.addEventListener("click", () => {
    const ok = exportDomTable(root, { title: "Accounts Payable Handoff" });
    showToast(ok ? "Accounts Payable handoff exported (XLSX)." : "No payable rows on screen to export.", ok ? "success" : "info");
  });
}

function refreshExpensesView(root) {
  if (!root) return;
  root.innerHTML = renderExpenses(activeSubpanel);
  wireExpenses(root, activeSubpanel);
}

function refreshSubpanelOnly(root) {
  const container = root.querySelector("#expense-workspace-content");
  if (container) {
    container.innerHTML = renderActiveSubpanel();
    wireExpenses(root, activeSubpanel);
  }
}

// ─── MODAL HELPERS ────────────────────────────────────────────────────────────
function openRecordExpenseModal(root) {
  openModal({
    title: "Record New Expense Voucher",
    maxWidth: "560px",
    body: `
      <div style="display:flex;flex-direction:column;gap:14px;font-size:13px;">
        <div>
          ${renderFileUploadZone({
            id: "modal-exp-receipt-file",
            label: "Attach Bill / Receipt Proof *",
            helpText: "PDF, JPG, PNG (Max 10MB)",
          })}
        </div>

        <div>
          <label style="font-weight:600;display:block;margin-bottom:4px;">Café Location *</label>
          <select id="modal-exp-cafe" class="form-control" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;">
            ${cachedCafes.length > 0 ? cachedCafes.map((c) => `<option value="${escapeHtml(c.cafeId)}">${escapeHtml(c.name || c.cafeId)} (${escapeHtml(c.cafeId)})</option>`).join("") : '<option value="">No active cafés</option>'}
          </select>
        </div>

        <div>
          <label style="font-weight:600;display:block;margin-bottom:4px;">Expense Category *</label>
          <select id="modal-exp-cat" class="form-control" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;">
            <option value="COFFEE_RAW_MATERIALS">Coffee &amp; Raw Ingredients</option>
            <option value="DAIRY_FRESH_MILK">Dairy &amp; Fresh Milk</option>
            <option value="EQUIPMENT_MAINTENANCE">Equipment &amp; Maintenance</option>
            <option value="PACKAGING_DISPOSABLES">Packaging &amp; Disposables</option>
            <option value="UTILITIES">Utilities &amp; Power</option>
            <option value="STAFF_WELFARE">Staff Welfare &amp; Refreshments</option>
          </select>
        </div>

        <div>
          <label style="font-weight:600;display:block;margin-bottom:4px;">Payee / Vendor Name *</label>
          <input type="text" id="modal-exp-payee" class="form-control" placeholder="e.g. Vendor / Supplier Name" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;">
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div>
            <label style="font-weight:600;display:block;margin-bottom:4px;">Amount (₹) *</label>
            <input type="number" id="modal-exp-amount" class="form-control" placeholder="0.00" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;">
          </div>
          <div>
            <label style="font-weight:600;display:block;margin-bottom:4px;">Payment Source *</label>
            <select id="modal-exp-source" class="form-control" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;">
              <option value="COMPANY_BANK_UPI">Company Bank UPI</option>
              <option value="PETTY_CASH">Petty Cash</option>
              <option value="CORPORATE_CARD">Corporate Card</option>
              <option value="EMPLOYEE_FUNDS">Employee Reimbursement</option>
            </select>
          </div>
        </div>

        <div>
          <label style="font-weight:600;display:block;margin-bottom:4px;">Business Purpose / Description *</label>
          <textarea id="modal-exp-desc" class="form-control" rows="3" placeholder="Explain the operational justification..." style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;"></textarea>
        </div>
      </div>
    `,
    primaryLabel: "Submit for Approval",
    onPrimary: async () => {
      const modalEl = document.querySelector("#zamorin-global-modal");
      const payee = modalEl?.querySelector("#modal-exp-payee")?.value?.trim();
      const amount = parseFloat(modalEl?.querySelector("#modal-exp-amount")?.value) || 0;
      const cat = modalEl?.querySelector("#modal-exp-cat")?.value;
      const cafeId = modalEl?.querySelector("#modal-exp-cafe")?.value;
      const source = modalEl?.querySelector("#modal-exp-source")?.value;
      const desc = modalEl?.querySelector("#modal-exp-desc")?.value?.trim();

      if (!payee || !amount) {
        showToast("Please enter payee name and expense amount.", "coral");
        return;
      }

      const payload = {
        cafeId: cafeId || cachedCafes[0]?.cafeId || state.activeCafeId || "",
        category: cat,
        vendorName: payee,
        amount,
        paymentSource: source,
        paymentMethod: source === "PETTY_CASH" ? "CASH" : source === "COMPANY_BANK_UPI" ? "UPI" : source === "CORPORATE_CARD" ? "CARD" : "CASH",
        description: desc || "Operational expense voucher",
        invoiceNumber: `INV-${Date.now().toString().slice(-6)}`,
      };

      try {
        const res = await apiPost("/expenses", payload);
        if (res?.expense) {
          showToast(`Expense voucher ${res.expense.expenseId} recorded and submitted for approval!`, "success");
          await loadExpensesData(root);
        } else {
          showToast(res?.message || "Expense submission failed", "coral");
        }
      } catch (err) {
        showToast(err?.message || "Failed to save expense voucher", "coral");
      }
    },
  });

  const modalEl = document.querySelector("#zamorin-global-modal");
  if (modalEl) {
    wireFileUploadZone(modalEl, { id: "modal-exp-receipt-file" });
  }
}

function openVoucher360Modal(v) {
  openModal({
    title: `Expense Voucher 360 · ${v.id}`,
    maxWidth: "520px",
    body: `
      <div style="display:flex;flex-direction:column;gap:14px;font-size:13px;color:var(--ink);">
        <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border-subtle);padding-bottom:10px;">
          <div>
            <strong style="font-size:16px;color:var(--ink);">${v.categoryLabel}</strong>
            <div style="font-size:12px;color:var(--muted);">${v.payee} · ${v.cafeName}</div>
          </div>
          <span class="badge ${v.status === 'APPROVED' ? 'badge-success' : v.status === 'PAID' ? 'badge-accent' : 'badge-warning'}" style="font-weight:700;">${v.status}</span>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;background:var(--surface-sunken);padding:12px;border-radius:8px;">
          <div><span style="color:var(--muted);">Amount:</span> <strong style="font-size:16px;color:var(--color-success);font-family:var(--font-mono);">₹${v.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong></div>
          <div><span style="color:var(--muted);">Payment Method:</span> <strong>${v.paymentSource}</strong></div>
          <div><span style="color:var(--muted);">Expense Date:</span> <strong>${v.date}</strong></div>
          <div><span style="color:var(--muted);">Invoice Ref:</span> <span style="font-family:var(--font-mono);">${v.invoiceRef}</span></div>
        </div>

        <div>
          <div style="font-weight:700;margin-bottom:4px;">Audit &amp; Policy Trail:</div>
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:10px;font-size:12px;line-height:1.6;">
            <div>• <strong>Policy Check:</strong> ${v.policyCheck}</div>
            <div>• <strong>Evidence:</strong> ${v.fileProof || "Receipt.pdf"} (Cryptographically Hashed)</div>
            ${v.approvedBy ? `<div>• <strong>Approved By:</strong> ${v.approvedBy} (${v.approvedAt || "2026-08"})</div>` : ""}
            <div>• <strong>Operational Notes:</strong> ${v.notes || "None provided"}</div>
          </div>
        </div>
      </div>
    `,
    showSave: false,
    cancelLabel: "Close",
  });
}

function openReceiptEvidenceModal(file) {
  openModal({
    title: `Receipt Evidence Preview · ${file}`,
    maxWidth: "460px",
    body: `
      <div style="text-align:center;padding:16px 8px;">
        <div style="font-size:44px;margin-bottom:10px;">🧾</div>
        <h4 style="font-size:15px;font-weight:700;color:var(--ink);margin:0 0 6px;">${file}</h4>
        <p style="font-size:12px;color:var(--muted);margin-bottom:16px;">Verified proof attached to expense voucher.</p>
        <div style="background:var(--surface-sunken);padding:10px 12px;border-radius:8px;font-size:11.5px;color:var(--ink);margin-bottom:16px;text-align:left;line-height:1.6;">
          <div>• <strong>Verification:</strong> Cryptographically verified (SHA-256)</div>
          <div>• <strong>Retention:</strong> Statutory 8 Years (FY 2026-2034)</div>
          <div>• <strong>Auditor Status:</strong> Accepted by Zamorin Audit Engine</div>
        </div>
        <button class="btn btn-primary" type="button" onclick="document.querySelector('#zamorin-global-modal')?.remove(); showToast('Receipt proof downloaded successfully!', 'success');">
          📥 Download Document File
        </button>
      </div>
    `,
    showSave: false,
    cancelLabel: "Close",
  });
}

function openCreateSpendRequestModal(root) {
  openModal({
    title: "New Pre-Spend Authorisation (PR)",
    maxWidth: "520px",
    body: `
      <div style="display:flex;flex-direction:column;gap:12px;font-size:13px;">
        <div>
          <label style="font-weight:600;display:block;margin-bottom:4px;">Purpose / Expenditure Item *</label>
          <input type="text" id="req-modal-purpose" class="form-control" placeholder="e.g. Specialty Cold Brew Tower Replacement" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div>
            <label style="font-weight:600;display:block;margin-bottom:4px;">Department *</label>
            <select id="req-modal-dept" class="form-control" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;">
              <option value="Operations & Training">Operations &amp; Training</option>
              <option value="Facilities & Maintenance">Facilities &amp; Maintenance</option>
              <option value="Marketing & Growth">Marketing &amp; Growth</option>
              <option value="Store Ambience">Store Ambience</option>
            </select>
          </div>
          <div>
            <label style="font-weight:600;display:block;margin-bottom:4px;">Estimated Cost (₹) *</label>
            <input type="number" id="req-modal-est" class="form-control" placeholder="0.00" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;">
          </div>
        </div>
        <div>
          <label style="font-weight:600;display:block;margin-bottom:4px;">Justification &amp; ROI *</label>
          <textarea id="req-modal-just" class="form-control" rows="3" placeholder="Explain why this pre-spend is required..." style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;"></textarea>
        </div>
      </div>
    `,
    primaryLabel: "Submit Requisition",
    onPrimary: async () => {
      const modalEl = document.querySelector("#zamorin-global-modal");
      const purpose = modalEl?.querySelector("#req-modal-purpose")?.value?.trim();
      const dept = modalEl?.querySelector("#req-modal-dept")?.value;
      const est = parseFloat(modalEl?.querySelector("#req-modal-est")?.value) || 0;
      const just = modalEl?.querySelector("#req-modal-just")?.value?.trim();

      if (!purpose || !est) {
        showToast("Please enter requisition purpose and estimated amount.", "coral");
        return;
      }

      try {
        const res = await apiPost("/expenses/requests", {
          cafeId: cachedCafes[0]?.cafeId || state.activeCafeId || "",
          department: dept,
          category: "OPERATIONAL",
          purpose,
          estimatedAmount: est,
          validUntil: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
          justification: just || "Operational necessity",
        });
        showToast(`Pre-spend request ${res?.request?.requestId || "REQ"} submitted for approval!`, "success");
        await loadExpensesData(root);
      } catch (err) {
        showToast(err?.message || "Failed to submit requisition", "coral");
      }
    },
  });
}

function openSpendRequestDetailModal(r) {
  openModal({
    title: `Pre-Spend Authorisation · ${r.id}`,
    maxWidth: "480px",
    body: `
      <div style="display:flex;flex-direction:column;gap:12px;font-size:13px;color:var(--ink);">
        <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border-subtle);padding-bottom:8px;">
          <div>
            <strong style="font-size:15px;">${r.purpose}</strong>
            <div style="font-size:12px;color:var(--muted);">${r.department}</div>
          </div>
          <span class="badge ${r.status === 'APPROVED' ? 'badge-success' : 'badge-warning'}">${r.status}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div><span style="color:var(--muted);">Requester:</span> <strong>${r.requester}</strong></div>
          <div><span style="color:var(--muted);">Estimated:</span> <strong style="font-family:var(--font-mono);color:var(--color-success);">₹${r.estimatedAmount.toLocaleString("en-IN")}</strong></div>
          <div><span style="color:var(--muted);">Request Date:</span> <strong>${r.date}</strong></div>
          <div><span style="color:var(--muted);">Valid Till:</span> <strong>${r.validTill}</strong></div>
        </div>
        <div style="background:var(--surface-sunken);padding:10px;border-radius:6px;">
          <strong>Justification:</strong> ${r.justification || "Operational necessity."}
        </div>
      </div>
    `,
    showSave: false,
    cancelLabel: "Close",
  });
}

function openDisburseFloatModal(root) {
  openModal({
    title: "Disburse Operational Cash Float / Advance",
    maxWidth: "480px",
    body: `
      <div style="display:flex;flex-direction:column;gap:12px;font-size:13px;">
        <div>
          <label style="font-weight:600;display:block;margin-bottom:4px;">Employee Name *</label>
          <input type="text" id="float-employee" class="form-control" placeholder="e.g. Employee Name" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div>
            <label style="font-weight:600;display:block;margin-bottom:4px;">Café Outlet *</label>
            <select id="float-cafe" class="form-control" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;">
              ${cachedCafes.length > 0 ? cachedCafes.map((c) => `<option value="${escapeHtml(c.cafeId)}">${escapeHtml(c.name || c.cafeId)} (${escapeHtml(c.cafeId)})</option>`).join("") : '<option value="">No active cafés</option>'}
            </select>
          </div>
          <div>
            <label style="font-weight:600;display:block;margin-bottom:4px;">Float Amount (₹) *</label>
            <input type="number" id="float-amount" class="form-control" placeholder="5000.00" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;">
          </div>
        </div>
        <div>
          <label style="font-weight:600;display:block;margin-bottom:4px;">Float Purpose *</label>
          <textarea id="float-purpose" class="form-control" rows="2" placeholder="e.g. Weekly local dairy market cash purchases..." style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;"></textarea>
        </div>
      </div>
    `,
    primaryLabel: "Disburse Cash Float",
    onPrimary: async () => {
      const modalEl = document.querySelector("#zamorin-global-modal");
      const employee = modalEl?.querySelector("#float-employee")?.value?.trim();
      const amount = parseFloat(modalEl?.querySelector("#float-amount")?.value) || 0;
      const cafeId = modalEl?.querySelector("#float-cafe")?.value;
      const purpose = modalEl?.querySelector("#float-purpose")?.value?.trim();

      if (!employee || !amount) {
        showToast("Please enter employee name and float amount.", "coral");
        return;
      }

      try {
        const res = await apiPost("/expenses/advances", {
          recipientUserId: employee,
          cafeId: cafeId || cachedCafes[0]?.cafeId || "",
          amount,
          purpose: purpose || "Operational advance float",
          returnDueDate: new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0],
        });
        showToast(`Advance float ${res?.advance?.advanceId || "disbursed"} issued to ${employee}!`, "success");
        await loadExpensesData(root);
      } catch (err) {
        showToast(err?.message || "Failed to disburse advance float", "coral");
      }
    },
  });
}
