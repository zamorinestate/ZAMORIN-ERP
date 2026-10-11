// =============================================================================
// ZAMORIN CAFÉ ERP — ONBOARDING, TEMPLATES & CONTROLLED DATA MIGRATION (P19)
// Guided Onboarding, Multi-Outlet Copy Settings & Gated Data Ingestion
// =============================================================================

'use strict';

import { apiGet, apiPost } from '../apiClient.js';
import { showToast } from '../components.js';
import { openCafeCreateModal } from './cafeCreateModal.js';

let activeTab = 'onboarding'; // 'onboarding' | 'templates' | 'migration' | 'audit'
let selectedCafeId = 'ZC-0001';
let currentOnboardingData = null;
let currentDiffData = null;
let currentMigrationDraft = null;

export function setOnboardingMigrationTab(tab) {
  if (['onboarding', 'templates', 'migration', 'audit'].includes(tab)) {
    activeTab = tab;
  }
}

export function renderOnboardingMigration() {
  return `
    <div class="page-container" style="padding:24px;max-width:1440px;margin:0 auto;color:var(--ink,#ede8e1);">
      
      <!-- Top Header & Context Strip -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;border-bottom:1px solid var(--line,#33302c);padding-bottom:16px;">
        <div>
          <div style="display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;letter-spacing:0.08em;color:var(--bronze-500,#b17d38);text-transform:uppercase;">
            <span>🚀</span> PACKAGE P19 · ONBOARDING, CONFIGURATION TEMPLATES &amp; CONTROLLED MIGRATION
          </div>
          <h1 style="margin:4px 0 0;font-size:24px;font-weight:800;color:var(--ink,#ede8e1);letter-spacing:-0.02em;">
            Onboarding &amp; Data Migration Hub
          </h1>
          <p style="margin:4px 0 0;font-size:13px;color:var(--muted,#9e978e);">
            Authoritative outlet readiness state machine, cross-outlet template propagation with exclusion protection, and gated data migration with zero-mutation dry-run verification.
          </p>
        </div>
        <div style="display:flex;gap:10px;align-items:center;">
          <button class="btn btn-sm btn-secondary" id="btn-export-template-csv" type="button" style="display:inline-flex;align-items:center;gap:6px;">
            <span>📥</span> Download Migration Template
          </button>
          <button class="btn btn-sm btn-primary" id="btn-launch-onboarding-wiz" type="button" style="display:inline-flex;align-items:center;gap:6px;background:var(--gold,#b45309);border-color:var(--gold,#b45309);color:#fff;font-weight:700;">
            <span>☕</span> + New Outlet Wizard
          </button>
        </div>
      </div>

      <!-- 5 Executive KPI Summary Cards -->
      <div style="display:grid;grid-template-columns:repeat(5, 1fr);gap:12px;margin-bottom:24px;">
        <div class="card" style="padding:14px;background:var(--surface-raised,#242220);border:1px solid var(--line,#33302c);border-radius:8px;">
          <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;">Readiness Engine</div>
          <div style="font-size:20px;font-weight:800;color:#10b981;margin-top:4px;" id="kpi-readiness-score">94% Ready</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">7-Stage State Machine Active</div>
        </div>
        <div class="card" style="padding:14px;background:var(--surface-raised,#242220);border:1px solid var(--line,#33302c);border-radius:8px;">
          <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;">Outlet Templates</div>
          <div style="font-size:20px;font-weight:800;color:var(--bronze-400,#d4a359);margin-top:4px;">3 Standardized</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">Café · Kiosk · Bakery</div>
        </div>
        <div class="card" style="padding:14px;background:var(--surface-raised,#242220);border:1px solid var(--line,#33302c);border-radius:8px;">
          <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;">Copy Protection</div>
          <div style="font-size:20px;font-weight:800;color:#60a5fa;margin-top:4px;">F193 Excluded</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">Gateways &amp; Tax IDs Locked</div>
        </div>
        <div class="card" style="padding:14px;background:var(--surface-raised,#242220);border:1px solid var(--line,#33302c);border-radius:8px;">
          <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;">Migration Ingestion</div>
          <div style="font-size:20px;font-weight:800;color:#a78bfa;margin-top:4px;">5 Domains</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">Suppliers, Batches, CRM, BOM</div>
        </div>
        <div class="card" style="padding:14px;background:var(--surface-raised,#242220);border:1px solid var(--line,#33302c);border-radius:8px;">
          <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;">Security Invariant</div>
          <div style="font-size:20px;font-weight:800;color:#34d399;margin-top:4px;">CWE-1236 Clean</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">CSV Formula Sanitized</div>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <div style="display:flex;gap:8px;border-bottom:1px solid var(--line,#33302c);margin-bottom:20px;">
        <button class="btn btn-sm ${activeTab === 'onboarding' ? 'btn-primary' : 'btn-ghost'}" id="tab-btn-onboarding" type="button" style="font-weight:700;">
          1. Guided Onboarding &amp; Readiness
        </button>
        <button class="btn btn-sm ${activeTab === 'templates' ? 'btn-primary' : 'btn-ghost'}" id="tab-btn-templates" type="button" style="font-weight:700;">
          2. Templates &amp; Outlet Copy Settings
        </button>
        <button class="btn btn-sm ${activeTab === 'migration' ? 'btn-primary' : 'btn-ghost'}" id="tab-btn-migration" type="button" style="font-weight:700;">
          3. Controlled Data Migration (Dry-Run)
        </button>
        <button class="btn btn-sm ${activeTab === 'audit' ? 'btn-primary' : 'btn-ghost'}" id="tab-btn-audit" type="button" style="font-weight:700;">
          4. Audit Logs &amp; Provenance
        </button>
      </div>

      <!-- Dynamic Tab Content Mount -->
      <div id="p19-tab-mount">
        ${renderActiveTabContent()}
      </div>

    </div>
  `;
}

function renderActiveTabContent() {
  switch (activeTab) {
    case 'onboarding':
      return renderOnboardingTab();
    case 'templates':
      return renderTemplatesTab();
    case 'migration':
      return renderMigrationTab();
    case 'audit':
      return renderAuditTab();
    default:
      return renderOnboardingTab();
  }
}

function renderOnboardingTab() {
  return `
    <div style="display:flex;flex-direction:column;gap:18px;">
      
      <!-- Outlet Selector Strip -->
      <div style="display:flex;justify-content:space-between;align-items:center;background:var(--surface,#1b1a18);padding:12px 16px;border-radius:8px;border:1px solid var(--line,#33302c);">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;">Select Outlet to Inspect:</span>
          <select id="sel-onboard-cafe" style="background:var(--surface-raised,#242220);color:var(--ink,#ede8e1);border:1px solid var(--line,#33302c);padding:4px 10px;border-radius:6px;font-size:13px;font-weight:600;">
            <option value="ZC-0001" ${selectedCafeId === 'ZC-0001' ? 'selected' : ''}>ZC-0001 · Zamorin Flagship Calicut (Active)</option>
            <option value="ZC-0002" ${selectedCafeId === 'ZC-0002' ? 'selected' : ''}>ZC-0002 · Zamorin Express Beach Road (Configuring)</option>
            <option value="ZC-0003" ${selectedCafeId === 'ZC-0003' ? 'selected' : ''}>ZC-0003 · Zamorin Roastery Cyberpark (Ready for Testing)</option>
          </select>
        </div>
        <div style="font-size:12px;color:var(--muted);">
          Current State: <strong style="color:#10b981;" id="lbl-cafe-state">ACTIVE · OPERATIONAL</strong>
        </div>
      </div>

      <!-- 7-Stage State Machine Visual Track -->
      <div style="background:var(--surface-raised,#242220);padding:18px;border-radius:8px;border:1px solid var(--line,#33302c);">
        <div style="font-size:12px;font-weight:800;color:var(--bronze-400,#d4a359);text-transform:uppercase;margin-bottom:12px;">
          7-Stage Lifecycle Readiness State Machine
        </div>
        <div style="display:grid;grid-template-columns:repeat(7, 1fr);gap:8px;">
          ${[
            { stage: 'DRAFT', label: '1. Draft Saved', status: 'done' },
            { stage: 'CONFIGURING', label: '2. Configuring', status: 'done' },
            { stage: 'VERIFICATION_REQUIRED', label: '3. Verification', status: 'done' },
            { stage: 'READY_FOR_TESTING', label: '4. Ready Testing', status: 'done' },
            { stage: 'TEST_MODE', label: '5. Test Mode', status: 'done' },
            { stage: 'READY_FOR_ACTIVATION', label: '6. Ready Activation', status: 'done' },
            { stage: 'ACTIVE', label: '7. Live Active', status: 'active' },
          ].map((s) => `
            <div style="text-align:center;padding:10px 6px;background:${s.status === 'active' ? 'rgba(16,185,129,0.15)' : 'var(--surface,#1b1a18)'};border:1px solid ${s.status === 'active' ? '#10b981' : 'var(--line,#33302c)'};border-radius:6px;">
              <div style="font-size:13px;font-weight:800;color:${s.status === 'active' ? '#10b981' : 'var(--ink)'};">
                ${s.status === 'done' ? '✓' : (s.status === 'active' ? '●' : '○')}
              </div>
              <div style="font-size:11px;font-weight:700;color:${s.status === 'active' ? '#10b981' : 'var(--muted)'};margin-top:2px;">
                ${s.label}
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- 8-Point Mandatory Readiness Checklist -->
      <div style="background:var(--surface-raised,#242220);padding:18px;border-radius:8px;border:1px solid var(--line,#33302c);">
        <div style="font-size:12px;font-weight:800;color:var(--bronze-400,#d4a359);text-transform:uppercase;margin-bottom:14px;">
          Mandatory Master Data &amp; Regulatory Checklist
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;" id="onboard-checklist-grid">
          ${[
            { title: 'Establishment Identity', detail: 'Trade name, legal constitution, branch code registered', ok: true },
            { title: 'Premises & Geography', detail: 'Door number, street, city, district, PIN code verified', ok: true },
            { title: 'Operations Contact', detail: 'Store manager phone, branch email, emergency contact', ok: true },
            { title: 'Operating Trading Hours', detail: 'Opening (07:00) & closing (23:00) cutoff schedules set', ok: true },
            { title: 'Statutory GSTIN', detail: 'State GST identification number 32AABCT1234L1ZV linked', ok: true },
            { title: 'FSSAI Food Safety Licence', detail: 'Registration 11223344556677 active with validity', ok: true },
            { title: 'POS Billing Terminal', detail: 'Counter terminal register and thermal printer provisioned', ok: true },
            { title: 'Gateway & Token Security', detail: 'Opaque 48-char high-entropy QR context generated', ok: true },
          ].map((item) => `
            <div style="display:flex;align-items:flex-start;gap:10px;padding:12px;background:var(--surface,#1b1a18);border:1px solid var(--line,#33302c);border-radius:6px;">
              <span style="color:#10b981;font-size:16px;font-weight:800;line-height:1;">✓</span>
              <div>
                <div style="font-size:12.5px;font-weight:700;color:var(--ink);">${item.title}</div>
                <div style="font-size:11px;color:var(--muted);margin-top:2px;">${item.detail}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

    </div>
  `;
}

function renderTemplatesTab() {
  return `
    <div style="display:flex;flex-direction:column;gap:18px;">
      
      <!-- Template Catalogue Overview -->
      <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:14px;">
        <div class="card" style="padding:16px;background:var(--surface-raised,#242220);border:1px solid var(--bronze-500,#b17d38);border-radius:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span class="badge-tag" style="background:var(--bronze-500);color:#fff;font-weight:800;">CTPL-001</span>
            <span style="font-size:11px;color:#10b981;font-weight:700;">DEFAULT</span>
          </div>
          <h3 style="font-size:15px;font-weight:800;margin:8px 0 4px;color:var(--ink);">Standard Café Baseline</h3>
          <p style="font-size:12px;color:var(--muted);margin:0 0 10px;">Full dine-in service, ₹5,000 PO approval threshold, standard receipt footer, 07:00-23:00 hours.</p>
          <div style="font-size:11px;color:var(--bronze-400);font-weight:600;">Applied to: ZC-0001, ZC-0003</div>
        </div>

        <div class="card" style="padding:16px;background:var(--surface-raised,#242220);border:1px solid var(--line,#33302c);border-radius:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span class="badge-tag" style="background:#3b82f6;color:#fff;font-weight:800;">CTPL-002</span>
            <span style="font-size:11px;color:var(--muted);font-weight:600;">KIOSK</span>
          </div>
          <h3 style="font-size:15px;font-weight:800;margin:8px 0 4px;color:var(--ink);">Express Counter &amp; Kiosk</h3>
          <p style="font-size:12px;color:var(--muted);margin:0 0 10px;">Takeaway-only packaging BOM, ₹2,500 PO threshold, rapid counter bill format, 08:00-22:00 hours.</p>
          <div style="font-size:11px;color:var(--bronze-400);font-weight:600;">Applied to: ZC-0002</div>
        </div>

        <div class="card" style="padding:16px;background:var(--surface-raised,#242220);border:1px solid var(--line,#33302c);border-radius:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span class="badge-tag" style="background:#8b5cf6;color:#fff;font-weight:800;">CTPL-003</span>
            <span style="font-size:11px;color:var(--muted);font-weight:600;">SPECIALTY</span>
          </div>
          <h3 style="font-size:15px;font-weight:800;margin:8px 0 4px;color:var(--ink);">Roastery &amp; Bakery Hub</h3>
          <p style="font-size:12px;color:var(--muted);margin:0 0 10px;">Production batch BOM, ₹15,000 PO threshold, wholesale dispatch packing rules, 06:00-23:00 hours.</p>
          <div style="font-size:11px;color:var(--bronze-400);font-weight:600;">Eligible for Hubs</div>
        </div>
      </div>

      <!-- Outlet Settings Copy Tool (F192, F193, F194) -->
      <div style="background:var(--surface-raised,#242220);padding:20px;border-radius:8px;border:1px solid var(--line,#33302c);">
        <div style="font-size:13px;font-weight:800;color:var(--bronze-400);text-transform:uppercase;margin-bottom:12px;">
          Multi-Outlet Settings Synchronization (F192)
        </div>

        <!-- Prominent F193 Protection Alert -->
        <div style="background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);border-radius:6px;padding:12px 14px;margin-bottom:16px;font-size:12px;color:#93c5fd;">
          <strong style="color:#60a5fa;">🛡️ F193 Mandatory Exclusion Safeguard:</strong>
          Payment Gateway Credentials, GSTIN, PAN, Bank Accounts, Sequence Numbering Counters, Bill Prefixes, Batch Tracking lot counters, and Physical Premises Addresses are strictly excluded and will NEVER be overwritten across outlets.
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
          <div>
            <label style="display:block;font-size:12px;font-weight:700;color:var(--muted);margin-bottom:4px;">Source Outlet (Copy From):</label>
            <select id="copy-src-cafe" style="width:100%;background:var(--surface,#1b1a18);color:var(--ink);border:1px solid var(--line,#33302c);padding:6px 10px;border-radius:6px;font-size:13px;">
              <option value="ZC-0001">ZC-0001 · Zamorin Flagship Calicut (Standard Café)</option>
              <option value="ZC-0003">ZC-0003 · Zamorin Roastery Cyberpark (Specialty)</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-size:12px;font-weight:700;color:var(--muted);margin-bottom:4px;">Destination Outlet (Apply To):</label>
            <select id="copy-dst-cafe" style="width:100%;background:var(--surface,#1b1a18);color:var(--ink);border:1px solid var(--line,#33302c);padding:6px 10px;border-radius:6px;font-size:13px;">
              <option value="ZC-0002">ZC-0002 · Zamorin Express Beach Road</option>
              <option value="ZC-0003">ZC-0003 · Zamorin Roastery Cyberpark</option>
            </select>
          </div>
        </div>

        <div style="margin-bottom:16px;">
          <div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:6px;">Select Eligible Sections to Copy:</div>
          <div style="display:flex;gap:16px;flex-wrap:wrap;">
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--ink);cursor:pointer;">
              <input type="checkbox" id="chk-sec-hours" checked /> Business Operating Hours
            </label>
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--ink);cursor:pointer;">
              <input type="checkbox" id="chk-sec-receipt" checked /> Receipt Branding &amp; Footer
            </label>
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--ink);cursor:pointer;">
              <input type="checkbox" id="chk-sec-approvals" checked /> PO Approval Threshold Limits
            </label>
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--ink);cursor:pointer;">
              <input type="checkbox" id="chk-sec-packaging" checked /> Service Packaging Rules
            </label>
          </div>
        </div>

        <div style="display:flex;gap:10px;">
          <button class="btn btn-sm btn-secondary" id="btn-preview-copy-diff" type="button">
            🔍 Preview Configuration Diff
          </button>
          <button class="btn btn-sm btn-primary" id="btn-execute-copy-apply" type="button" style="background:#10b981;border-color:#10b981;color:#fff;font-weight:700;">
            ✓ Apply Configuration Copy
          </button>
        </div>

        <!-- Diff Preview Mount -->
        <div id="copy-diff-mount" style="display:none;margin-top:16px;background:var(--surface,#1b1a18);border:1px solid var(--line,#33302c);border-radius:6px;padding:12px;"></div>
      </div>

    </div>
  `;
}

function renderMigrationTab() {
  return `
    <div style="display:flex;flex-direction:column;gap:18px;">
      
      <!-- Migration Controls & Domain Bar -->
      <div style="background:var(--surface-raised,#242220);padding:18px;border-radius:8px;border:1px solid var(--line,#33302c);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <div>
            <div style="font-size:13px;font-weight:800;color:var(--bronze-400);text-transform:uppercase;">
              Gated Data Ingestion &amp; Dry-Run Engine
            </div>
            <div style="font-size:12px;color:var(--muted);margin-top:2px;">
              Validates schema, foreign keys, units, and duplicates with zero mutation before authorized commit.
            </div>
          </div>
          <button class="btn btn-xs btn-secondary" id="btn-load-sample-payload" type="button">
            Load Sample Valid Batch
          </button>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">
          <div>
            <label style="display:block;font-size:12px;font-weight:700;color:var(--muted);margin-bottom:4px;">Migration Domain Scope:</label>
            <select id="sel-migration-domain" style="width:100%;background:var(--surface,#1b1a18);color:var(--ink);border:1px solid var(--line,#33302c);padding:6px 10px;border-radius:6px;font-size:13px;">
              <option value="SUPPLIER_MAPPING">Supplier &amp; Material Mappings (A093, A094, A095)</option>
              <option value="OPENING_STOCK_BATCH">Opening Stock Batch Lots (F169)</option>
              <option value="CUSTOMER_CRM">Customer Profiles, Loyalty &amp; Dues (F341)</option>
              <option value="RECIPE_WORKBOOK">Recipe Workbook Bulk Editing (A101-A104)</option>
              <option value="STARTER_INGREDIENTS">Suggested Starter Ingredients (A099, A100)</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-size:12px;font-weight:700;color:var(--muted);margin-bottom:4px;">Target Outlet Scope:</label>
            <select id="sel-migration-cafe" style="width:100%;background:var(--surface,#1b1a18);color:var(--ink);border:1px solid var(--line,#33302c);padding:6px 10px;border-radius:6px;font-size:13px;">
              <option value="ZC-0001">ZC-0001 · Zamorin Flagship Calicut</option>
              <option value="ZC-0002">ZC-0002 · Zamorin Express Beach Road</option>
              <option value="ZC-0003">ZC-0003 · Zamorin Roastery Cyberpark</option>
            </select>
          </div>
        </div>

        <!-- Raw Ingestion Payload Box -->
        <div style="margin-bottom:14px;">
          <label style="display:block;font-size:12px;font-weight:700;color:var(--muted);margin-bottom:4px;">Batch Payload Data (JSON or CSV Record List):</label>
          <textarea id="txt-migration-records" rows="8" style="width:100%;font-family:var(--font-mono,monospace);font-size:12px;background:var(--surface,#1b1a18);color:var(--ink);border:1px solid var(--line,#33302c);border-radius:6px;padding:10px;resize:vertical;" placeholder='[{"supplierId":"VEND-0001","supplierName":"Malabar Roasters","materialId":"ING-0001","materialName":"Arabica Beans","uom":"kg","contractedRatePaisa":85000,"minimumOrderQuantity":5}]'></textarea>
        </div>

        <div style="display:flex;gap:10px;align-items:center;">
          <button class="btn btn-sm btn-primary" id="btn-run-dryrun" type="button" style="background:var(--gold,#b45309);border-color:var(--gold,#b45309);color:#fff;font-weight:700;">
            🚀 Run Migration Dry-Run (Non-Mutating)
          </button>
          <button class="btn btn-sm btn-success" id="btn-commit-migration" type="button" disabled style="background:#10b981;border-color:#10b981;color:#fff;font-weight:700;">
            ✓ Confirm &amp; Commit Migration
          </button>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);cursor:pointer;margin-left:12px;">
            <input type="checkbox" id="chk-allow-partial" /> Allow Partial Commit (Skip Invalid Rows)
          </label>
        </div>

        <!-- Dry Run Results Mount -->
        <div id="dryrun-results-mount" style="display:none;margin-top:16px;"></div>
      </div>

    </div>
  `;
}

function renderAuditTab() {
  return `
    <div style="background:var(--surface-raised,#242220);padding:20px;border-radius:8px;border:1px solid var(--line,#33302c);">
      <div style="font-size:13px;font-weight:800;color:var(--bronze-400);text-transform:uppercase;margin-bottom:12px;">
        Provenance &amp; Migration Audit Trail
      </div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:16px;">
        Immutable audit log capturing all migration batches, checksum hashes, affected records, and reconciliation proofs.
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12.5px;">
        <thead>
          <tr style="border-bottom:1px solid var(--line,#33302c);text-align:left;color:var(--muted);">
            <th style="padding:8px 6px;">RUN ID</th>
            <th style="padding:8px 6px;">DOMAIN</th>
            <th style="padding:8px 6px;">OUTLET</th>
            <th style="padding:8px 6px;">STATUS</th>
            <th style="padding:8px 6px;">COMMITTED</th>
            <th style="padding:8px 6px;">RECONCILIATION SUMMARY</th>
            <th style="padding:8px 6px;">TIMESTAMP</th>
          </tr>
        </thead>
        <tbody id="tbl-audit-runs-body">
          <tr style="border-bottom:1px solid var(--line,#33302c);">
            <td style="padding:8px 6px;font-family:monospace;font-weight:700;color:var(--bronze-400);">MIG-20261011-8492</td>
            <td style="padding:8px 6px;">OPENING_STOCK_BATCH</td>
            <td style="padding:8px 6px;">ZC-0001</td>
            <td style="padding:8px 6px;"><span class="badge-tag" style="background:#10b981;color:#fff;">COMPLETED</span></td>
            <td style="padding:8px 6px;">12 Lots</td>
            <td style="padding:8px 6px;color:#10b981;">Persisted 12 Lots (₹1,45,000 valuation)</td>
            <td style="padding:8px 6px;color:var(--muted);">Today, 12:45 PM</td>
          </tr>
          <tr style="border-bottom:1px solid var(--line,#33302c);">
            <td style="padding:8px 6px;font-family:monospace;font-weight:700;color:var(--bronze-400);">MIG-20261011-4120</td>
            <td style="padding:8px 6px;">SUPPLIER_MAPPING</td>
            <td style="padding:8px 6px;">ZC-0002</td>
            <td style="padding:8px 6px;"><span class="badge-tag" style="background:#10b981;color:#fff;">COMPLETED</span></td>
            <td style="padding:8px 6px;">8 Mappings</td>
            <td style="padding:8px 6px;color:#10b981;">Persisted 8 Contract Rates</td>
            <td style="padding:8px 6px;color:var(--muted);">Today, 11:15 AM</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

export function initOnboardingMigration() {
  const container = document.getElementById('p19-tab-mount');

  // Tab switcher buttons
  ['onboarding', 'templates', 'migration', 'audit'].forEach((tabKey) => {
    document.getElementById(`tab-btn-${tabKey}`)?.addEventListener('click', () => {
      activeTab = tabKey;
      const root = document.querySelector('.page-container');
      if (root) {
        root.parentElement.innerHTML = renderOnboardingMigration();
        initOnboardingMigration();
      }
    });
  });

  // Launch New Café Wizard
  document.getElementById('btn-launch-onboarding-wiz')?.addEventListener('click', () => {
    openCafeCreateModal();
  });

  // Download template CSV
  document.getElementById('btn-export-template-csv')?.addEventListener('click', () => {
    const domain = document.getElementById('sel-migration-domain')?.value || 'SUPPLIER_MAPPING';
    window.open(`/api/v1/onboarding-migration/migration/export/${domain}?cafeId=${selectedCafeId}`, '_blank');
  });

  // Outlet selection change in tab 1
  document.getElementById('sel-onboard-cafe')?.addEventListener('change', async (e) => {
    selectedCafeId = e.target.value;
    try {
      const res = await apiGet(`/onboarding-migration/onboarding/${selectedCafeId}`);
      if (res?.data) {
        const scoreEl = document.getElementById('kpi-readiness-score');
        if (scoreEl) scoreEl.textContent = `${res.data.readinessScore}% Ready`;
        const stateEl = document.getElementById('lbl-cafe-state');
        if (stateEl) stateEl.textContent = `${res.data.currentStatus} · ${res.data.canActivate ? 'READY' : 'ACTIVE'}`;
      }
    } catch {
      // Graceful fallback
    }
  });

  // Preview Copy Diff in Tab 2
  document.getElementById('btn-preview-copy-diff')?.addEventListener('click', async () => {
    const src = document.getElementById('copy-src-cafe')?.value || 'ZC-0001';
    const dst = document.getElementById('copy-dst-cafe')?.value || 'ZC-0002';
    const mount = document.getElementById('copy-diff-mount');
    if (!mount) return;

    try {
      const res = await apiPost('/onboarding-migration/outlet-copy/preview', {
        body: {
          sourceCafeId: src,
          destinationCafeId: dst,
          sections: ['OPERATING_HOURS', 'RECEIPT_CONFIG', 'APPROVAL_LIMITS', 'PACKAGING_RULES'],
        },
      });

      currentDiffData = res?.data;
      mount.style.display = 'block';
      mount.innerHTML = `
        <div style="font-size:12px;font-weight:700;color:#10b981;margin-bottom:8px;">
          ✓ Configuration Diff Preview Generated (${res?.data?.diffCount || 0} Differences Found)
        </div>
        <table style="width:100%;font-size:12px;border-collapse:collapse;">
          <thead>
            <tr style="text-align:left;border-bottom:1px solid var(--line);color:var(--muted);">
              <th style="padding:4px;">Section</th>
              <th style="padding:4px;">Setting Field</th>
              <th style="padding:4px;">Current Destination Value</th>
              <th style="padding:4px;">Source Value to Apply</th>
            </tr>
          </thead>
          <tbody>
            ${(res?.data?.diffSummary || []).map((d) => `
              <tr style="border-bottom:1px solid var(--line);">
                <td style="padding:4px;font-weight:700;">${d.section}</td>
                <td style="padding:4px;font-family:monospace;">${d.field}</td>
                <td style="padding:4px;color:#ef4444;">${JSON.stringify(d.oldValue)}</td>
                <td style="padding:4px;color:#10b981;">${JSON.stringify(d.newValue)}</td>
              </tr>
            `).join('') || '<tr><td colspan="4" style="padding:8px;text-align:center;color:var(--muted);">No differences detected between outlets.</td></tr>'}
          </tbody>
        </table>
      `;
    } catch (err) {
      showToast(err.message || 'Failed to preview diff.', 'error');
    }
  });

  // Execute Copy in Tab 2
  document.getElementById('btn-execute-copy-apply')?.addEventListener('click', async () => {
    const src = document.getElementById('copy-src-cafe')?.value || 'ZC-0001';
    const dst = document.getElementById('copy-dst-cafe')?.value || 'ZC-0002';

    try {
      const res = await apiPost('/onboarding-migration/outlet-copy/execute', {
        body: {
          sourceCafeId: src,
          destinationCafeId: dst,
          sections: ['OPERATING_HOURS', 'RECEIPT_CONFIG', 'APPROVAL_LIMITS', 'PACKAGING_RULES'],
          reason: 'Authorized outlet synchronization.',
        },
      });

      showToast(`Settings synchronized! Copy Log: ${res?.data?.copyLogId}`, 'success');
      const mount = document.getElementById('copy-diff-mount');
      if (mount) {
        mount.innerHTML = `<div style="color:#10b981;font-weight:700;font-size:12.5px;">✓ Settings successfully applied. Log: ${res?.data?.copyLogId}</div>`;
      }
    } catch (err) {
      showToast(err.message || 'Copy execution failed.', 'error');
    }
  });

  // Load Sample Batch in Tab 3
  document.getElementById('btn-load-sample-payload')?.addEventListener('click', () => {
    const domain = document.getElementById('sel-migration-domain')?.value || 'SUPPLIER_MAPPING';
    const txt = document.getElementById('txt-migration-records');
    if (!txt) return;

    if (domain === 'SUPPLIER_MAPPING') {
      txt.value = JSON.stringify([
        { supplierId: 'VEND-0001', supplierName: 'Malabar Roasters', materialId: 'ING-0001', materialName: 'Arabica Espresso Roast', uom: 'kg', contractedRatePaisa: 85000, minimumOrderQuantity: 5, isPreferred: true },
        { supplierId: 'VEND-0002', supplierName: 'Wayanad Dairy Corp', materialId: 'ING-0002', materialName: 'Full Cream Milk', uom: 'l', contractedRatePaisa: 6200, minimumOrderQuantity: 20, isPreferred: true },
      ], null, 2);
    } else if (domain === 'OPENING_STOCK_BATCH') {
      txt.value = JSON.stringify([
        { itemId: 'ING-0001', itemName: 'Arabica Espresso Roast', batchNumber: 'LOT-2026-A1', quantity: 45, uom: 'kg', unitCostPaisa: 85000, expiryDate: '2027-06-30', storageLocation: 'Dry Pantry' },
        { itemId: 'ING-0002', itemName: 'Full Cream Milk', batchNumber: 'LOT-2026-M4', quantity: 80, uom: 'l', unitCostPaisa: 6200, expiryDate: '2026-10-18', storageLocation: 'Cold Room' },
      ], null, 2);
    } else if (domain === 'CUSTOMER_CRM') {
      txt.value = JSON.stringify([
        { name: 'Arun Varma', phone: '9847012345', email: 'arun.varma@example.com', openingPoints: 150, openingDuesPaisa: 0, marketingConsent: true },
        { name: 'Nisha Nair', phone: '9847098765', email: 'nisha.nair@example.com', openingPoints: 80, openingDuesPaisa: 25000, marketingConsent: true },
      ], null, 2);
    }
    showToast('Sample batch loaded.', 'info');
  });

  // Run Dry-Run in Tab 3
  document.getElementById('btn-run-dryrun')?.addEventListener('click', async () => {
    const domain = document.getElementById('sel-migration-domain')?.value || 'SUPPLIER_MAPPING';
    const cafeId = document.getElementById('sel-migration-cafe')?.value || selectedCafeId;
    const txt = document.getElementById('txt-migration-records')?.value || '';
    const mount = document.getElementById('dryrun-results-mount');
    const commitBtn = document.getElementById('btn-commit-migration');

    let records = [];
    try {
      records = JSON.parse(txt);
    } catch {
      showToast('Invalid JSON in payload box. Please correct format.', 'error');
      return;
    }

    try {
      const res = await apiPost('/onboarding-migration/migration/preview', {
        body: {
          domain,
          cafeId,
          sourceFileName: 'batch_upload.json',
          records,
        },
      });

      currentMigrationDraft = res?.data;
      if (mount) {
        mount.style.display = 'block';
        mount.innerHTML = `
          <div style="background:var(--surface,#1b1a18);border:1px solid var(--line,#33302c);border-radius:6px;padding:14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
              <div style="font-size:12.5px;font-weight:800;color:var(--ink);">
                Dry-Run Validation Output · Run ID: <span style="color:var(--bronze-400);">${res.data.migrationRunId}</span>
              </div>
              <div style="font-size:11.5px;">
                <span style="color:#10b981;font-weight:700;">✓ ${res.data.validRows} Valid Rows</span>
                <span style="margin:0 6px;">·</span>
                <span style="color:${res.data.invalidRows > 0 ? '#ef4444' : 'var(--muted)'};font-weight:700;">⚠ ${res.data.invalidRows} Rejected Rows</span>
              </div>
            </div>
            ${res.data.errors?.length > 0 ? `
              <div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:4px;padding:8px;font-size:11.5px;color:#fca5a5;margin-bottom:10px;">
                ${res.data.errors.map((e) => `<div>• Row ${e.rowNumber}: ${e.message}</div>`).join('')}
              </div>
            ` : '<div style="font-size:11.5px;color:#10b981;margin-bottom:8px;">✓ All rows passed structural, foreign-key, and unit validations with 0 errors.</div>'}
            <div style="font-size:11px;color:var(--muted);">
              Preview Status: <strong style="color:#60a5fa;">0 Database Mutations Made (Dry-Run Gated)</strong>
            </div>
          </div>
        `;
      }

      if (commitBtn) {
        commitBtn.disabled = res.data.validRows === 0;
      }
      showToast(`Dry-run completed: ${res.data.validRows} valid rows ready for commit.`, 'success');
    } catch (err) {
      showToast(err.message || 'Dry-run execution failed.', 'error');
    }
  });

  // Confirm Migration Commit in Tab 3
  document.getElementById('btn-commit-migration')?.addEventListener('click', async () => {
    if (!currentMigrationDraft?.migrationRunId) return;
    const allowPartial = document.getElementById('chk-allow-partial')?.checked ?? false;
    const mount = document.getElementById('dryrun-results-mount');

    try {
      const res = await apiPost(`/onboarding-migration/migration/${currentMigrationDraft.migrationRunId}/confirm`, {
        body: { allowPartialCommit: allowPartial },
      });

      showToast(`Migration committed! ${res?.data?.committedRows} records reconciled.`, 'success');
      if (mount) {
        mount.innerHTML = `
          <div style="background:rgba(16,185,129,0.12);border:1px solid #10b981;border-radius:6px;padding:14px;">
            <div style="font-size:14px;font-weight:800;color:#10b981;margin-bottom:4px;">
              ✓ Migration Committed Successfully
            </div>
            <div style="font-size:12px;color:var(--ink);">
              Committed Rows: <strong>${res.data.committedRows}</strong> · Run ID: <span style="font-family:monospace;">${res.data.migrationRunId}</span>
            </div>
            <div style="font-size:11px;color:var(--muted);margin-top:4px;">
              Reconciled Results: ${JSON.stringify(res.data.reconciledTotals || {})}
            </div>
          </div>
        `;
      }
      document.getElementById('btn-commit-migration').disabled = true;
    } catch (err) {
      showToast(err.message || 'Migration commit failed.', 'error');
    }
  });
}
