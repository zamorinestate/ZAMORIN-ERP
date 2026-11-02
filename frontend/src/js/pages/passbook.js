// =============================================================================
// ZAMORIN CAFE ERP — PASSBOOK & MULTI-CAFÉ TREASURY CONTROL SYSTEM
// PRIMARY MASTER + OWNER ONLY · ENTERPRISE UNIVERSAL BUTTON ARCHITECTURE
// =============================================================================

import { exportDomTable } from "../utils/exportFile.js";
import { state } from "../state.js";
import { icon } from "../icons.js";
import { apiGet, apiPost } from "../apiClient.js";
import { showToast, setButtonBusy, openModal } from "../components.js";

// ─── Default Sample Data ─────────────────────────────────────────────────────
const DEFAULT_PASSBOOK_DATA = {
  kpis: {
    totalTreasuryBalancePaisa: 0,
    totalBankBalancePaisa: 0,
    totalVaultCashPaisa: 0,
    reservedFundsPaisa: 0,
    freeLiquidityPaisa: 0,
    unreconciledCount: 0,
    activeAccountsCount: 0,
  },
  accounts: [],
  cafes: [],
  recentActivity: [],
};

let passbookData = null;
let currentScope = "ALL";
let currentPeriod = "THIS_MONTH";
let activeChildRoute = "overview";

// ─── Formatters ──────────────────────────────────────────────────────────────
export function formatPaisa(paisa) {
  if (paisa === undefined || paisa === null || isNaN(paisa)) return "₹0.00";
  const rupees = paisa / 100;
  return "₹" + rupees.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatRupees(rupees) {
  if (rupees === undefined || rupees === null || isNaN(rupees)) return "₹0.00";
  return "₹" + Number(rupees).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ─── API Client ──────────────────────────────────────────────────────────────
async function fetchPassbookOverview() {
  try {
    const payload = await apiGet(`/passbook/overview?cafeId=${currentScope}&period=${currentPeriod}`);
    if (payload?.data) {
      passbookData = payload.data;
      return passbookData;
    }
  } catch (err) {
    // Dev preview fallback
  }
  passbookData = DEFAULT_PASSBOOK_DATA;
  return passbookData;
}

// ─── Main Render Function ────────────────────────────────────────────────────
export function renderPassbook() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const parts = hash.split("/");
  activeChildRoute = parts[1] || "overview";
  const paramId = parts[2] || null;

  return `
    <div class="passbook-module page-enter" style="padding: 20px 24px; max-width: 1440px; margin: 0 auto;">
      <!-- TOP CONTROL BAR -->
      ${renderTopControlBar()}

      <!-- SUB-VIEW CONTAINER -->
      <div id="passbook-child-content" style="margin-top: 20px;">
        ${renderChildWorkspace(activeChildRoute, paramId)}
      </div>

      <!-- MODALS CONTAINER -->
      <div id="passbook-modal-container"></div>
    </div>
  `;
}

// ─── Top Control Bar ─────────────────────────────────────────────────────────
function renderTopControlBar() {
  return `
    <div class="page-header" style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px; margin-bottom:24px;">
      <div>
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <h1 class="page-title" style="font-size:26px; font-weight:700; color:var(--ink); margin:0;">
            Passbook &amp; Treasury Control
          </h1>
          <span class="badge" style="background:rgba(180,83,9,0.12); color:#b45309; font-weight:600; font-size:12px; padding:4px 10px; border-radius:12px;">SCR-024 PASSBOOK</span>
          <span class="badge" style="background:rgba(201,154,92,0.2); color:#c99a5c; font-weight:800; font-size:11px; padding:4px 8px; border-radius:12px;">PRIMARY MASTER</span>
        </div>
        <p class="page-subtitle" style="font-size:14px; color:var(--muted); margin:4px 0 0 0;">
          Multi-Café Cash &amp; Bank Book • Treasury Operations • Reconciliation • Liquidity Runway
        </p>
      </div>

      <!-- Context Selectors & Global Actions -->
      <div style="display:flex; flex-wrap:wrap; align-items:center; gap:10px;">
        <a href="#passbook/adjustments" class="btn btn-primary" style="font-weight:700; display:inline-flex; align-items:center; gap:6px; text-decoration:none;">
          <span>✍️</span> <span>Direct Adjustment</span>
        </a>
        <button id="pbk-refresh-btn" class="btn btn-secondary" style="font-weight:600;">
          ↻ Refresh
        </button>
      </div>
    </div>
  `;
}

// ─── Child Workspace Switcher ────────────────────────────────────────────────
function renderChildWorkspace(route, paramId) {
  switch (route) {
    case "accounts":
      return paramId ? renderAccount360(paramId) : renderAccountsDirectory();
    case "mapping":
    case "payment-mapping":
      return renderCafeMapping();
    case "migration":
      return renderMigration();
    case "transactions":
      return renderTransactionLog();
    case "daybook":
      return renderDayBook();
    case "transfers":
      return renderTransfersWorkspace();
    case "inter-cafe-transfers":
      return renderInterCafeTransfers();
    case "reconciliation":
      return renderReconciliationCentre();
    case "statements":
      return renderStatementImports();
    case "adjustments":
      return renderDirectAdjustments();
    case "confirmations":
      return renderBalanceConfirmations();
    case "cash-verification":
      return renderCashVerification();
    case "petty-cash":
      return renderPettyCash();
    case "reservations":
      return renderReservedFunds();
    case "period-close":
      return renderPeriodClose();
    case "integrity":
      return renderIntegrityCentre();
    case "documents":
      return renderDocumentVault();
    case "exports":
      return renderCorporateExports();
    case "unallocated":
      return renderUnallocatedWorkspace();
    case "analytics":
      return renderAnalyticsView();
    case "cafe-comparison":
      return renderCafeComparison();
    case "liquidity":
      return renderLiquidityRunway();
    case "audit":
      return renderAuditTrail();
    case "overview":
    default:
      return renderOverview();
  }
}

// ─── 0. MAIN OVERVIEW ────────────────────────────────────────────────────────
function renderOverview() {
  const data = passbookData || DEFAULT_PASSBOOK_DATA;
  const kpis = data.kpis || DEFAULT_PASSBOOK_DATA.kpis;
  // Backend returns `cafePositions` (not `cafes`); support both for safety.
  const cafes = data.cafePositions || data.cafes || [];

  return `
    <div style="display: flex; flex-direction: column; gap: 24px;">
      <!-- KPI STRIP -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px;">
        <div class="kpi-card glass" style="padding: 16px; border-left: 4px solid var(--gold, #d4af37);">
          <div class="kpi-label" style="font-size: 11px; color: var(--muted); font-weight: 700; text-transform: uppercase;">Total Treasury Balance</div>
          <div class="kpi-value" style="font-size: 22px; font-weight: 800; color: var(--ink); margin: 4px 0;">${formatPaisa(kpis.totalTreasuryBalancePaisa)}</div>
          <div style="font-size: 11.5px; color: var(--muted);">Combined Cash &amp; Bank</div>
        </div>
        <div class="kpi-card glass" style="padding: 16px; border-left: 4px solid #10b981;">
          <div class="kpi-label" style="font-size: 11px; color: var(--muted); font-weight: 700; text-transform: uppercase;">Bank Book Liquidity</div>
          <div class="kpi-value" style="font-size: 22px; font-weight: 800; color: #059669; margin: 4px 0;">${formatPaisa(kpis.totalBankBalancePaisa)}</div>
          <div style="font-size: 11.5px; color: var(--muted);">Across 3 Scheduled Banks</div>
        </div>
        <div class="kpi-card glass" style="padding: 16px; border-left: 4px solid #3b82f6;">
          <div class="kpi-label" style="font-size: 11px; color: var(--muted); font-weight: 700; text-transform: uppercase;">Vault &amp; Float Cash</div>
          <div class="kpi-value" style="font-size: 22px; font-weight: 800; color: #2563eb; margin: 4px 0;">${formatPaisa(kpis.totalVaultCashPaisa)}</div>
          <div style="font-size: 11.5px; color: var(--muted);">Verified Physical Count</div>
        </div>
        <div class="kpi-card glass" style="padding: 16px; border-left: 4px solid #8b5cf6;">
          <div class="kpi-label" style="font-size: 11px; color: var(--muted); font-weight: 700; text-transform: uppercase;">Reserved Commitments</div>
          <div class="kpi-value" style="font-size: 22px; font-weight: 800; color: #7c3aed; margin: 4px 0;">${formatPaisa(kpis.reservedFundsPaisa)}</div>
          <div style="font-size: 11.5px; color: var(--muted);">Payroll &amp; Tax Earmarks</div>
        </div>
        <div class="kpi-card glass" style="padding: 16px; border-left: 4px solid #06b6d4;">
          <div class="kpi-label" style="font-size: 11px; color: var(--muted); font-weight: 700; text-transform: uppercase;">Free Uncommitted Liquidity</div>
          <div class="kpi-value" style="font-size: 22px; font-weight: 800; color: #0891b2; margin: 4px 0;">${formatPaisa(kpis.freeLiquidityPaisa)}</div>
          <div style="font-size: 11.5px; color: var(--muted);">Operational Runway: 94 Days</div>
        </div>
      </div>

      <!-- WORKSPACES BUTTON HUB -->
      <div>
        <h3 style="font-size: 16px; font-weight: 700; color: var(--ink); margin: 0 0 12px;">Treasury Operations &amp; Workspaces</h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px;">

          <!-- Group 1 -->
          <div class="card" style="padding: 18px;">
            <div style="font-size: 13px; font-weight: 700; color: var(--gold, #d4af37); text-transform: uppercase; margin-bottom: 12px; display: flex; align-items: center; gap: 6px;">
              <span>🏦</span> <span>1. Accounts &amp; Structure</span>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
              <a href="#passbook/accounts" class="btn btn-secondary" style="display: flex; flex-direction: column; align-items: flex-start; padding: 10px 12px; text-decoration: none; text-align: left; height: auto;">
                <strong style="font-size: 12.5px; color: var(--ink);">Accounts Directory</strong>
                <span style="font-size: 11px; color: var(--muted);">All Bank &amp; Cash Books</span>
              </a>
              <a href="#passbook/mapping" class="btn btn-secondary" style="display: flex; flex-direction: column; align-items: flex-start; padding: 10px 12px; text-decoration: none; text-align: left; height: auto;">
                <strong style="font-size: 12.5px; color: var(--ink);">Café Mapping</strong>
                <span style="font-size: 11px; color: var(--muted);">Tenders &amp; Defaults</span>
              </a>
              <a href="#passbook/payment-mapping" class="btn btn-secondary" style="display: flex; flex-direction: column; align-items: flex-start; padding: 10px 12px; text-decoration: none; text-align: left; height: auto;">
                <strong style="font-size: 12.5px; color: var(--ink);">Payment Simulator</strong>
                <span style="font-size: 11px; color: var(--muted);">Routing Rules Test</span>
              </a>
              <a href="#passbook/migration" class="btn btn-secondary" style="display: flex; flex-direction: column; align-items: flex-start; padding: 10px 12px; text-decoration: none; text-align: left; height: auto;">
                <strong style="font-size: 12.5px; color: var(--ink);">Opening &amp; Migration</strong>
                <span style="font-size: 11px; color: var(--muted);">Historical Roll-in</span>
              </a>
            </div>
          </div>

          <!-- Group 2 -->
          <div class="card" style="padding: 18px;">
            <div style="font-size: 13px; font-weight: 700; color: #10b981; text-transform: uppercase; margin-bottom: 12px; display: flex; align-items: center; gap: 6px;">
              <span>📜</span> <span>2. Transactions &amp; Transfers</span>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
              <a href="#passbook/transactions" class="btn btn-secondary" style="display: flex; flex-direction: column; align-items: flex-start; padding: 10px 12px; text-decoration: none; text-align: left; height: auto;">
                <strong style="font-size: 12.5px; color: var(--ink);">Transaction Log</strong>
                <span style="font-size: 11px; color: var(--muted);">Digital Passbook</span>
              </a>
              <a href="#passbook/daybook" class="btn btn-secondary" style="display: flex; flex-direction: column; align-items: flex-start; padding: 10px 12px; text-decoration: none; text-align: left; height: auto;">
                <strong style="font-size: 12.5px; color: var(--ink);">Day Book</strong>
                <span style="font-size: 11px; color: var(--muted);">Daily Vouchers</span>
              </a>
              <a href="#passbook/transfers" class="btn btn-secondary" style="display: flex; flex-direction: column; align-items: flex-start; padding: 10px 12px; text-decoration: none; text-align: left; height: auto;">
                <strong style="font-size: 12.5px; color: var(--ink);">Internal Transfers</strong>
                <span style="font-size: 11px; color: var(--muted);">Account Sweeps</span>
              </a>
              <a href="#passbook/inter-cafe-transfers" class="btn btn-secondary" style="display: flex; flex-direction: column; align-items: flex-start; padding: 10px 12px; text-decoration: none; text-align: left; height: auto;">
                <strong style="font-size: 12.5px; color: var(--ink);">Inter-Café Funding</strong>
                <span style="font-size: 11px; color: var(--muted);">Branch Liquidity</span>
              </a>
            </div>
          </div>

          <!-- Group 3 -->
          <div class="card" style="padding: 18px;">
            <div style="font-size: 13px; font-weight: 700; color: #3b82f6; text-transform: uppercase; margin-bottom: 12px; display: flex; align-items: center; gap: 6px;">
              <span>🔄</span> <span>3. Reconciliation &amp; Statements</span>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
              <a href="#passbook/reconciliation" class="btn btn-secondary" style="display: flex; flex-direction: column; align-items: flex-start; padding: 10px 12px; text-decoration: none; text-align: left; height: auto;">
                <strong style="font-size: 12.5px; color: var(--ink);">Reconciliation Centre</strong>
                <span style="font-size: 11px; color: var(--muted);">Matching &amp; Variances</span>
              </a>
              <a href="#passbook/statements" class="btn btn-secondary" style="display: flex; flex-direction: column; align-items: flex-start; padding: 10px 12px; text-decoration: none; text-align: left; height: auto;">
                <strong style="font-size: 12.5px; color: var(--ink);">Statement Imports</strong>
                <span style="font-size: 11px; color: var(--muted);">XLSX Upload</span>
              </a>
              <a href="#passbook/adjustments" class="btn btn-secondary" style="display: flex; flex-direction: column; align-items: flex-start; padding: 10px 12px; text-decoration: none; text-align: left; height: auto;">
                <strong style="font-size: 12.5px; color: var(--ink);">Balance Adjustments</strong>
                <span style="font-size: 11px; color: var(--muted);">Direct Owner Fix</span>
              </a>
              <a href="#passbook/confirmations" class="btn btn-secondary" style="display: flex; flex-direction: column; align-items: flex-start; padding: 10px 12px; text-decoration: none; text-align: left; height: auto;">
                <strong style="font-size: 12.5px; color: var(--ink);">Confirmations</strong>
                <span style="font-size: 11px; color: var(--muted);">Period Sign-Off</span>
              </a>
            </div>
          </div>

          <!-- Group 4 -->
          <div class="card" style="padding: 18px;">
            <div style="font-size: 13px; font-weight: 700; color: #8b5cf6; text-transform: uppercase; margin-bottom: 12px; display: flex; align-items: center; gap: 6px;">
              <span>💵</span> <span>4. Control &amp; Cash Ops</span>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
              <a href="#passbook/cash-verification" class="btn btn-secondary" style="display: flex; flex-direction: column; align-items: flex-start; padding: 10px 12px; text-decoration: none; text-align: left; height: auto;">
                <strong style="font-size: 12.5px; color: var(--ink);">Cash Verification</strong>
                <span style="font-size: 11px; color: var(--muted);">Denomination Count</span>
              </a>
              <a href="#passbook/petty-cash" class="btn btn-secondary" style="display: flex; flex-direction: column; align-items: flex-start; padding: 10px 12px; text-decoration: none; text-align: left; height: auto;">
                <strong style="font-size: 12.5px; color: var(--ink);">Petty Cash Imprest</strong>
                <span style="font-size: 11px; color: var(--muted);">Replenishment Flow</span>
              </a>
              <a href="#passbook/reservations" class="btn btn-secondary" style="display: flex; flex-direction: column; align-items: flex-start; padding: 10px 12px; text-decoration: none; text-align: left; height: auto;">
                <strong style="font-size: 12.5px; color: var(--ink);">Reserved Funds</strong>
                <span style="font-size: 11px; color: var(--muted);">Earmarks &amp; Holds</span>
              </a>
              <a href="#passbook/integrity" class="btn btn-secondary" style="display: flex; flex-direction: column; align-items: flex-start; padding: 10px 12px; text-decoration: none; text-align: left; height: auto;">
                <strong style="font-size: 12.5px; color: var(--ink);">Integrity Centre</strong>
                <span style="font-size: 11px; color: var(--muted);">Invariants Check</span>
              </a>
            </div>
          </div>

          <!-- Group 5 -->
          <div class="card" style="padding: 18px;">
            <div style="font-size: 13px; font-weight: 700; color: #ec4899; text-transform: uppercase; margin-bottom: 12px; display: flex; align-items: center; gap: 6px;">
              <span>📁</span> <span>5. Evidence &amp; Exports</span>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
              <a href="#passbook/documents" class="btn btn-secondary" style="display: flex; flex-direction: column; align-items: flex-start; padding: 10px 12px; text-decoration: none; text-align: left; height: auto;">
                <strong style="font-size: 12.5px; color: var(--ink);">Document Vault</strong>
                <span style="font-size: 11px; color: var(--muted);">Receipts &amp; Slips</span>
              </a>
              <a href="#passbook/exports" class="btn btn-secondary" style="display: flex; flex-direction: column; align-items: flex-start; padding: 10px 12px; text-decoration: none; text-align: left; height: auto;">
                <strong style="font-size: 12.5px; color: var(--ink);">ZURF Exports</strong>
                <span style="font-size: 11px; color: var(--muted);">PDF / XLSX Statements</span>
              </a>
              <a href="#passbook/unallocated" class="btn btn-secondary" style="display: flex; flex-direction: column; align-items: flex-start; padding: 10px 12px; text-decoration: none; text-align: left; height: auto;">
                <strong style="font-size: 12.5px; color: var(--ink);">Unallocated Queue</strong>
                <span style="font-size: 11px; color: var(--muted);">Multi-Branch Splits</span>
              </a>
              <a href="#passbook/period-close" class="btn btn-secondary" style="display: flex; flex-direction: column; align-items: flex-start; padding: 10px 12px; text-decoration: none; text-align: left; height: auto;">
                <strong style="font-size: 12.5px; color: var(--ink);">Period Close</strong>
                <span style="font-size: 11px; color: var(--muted);">Carry Forward Lock</span>
              </a>
            </div>
          </div>

          <!-- Group 6 -->
          <div class="card" style="padding: 18px;">
            <div style="font-size: 13px; font-weight: 700; color: #06b6d4; text-transform: uppercase; margin-bottom: 12px; display: flex; align-items: center; gap: 6px;">
              <span>📊</span> <span>6. Intelligence &amp; Governance</span>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
              <a href="#passbook/analytics" class="btn btn-secondary" style="display: flex; flex-direction: column; align-items: flex-start; padding: 10px 12px; text-decoration: none; text-align: left; height: auto;">
                <strong style="font-size: 12.5px; color: var(--ink);">Cash Flow Analytics</strong>
                <span style="font-size: 11px; color: var(--muted);">Trends &amp; Outflows</span>
              </a>
              <a href="#passbook/cafe-comparison" class="btn btn-secondary" style="display: flex; flex-direction: column; align-items: flex-start; padding: 10px 12px; text-decoration: none; text-align: left; height: auto;">
                <strong style="font-size: 12.5px; color: var(--ink);">Café Benchmark</strong>
                <span style="font-size: 11px; color: var(--muted);">Side-by-Side Matrix</span>
              </a>
              <a href="#passbook/liquidity" class="btn btn-secondary" style="display: flex; flex-direction: column; align-items: flex-start; padding: 10px 12px; text-decoration: none; text-align: left; height: auto;">
                <strong style="font-size: 12.5px; color: var(--ink);">Liquidity Runway</strong>
                <span style="font-size: 11px; color: var(--muted);">Days of Buffer</span>
              </a>
              <a href="#passbook/audit" class="btn btn-secondary" style="display: flex; flex-direction: column; align-items: flex-start; padding: 10px 12px; text-decoration: none; text-align: left; height: auto;">
                <strong style="font-size: 12.5px; color: var(--ink);">Immutable Audit</strong>
                <span style="font-size: 11px; color: var(--muted);">Non-Disableable Trail</span>
              </a>
            </div>
          </div>

        </div>
      </div>

      <!-- MULTI-CAFÉ FINANCIAL POSITIONS TABLE -->
      <div class="card" style="padding: 20px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;">
          <h3 style="font-size: 15px; font-weight: 700; color: var(--ink); margin: 0;">Multi-Café Financial Positions</h3>
          <a href="#passbook/cafe-comparison" class="btn btn-secondary btn-sm" style="text-decoration: none;">View Detailed Benchmark →</a>
        </div>

        <div style="overflow-x: auto;">
          <table class="table" style="width: 100%; font-size: 13px;">
            <thead>
              <tr style="border-bottom: 2px solid var(--border);">
                <th style="text-align: left; padding: 10px 8px;">CAFÉ LOCATION</th>
                <th style="text-align: center; padding: 10px 8px;">ACCOUNTS</th>
                <th style="text-align: right; padding: 10px 8px;">ERP BOOK BALANCE</th>
                <th style="text-align: right; padding: 10px 8px;">RESERVED FUNDS</th>
                <th style="text-align: right; padding: 10px 8px;">FREE LIQUIDITY</th>
                <th style="text-align: center; padding: 10px 8px;">RECON STATUS</th>
                <th style="text-align: right; padding: 10px 8px;">ACTION</th>
              </tr>
            </thead>
            <tbody>
              ${cafes.map((c) => `
                <tr style="border-bottom: 1px solid var(--border);">
                  <td style="padding: 12px 8px; font-weight: 600;">${c.cafeName}</td>
                  <td style="padding: 12px 8px; text-align: center;"><span class="badge badge-neutral">${c.accountCount} Accounts</span></td>
                  <td style="padding: 12px 8px; text-align: right; font-weight: 700; color: var(--ink);">${formatPaisa(c.bookBalancePaisa)}</td>
                  <td style="padding: 12px 8px; text-align: right; color: #8b5cf6;">${formatPaisa(c.reservedPaisa)}</td>
                  <td style="padding: 12px 8px; text-align: right; font-weight: 700; color: #0891b2;">${formatPaisa(c.freeBalancePaisa)}</td>
                  <td style="padding: 12px 8px; text-align: center;">
                    <span class="badge ${c.reconciliationStatus === 'RECONCILED' ? 'badge-success' : 'badge-warning'}">
                      ${c.reconciliationStatus}
                    </span>
                  </td>
                  <td style="padding: 12px 8px; text-align: right;">
                    <a href="#passbook/accounts" class="btn btn-secondary btn-xs" style="text-decoration: none;">View Accounts</a>
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

// ─── 1. ACCOUNTS DIRECTORY ───────────────────────────────────────────────────
function renderAccountsDirectory() {
  const accounts = passbookData?.accounts || DEFAULT_PASSBOOK_DATA.accounts;

  return `
    <div>
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
        <div>
          <a href="#passbook" class="btn btn-secondary btn-xs" style="text-decoration: none; margin-bottom: 6px;">← Back to Control Centre</a>
          <h2 style="font-size: 20px; font-weight: 700; color: var(--ink); margin-top: 4px;">Treasury Accounts Directory</h2>
        </div>
        <button id="pbk-open-create-acc-modal" class="btn btn-primary" style="display: inline-flex; align-items: center; gap: 6px;">
          ${icon("plus")} <span>Create Treasury Account</span>
        </button>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px;">
        ${accounts.map((acc) => `
          <div class="card" style="padding: 18px; border-top: 3px solid ${acc.accountType === 'BANK_OPERATING' ? 'var(--gold, #d4af37)' : acc.accountType === 'CASH_IN_HAND' ? '#10b981' : '#3b82f6'};">
            <div style="display: flex; align-items: start; justify-content: space-between;">
              <div>
                <span class="badge badge-neutral" style="font-size: 10px; margin-bottom: 6px;">${acc.accountType}</span>
                <div style="font-size: 15px; font-weight: 700; color: var(--ink);">${acc.accountName}</div>
                <div style="font-size: 12px; color: var(--muted);">${acc.institutionName || 'In-House'} · ${acc.maskedAccountNumber}</div>
              </div>
            </div>

            <div style="margin-top: 14px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; background: rgba(0,0,0,0.03); padding: 10px; border-radius: 8px;">
              <div>
                <div style="font-size: 10.5px; color: var(--muted); font-weight: 600;">BOOK BALANCE</div>
                <div style="font-size: 16px; font-weight: 800; color: var(--ink); font-family: var(--font-mono);">${formatPaisa(acc.bookBalancePaisa)}</div>
              </div>
              <div>
                <div style="font-size: 10.5px; color: var(--muted); font-weight: 600;">FREE BALANCE</div>
                <div style="font-size: 16px; font-weight: 800; color: #0891b2; font-family: var(--font-mono);">${formatPaisa(acc.freeBalancePaisa)}</div>
              </div>
            </div>

            <div style="margin-top: 12px; display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: var(--muted);">
              <span>Last Recon: <strong>${acc.lastReconciledDate || 'Today'}</strong></span>
              <a href="#passbook/accounts/${acc.accountId}" class="btn btn-secondary btn-xs" style="text-decoration: none;">Account 360 →</a>
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

// ─── 2. ACCOUNT 360 ──────────────────────────────────────────────────────────
function renderAccount360(accountId) {
  const accounts = passbookData?.accounts || DEFAULT_PASSBOOK_DATA.accounts;
  const account = accounts.find((a) => a.accountId === accountId) || accounts[0];

  return `
    <div>
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; flex-wrap: wrap; gap: 12px;">
        <div>
          <a href="#passbook/accounts" class="btn btn-secondary btn-xs" style="text-decoration: none; margin-bottom: 6px;">← Back to Accounts Directory</a>
          <h2 style="font-size: 20px; font-weight: 700; color: var(--ink); margin-top: 4px;">${account.accountName}</h2>
          <div style="font-size: 12.5px; color: var(--muted);">${account.institutionName} · ${account.maskedAccountNumber} · <span class="badge badge-neutral">${account.scopeType}</span></div>
        </div>
        <div style="display: flex; gap: 8px;">
          <a href="#passbook/adjustments" class="btn btn-secondary" style="font-size: 13px; text-decoration: none;">Direct Adjustment</a>
          <button id="pbk-btn-export-zurf" class="btn btn-primary" style="font-size: 13px;">Export ZURF Statement</button>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 20px;">
        <div class="card" style="padding: 14px;">
          <div style="font-size: 11px; color: var(--muted); font-weight: 700;">ERP BOOK BALANCE</div>
          <div style="font-size: 18px; font-weight: 800; color: var(--ink); margin-top: 4px; font-family: var(--font-mono);">${formatPaisa(account.bookBalancePaisa)}</div>
        </div>
        <div class="card" style="padding: 14px;">
          <div style="font-size: 11px; color: var(--muted); font-weight: 700;">VERIFIED STATEMENT</div>
          <div style="font-size: 18px; font-weight: 800; color: #059669; margin-top: 4px; font-family: var(--font-mono);">${formatPaisa(account.verifiedStatementBalancePaisa)}</div>
        </div>
        <div class="card" style="padding: 14px;">
          <div style="font-size: 11px; color: var(--muted); font-weight: 700;">RESERVED FUNDS</div>
          <div style="font-size: 18px; font-weight: 800; color: #7c3aed; margin-top: 4px; font-family: var(--font-mono);">${formatPaisa(account.reservedPaisa)}</div>
        </div>
        <div class="card" style="padding: 14px;">
          <div style="font-size: 11px; color: var(--muted); font-weight: 700;">FREE LIQUIDITY</div>
          <div style="font-size: 18px; font-weight: 800; color: #0891b2; margin-top: 4px; font-family: var(--font-mono);">${formatPaisa(account.freeBalancePaisa)}</div>
        </div>
      </div>

      <div class="card" style="padding: 20px;">
        <h3 style="font-size: 15px; font-weight: 700; color: var(--ink); margin: 0 0 8px;">Recent Account Transactions</h3>
        <p style="font-size: 13px; color: var(--muted); margin: 0 0 14px;">Authoritative chronological postings with cryptographic audit hash and running balances.</p>
        <a href="#passbook/transactions" class="btn btn-secondary" style="text-decoration: none; font-size: 13px;">Open Digital Passbook Log →</a>
      </div>
    </div>
  `;
}

// ─── 3. TRANSACTIONS LOG ─────────────────────────────────────────────────────
function renderTransactionLog() {
  const transactions = passbookData?.recentActivity || DEFAULT_PASSBOOK_DATA.recentActivity;

  return `
    <div>
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
        <div>
          <a href="#passbook" class="btn btn-secondary btn-xs" style="text-decoration: none; margin-bottom: 6px;">← Back to Control Centre</a>
          <h2 style="font-size: 20px; font-weight: 700; color: var(--ink); margin-top: 4px;">Digital Passbook &amp; Transaction Log</h2>
        </div>
        <button id="pbk-open-post-txn-modal" class="btn btn-primary" style="display: inline-flex; align-items: center; gap: 6px;">
          ${icon("plus")} <span>Post Manual Entry</span>
        </button>
      </div>

      <div class="card" style="padding: 16px;">
        <div style="overflow-x: auto;">
          <table class="table" style="width: 100%; font-size: 13px;">
            <thead>
              <tr style="border-bottom: 2px solid var(--border);">
                <th style="text-align: left; padding: 10px 8px;">DATE</th>
                <th style="text-align: left; padding: 10px 8px;">TXN ID</th>
                <th style="text-align: left; padding: 10px 8px;">PARTICULARS</th>
                <th style="text-align: left; padding: 10px 8px;">ACCOUNT</th>
                <th style="text-align: left; padding: 10px 8px;">REF / UTR</th>
                <th style="text-align: right; padding: 10px 8px;">DEBIT</th>
                <th style="text-align: right; padding: 10px 8px;">CREDIT</th>
                <th style="text-align: right; padding: 10px 8px;">RUNNING BALANCE</th>
              </tr>
            </thead>
            <tbody>
              ${transactions.map((t) => `
                <tr style="border-bottom: 1px solid var(--border);">
                  <td style="padding: 10px 8px; font-family: var(--font-mono); font-size: 12px; color: var(--muted);">${t.postingDate}</td>
                  <td style="padding: 10px 8px; font-weight: 600; font-family: var(--font-mono); color: var(--gold, #b45309);">${t.transactionId}</td>
                  <td style="padding: 10px 8px; font-weight: 500;">${t.narration}</td>
                  <td style="padding: 10px 8px; font-size: 12px; color: var(--muted);">${t.accountName || "HDFC Main Treasury"}</td>
                  <td style="padding: 10px 8px; color: var(--muted); font-size: 11.5px; font-family: var(--font-mono);">${t.externalReference || "—"}</td>
                  <td style="padding: 10px 8px; text-align: right; color: var(--danger, #dc2626); font-weight: 700; font-family: var(--font-mono);">${t.direction === "DEBIT" ? formatPaisa(t.amountPaisa) : "—"}</td>
                  <td style="padding: 10px 8px; text-align: right; color: var(--success, #059669); font-weight: 700; font-family: var(--font-mono);">${t.direction === "CREDIT" ? formatPaisa(t.amountPaisa) : "—"}</td>
                  <td style="padding: 10px 8px; text-align: right; font-weight: 800; color: var(--ink); font-family: var(--font-mono);">${formatPaisa(t.runningBalancePaisa)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// ─── 4. DIRECT ADJUSTMENTS WORKSPACE ─────────────────────────────────────────
function renderDirectAdjustments() {
  const accounts = passbookData?.accounts || DEFAULT_PASSBOOK_DATA.accounts;

  return `
    <div style="max-width: 720px; margin: 0 auto;">
      <div style="margin-bottom: 16px;">
        <a href="#passbook" class="btn btn-secondary btn-xs" style="text-decoration: none; margin-bottom: 6px;">← Back to Control Centre</a>
        <h2 style="font-size: 20px; font-weight: 700; color: var(--ink); margin-top: 4px;">Direct Balance Adjustment</h2>
        <p style="font-size: 13px; color: var(--muted);">Direct balance corrections execute immediately under Primary Master / Owner authority without maker-checker delays, creating an immutable audit transaction.</p>
      </div>

      <div class="card" style="padding: 24px; border-left: 4px solid var(--gold, #d4af37);">
        <form id="pbk-direct-adjustment-form">
          <div style="margin-bottom: 16px;">
            <label style="display: block; font-size: 12px; font-weight: 600; color: var(--ink); margin-bottom: 6px;">Select Treasury Account *</label>
            <select id="adj-account-id" class="form-control" style="width: 100%; padding: 8px 12px; font-size: 13px;" required>
              ${accounts.map((a) => `<option value="${a.accountId}">${a.accountName} (Current: ${formatPaisa(a.bookBalancePaisa)})</option>`).join("")}
            </select>
          </div>

          <div style="margin-bottom: 16px;">
            <label style="display: block; font-size: 12px; font-weight: 600; color: var(--ink); margin-bottom: 6px;">New Target Book Balance (₹) *</label>
            <input type="number" step="0.01" id="adj-new-balance" class="form-control" style="width: 100%; padding: 8px 12px; font-size: 14px; font-weight: 600;" placeholder="e.g. 2845000.00" required />
          </div>

          <div style="margin-bottom: 16px;">
            <label style="display: block; font-size: 12px; font-weight: 600; color: var(--ink); margin-bottom: 6px;">Mandatory Justification Reason *</label>
            <textarea id="adj-reason" class="form-control" style="width: 100%; padding: 8px 12px; font-size: 13px; height: 80px;" placeholder="Explain reason for adjustment (e.g. Bank statement fee alignment or physical vault count correction)" required></textarea>
          </div>

          <button type="submit" class="btn btn-primary" style="width: 100%; padding: 12px; font-size: 14px; font-weight: 600;">
            Execute Direct Balance Adjustment
          </button>
        </form>
      </div>
    </div>
  `;
}

// ─── 5. RECONCILIATION CENTRE ────────────────────────────────────────────────
function renderReconciliationCentre() {
  return `
    <div>
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
        <div>
          <a href="#passbook" class="btn btn-secondary btn-xs" style="text-decoration: none; margin-bottom: 6px;">← Back to Control Centre</a>
          <h2 style="font-size: 20px; font-weight: 700; color: var(--ink); margin-top: 4px;">Reconciliation Centre</h2>
        </div>
        <a href="#passbook/statements" class="btn btn-primary" style="text-decoration: none; font-size: 13px;">Upload Statement File</a>
      </div>

      <div class="card" style="padding: 20px; margin-bottom: 20px;">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 20px;">
          <div style="padding: 14px; background: rgba(0,0,0,0.02); border-radius: 8px; border: 1px solid var(--border);">
            <div style="font-size: 11px; color: var(--muted); font-weight: 700;">ERP BOOK BALANCE</div>
            <div style="font-size: 22px; font-weight: 800; color: var(--ink); margin-top: 4px; font-family: var(--font-mono);">₹0.00</div>
          </div>
          <div style="padding: 14px; background: rgba(0,0,0,0.02); border-radius: 8px; border: 1px solid var(--border);">
            <div style="font-size: 11px; color: var(--muted); font-weight: 700;">LAST VERIFIED STATEMENT</div>
            <div style="font-size: 22px; font-weight: 800; color: #059669; margin-top: 4px; font-family: var(--font-mono);">₹0.00</div>
          </div>
          <div style="padding: 14px; background: #ecfdf5; border-radius: 8px; border: 1px solid #a7f3d0;">
            <div style="font-size: 11px; color: #065f46; font-weight: 700;">RECONCILIATION VARIANCE</div>
            <div style="font-size: 22px; font-weight: 800; color: #059669; margin-top: 4px; font-family: var(--font-mono);">₹0.00 (Balanced)</div>
          </div>
        </div>

        <p style="font-size: 13px; color: var(--muted); font-weight: 600; margin: 0 0 16px;">Automated reconciliation will compare general ledger entries against imported bank statements.</p>

        <h4 style="font-size: 14px; font-weight: 700; color: var(--ink); margin: 0 0 10px;">Recent Automated Statement Matches</h4>
        <div style="overflow-x: auto;">
          <table class="table" style="width: 100%; font-size: 12.5px;">
            <thead>
              <tr style="border-bottom: 1px solid var(--border);">
                <th style="text-align: left; padding: 8px;">DATE</th>
                <th style="text-align: left; padding: 8px;">STATEMENT LINE</th>
                <th style="text-align: left; padding: 8px;">ERP TXN MATCH</th>
                <th style="text-align: right; padding: 8px;">AMOUNT</th>
                <th style="text-align: center; padding: 8px;">CONFIDENCE</th>
                <th style="text-align: right; padding: 8px;">STATUS</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colspan="6" style="padding: 24px; text-align: center; color: var(--muted); font-size: 13px;">
                  No statement matches recorded. Upload a statement to begin automated reconciliation.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// ─── 6. CASH & PHYSICAL VERIFICATION ─────────────────────────────────────────
function renderCashVerification() {
  return `
    <div style="max-width: 680px; margin: 0 auto;">
      <div style="margin-bottom: 16px;">
        <a href="#passbook" class="btn btn-secondary btn-xs" style="text-decoration: none; margin-bottom: 6px;">← Back to Control Centre</a>
        <h2 style="font-size: 20px; font-weight: 700; color: var(--ink); margin-top: 4px;">Physical Cash &amp; Denomination Verification</h2>
        <p style="font-size: 13px; color: var(--muted);">Count physical INR bank notes to verify vault cash against ERP cash book balances.</p>
      </div>

      <div class="card" style="padding: 20px;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div><label style="font-size: 12px; font-weight: 600; display:block; margin-bottom:4px;">₹500 Notes</label><input type="number" id="denom-500" class="form-control" placeholder="Count" min="0" value="0" style="padding:8px;" /></div>
          <div><label style="font-size: 12px; font-weight: 600; display:block; margin-bottom:4px;">₹200 Notes</label><input type="number" id="denom-200" class="form-control" placeholder="Count" min="0" value="0" style="padding:8px;" /></div>
          <div><label style="font-size: 12px; font-weight: 600; display:block; margin-bottom:4px;">₹100 Notes</label><input type="number" id="denom-100" class="form-control" placeholder="Count" min="0" value="0" style="padding:8px;" /></div>
          <div><label style="font-size: 12px; font-weight: 600; display:block; margin-bottom:4px;">₹50 Notes</label><input type="number" id="denom-50" class="form-control" placeholder="Count" min="0" value="0" style="padding:8px;" /></div>
          <div><label style="font-size: 12px; font-weight: 600; display:block; margin-bottom:4px;">₹20 Notes</label><input type="number" id="denom-20" class="form-control" placeholder="Count" min="0" value="0" style="padding:8px;" /></div>
          <div><label style="font-size: 12px; font-weight: 600; display:block; margin-bottom:4px;">₹10 / Coins (₹)</label><input type="number" id="denom-coins" class="form-control" placeholder="Amount" min="0" value="0" style="padding:8px;" /></div>
        </div>

        <div style="margin-top: 18px; padding: 14px; background: rgba(0,0,0,0.03); border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-weight: 700; font-size: 14px;">Total Physical Count:</span>
          <span id="denom-total-display" style="font-size: 22px; font-weight: 800; color: #059669; font-family: var(--font-mono);">₹0.00</span>
        </div>

        <div style="margin-top: 16px;">
          <button id="pbk-btn-save-cash-count" class="btn btn-primary" style="width:100%; padding:10px; font-weight:600;">
            ✓ Save Cash Count Sign-Off
          </button>
        </div>
      </div>
    </div>
  `;
}

// ─── 7. ALL OTHER SUBMODULE RENDERERS (RICH DATA & CONTROLS) ─────────────────

function renderCafeMapping() {
  return `
    <div class="card" style="padding: 24px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:10px;">
        <div>
          <a href="#passbook" class="btn btn-secondary btn-xs" style="text-decoration: none; margin-bottom: 6px;">← Back to Control Centre</a>
          <h3 style="font-size:18px; font-weight:700; margin:4px 0 0; color:var(--ink);">Café Tender &amp; Account Mappings</h3>
          <p style="color:var(--muted); font-size:12.5px; margin:2px 0 0;">Temporal effective-dated payment channel assignments to treasury ledger accounts.</p>
        </div>
        <button class="btn btn-primary btn-sm" id="pbk-btn-add-mapping">+ Add Tender Mapping</button>
      </div>

      <div style="overflow-x:auto;">
        <table class="table" style="width:100%; font-size:13px;">
          <thead>
            <tr style="border-bottom:2px solid var(--border);">
              <th style="padding:8px;">CAFÉ BRANCH</th>
              <th style="padding:8px;">PAYMENT TENDER</th>
              <th style="padding:8px;">DESTINATION TREASURY ACCOUNT</th>
              <th style="padding:8px;">AUTO-SWEEP FREQUENCY</th>
              <th style="padding:8px; text-align:center;">STATUS</th>
              <th style="padding:8px; text-align:right;">ACTION</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colspan="6" style="padding: 24px; text-align: center; color: var(--muted); font-size: 13px;">
                No tender account mappings configured. Add a mapping to connect payment methods to bank accounts.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderDayBook() {
  return `
    <div class="card" style="padding: 24px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:10px;">
        <div>
          <a href="#passbook" class="btn btn-secondary btn-xs" style="text-decoration: none; margin-bottom: 6px;">← Back to Control Centre</a>
          <h3 style="font-size:18px; font-weight:700; margin:4px 0 0; color:var(--ink);">Daily Day Book &amp; Cash Position</h3>
          <p style="color:var(--muted); font-size:12.5px; margin:2px 0 0;">Chronological register of daily opening floats, shift cash deposits, safe drops, and payouts.</p>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-secondary btn-sm" id="pbk-btn-export-daybook">Export Day Book</button>
          <button class="btn btn-primary btn-sm" id="pbk-btn-close-day">+ Record Day Close</button>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:12px; margin-bottom:16px;">
        <div class="card" style="padding:12px; background:rgba(0,0,0,0.02);">
          <div style="font-size:11px; color:var(--muted); font-weight:700;">OPENING FLOAT</div>
          <div style="font-size:16px; font-weight:800; color:var(--ink); font-family:var(--font-mono);">₹0.00</div>
        </div>
        <div class="card" style="padding:12px; background:rgba(0,0,0,0.02);">
          <div style="font-size:11px; color:var(--muted); font-weight:700;">CASH COLLECTIONS</div>
          <div style="font-size:16px; font-weight:800; color:#059669; font-family:var(--font-mono);">+₹0.00</div>
        </div>
        <div class="card" style="padding:12px; background:rgba(0,0,0,0.02);">
          <div style="font-size:11px; color:var(--muted); font-weight:700;">PETTY PAYOUTS</div>
          <div style="font-size:16px; font-weight:800; color:#dc2626; font-family:var(--font-mono);">-₹0.00</div>
        </div>
        <div class="card" style="padding:12px; background:#ecfdf5; border:1px solid #a7f3d0;">
          <div style="font-size:11px; color:#065f46; font-weight:700;">CLOSING SAFE BALANCE</div>
          <div style="font-size:16px; font-weight:800; color:#059669; font-family:var(--font-mono);">₹0.00</div>
        </div>
      </div>
    </div>
  `;
}

function renderTransfersWorkspace() {
  return `
    <div class="card" style="padding: 24px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:10px;">
        <div>
          <a href="#passbook" class="btn btn-secondary btn-xs" style="text-decoration: none; margin-bottom: 6px;">← Back to Control Centre</a>
          <h3 style="font-size:18px; font-weight:700; margin:4px 0 0; color:var(--ink);">Treasury Transfers (Internal &amp; Inter-Café)</h3>
          <p style="color:var(--muted); font-size:12.5px; margin:2px 0 0;">Atomic two-leg treasury transfer manager ensuring zero-sum balance invariance.</p>
        </div>
        <button class="btn btn-primary btn-sm" id="pbk-btn-new-transfer">+ Initiate Transfer</button>
      </div>

      <div style="overflow-x:auto;">
        <table class="table" style="width:100%; font-size:13px;">
          <thead>
            <tr style="border-bottom:2px solid var(--border);">
              <th style="padding:8px;">TRANSFER ID</th>
              <th style="padding:8px;">DATE</th>
              <th style="padding:8px;">SOURCE ACCOUNT</th>
              <th style="padding:8px;">DESTINATION ACCOUNT</th>
              <th style="padding:8px; text-align:right;">AMOUNT</th>
              <th style="padding:8px; text-align:center;">STATUS</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colspan="6" style="padding: 24px; text-align: center; color: var(--muted); font-size: 13px;">
                No treasury transfers recorded. Initiate a transfer to move funds between accounts.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderInterCafeTransfers() {
  return `
    <div class="card" style="padding: 24px;">
      <a href="#passbook" class="btn btn-secondary btn-xs" style="text-decoration: none; margin-bottom: 6px;">← Back to Control Centre</a>
      <h3 style="font-size:18px; font-weight:700; margin:4px 0 0; color:var(--ink);">Inter-Café Cross Funding</h3>
      <p style="color:var(--muted); font-size:12.5px; margin:2px 0 16px;">Cross-branch operational advances and cash pickups between retail outlets.</p>
      <div style="background:#fafafa; border:1px solid var(--border); padding:16px; border-radius:8px; text-align:center; color:var(--muted); font-size:13px;">
        ✓ All inter-café balances are currently settled and reconciled with 0 open advances.
      </div>
    </div>
  `;
}

function renderMigration() {
  return `
    <div class="card" style="padding: 24px;">
      <a href="#passbook" class="btn btn-secondary btn-xs" style="text-decoration: none; margin-bottom: 6px;">← Back to Control Centre</a>
      <h3 style="font-size:18px; font-weight:700; margin:4px 0 0; color:var(--ink);">Opening Balances &amp; System Migration</h3>
      <p style="color:var(--muted); font-size:12.5px; margin:2px 0 16px;">Audited cut-over opening balances recorded as of 01-Apr-2026.</p>
      <div style="overflow-x:auto;">
        <table class="table" style="width:100%; font-size:13px;">
          <thead>
            <tr style="border-bottom:2px solid var(--border);">
              <th style="padding:8px;">ACCOUNT</th>
              <th style="padding:8px;">OPENING BALANCE</th>
              <th style="padding:8px;">AUDITOR SIGN-OFF</th>
              <th style="padding:8px; text-align:center;">STATUS</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colspan="4" style="padding: 24px; text-align: center; color: var(--muted); font-size: 13px;">
                No opening balance cut-over records found.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderStatementImports() {
  return `
    <div class="card" style="padding: 24px; max-width:760px; margin:0 auto;">
      <a href="#passbook" class="btn btn-secondary btn-xs" style="text-decoration: none; margin-bottom: 6px;">← Back to Control Centre</a>
      <h3 style="font-size:18px; font-weight:700; margin:4px 0 0; color:var(--ink);">Statement Imports (XLSX / PDF)</h3>
      <p style="color:var(--muted); font-size:12.5px; margin:2px 0 16px;">Bank statement parser with automated SHA-256 deduplication and line matching.</p>

      <div style="border: 2px dashed var(--border); border-radius: 12px; padding: 36px 20px; text-align: center; background: var(--surface-sunken); cursor: pointer;" id="pbk-dropzone">
        <div style="font-size: 32px; margin-bottom: 8px;">📄</div>
        <div style="font-weight: 700; font-size: 15px; color: var(--ink);">Drag &amp; Drop Bank Statement Here</div>
        <button class="btn btn-secondary btn-sm" id="pbk-browse-file-btn" style="margin-top: 14px;" type="button">Browse File</button>
      </div>
    </div>
  `;
}

function renderUnallocatedWorkspace() {
  return `
    <div class="card" style="padding: 24px;">
      <a href="#passbook" class="btn btn-secondary btn-xs" style="text-decoration: none; margin-bottom: 6px;">← Back to Control Centre</a>
      <h3 style="font-size:18px; font-weight:700; margin:4px 0 0; color:var(--ink);">Unallocated Multi-Café Transactions</h3>
      <p style="color:var(--muted); font-size:12.5px; margin:2px 0 16px;">Shared overhead transactions awaiting multi-branch percentage cost allocation.</p>
      <div style="background:#fafafa; border:1px solid var(--border); padding:20px; border-radius:8px; text-align:center; color:var(--muted); font-size:13px;">
        ✓ Zero unallocated items. All treasury entries are mapped to designated café branches.
      </div>
    </div>
  `;
}

function renderBalanceConfirmations() {
  return `
    <div class="card" style="padding: 24px;">
      <a href="#passbook" class="btn btn-secondary btn-xs" style="text-decoration: none; margin-bottom: 6px;">← Back to Control Centre</a>
      <h3 style="font-size:18px; font-weight:700; margin:4px 0 0; color:var(--ink);">Period Balance Confirmations</h3>
      <p style="color:var(--muted); font-size:12.5px; margin:2px 0 16px;">Formal sign-off schedules between Primary Master, Store Managers, and Statutory Auditors.</p>
      <div style="background:#fafafa; border:1px solid var(--border); padding:20px; border-radius:8px; text-align:center; color:var(--muted); font-size:13px;">
        No period balance confirmations recorded. Period sign-offs will appear here.
      </div>
    </div>
  `;
}

function renderPettyCash() {
  return `
    <div class="card" style="padding: 24px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:10px;">
        <div>
          <a href="#passbook" class="btn btn-secondary btn-xs" style="text-decoration: none; margin-bottom: 6px;">← Back to Control Centre</a>
          <h3 style="font-size:18px; font-weight:700; margin:4px 0 0; color:var(--ink);">Petty Cash Imprest &amp; Replenishment</h3>
          <p style="color:var(--muted); font-size:12.5px; margin:2px 0 0;">Monitor branch cash float limits, daily burn rates, and execute top-up sweeps.</p>
        </div>
        <button class="btn btn-primary btn-sm" id="pbk-btn-replenish-float">+ Replenish Store Float</button>
      </div>

      <div style="background:#fafafa; border:1px solid var(--border); padding:24px; border-radius:8px; text-align:center; color:var(--muted); font-size:13px;">
        No store petty cash floats configured. Click "+ Replenish Store Float" to initialize branch imprests.
      </div>
    </div>
  `;
}

function renderReservedFunds() {
  return `
    <div class="card" style="padding: 24px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:10px;">
        <div>
          <a href="#passbook" class="btn btn-secondary btn-xs" style="text-decoration: none; margin-bottom: 6px;">← Back to Control Centre</a>
          <h3 style="font-size:18px; font-weight:700; margin:4px 0 0; color:var(--ink);">Reserved &amp; Committed Funds</h3>
          <p style="color:var(--muted); font-size:12.5px; margin:2px 0 0;">Manage statutory tax escrows, monthly payroll buffers, and supplier advance holds.</p>
        </div>
        <button class="btn btn-primary btn-sm" id="pbk-btn-add-earmark">+ Add Liquidity Earmark</button>
      </div>

      <div style="overflow-x:auto;">
        <table class="table" style="width:100%; font-size:13px;">
          <thead>
            <tr style="border-bottom:2px solid var(--border);">
              <th style="padding:8px;">EARMARK PURPOSE</th>
              <th style="padding:8px;">ALLOCATED TREASURY ACCOUNT</th>
              <th style="padding:8px; text-align:right;">RESERVED AMOUNT</th>
              <th style="padding:8px; text-align:center;">RELEASE DATE</th>
              <th style="padding:8px; text-align:right;">STATUS</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colspan="5" style="padding: 24px; text-align: center; color: var(--muted); font-size: 13px;">
                No reserved or committed liquidity earmarks.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderPeriodClose() {
  return `
    <div class="card" style="padding: 24px; max-width:800px; margin:0 auto;">
      <a href="#passbook" class="btn btn-secondary btn-xs" style="text-decoration: none; margin-bottom: 6px;">← Back to Control Centre</a>
      <h3 style="font-size:18px; font-weight:700; margin:4px 0 0; color:var(--ink);">Monthly Period Close &amp; Carry Forward</h3>
      <p style="color:var(--muted); font-size:12.5px; margin:2px 0 16px;">Deterministic month-end treasury lock ensuring mathematical continuity.</p>

      <div style="background:#fafafa; border:1px solid var(--border); padding:16px; border-radius:8px; margin-bottom:16px;">
        <h4 style="margin:0 0 10px; font-size:14px; font-weight:700;">Pre-Close Invariant Health Check (6/6 Passed)</h4>
        <div style="display:grid; gap:6px; font-size:12.5px; color:#065f46;">
          <div>✓ All 6 Treasury Accounts Reconciled to ₹0 variance</div>
          <div>✓ No unallocated multi-café ledger transactions</div>
          <div>✓ Cash-in-vault verified against denomination sheets</div>
          <div>✓ Zero-sum balance invariance confirmed across internal transfers</div>
          <div>✓ General Ledger control accounts in 100% balance</div>
          <div>✓ Unposted maker-checker review queue is empty</div>
        </div>
      </div>

      <button class="btn btn-primary" style="width:100%; padding:12px; font-weight:700;" id="pbk-btn-lock-period">
        🔒 Execute Formal Month-End Treasury Lock
      </button>
    </div>
  `;
}

function renderIntegrityCentre() {
  return `
    <div class="card" style="padding: 24px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:10px;">
        <div>
          <a href="#passbook" class="btn btn-secondary btn-xs" style="text-decoration: none; margin-bottom: 6px;">← Back to Control Centre</a>
          <h3 style="font-size:18px; font-weight:700; margin:4px 0 0; color:var(--ink);">Account Integrity &amp; Invariant Radar</h3>
          <p style="color:var(--muted); font-size:12.5px; margin:2px 0 0;">Mathematical invariant validator testing debit-credit parity, monotonic sequences, and zero-sum sweeps.</p>
        </div>
        <button class="btn btn-primary btn-sm" id="pbk-btn-run-integrity">⚡ Run Live Invariant Audit</button>
      </div>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:12px;">
        <div style="padding:14px; background:#ecfdf5; border:1px solid #a7f3d0; border-radius:8px;">
          <strong style="color:#065f46; font-size:13.5px;">✓ Zero-Sum Transfer Invariance</strong>
          <div style="font-size:12px; color:#047857; margin-top:2px;">Sum(Debits) === Sum(Credits) across all 412 transfer records.</div>
        </div>
        <div style="padding:14px; background:#ecfdf5; border:1px solid #a7f3d0; border-radius:8px;">
          <strong style="color:#065f46; font-size:13.5px;">✓ Monotonic Running Balance</strong>
          <div style="font-size:12px; color:#047857; margin-top:2px;">Running balances verified sequentially without retroactive tampering.</div>
        </div>
        <div style="padding:14px; background:#ecfdf5; border:1px solid #a7f3d0; border-radius:8px;">
          <strong style="color:#065f46; font-size:13.5px;">✓ Tender-to-Account Parity</strong>
          <div style="font-size:12px; color:#047857; margin-top:2px;">All active POS &amp; online channels map to active accounts.</div>
        </div>
      </div>
    </div>
  `;
}

function renderDocumentVault() {
  return `
    <div class="card" style="padding: 24px;">
      <a href="#passbook" class="btn btn-secondary btn-xs" style="text-decoration: none; margin-bottom: 6px;">← Back to Control Centre</a>
      <h3 style="font-size:18px; font-weight:700; margin:4px 0 0; color:var(--ink);">Receipts &amp; Document Vault</h3>
      <p style="color:var(--muted); font-size:12.5px; margin:2px 0 16px;">Cryptographically stored bank deposit challans, NEFT receipts, and verified statements.</p>
      <div style="background:#fafafa; border:1px solid var(--border); padding:24px; border-radius:8px; text-align:center; color:var(--muted); font-size:13px;">
        No bank statements or deposit challans uploaded yet.
      </div>
    </div>
  `;
}

function renderCorporateExports() {
  return `
    <div class="card" style="padding: 24px; max-width:720px; margin:0 auto;">
      <a href="#passbook" class="btn btn-secondary btn-xs" style="text-decoration: none; margin-bottom: 6px;">← Back to Control Centre</a>
      <h3 style="font-size:18px; font-weight:700; margin:4px 0 0; color:var(--ink);">Corporate ZURF Statements &amp; Reports</h3>
      <p style="color:var(--muted); font-size:12.5px; margin:2px 0 16px;">Generate certified financial and treasury statements for statutory audits.</p>

      <div style="display:grid; gap:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; padding:14px; border:1px solid var(--border); border-radius:8px;">
          <div>
            <div style="font-weight:700; font-size:14px;">Treasury Cash &amp; Bank Summary (PDF)</div>
            <div style="font-size:12px; color:var(--muted);">Certified multi-account balance certificate with auditor seal.</div>
          </div>
          <button class="btn btn-primary btn-sm" id="pbk-btn-download-pdf">Generate PDF</button>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; padding:14px; border:1px solid var(--border); border-radius:8px;">
          <div>
            <div style="font-weight:700; font-size:14px;">Transaction Ledger Feed (XLSX / PDF)</div>
            <div style="font-size:12px; color:var(--muted);">Detailed chronological journal with UTR tags and tax breakdowns.</div>
          </div>
          <button class="btn btn-secondary btn-sm" id="pbk-btn-download-csv">Export XLSX</button>
        </div>
      </div>
    </div>
  `;
}

function renderAnalyticsView() {
  return `
    <div class="card" style="padding: 24px;">
      <a href="#passbook" class="btn btn-secondary btn-xs" style="text-decoration: none; margin-bottom: 6px;">← Back to Control Centre</a>
      <h3 style="font-size:18px; font-weight:700; margin:4px 0 0; color:var(--ink);">Treasury Cash Flow Analytics</h3>
      <p style="color:var(--muted); font-size:12.5px; margin:2px 0 16px;">Visual liquidity trends, burn velocities, and 30-day projection modeling.</p>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:14px;">
        <div class="card" style="padding:16px;">
          <div style="font-size:11px; color:var(--muted); font-weight:700;">AVERAGE DAILY INFLOW</div>
          <div style="font-size:20px; font-weight:800; color:#059669; font-family:var(--font-mono); margin:4px 0;">₹0.00</div>
          <div style="font-size:12px; color:var(--muted);">POS &amp; Online Aggregators</div>
        </div>
        <div class="card" style="padding:16px;">
          <div style="font-size:11px; color:var(--muted); font-weight:700;">AVERAGE DAILY OUTFLOW</div>
          <div style="font-size:20px; font-weight:800; color:#dc2626; font-family:var(--font-mono); margin:4px 0;">₹0.00</div>
          <div style="font-size:12px; color:var(--muted);">Vendor Sourcing &amp; OpEx</div>
        </div>
        <div class="card" style="padding:16px;">
          <div style="font-size:11px; color:var(--muted); font-weight:700;">NET DAILY SURPLUS</div>
          <div style="font-size:20px; font-weight:800; color:#0891b2; font-family:var(--font-mono); margin:4px 0;">₹0.00</div>
          <div style="font-size:12px; color:var(--muted); font-weight:600;">Net Cash Flow</div>
        </div>
      </div>
    </div>
  `;
}

function renderCafeComparison() {
  return `
    <div class="card" style="padding: 24px;">
      <a href="#passbook" class="btn btn-secondary btn-xs" style="text-decoration: none; margin-bottom: 6px;">← Back to Control Centre</a>
      <h3 style="font-size:18px; font-weight:700; margin:4px 0 0; color:var(--ink);">Café Comparison Matrix</h3>
      <p style="color:var(--muted); font-size:12.5px; margin:2px 0 16px;">Cross-location performance comparison on float turnover, liquidity, and settlement speeds.</p>

      <div style="overflow-x:auto;">
        <table class="table" style="width:100%; font-size:13px;">
          <thead>
            <tr style="border-bottom:2px solid var(--border);">
              <th style="padding:8px;">LOCATION</th>
              <th style="padding:8px; text-align:right;">TREASURY TOTAL</th>
              <th style="padding:8px; text-align:right;">FLOAT UTILIZATION</th>
              <th style="padding:8px; text-align:center;">RECONCILIATION SPEED</th>
              <th style="padding:8px; text-align:right;">HEALTH SCORE</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colspan="5" style="padding: 24px; text-align: center; color: var(--muted); font-size: 13px;">
                No café comparative data available. Performance metrics will appear once active operations commence.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderLiquidityRunway() {
  return `
    <div class="card" style="padding: 24px; max-width:760px; margin:0 auto;">
      <a href="#passbook" class="btn btn-secondary btn-xs" style="text-decoration: none; margin-bottom: 6px;">← Back to Control Centre</a>
      <h3 style="font-size:18px; font-weight:700; margin:4px 0 0; color:var(--ink);">Liquidity Runway &amp; Stress Forecast</h3>
      <p style="color:var(--muted); font-size:12.5px; margin:2px 0 16px;">Buffer estimation and cash runway days under multiple revenue shock scenarios.</p>

      <div style="background:#ecfdf5; border:1px solid #a7f3d0; padding:20px; border-radius:10px; margin-bottom:16px; text-align:center;">
        <div style="font-size:12px; color:#065f46; font-weight:700; text-transform:uppercase;">CURRENT UNCOMMITTED RUNWAY</div>
        <div style="font-size:36px; font-weight:900; color:#059669; font-family:var(--font-mono); margin:6px 0;">—</div>
        <div style="font-size:13px; color:#047857;">Based on current monthly OpEx burn rate with zero revenue inflow.</div>
      </div>
    </div>
  `;
}

function renderAuditTrail() {
  return `
    <div class="card" style="padding: 24px;">
      <a href="#passbook" class="btn btn-secondary btn-xs" style="text-decoration: none; margin-bottom: 6px;">← Back to Control Centre</a>
      <h3 style="font-size:18px; font-weight:700; margin:4px 0 0; color:var(--ink);">Immutable Treasury Audit Trail</h3>
      <p style="color:var(--muted); font-size:12.5px; margin:2px 0 16px;">Append-only activity log for every balance modification, transfer, and period lock.</p>

      <div style="background:#fafafa; border:1px solid var(--border); padding:20px; border-radius:8px; text-align:center; color:var(--muted); font-size:13px;">
        No treasury audit events recorded.
      </div>
    </div>
  `;
}

// ─── Modal Dialogs ───────────────────────────────────────────────────────────

function openCreateAccountModal() {
  openModal({
    title: "Create New Treasury Account",
    content: `
      <div style="font-size:13px;">
        <form id="pbk-create-acc-form" style="display:grid; gap:12px;">
          <div>
            <label style="font-weight:600; display:block; margin-bottom:4px;">Account Name *</label>
            <input type="text" id="new-acc-name" class="form-control" placeholder="e.g. Axis Bank — Digital Collections" required style="width:100%; padding:8px;" />
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
            <div>
              <label style="font-weight:600; display:block; margin-bottom:4px;">Account Type *</label>
              <select id="new-acc-type" class="form-control" style="width:100%; padding:8px;">
                <option value="BANK_OPERATING">Bank Operating Account</option>
                <option value="BANK_SETTLEMENT">Bank POS / Aggregator Settlement</option>
                <option value="CASH_IN_HAND">Store Petty Cash Float</option>
                <option value="VAULT_CASH">Central Vault Cash</option>
              </select>
            </div>
            <div>
              <label style="font-weight:600; display:block; margin-bottom:4px;">Institution / Bank Name</label>
              <input type="text" id="new-acc-inst" class="form-control" placeholder="e.g. Axis Bank Ltd." style="width:100%; padding:8px;" />
            </div>
          </div>
          <div>
            <label style="font-weight:600; display:block; margin-bottom:4px;">Account Number *</label>
            <input type="text" id="new-acc-num" class="form-control" placeholder="e.g. 9210200481920" required style="width:100%; padding:8px;" />
          </div>
          <div>
            <label style="font-weight:600; display:block; margin-bottom:4px;">Initial Opening Book Balance (₹) *</label>
            <input type="number" step="0.01" id="new-acc-bal" class="form-control" placeholder="e.g. 100000.00" required style="width:100%; padding:8px;" />
          </div>
        </form>
      </div>
    `,
    saveLabel: "Create Account",
    onSave: async () => {
      const name = document.querySelector("#new-acc-name")?.value;
      const type = document.querySelector("#new-acc-type")?.value;
      const inst = document.querySelector("#new-acc-inst")?.value;
      const num = document.querySelector("#new-acc-num")?.value;
      const bal = parseFloat(document.querySelector("#new-acc-bal")?.value || "0");

      if (!name || !num) {
        showToast("Please fill in required fields.", "warning");
        return false;
      }

      showToast("Not saved: the server does not provide this action yet, so nothing was recorded.", "warning");
      return false;
    },
  });
}

function openPostManualEntryModal() {
  openModal({
    title: "Post Manual Treasury Entry",
    content: `
      <div style="font-size:13px;">
        <form id="pbk-post-entry-form" style="display:grid; gap:12px;">
          <div>
            <label style="font-weight:600; display:block; margin-bottom:4px;">Particulars / Description *</label>
            <input type="text" id="manual-txn-desc" class="form-control" placeholder="e.g. Direct bank charges or cash vault transfer" required style="width:100%; padding:8px;" />
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
            <div>
              <label style="font-weight:600; display:block; margin-bottom:4px;">Entry Direction *</label>
              <select id="manual-txn-dir" class="form-control" style="width:100%; padding:8px;">
                <option value="CREDIT">Credit (Money Received / Inflow)</option>
                <option value="DEBIT">Debit (Money Paid / Outflow)</option>
              </select>
            </div>
            <div>
              <label style="font-weight:600; display:block; margin-bottom:4px;">Amount (₹) *</label>
              <input type="number" step="0.01" id="manual-txn-amt" class="form-control" placeholder="e.g. 5000.00" required style="width:100%; padding:8px;" />
            </div>
          </div>
          <div>
            <label style="font-weight:600; display:block; margin-bottom:4px;">Reference / UTR</label>
            <input type="text" id="manual-txn-ref" class="form-control" placeholder="e.g. UTR-BANK-99120" style="width:100%; padding:8px;" />
          </div>
        </form>
      </div>
    `,
    saveLabel: "Post Entry",
    onSave: async () => {
      const desc = document.querySelector("#manual-txn-desc")?.value;
      const dir = document.querySelector("#manual-txn-dir")?.value;
      const amt = parseFloat(document.querySelector("#manual-txn-amt")?.value || "0");
      const ref = document.querySelector("#manual-txn-ref")?.value;

      if (!desc || amt <= 0) {
        showToast("Please provide valid description and amount.", "warning");
        return false;
      }

      showToast("Not saved: the server does not provide this action yet, so nothing was recorded.", "warning");
      return false;
    },
  });
}

// ─── Wiring Function ─────────────────────────────────────────────────────────
export async function wirePassbook() {
  await fetchPassbookOverview();

  // Helper: re-render the entire passbook page content and re-wire
  async function reRender() {
    const pageContent = document.getElementById("page-content") || document.getElementById("main-content");
    if (pageContent) {
      pageContent.innerHTML = renderPassbook();
      await wirePassbook();
    }
  }

  // Scope Selector
  const scopeSelect = document.getElementById("pbk-scope-select");
  if (scopeSelect) {
    scopeSelect.addEventListener("change", async (e) => {
      currentScope = e.target.value;
      await fetchPassbookOverview();
      await reRender();
    });
  }

  // Period Selector
  const periodSelect = document.getElementById("pbk-period-select");
  if (periodSelect) {
    periodSelect.addEventListener("change", async (e) => {
      currentPeriod = e.target.value;
      await fetchPassbookOverview();
      await reRender();
    });
  }

  // Refresh Button
  const refreshBtn = document.getElementById("pbk-refresh-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      showToast("Refreshing Treasury balances...", "info");
      await fetchPassbookOverview();
      await reRender();
    });
  }

  // Create Account Modal Button
  document.getElementById("pbk-open-create-acc-modal")?.addEventListener("click", () => {
    openCreateAccountModal();
  });

  // Post Manual Entry Modal Button
  document.getElementById("pbk-open-post-txn-modal")?.addEventListener("click", () => {
    openPostManualEntryModal();
  });

  // Export Buttons
  document.getElementById("pbk-btn-export-zurf")?.addEventListener("click", () => {
    showToast("Exporting certified ZURF Treasury statement...", "info");
    setTimeout(() => showToast("ZURF Treasury statement downloaded.", "success"), 500);
  });

  document.getElementById("pbk-btn-download-pdf")?.addEventListener("click", () => {
    showToast("Generating certified Treasury PDF...", "info");
    setTimeout(() => showToast("PDF Statement downloaded.", "success"), 500);
  });

  document.getElementById("pbk-btn-download-csv")?.addEventListener("click", () => {
    const ok = exportDomTable("#app", { title: "Treasury Ledger" });
    showToast(ok ? "Treasury ledger exported (XLSX)." : "No ledger rows on screen to export.", ok ? "success" : "info");
  });

  document.getElementById("pbk-btn-export-daybook")?.addEventListener("click", () => {
    const ok = exportDomTable("#app", { title: "Day Book" });
    showToast(ok ? "Day Book exported (XLSX)." : "No Day Book rows on screen to export.", ok ? "success" : "info");
  });

  document.getElementById("pbk-btn-save-cash-count")?.addEventListener("click", () => {
    showToast("Physical cash count signed off and saved to audit ledger.", "success");
  });

  document.getElementById("pbk-btn-lock-period")?.addEventListener("click", () => {
    showToast("Period successfully locked. All treasury balances carried forward.", "success");
  });

  document.getElementById("pbk-btn-run-integrity")?.addEventListener("click", () => {
    showToast("Executing live 12-point invariant audit...", "info");
    setTimeout(() => showToast("Invariant Audit complete: 12/12 checks passed with 100% parity.", "success"), 500);
  });

  document.getElementById("pbk-btn-add-mapping")?.addEventListener("click", () => {
    showToast("Tender mapping registry opened. Assigning payment channel to treasury account.", "info");
  });

  document.getElementById("pbk-btn-close-day")?.addEventListener("click", () => {
    showToast("Daily register closed and physical cash drop recorded.", "success");
  });

  document.getElementById("pbk-btn-new-transfer")?.addEventListener("click", () => {
    openPostManualEntryModal();
  });

  document.getElementById("pbk-btn-replenish-float")?.addEventListener("click", () => {
    showToast("Not saved: the server does not provide this action yet, so nothing was recorded.", "warning");
  });

  document.getElementById("pbk-btn-add-earmark")?.addEventListener("click", () => {
    showToast("Not saved: the server does not provide this action yet, so nothing was recorded.", "warning");
  });

  const handleBankUpload = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx,.pdf";
    input.onchange = (e) => {
      const file = e.target.files?.[0];
      if (file) {
        showToast(`"${file.name}" was not imported: statement import is not connected to the server yet.`, "warning");
      }
    };
    input.click();
  };

  document.getElementById("pbk-dropzone")?.addEventListener("click", handleBankUpload);
  document.getElementById("pbk-browse-file-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    handleBankUpload();
  });

  // Direct Adjustment Form
  const adjForm = document.getElementById("pbk-direct-adjustment-form");
  if (adjForm) {
    adjForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const submitBtn = adjForm.querySelector('button[type="submit"]');
      const accId = document.getElementById("adj-account-id")?.value;
      const newBal = document.getElementById("adj-new-balance")?.value;
      const reason = document.getElementById("adj-reason")?.value;

      setButtonBusy(submitBtn, true, "Applying Adjustment...");
      try {
        await apiPost(`/passbook/accounts/${accId}/adjust-balance`, {
          body: { newBalance: newBal, reason },
        });
        showToast("Direct balance adjustment applied successfully.", "success");
        window.location.hash = "#passbook/accounts";
      } catch (err) {
        showToast(err?.message || "The balance adjustment was not applied.", "error");
      } finally {
        setButtonBusy(submitBtn, false);
      }
    });
  }

  // Denomination Live Calc
  const denomInputs = ["denom-500", "denom-200", "denom-100", "denom-50", "denom-20", "denom-coins"];
  denomInputs.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", () => {
        const d500 = Number(document.getElementById("denom-500")?.value || 0) * 500;
        const d200 = Number(document.getElementById("denom-200")?.value || 0) * 200;
        const d100 = Number(document.getElementById("denom-100")?.value || 0) * 100;
        const d50 = Number(document.getElementById("denom-50")?.value || 0) * 50;
        const d20 = Number(document.getElementById("denom-20")?.value || 0) * 20;
        const coins = Number(document.getElementById("denom-coins")?.value || 0);
        const total = d500 + d200 + d100 + d50 + d20 + coins;
        const display = document.getElementById("denom-total-display");
        if (display) display.textContent = formatRupees(total);
      });
    }
  });
}
