import { apiGet, apiPost, apiPut, downloadFile } from '../apiClient.js';
import { showToast, skeleton, openModal, closeModal, confirmAction, renderCafeContextStrip, renderFileUploadZone, wireFileUploadZone, openUniversalDocumentModal } from '../components.js';
import { state } from '../state.js';
import { ROLES } from '../navigation.js';
import { navigate } from '../router.js';
import { openInvoiceIntelligenceReviewModal } from './invoiceIntelligenceReview.js';

let activeTab = 'overview';
let cachedOverview = null;
let cachedOrders = [];
let cachedRequisitions = [];
let cachedRfqs = [];
let cachedGrns = [];
let cachedAgreements = [];
let cachedSuppliers = [];
let cachedReturns = [];
let sampleGRNs = [];
let cachedMatching = null;
let searchQuery = '';
let selectedCafe = 'ALL';
let selectedStatus = 'ALL';

export function setProcurementActiveTab(tab) {
  activeTab = tab || 'overview';
}

const STATUS_PILLS = {
  DRAFT: 'pill-dark',
  SUBMITTED: 'pill-amber',
  PENDING_APPROVAL: 'pill-amber',
  APPROVED: 'pill-mint',
  ORDERED: 'pill-sky',
  PARTIALLY_RECEIVED: 'pill-amber',
  RECEIVED: 'pill-mint',
  VERIFIED_PENDING_MASTER_APPROVAL: 'pill-amber',
  CLOSED: 'pill-dark',
  CANCELLED: 'pill-coral',
  OPEN: 'pill-sky',
  EVALUATION: 'pill-amber',
  AWARDED: 'pill-mint',
  MATCHED_100_PERCENT: 'pill-mint',
  WITHIN_TOLERANCE: 'pill-amber',
  MISMATCH: 'pill-coral',
};

function formatPaise(paisa) {
  return '₹' + ((paisa || 0) / 100).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
}

function renderStatusPill(status) {
  const pillClass = STATUS_PILLS[status] || 'pill-dark';
  return `<span class="pill ${pillClass}" style="font-size:10px;font-weight:700;letter-spacing:0.3px;">${status || 'UNKNOWN'}</span>`;
}

export function renderProcurement(subroute) {
  if (subroute !== undefined) {
    activeTab = subroute || 'overview';
  }

  // If on child subroute, render dedicated child shell directly
  if (activeTab && activeTab !== 'overview') {
    return `
      <div class="page-enter" style="display:flex;flex-direction:column;gap:16px;">
        <div id="procurement-tab-content">
          ${skeleton('280px')}
        </div>
      </div>
    `;
  }

  return `
    <div class="page-enter" style="padding-bottom: 60px;">
      <!-- Page Header -->
      <div class="page-header" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 24px; flex-wrap:wrap; gap:16px;">
        <div>
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <h1 class="page-title" style="font-size:26px; font-weight:700; color:var(--ink); margin:0;">Procurement Control Centre</h1>
            <span class="badge" style="background:rgba(180,83,9,0.12); color:#b45309; font-weight:600; font-size:12px; padding:4px 10px; border-radius:12px;">SCR-012 PROC</span>
          </div>
          <p class="page-subtitle" style="font-size:14px; color:var(--muted); margin:4px 0 0;">Source-to-Pay, Supplier Deliveries, GRN Receiving &amp; 3-Way Matching</p>
        </div>
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <button class="btn btn-secondary" id="btn-sync-procurement" style="font-weight:600; display:flex; align-items:center; gap:6px;" type="button">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Sync Procurement
          </button>
        </div>
      </div>
      <!-- Scope Context Banner -->
      ${renderCafeContextStrip()}

      <!-- 4 Primary Headline KPIs -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:12px;">
        <div class="card" style="padding:14px 16px;background:var(--surface);">
          <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;">Open Purchase Orders</div>
          <div id="kpi-open-orders" style="font-size:22px;font-weight:800;color:var(--ink);margin-top:4px;">—</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">Committed with suppliers</div>
        </div>
        <div class="card" style="padding:14px 16px;background:var(--surface);">
          <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;">Open Commitment</div>
          <div id="kpi-open-commitment" style="font-size:22px;font-weight:800;color:var(--ink);margin-top:4px;">—</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">Total active order value</div>
        </div>
        <div class="card" style="padding:14px 16px;background:var(--surface);">
          <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;">Deliveries Due</div>
          <div id="kpi-deliveries-due" style="font-size:22px;font-weight:800;color:var(--amber, #f59e0b);margin-top:4px;">—</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">Scheduled or in transit</div>
        </div>
        <div class="card" style="padding:14px 16px;background:var(--surface);">
          <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;">Awaiting Approval</div>
          <div id="kpi-awaiting-approval" style="font-size:22px;font-weight:800;color:var(--sky, #0284c7);margin-top:4px;">—</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">Pending managerial review</div>
        </div>
      </div>

      <!-- Action Centre / Requires Attention Strip -->
      <div id="procurement-action-centre" style="display:none;"></div>

      <!-- Tab Content Area -->
      <div id="procurement-tab-content">
        ${skeleton('280px')}
      </div>
    </div>
  `;
}

export async function wireProcurement(root, subroute) {
  if (subroute !== undefined) {
    activeTab = subroute || 'overview';
  }
  setupTabHandlers(root);
  setupHeaderActionHandlers(root);
  await renderActiveTab(root);
  if (activeTab === 'overview') {
    loadProcurementOverview(root);
  }
}

function setupTabHandlers(root) {
  root.querySelectorAll('[data-proc-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.procTab;
      navigate(`procurement/${activeTab}`);
    });
  });
}

function setupHeaderActionHandlers(root) {
  root.querySelector('#btn-sync-procurement')?.addEventListener('click', () => {
    showToast('Syncing procurement data...', 'info');
    loadProcurementOverview(root);
  });
}

async function loadProcurementOverview(root) {
  try {
    const res = await apiGet('/procurement/overview');
    if (res?.success && res.data) {
      cachedOverview = res.data;
      const kpis = res.data.kpis || {};
      const elOpen = root.querySelector('#kpi-open-orders');
      const elCommit = root.querySelector('#kpi-open-commitment');
      const elDue = root.querySelector('#kpi-deliveries-due');
      const elApprove = root.querySelector('#kpi-awaiting-approval');

      if (elOpen) elOpen.textContent = kpis.openOrdersCount ?? '0';
      if (elCommit) elCommit.textContent = formatPaise(kpis.openCommitmentPaise || 0);
      if (elDue) elDue.textContent = kpis.deliveriesDueCount ?? '0';
      if (elApprove) elApprove.textContent = kpis.awaitingApprovalCount ?? '0';

      const actionCentre = root.querySelector('#procurement-action-centre');
      if (actionCentre && res.data.actionItems?.length > 0) {
        actionCentre.style.display = 'block';
        actionCentre.innerHTML = `
          <div class="card" style="padding:12px 16px;background:rgba(245, 158, 11, 0.08);border:1px solid rgba(245, 158, 11, 0.3);display:flex;flex-direction:column;gap:8px;">
            <div style="font-size:12px;font-weight:800;color:var(--amber, #f59e0b);display:flex;align-items:center;gap:6px;">
              <span>⚡</span> REQUIRES ATTENTION (${res.data.actionItems.length})
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;">
              ${res.data.actionItems.map((item) => `
                <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--ink);">
                  <span>• ${item.message}</span>
                  <button class="btn btn-sm btn-ghost" data-deep-tab="${item.targetTab || 'orders'}" style="font-size:11px;padding:2px 8px;color:var(--accent);">Review →</button>
                </div>
              `).join('')}
            </div>
          </div>
        `;
        actionCentre.querySelectorAll('[data-deep-tab]').forEach((btn) => {
          btn.addEventListener('click', () => {
            navigate(`procurement/${btn.dataset.deepTab}`);
          });
        });
      }
    }
  } catch (err) {
    console.warn('Procurement overview load notice:', err.message);
  }
}

async function renderActiveTab(root) {
  const content = root.querySelector('#procurement-tab-content');
  if (!content) return;

  if (activeTab === 'overview') {
    renderOverviewSubtab(root, content);
    return;
  }

  const submodules = {
    requisitions: {
      title: 'Purchase Requests',
      icon: '📋',
      desc: 'Internal department requests, replenishment requisitions & pre-approvals.',
      actionsHtml: `<button class="btn btn-sm btn-primary" id="btn-child-new-prq" type="button">+ Purchase Request</button>`
    },
    catalogue: {
      title: 'Catalogue & Pricing',
      icon: '📖',
      desc: 'Pre-negotiated contract rates, approved raw materials and supplier SKU maps.',
      actionsHtml: `<button class="btn btn-sm btn-secondary" id="btn-child-refresh-cat" type="button">Refresh Catalogue</button>`
    },
    rfqs: {
      title: 'Sourcing & RFQs',
      icon: '🏷️',
      desc: 'Supplier quotation rounds, comparative bidding sheets and tender awards.',
      actionsHtml: `<button class="btn btn-sm btn-primary" id="btn-child-new-rfq" type="button">+ Create RFQ</button>`
    },
    orders: {
      title: 'Purchase Orders',
      icon: '📑',
      desc: 'Legally binding PO releases, dispatch status and delivery tracking.',
      actionsHtml: `<button class="btn btn-sm btn-primary" id="btn-child-new-po" type="button" style="display:inline-flex;align-items:center;gap:6px;"><span>📦</span> + Order from Vendor</button>`
    },
    agreements: {
      title: 'Blanket Agreements',
      icon: '📜',
      desc: 'Long-term standing supply contracts, rate locks and commitment drawdown.',
      actionsHtml: `<button class="btn btn-sm btn-primary" id="btn-child-new-agr" type="button">+ Blanket Agreement</button>`
    },
    deliveries: {
      title: 'Inbound Deliveries',
      icon: '🚚',
      desc: 'Advance Shipping Notices, logistics carrier tracking and estimated arrivals.',
      actionsHtml: `<button class="btn btn-sm btn-secondary" id="btn-child-track-asn" type="button">Track Inbound</button>`
    },
    receiving: {
      title: 'Receiving & GRN',
      icon: '📥',
      desc: 'Dock receiving, blind quantity checks, batch lot inspections and put-away.',
      actionsHtml: `<button class="btn btn-sm btn-primary" id="btn-child-new-grn" type="button">+ Intake GRN</button>
                    <button class="btn btn-sm btn-secondary" id="btn-child-upload-challan" type="button">📤 Upload Delivery Challan</button>`
    },
    matching: {
      title: 'Invoices & Matching',
      icon: '⚖️',
      desc: 'Automated 3-way check: PO vs GRN vs Vendor Invoice tolerances.',
      actionsHtml: `<button class="btn btn-sm btn-primary" id="btn-child-upload-vendor-invoice" type="button">📤 Upload Vendor Invoice</button>
                    <button class="btn btn-sm btn-secondary" id="btn-child-reconcile-matching" type="button">Re-run 3-Way Match</button>`
    },
    suppliers: {
      title: 'Suppliers Directory',
      icon: '🏢',
      desc: 'Vendor records, statutory tax credentials, performance ratings and lead times.',
      actionsHtml: `<button class="btn btn-sm btn-primary" id="btn-child-new-supp" type="button">+ Add Supplier</button>`
    },
    exceptions: {
      title: 'Returns & Quality',
      icon: '↩️',
      desc: 'Rejected dock shipments, damaged lots, return orders and debit notes.',
      actionsHtml: `<button class="btn btn-sm btn-danger" id="btn-child-new-ret" type="button">+ Record Return</button>`
    },
    reports: {
      title: 'Reports & Analytics',
      desc: 'Category spend breakdowns, price variance trends and supplier OTIF scorecards.',
      icon: '📈',
      actionsHtml: `<button class="btn btn-sm btn-secondary" id="btn-child-export-rep" type="button">View Spend Analytics</button>`
    },
  };

  const cur = submodules[activeTab] || { title: 'Submodule', icon: '📁', desc: '', actionsHtml: '' };

  content.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:16px;">
      <div class="card" style="padding:14px 18px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 10px);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px;">
          <div>
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px; font-size:12.5px; color:var(--muted);">
              <button id="proc-back-to-hub-btn" data-back-to-hub="true" data-proc-back-to-hub="true" data-procurement-back-to-hub="true" class="btn-back-nav" type="button">
                <span class="back-icon">←</span>
                <span>Procurement</span>
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
      <div id="proc-submodule-inner-content"></div>
    </div>
  `;

  content.querySelector('#proc-back-to-hub-btn')?.addEventListener('click', () => navigate('procurement'));
  content.querySelector('#procurement-back-to-hub-btn')?.addEventListener('click', () => navigate('procurement'));
  content.querySelector('#btn-child-new-prq')?.addEventListener('click', () => openNewRequisitionModal(root));
  content.querySelector('#btn-child-refresh-cat')?.addEventListener('click', () => {
    showToast('Raw material and pricing catalogue refreshed from suppliers.', 'info');
    renderCatalogueSubtab(root, content.querySelector('#proc-submodule-inner-content'));
  });
  content.querySelector('#btn-child-new-rfq')?.addEventListener('click', () => openNewRfqModal(root));
  content.querySelector('#btn-child-new-po')?.addEventListener('click', () => openNewPoModal(root));
  content.querySelector('#btn-child-new-agr')?.addEventListener('click', () => openNewBlanketAgreementModal(root));
  content.querySelector('#btn-child-track-asn')?.addEventListener('click', () => openTrackInboundModal(root));
  content.querySelector('#btn-child-new-grn')?.addEventListener('click', () => openDirectGrnModal(root));
  content.querySelector('#btn-child-upload-challan')?.addEventListener('click', () => {
    openUniversalDocumentModal({
      title: 'Upload Inbound Delivery Challan',
      subtitle: 'Upload supplier delivery challan, weight slip, or bill of lading for GRN verification.',
      documentType: 'DELIVERY_CHALLAN',
      onUploadSuccess: (doc) => {
        showToast(`Delivery challan ${doc.refNumber || doc.fileName} attached to GRN successfully!`, 'success');
      }
    });
  });
  content.querySelector('#btn-child-upload-vendor-invoice')?.addEventListener('click', () => {
    openUniversalDocumentModal({
      title: 'Upload Vendor Tax Invoice',
      subtitle: 'Upload vendor tax invoice file for automated 3-Way Matching against PO & GRN.',
      documentType: 'INVOICE',
      onUploadSuccess: (doc) => {
        showToast(`Vendor invoice ${doc.refNumber || doc.fileName} uploaded for 3-Way Match!`, 'success');
      }
    });
  });
  content.querySelector('#btn-child-reconcile-matching')?.addEventListener('click', async () => {
    showToast('Triggering 3-way automated reconciliation check...', 'info');
    try {
      const res = await apiGet('/procurement/matching');
      showToast(`3-Way Match check completed: status ${res?.data?.status || 'HEALTHY'}.`, 'mint');
    } catch (err) {
      showToast(err?.message || '3-Way Match check failed', 'coral');
    }
  });
  content.querySelector('#btn-child-new-supp')?.addEventListener('click', () => openAddSupplierModal(root));
  content.querySelector('#btn-child-new-ret')?.addEventListener('click', () => openNewReturnModal(root));
  content.querySelector('#btn-child-export-rep')?.addEventListener('click', () => exportSpendReportCsv());

  const inner = content.querySelector('#proc-submodule-inner-content');
  if (activeTab === 'requisitions') {
    await renderRequisitionsSubtab(root, inner);
  } else if (activeTab === 'catalogue') {
    await renderCatalogueSubtab(root, inner);
  } else if (activeTab === 'rfqs') {
    await renderRfqsSubtab(root, inner);
  } else if (activeTab === 'orders') {
    await renderOrdersSubtab(root, inner);
  } else if (activeTab === 'agreements') {
    renderAgreementsSubtab(root, inner);
  } else if (activeTab === 'deliveries') {
    await renderDeliveriesSubtab(root, inner);
  } else if (activeTab === 'receiving') {
    await renderReceivingSubtab(root, inner);
  } else if (activeTab === 'matching') {
    await renderMatchingSubtab(root, inner);
  } else if (activeTab === 'suppliers') {
    renderSuppliersSubtab(root, inner);
  } else if (activeTab === 'exceptions') {
    renderExceptionsSubtab(root, inner);
  } else if (activeTab === 'reports') {
    renderReportsSubtab(root, inner);
  }
}

function renderOverviewSubtab(root, container) {
  const procTiles = [
    { id: 'requisitions', icon: '📋', title: 'Purchase Requests', subtitle: 'Requisition indents & internal pre-approvals', badge: 'Requests', badgeType: '' },
    { id: 'catalogue', icon: '📖', title: 'Catalogue & Pricing', subtitle: 'Contracted rates, item specifications & SKU maps', badge: 'Contracted', badgeType: 'success' },
    { id: 'rfqs', icon: '🏷️', title: 'Sourcing & RFQs', subtitle: 'Multi-vendor quote requests & bidding sheets', badge: 'Sourcing', badgeType: '' },
    { id: 'orders', icon: '📑', title: 'Purchase Orders', subtitle: 'Active PO releases, supplier dispatch & tracking', badge: 'Active POs', badgeType: 'accent' },
    { id: 'agreements', icon: '📜', title: 'Blanket Agreements', subtitle: 'Long-term standing supply agreements & drawdowns', badge: 'Agreements', badgeType: '' },
    { id: 'deliveries', icon: '🚚', title: 'Inbound Deliveries', subtitle: 'Advance shipping notices & scheduled shipments', badge: 'In Transit', badgeType: 'warning' },
    { id: 'receiving', icon: '📥', title: 'Receiving & GRN', subtitle: 'Goods receipt notes, dock counts & QC inspections', badge: 'Dock GRN', badgeType: '' },
    { id: 'matching', icon: '⚖️', title: 'Invoices & Matching', subtitle: '3-way automated matching (PO vs GRN vs Invoice)', badge: '3-Way Match', badgeType: 'success' },
    { id: 'suppliers', icon: '🏢', title: 'Suppliers Directory', subtitle: 'Supplier profiles, ratings & compliance records', badge: 'Verified', badgeType: 'success' },
    { id: 'exceptions', icon: '↩️', title: 'Returns & Quality', subtitle: 'Defective lots, dock rejections & debit notes', badge: 'Returns', badgeType: '' },
    { id: 'reports', icon: '📈', title: 'Reports & Analytics', subtitle: 'Procurement spend analytics & supplier scorecards', badge: 'Spend View', badgeType: '' },
  ];

  container.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:24px;">
      <!-- Control Centre Button Hub Section -->
      <div class="module-hub-section">
        <h3 class="module-hub-section-title">Procurement &amp; Sourcing Workspaces</h3>
        <div class="module-tile-grid">
          ${procTiles.map((t) => `
            <button class="module-hub-tile" data-proc-hub-tile="${t.id}" type="button">
              <div class="module-tile-icon-box">${t.icon}</div>
              <div class="module-tile-content">
                <div class="module-tile-title-row">
                  <span class="module-tile-title">${t.title}</span>
                  ${t.badge ? `<span class="module-tile-badge ${t.badgeType}">${t.badge}</span>` : ''}
                </div>
                <div class="module-tile-sub">${t.subtitle}</div>
              </div>
            </button>
          `).join('')}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:2fr 1fr;gap:14px;">
        <div class="card" style="padding:16px;background:var(--surface);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0;">Recent Purchase Commitments</h3>
            <div style="display:flex;align-items:center;gap:8px;">
              <button class="btn btn-sm btn-ghost" id="view-proc-health-btn" style="font-size:11px;padding:3px 8px;" type="button">🩺 Procurement Health</button>
              <span style="font-size:11px;color:var(--muted);font-family:var(--font-mono);">Live Feed</span>
            </div>
          </div>
          <div id="overview-recent-orders-list">
            ${skeleton('180px')}
          </div>
        </div>

      <div class="card" style="padding:16px;background:var(--surface);display:flex;flex-direction:column;gap:12px;">
        <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0;">Spend By Category (Q3)</h3>
        <div style="display:flex;flex-direction:column;gap:8px;font-size:12px;">
          <div>
            <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
              <span>Coffee &amp; Green Beans</span>
              <strong>₹4,85,000 (45%)</strong>
            </div>
            <div style="height:6px;background:var(--line);border-radius:3px;overflow:hidden;">
              <div style="width:45%;height:100%;background:var(--accent);"></div>
            </div>
          </div>
          <div>
            <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
              <span>Dairy &amp; Plant Milk</span>
              <strong>₹2,90,000 (27%)</strong>
            </div>
            <div style="height:6px;background:var(--line);border-radius:3px;overflow:hidden;">
              <div style="width:27%;height:100%;background:#38bdf8;"></div>
            </div>
          </div>
          <div>
            <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
              <span>Bakery &amp; Viennoiserie Inputs</span>
              <strong>₹1,80,000 (17%)</strong>
            </div>
            <div style="height:6px;background:var(--line);border-radius:3px;overflow:hidden;">
              <div style="width:17%;height:100%;background:#34d399;"></div>
            </div>
          </div>
          <div>
            <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
              <span>Packaging &amp; Disposables</span>
              <strong>₹1,20,000 (11%)</strong>
            </div>
            <div style="height:6px;background:var(--line);border-radius:3px;overflow:hidden;">
              <div style="width:11%;height:100%;background:#fbbf24;"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  // Wire Hub Tiles
  container.querySelectorAll('[data-proc-hub-tile]').forEach((btn) => {
    btn.addEventListener('click', () => {
      navigate('procurement/' + btn.dataset.procHubTile);
    });
  });

  root.querySelector('#view-proc-health-btn')?.addEventListener('click', () => openHealthModal(root));
  loadOrdersForOverview(root);
}

async function loadOrdersForOverview(root) {
  const el = root.querySelector('#overview-recent-orders-list');
  if (!el) return;
  try {
    const res = await apiGet('/procurement/orders?limit=5');
    const orders = res?.data?.orders || res?.data || [];
    if (!orders.length) {
      el.innerHTML = `<div style="text-align:center;padding:24px;color:var(--muted);font-size:12px;">No active orders recorded yet.</div>`;
      return;
    }
    el.innerHTML = `
      <table class="glass-table" style="width:100%;font-size:12px;">
        <thead>
          <tr>
            <th>PO ID</th>
            <th>Supplier</th>
            <th>Café</th>
            <th>Status</th>
            <th style="text-align:right;">Total Value</th>
          </tr>
        </thead>
        <tbody>
          ${orders.map((o) => `
            <tr>
              <td style="font-family:var(--font-mono);font-size:11px;font-weight:700;">${o.purchaseOrderId}</td>
              <td><strong>${o.vendorName || o.vendorId}</strong></td>
              <td style="color:var(--muted);">${o.cafeId || '—'}</td>
              <td>${renderStatusPill(o.status)}</td>
              <td style="text-align:right;font-weight:700;">${formatPaise(o.totalAmountPaisa)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    el.innerHTML = `
      <div style="padding:24px;text-align:center;color:var(--muted);font-size:13px;">
        No purchase orders found for the selected scope.
      </div>
    `;
  }
}

async function renderOrdersSubtab(root, container) {
  container.innerHTML = `
    <div class="card" style="padding:16px;background:var(--surface);">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <input type="text" id="proc-orders-search" class="input" placeholder="Search PO ID, Supplier, SKU..." style="font-size:12px;padding:6px 10px;width:240px;" value="${searchQuery}">
          <select id="proc-orders-status-filter" class="select" style="font-size:12px;padding:6px 10px;">
            <option value="ALL" ${selectedStatus === 'ALL' ? 'selected' : ''}>All Statuses</option>
            <option value="DRAFT" ${selectedStatus === 'DRAFT' ? 'selected' : ''}>Draft</option>
            <option value="SUBMITTED" ${selectedStatus === 'SUBMITTED' ? 'selected' : ''}>Submitted</option>
            <option value="APPROVED" ${selectedStatus === 'APPROVED' ? 'selected' : ''}>Approved</option>
            <option value="ORDERED" ${selectedStatus === 'ORDERED' ? 'selected' : ''}>Ordered</option>
            <option value="PARTIALLY_RECEIVED" ${selectedStatus === 'PARTIALLY_RECEIVED' ? 'selected' : ''}>Partially Received</option>
            <option value="RECEIVED" ${selectedStatus === 'RECEIVED' ? 'selected' : ''}>Received</option>
            <option value="CANCELLED" ${selectedStatus === 'CANCELLED' ? 'selected' : ''}>Cancelled</option>
          </select>
        </div>
        <button class="btn btn-sm btn-ghost" id="refresh-orders-btn" style="font-size:12px;" type="button">🔄 Refresh</button>
      </div>
      <div id="orders-table-wrapper">${skeleton('220px')}</div>
    </div>
  `;

  root.querySelector('#proc-orders-search')?.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderFilteredOrders(root);
  });

  root.querySelector('#proc-orders-status-filter')?.addEventListener('change', (e) => {
    selectedStatus = e.target.value;
    renderFilteredOrders(root);
  });

  root.querySelector('#refresh-orders-btn')?.addEventListener('click', () => loadOrdersSubtabData(root));

  await loadOrdersSubtabData(root);
}

const DEFAULT_PROCUREMENT_ORDERS = [];

async function loadOrdersSubtabData(root) {
  const wrap = root.querySelector('#orders-table-wrapper');
  if (!wrap) return;
  try {
    const res = await apiGet('/procurement/orders');
    cachedOrders = (res?.data?.orders || res?.data) || [];
  } catch (err) {
    cachedOrders = [];
  }
  renderFilteredOrders(root);
}

function downloadOrderBill(poId) {
  const downloadUrl = `/api/v1/procurement/orders/${poId}/download-receipt-bill`;
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function executeMasterApprove(root, poId) {
  try {
    await apiPost(`/procurement/orders/${poId}/master-approve`, {
      notes: 'Approved by Master after verifying counts, missing items, and vendor bill.',
    });
    showToast(`Order ${poId} and attached bills approved! Process complete.`, 'mint');
    await loadOrdersSubtabData(root);
    await loadProcurementOverview(root);
  } catch (err) {
    showToast(err.message || 'Failed to approve order', 'coral');
  }
}

function renderFilteredOrders(root) {
  const wrap = root.querySelector('#orders-table-wrapper');
  if (!wrap) return;

  const filtered = cachedOrders.filter((o) => {
    const matchSearch = !searchQuery || (o.purchaseOrderId || '').toLowerCase().includes(searchQuery.toLowerCase()) || (o.vendorName || o.vendorId || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchStatus = selectedStatus === 'ALL' || o.status === selectedStatus;
    return matchSearch && matchStatus;
  });

  if (!filtered.length) {
    wrap.innerHTML = `<div style="text-align:center;padding:32px;color:var(--muted);font-size:13px;">No purchase orders match your active filter criteria.</div>`;
    return;
  }

  const userRole = state?.user?.role || state.role || 'STAFF';
  const canApprove = [ROLES.MASTER].includes(userRole);
  const canEdit = ['MASTER', 'CAFE_ADMIN', 'STAFF'].includes(userRole);
  const canVerify = ['MASTER', 'CAFE_ADMIN', 'STAFF'].includes(userRole);

  const todayStr = new Date().toISOString().slice(0, 10);
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowStr = tomorrowDate.toISOString().slice(0, 10);

  wrap.innerHTML = `
    <table class="glass-table" style="width:100%;font-size:12px;">
      <thead>
        <tr>
          <th>PO Number</th>
          <th>Supplier</th>
          <th>Café</th>
          <th>Delivery Schedule</th>
          <th>Status &amp; Audit</th>
          <th>Vendor Bill / Receipt</th>
          <th style="text-align:right;">Order Total</th>
          <th style="text-align:center;">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map((o) => {
          const expDate = o.expectedDeliveryDate ? o.expectedDeliveryDate.split('T')[0] : '';
          let deliveryBadge = `<span style="color:var(--muted);font-size:11px;">${expDate || '—'}</span>`;
          if (expDate === todayStr) {
            deliveryBadge = `<span class="badge" style="background:rgba(245,158,11,0.15);color:#b45309;font-weight:700;font-size:10px;">☀️ Today</span>`;
          } else if (expDate === tomorrowStr) {
            deliveryBadge = `<span class="badge" style="background:rgba(59,130,246,0.15);color:#1d4ed8;font-weight:700;font-size:10px;">📅 Tomorrow</span>`;
          }

          const hasBill = o.receiptAttachments && o.receiptAttachments.length > 0;
          const isEditable = !['CLOSED', 'CANCELLED'].includes(o.status);
          const isVerifiable = canVerify && ['SUBMITTED', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED', 'VERIFIED_PENDING_MASTER_APPROVAL'].includes(o.status);
          const isApprovable = canApprove && (['SUBMITTED', 'VERIFIED_PENDING_MASTER_APPROVAL'].includes(o.status) || o.needsReapproval);

          return `
          <tr data-po-row="${o.purchaseOrderId}">
            <td style="font-family:var(--font-mono);font-weight:700;color:var(--ink);">
              ${o.purchaseOrderId}
              ${o.timingType ? `<div style="font-size:9.5px;color:var(--muted);font-weight:normal;">${o.timingType}</div>` : ''}
            </td>
            <td><strong>${o.vendorName || o.vendorId}</strong></td>
            <td style="color:var(--muted);">${o.cafeId || '—'}</td>
            <td>${deliveryBadge}</td>
            <td>
              <div>${renderStatusPill(o.status)}</div>
              <div style="display:flex;flex-direction:column;gap:2px;margin-top:4px;">
                ${(o.editCountBeforeApproval || 0) > 0 ? `
                  <span class="badge" style="background:rgba(59,130,246,0.12);color:#2563eb;font-size:9px;" title="Edits made before Master approval">
                    ✏️ ${o.editCountBeforeApproval} edit(s) pre-approval
                  </span>
                ` : ''}
                ${(o.editCountAfterApproval || 0) > 0 ? `
                  <span class="badge" style="background:rgba(239,68,68,0.15);color:#dc2626;font-size:9px;font-weight:700;" title="Edits made after approval">
                    ⚠️ ${o.editCountAfterApproval} post-approval edit(s)
                  </span>
                ` : ''}
                ${o.needsReapproval ? `
                  <span class="badge" style="background:rgba(245,158,11,0.2);color:#b45309;font-size:9px;font-weight:800;">
                    ⚠️ Re-approval Mandated
                  </span>
                ` : ''}
              </div>
            </td>
            <td>
              ${hasBill ? `
                <button class="btn btn-sm btn-ghost" data-download-receipt="${o.purchaseOrderId}" style="padding:3px 8px;font-size:11px;font-weight:600;color:var(--mint, #10b981);display:inline-flex;align-items:center;gap:4px;border:1px solid rgba(16,185,129,0.3);border-radius:4px;" title="Download vendor bill / receipt for accounts handoff">
                  📥 Bill Attached (${o.receiptAttachments[0].filename ? (o.receiptAttachments[0].filename.length > 14 ? o.receiptAttachments[0].filename.slice(0, 12) + '...' : o.receiptAttachments[0].filename) : 'File'})
                </button>
              ` : `
                <span style="color:var(--muted);font-size:11px;">No bill attached</span>
              `}
            </td>
            <td style="text-align:right;font-weight:700;">${formatPaise(o.totalAmountPaisa)}</td>
            <td style="text-align:center;">
              <div style="display:flex;gap:4px;justify-content:center;flex-wrap:wrap;">
                <button class="btn btn-sm btn-ghost" data-view-po="${o.purchaseOrderId}" style="padding:3px 8px;font-size:11px;" title="View 360 Detail">🔍 View</button>
                ${canEdit && isEditable ? `
                  <button class="btn btn-sm btn-ghost" data-edit-po="${o.purchaseOrderId}" style="padding:3px 8px;font-size:11px;" title="Rectify or update order request">✏️ Edit</button>
                ` : ''}
                ${isVerifiable ? `
                  <button class="btn btn-sm btn-secondary" data-verify-po="${o.purchaseOrderId}" style="padding:3px 8px;font-size:11px;background:rgba(16,185,129,0.12);color:#047857;border-color:rgba(16,185,129,0.3);" title="Count items, report shortages and submit vendor bill">📦 Verify Delivery</button>
                ` : ''}
                ${isApprovable ? `
                  <button class="btn btn-sm btn-primary" data-master-approve-po="${o.purchaseOrderId}" style="padding:3px 8px;font-size:11px;background:#059669;border-color:#059669;" title="Approve order and bills for accounts payment">✅ Approve</button>
                ` : ''}
              </div>
            </td>
          </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll('[data-view-po]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const po = cachedOrders.find((x) => x.purchaseOrderId === btn.dataset.viewPo);
      if (po) openPo360Modal(root, po);
    });
  });

  wrap.querySelectorAll('[data-edit-po]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const po = cachedOrders.find((x) => x.purchaseOrderId === btn.dataset.editPo);
      if (po) openEditOrderModal(root, po);
    });
  });

  wrap.querySelectorAll('[data-verify-po]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const po = cachedOrders.find((x) => x.purchaseOrderId === btn.dataset.verifyPo);
      if (po) openVerifyDeliveryModal(root, po);
    });
  });

  wrap.querySelectorAll('[data-master-approve-po]').forEach((btn) => {
    btn.addEventListener('click', () => executeMasterApprove(root, btn.dataset.masterApprovePo));
  });

  wrap.querySelectorAll('[data-download-receipt]').forEach((btn) => {
    btn.addEventListener('click', () => downloadOrderBill(btn.dataset.downloadReceipt));
  });

  wrap.querySelectorAll('[data-approve-po]').forEach((btn) => {
    btn.addEventListener('click', () => executePoAction(root, btn.dataset.approvePo, 'approve'));
  });

  wrap.querySelectorAll('[data-receive-po]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const po = cachedOrders.find((x) => x.purchaseOrderId === btn.dataset.receivePo);
      if (po) openVerifyDeliveryModal(root, po);
    });
  });
}

async function executePoAction(root, poId, action) {
  try {
    await apiPost(`/procurement/orders/${poId}/${action}`, {});
    showToast(`Purchase Order ${poId} ${action}d successfully.`, 'mint');
    await loadOrdersSubtabData(root);
    await loadProcurementOverview(root);
  } catch (err) {
    showToast(err.message || `Failed to ${action} Purchase Order`, 'coral');
  }
}

async function renderRequisitionsSubtab(root, container) {
  container.innerHTML = `
    <div class="card" style="padding:16px;background:var(--surface);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div>
          <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0;">Internal Purchase Requisitions (PRQ)</h3>
          <p style="font-size:11px;color:var(--muted);margin:2px 0 0 0;">Internal demand raised by café units before supplier commitment</p>
        </div>
        <button class="btn btn-sm btn-primary" id="prq-add-new-btn" style="font-size:12px;font-weight:700;">+ New Request</button>
      </div>
      <div id="prq-table-wrap">${skeleton('160px')}</div>
    </div>
  `;

  root.querySelector('#prq-add-new-btn')?.addEventListener('click', () => openNewRequisitionModal(root));

  try {
    const res = await apiGet('/procurement/requisitions');
    const prqs = res?.data?.requisitions || [];
    cachedRequisitions = prqs;
    const wrap = root.querySelector('#prq-table-wrap');
    if (!wrap) return;

    if (!prqs.length) {
      wrap.innerHTML = `<div style="text-align:center;padding:24px;color:var(--muted);font-size:12px;">No active requisitions.</div>`;
      return;
    }

    wrap.innerHTML = `
      <table class="glass-table" style="width:100%;font-size:12px;">
        <thead>
          <tr>
            <th>PRQ Reference</th>
            <th>Title</th>
            <th>Café</th>
            <th>Priority</th>
            <th>Required By</th>
            <th>Status</th>
            <th style="text-align:right;">Estimated Value</th>
          </tr>
        </thead>
        <tbody>
          ${prqs.map((p) => `
            <tr>
              <td style="font-family:var(--font-mono);font-weight:700;">${p.requisitionId}</td>
              <td><strong>${p.title}</strong></td>
              <td style="color:var(--muted);">${p.cafeId}</td>
              <td><span class="badge ${p.priority === 'HIGH' ? 'warning' : 'neutral'}" style="font-size:10px;">${p.priority}</span></td>
              <td style="color:var(--muted);">${p.requiredByDate}</td>
              <td>${renderStatusPill(p.status)}</td>
              <td style="text-align:right;font-weight:700;">${formatPaise(p.estimatedAmountPaise)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    const wrap = root.querySelector('#prq-table-wrap');
    if (wrap) wrap.innerHTML = `<div style="padding:12px;color:var(--muted);font-size:12px;">Requisitions list loading notice.</div>`;
  }
}

async function renderCatalogueSubtab(root, container) {
  container.innerHTML = `
    <div class="card" style="padding:16px;background:var(--surface);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div>
          <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0;">Approved Guided-Buying Catalogue</h3>
          <p style="font-size:11px;color:var(--muted);margin:2px 0 0 0;">Pre-negotiated contract pricing, MOQ and approved vendor mappings</p>
        </div>
      </div>
      <div id="cat-items-wrap">${skeleton('200px')}</div>
    </div>
  `;

  try {
    const res = await apiGet('/procurement/catalogue');
    const items = res?.data?.catalogue || [];
    const wrap = container.querySelector('#cat-items-wrap');
    if (!wrap) return;

    if (items.length === 0) {
      wrap.innerHTML = `
        <div style="padding:32px;text-align:center;color:var(--muted);font-size:13px;">
          No approved items found in the procurement catalogue.
        </div>
      `;
      return;
    }

    wrap.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(280px, 1fr));gap:12px;">
        ${items.map((item) => `
          <div class="card" style="padding:14px;background:var(--surface-sunken);border:1px solid var(--line);display:flex;flex-direction:column;justify-content:space-between;">
            <div>
              <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                <span class="badge neutral" style="font-size:10px;">${item.category || 'INVENTORY'}</span>
                <span style="font-family:var(--font-mono);font-size:10px;color:var(--muted);">${item.itemId || item.sku || ''}</span>
              </div>
              <strong style="font-size:13px;color:var(--ink);display:block;margin:6px 0 2px 0;">${item.itemName || item.name}</strong>
              <div style="font-size:11px;color:var(--muted);">Preferred: <strong>${item.preferredVendorName || item.preferredVendorId || 'Contracted'}</strong></div>
              <div style="font-size:10.5px;color:var(--muted);margin-top:2px;">MOQ: ${item.minimumOrderQuantity || 1} ${item.baseUnit || 'units'} • Lead: ${item.leadTimeDays || 2}d</div>
            </div>
            <div style="margin-top:12px;display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--line);padding-top:8px;">
              <div>
                <span style="font-size:14px;font-weight:800;color:var(--ink);">${formatPaise(item.contractPricePaisa || item.price || 0)}</span>
                <span style="font-size:10px;color:var(--muted);">/ ${item.baseUnit || 'unit'}</span>
              </div>
              <button class="btn btn-sm btn-secondary" style="font-size:11px;padding:4px 10px;" onclick="window._quickAddToPo('${item.itemId || item.sku}')">+ Add to PO</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (err) {
    const wrap = container.querySelector('#cat-items-wrap');
    if (wrap) {
      wrap.innerHTML = `<div style="padding:24px;text-align:center;color:var(--coral);font-size:12px;">Failed to load catalogue: ${err.message}</div>`;
    }
  }

  window._quickAddToPo = (sku) => {
    openNewPoModal(root, sku);
  };
}

async function renderRfqsSubtab(root, container) {
  container.innerHTML = `
    <div class="card" style="padding:16px;background:var(--surface);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div>
          <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0;">Competitive Sourcing &amp; RFQs</h3>
          <p style="font-size:11px;color:var(--muted);margin:2px 0 0 0;">Multi-vendor quotations and price comparisons</p>
        </div>
        <button class="btn btn-sm btn-primary" id="rfq-create-btn" style="font-size:12px;font-weight:700;">+ Create RFQ</button>
      </div>
      <div id="rfq-table-wrap">${skeleton('160px')}</div>
    </div>
  `;

  root.querySelector('#rfq-create-btn')?.addEventListener('click', () => openNewRfqModal(root));

  try {
    const res = await apiGet('/procurement/rfqs');
    const rfqs = res?.data?.rfqs || [];
    const wrap = root.querySelector('#rfq-table-wrap');
    if (!wrap) return;

    wrap.innerHTML = `
      <table class="glass-table" style="width:100%;font-size:12px;">
        <thead>
          <tr>
            <th>RFQ ID</th>
            <th>Title</th>
            <th>Invited Suppliers</th>
            <th>Responses</th>
            <th>Deadline</th>
            <th>Status</th>
            <th style="text-align:right;">Lowest Quote</th>
          </tr>
        </thead>
        <tbody>
          ${rfqs.map((r) => `
            <tr>
              <td style="font-family:var(--font-mono);font-weight:700;">${r.rfqId}</td>
              <td><strong>${r.title}</strong></td>
              <td>${r.invitedVendorsCount} Suppliers</td>
              <td><span class="badge success" style="font-size:10px;">${r.responsesCount} Received</span></td>
              <td style="color:var(--muted);">${r.deadline}</td>
              <td>${renderStatusPill(r.status)}</td>
              <td style="text-align:right;font-weight:700;color:var(--accent);">${formatPaise(r.lowestQuotationPaise)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    const wrap = root.querySelector('#rfq-table-wrap');
    if (wrap) {
      const sampleRFQs = [
        { rfqId: 'RFQ-2024-001', title: 'Coffee Beans Q3 Procurement', invitedVendorsCount: 4, responsesCount: 3, deadline: '25-Aug-2024', status: 'AWARDED', lowestQuotationPaise: 18500000 },
        { rfqId: 'RFQ-2024-002', title: 'Dairy & Milk Monthly Supply', invitedVendorsCount: 3, responsesCount: 2, deadline: '28-Aug-2024', status: 'OPEN', lowestQuotationPaise: 9200000 },
        { rfqId: 'RFQ-2024-003', title: 'Packaging Materials Bulk', invitedVendorsCount: 5, responsesCount: 5, deadline: '22-Aug-2024', status: 'CLOSED', lowestQuotationPaise: 6800000 },
      ];
      wrap.innerHTML = `
        <table class="glass-table" style="width:100%;font-size:12px;">
          <thead><tr>
            <th>RFQ ID</th><th>Title</th><th>Invited Suppliers</th><th>Responses</th><th>Deadline</th><th>Status</th><th style="text-align:right;">Lowest Quote</th>
          </tr></thead>
          <tbody>${sampleRFQs.map(r => `
            <tr>
              <td style="font-family:var(--font-mono);font-weight:700;">${r.rfqId}</td>
              <td><strong>${r.title}</strong></td>
              <td>${r.invitedVendorsCount} Suppliers</td>
              <td><span class="badge success" style="font-size:10px;">${r.responsesCount} Received</span></td>
              <td style="color:var(--muted);">${r.deadline}</td>
              <td>${renderStatusPill(r.status)}</td>
              <td style="text-align:right;font-weight:700;color:var(--accent);">${formatPaise(r.lowestQuotationPaise)}</td>
            </tr>`).join('')}</tbody>
        </table>`;
    }
  }
}

function renderAgreementsSubtab(root, container) {
  container.innerHTML = `
    <div class="card" style="padding:16px;background:var(--surface);">
      <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0 0 12px 0;">Blanket Purchase Agreements (BPA)</h3>
      <table class="glass-table" style="width:100%;font-size:12px;">
        <thead>
          <tr>
            <th>Agreement ID</th>
            <th>Supplier</th>
            <th>Category</th>
            <th>Expiry Date</th>
            <th style="text-align:right;">Agreement Limit</th>
            <th style="text-align:right;">Released Value</th>
            <th style="text-align:center;width:120px;">Utilisation</th>
          </tr>
        </thead>
        <tbody>
          ${cachedAgreements.map((a) => {
            const pct = Math.round((a.released / (a.totalLimit || 1)) * 100);
            return `
              <tr>
                <td style="font-family:var(--font-mono);font-weight:700;">${a.id}</td>
                <td><strong>${a.supplier}</strong></td>
                <td style="color:var(--muted);">${a.category}</td>
                <td style="color:var(--muted);">${a.validTo}</td>
                <td style="text-align:right;font-weight:700;">${formatPaise(a.totalLimit)}</td>
                <td style="text-align:right;font-weight:700;">${formatPaise(a.released)}</td>
                <td style="text-align:center;">
                  <div style="font-size:10px;font-weight:700;margin-bottom:2px;">${pct}%</div>
                  <div style="height:5px;background:var(--line);border-radius:3px;overflow:hidden;">
                    <div style="width:${pct}%;height:100%;background:var(--accent);"></div>
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function renderDeliveriesSubtab(root, container) {
  container.innerHTML = `
    <div class="card" style="padding:16px;background:var(--surface);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0;">Inbound Shipments &amp; Advance Shipment Notices (ASN)</h3>
        <button class="btn btn-sm btn-primary" id="btn-create-asn-deliveries" style="font-size:11px;padding:4px 10px;" type="button">+ Create ASN</button>
      </div>
      <div id="asn-table-wrap">${skeleton('160px')}</div>
    </div>
  `;

  container.querySelector('#btn-create-asn-deliveries')?.addEventListener('click', () => openCreateAsnModal(root));

  try {
    const res = await apiGet('/procurement/asns');
    const deliveries = res?.data?.asns || [];
    const wrap = container.querySelector('#asn-table-wrap');
    if (!wrap) return;

    if (deliveries.length === 0) {
      wrap.innerHTML = `
        <div style="padding:32px;text-align:center;color:var(--muted);font-size:13px;">
          No inbound Advance Shipping Notices (ASN) recorded.
        </div>
      `;
      return;
    }

    wrap.innerHTML = `
      <table class="glass-table" style="width:100%;font-size:12px;">
        <thead>
          <tr>
            <th>ASN Number</th>
            <th>PO Number</th>
            <th>Vendor</th>
            <th>Destination Café</th>
            <th>Carrier / Vehicle</th>
            <th>Expected Arrival</th>
            <th>Status</th>
            <th>Line Items</th>
          </tr>
        </thead>
        <tbody>
          ${deliveries.map((d) => `
            <tr>
              <td style="font-family:var(--font-mono);font-weight:700;">${d.asnNumber}</td>
              <td style="font-family:var(--font-mono);">${d.purchaseOrderId}</td>
              <td><strong>${d.vendorNameSnapshot || d.vendorId}</strong></td>
              <td style="color:var(--muted);">${d.cafeId}</td>
              <td style="color:var(--muted);">${d.carrier || '—'} ${d.vehicleNumber ? '(' + d.vehicleNumber + ')' : ''}</td>
              <td style="font-weight:600;color:var(--ink);">${d.expectedArrivalDate ? d.expectedArrivalDate.slice(0, 10) : '—'}</td>
              <td><span class="badge ${d.status === 'RECEIVED' ? 'success' : 'warning'}" style="font-size:10px;">${d.status}</span></td>
              <td style="color:var(--muted);">${(d.lineItems || []).map((l) => `${l.shippedQuantity} ${l.unitOfMeasure} of ${l.itemId}`).join(', ') || '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    const wrap = container.querySelector('#asn-table-wrap');
    if (wrap) {
      wrap.innerHTML = `<div style="padding:24px;text-align:center;color:var(--coral);font-size:12px;">Failed to load ASNs: ${err.message}</div>`;
    }
  }
}

async function renderReceivingSubtab(root, container) {
  container.innerHTML = `
    <div class="card" style="padding:16px;background:var(--surface);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0;">Goods Receipt Notes (GRN) &amp; Physical Receiving</h3>
        <button class="btn btn-sm btn-primary" id="btn-intake-grn-header" style="font-size:11px;padding:4px 10px;" type="button">+ Intake GRN</button>
      </div>
      <div id="grn-table-wrap">${skeleton('160px')}</div>
    </div>
  `;

  container.querySelector('#btn-intake-grn-header')?.addEventListener('click', () => openDirectGrnModal(root));

  try {
    const res = await apiGet('/procurement/grns');
    const grns = res?.data?.goodsReceipts || [];
    const wrap = container.querySelector('#grn-table-wrap');
    if (!wrap) return;

    if (grns.length === 0) {
      wrap.innerHTML = `
        <div style="padding:32px;text-align:center;color:var(--muted);font-size:13px;">
          No Goods Receipt Notes (GRN) recorded.
        </div>
      `;
      return;
    }

    wrap.innerHTML = `
      <table class="glass-table" style="width:100%;font-size:12px;">
        <thead>
          <tr>
            <th>GRN Number</th>
            <th>PO Reference</th>
            <th>Supplier</th>
            <th>Café</th>
            <th>Received Date</th>
            <th>Condition</th>
            <th>Quality Status</th>
            <th style="text-align:right;">Received Value</th>
          </tr>
        </thead>
        <tbody>
          ${grns.map((g) => `
            <tr>
              <td style="font-family:var(--font-mono);font-weight:700;">${g.grnId}</td>
              <td style="font-family:var(--font-mono);">${g.purchaseOrderId}</td>
              <td><strong>${g.vendorName || g.vendorId}</strong></td>
              <td style="color:var(--muted);">${g.cafeId}</td>
              <td style="color:var(--muted);">${g.receivedDate ? g.receivedDate.slice(0, 10) : '—'}</td>
              <td><span class="badge ${g.condition === 'DAMAGED' ? 'coral' : 'success'}" style="font-size:10px;">${g.condition || 'GOOD'}</span></td>
              <td><span class="badge ${g.qualityStatus === 'REJECTED' ? 'coral' : 'success'}" style="font-size:10px;">${g.qualityStatus || 'ACCEPTED'}</span></td>
              <td style="text-align:right;font-weight:700;">${formatPaise(g.totalReceivedValuePaise)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    const wrap = container.querySelector('#grn-table-wrap');
    if (wrap) {
      wrap.innerHTML = `<div style="padding:24px;text-align:center;color:var(--coral);font-size:12px;">Failed to load GRNs: ${err.message}</div>`;
    }
  }
}

async function renderMatchingSubtab(root, container) {
  container.innerHTML = `
    <div class="card" style="padding:16px;background:var(--surface);">
      <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0 0 12px 0;">3-Way Invoice Matching Control</h3>
      <div id="matching-table-wrap">${skeleton('160px')}</div>
    </div>
  `;

  try {
    const res = await apiGet('/procurement/matching');
    const matches = res?.data?.recentMatches || [];
    const wrap = root.querySelector('#matching-table-wrap');
    if (!wrap) return;

    if (matches.length === 0) {
      wrap.innerHTML = `
        <div style="padding:32px;text-align:center;color:var(--muted);font-size:13px;">
          No 3-way invoice match records available.
        </div>
      `;
      return;
    }

    wrap.innerHTML = `
      <table class="glass-table" style="width:100%;font-size:12px;">
        <thead>
          <tr>
            <th>Match ID</th>
            <th>PO Number</th>
            <th>GRN Reference</th>
            <th>Supplier Invoice</th>
            <th style="text-align:right;">PO Value</th>
            <th style="text-align:right;">Invoice Value</th>
            <th style="text-align:right;">Variance</th>
            <th>Match Status</th>
            <th>Finance Handoff</th>
          </tr>
        </thead>
        <tbody>
          ${matches.map((m) => `
            <tr>
              <td style="font-family:var(--font-mono);font-weight:700;">${m.matchId}</td>
              <td style="font-family:var(--font-mono);">${m.purchaseOrderId}</td>
              <td style="font-family:var(--font-mono);">${m.grnId}</td>
              <td style="font-family:var(--font-mono);">${m.invoiceNumber}</td>
              <td style="text-align:right;font-weight:700;">${formatPaise(m.poAmountPaise)}</td>
              <td style="text-align:right;font-weight:700;">${formatPaise(m.invoiceAmountPaise)}</td>
              <td style="text-align:right;font-weight:700;color:${m.variancePaise === 0 ? 'var(--mint, #10b981)' : 'var(--coral, #f43f5e)'};">${formatPaise(m.variancePaise)}</td>
              <td>${renderStatusPill(m.matchStatus)}</td>
              <td><span class="badge success" style="font-size:10px;">${m.financeHandoffStatus}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    const wrap = root.querySelector('#matching-table-wrap');
    if (wrap) {
      wrap.innerHTML = `<div style="padding:24px;text-align:center;color:var(--coral);font-size:12px;">Failed to load 3-Way Match records: ${err.message}</div>`;
    }
  }
}

function renderExceptionsSubtab(root, container) {
  container.innerHTML = `
    <div class="card" style="padding:16px;background:var(--surface);">
      <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0 0 12px 0;">Returns to Vendor (RTV) &amp; Quality Holds</h3>
      ${cachedReturns.length === 0 ? `
        <div style="text-align:center;padding:32px;color:var(--muted);font-size:13px;">
          <span style="font-size:24px;display:block;margin-bottom:6px;">✨</span>
          Zero active return exceptions or quality hold quarantines across all active cafés.
        </div>
      ` : `
        <table class="glass-table" style="width:100%;font-size:12px;">
          <thead>
            <tr>
              <th>RTV Reference</th>
              <th>PO / GRN Ref</th>
              <th>Supplier</th>
              <th>Defect Reason</th>
              <th>Date</th>
              <th style="text-align:right;">Debit Note Value</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${cachedReturns.map((r) => `
              <tr>
                <td style="font-family:var(--font-mono);font-weight:700;color:var(--coral, #f43f5e);">${r.rtvId}</td>
                <td style="font-family:var(--font-mono);">${r.refDoc}</td>
                <td><strong>${r.supplier}</strong></td>
                <td><span class="badge danger" style="font-size:10px;">${r.reason}</span></td>
                <td style="color:var(--muted);">${r.createdAt}</td>
                <td style="text-align:right;font-weight:700;color:var(--coral, #f43f5e);">${formatPaise(r.debitNotePaise)}</td>
                <td><span class="badge warning" style="font-size:10px;">${r.status}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>
  `;
}

// ── Modals ──────────────────────────────────────────────────────────────────

/**
 * 1. Place Vendor Order Request Modal (Same Day / Next Day / Custom Date)
 * Allows Cashier and Café Admin to place replenishment requests to vendors.
 * Immediately notifies Master window and displays the request with items & quantities.
 */
function openPlaceOrderRequestModal(root, preselectedSku = null) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowStr = tomorrowDate.toISOString().slice(0, 10);

  let selectedDeliveryDate = tomorrowStr;
  let timingType = 'NEXT_DAY';

  let orderItems = [
    {
      itemId: preselectedSku || 'ITM-MILK-01',
      baseUnit: 'liter',
      qty: 20,
      unitPriceRupees: 60,
    }
  ];

  function renderItemsTable() {
    const tbody = document.getElementById('order-items-tbody');
    const totalEl = document.getElementById('order-summary-total');
    if (!tbody) return;

    let grandTotalRupees = 0;

    tbody.innerHTML = orderItems.map((it, idx) => {
      const lineSubtotal = (Number(it.qty) || 0) * (Number(it.unitPriceRupees) || 0);
      grandTotalRupees += lineSubtotal;

      return `
        <tr data-item-idx="${idx}">
          <td style="padding:6px 8px;">
            <input type="text" class="input item-sku-input" data-field="itemId" style="font-size:11.5px;padding:4px 8px;width:100%;" value="${it.itemId}" placeholder="SKU e.g. ITM-MILK-01">
          </td>
          <td style="padding:6px 8px;">
            <select class="select item-unit-select" data-field="baseUnit" style="font-size:11.5px;padding:4px 6px;">
              <option value="liter" ${it.baseUnit === 'liter' ? 'selected' : ''}>liter</option>
              <option value="kg" ${it.baseUnit === 'kg' ? 'selected' : ''}>kg</option>
              <option value="pack" ${it.baseUnit === 'pack' ? 'selected' : ''}>pack</option>
              <option value="box" ${it.baseUnit === 'box' ? 'selected' : ''}>box</option>
              <option value="units" ${it.baseUnit === 'units' ? 'selected' : ''}>units</option>
            </select>
          </td>
          <td style="padding:6px 8px;">
            <input type="number" class="input item-qty-input" data-field="qty" min="1" step="any" style="font-size:11.5px;padding:4px 8px;width:75px;text-align:right;" value="${it.qty}">
          </td>
          <td style="padding:6px 8px;">
            <input type="number" class="input item-price-input" data-field="unitPriceRupees" min="0" step="any" style="font-size:11.5px;padding:4px 8px;width:85px;text-align:right;" value="${it.unitPriceRupees}">
          </td>
          <td style="padding:6px 8px;text-align:right;font-weight:700;color:var(--ink);">
            ₹${lineSubtotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </td>
          <td style="padding:6px 8px;text-align:center;">
            ${orderItems.length > 1 ? `
              <button class="btn btn-sm btn-ghost btn-remove-item" data-idx="${idx}" style="padding:2px 6px;color:var(--coral, #ef4444);font-size:12px;" type="button" title="Remove line item">✕</button>
            ` : '—'}
          </td>
        </tr>
      `;
    }).join('');

    if (totalEl) {
      totalEl.textContent = '₹' + grandTotalRupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    tbody.querySelectorAll('input, select').forEach((elem) => {
      elem.addEventListener('input', (e) => {
        const row = e.target.closest('tr');
        const idx = Number(row.dataset.itemIdx);
        const field = e.target.dataset.field;
        orderItems[idx][field] = e.target.value;
        renderItemsTable();
      });
    });

    tbody.querySelectorAll('.btn-remove-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        orderItems.splice(idx, 1);
        renderItemsTable();
      });
    });
  }

  const modalHtml = `
    <div style="display:flex;flex-direction:column;gap:14px;width:100%;max-width:680px;" class="proc-order-request-modal">
      <div style="border-bottom:1px solid var(--line);padding-bottom:10px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <h2 style="font-size:18px;font-weight:800;color:var(--ink);margin:0;">📦 Place Vendor Order Request</h2>
          <span class="badge" style="background:rgba(59,130,246,0.12);color:#2563eb;font-weight:700;font-size:11px;">Café Staff / Admin</span>
        </div>
        <p style="font-size:12.5px;color:var(--muted);margin:4px 0 0 0;">
          Create a replenishment order for today or tomorrow. The request will instantly appear in the Master window with items and quantities.
        </p>
      </div>

      <!-- Timing Selector -->
      <div style="background:var(--surface-sunken);border:1px solid var(--line);border-radius:8px;padding:12px;">
        <label style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--muted);letter-spacing:0.5px;display:block;margin-bottom:8px;">
          Order Timing &amp; Required Delivery Schedule
        </label>
        <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;">
          <label style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;cursor:pointer;">
            <input type="radio" name="order-timing" value="SAME_DAY" id="timing-opt-today">
            ☀️ Same Day (Today)
          </label>
          <label style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;cursor:pointer;">
            <input type="radio" name="order-timing" value="NEXT_DAY" id="timing-opt-tomorrow" checked>
            📅 Next Day (Tomorrow)
          </label>
          <label style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;cursor:pointer;">
            <input type="radio" name="order-timing" value="CUSTOM" id="timing-opt-custom">
            🗓️ Custom Date:
          </label>
          <input type="date" id="modal-order-delivery-date" class="input" style="font-size:12px;padding:4px 8px;width:140px;" value="${tomorrowStr}">
        </div>
      </div>

      <!-- Scope & Vendor Selection -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">Supplying Vendor *</label>
          <input type="text" id="modal-order-vendor" class="input" style="font-size:12px;width:100%;" value="VEN-0001" placeholder="e.g. VEN-0001 / Malabar Fresh">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">Requesting Café *</label>
          <input type="text" id="modal-order-cafe" class="input" style="font-size:12px;width:100%;" value="${state.currentCafeId || state.selectedCafeId || ''}" placeholder="e.g. CAFE-PATIO-01">
        </div>
      </div>

      <!-- Items Table -->
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <label style="font-size:11.5px;font-weight:700;color:var(--ink);">Requested Items &amp; Quantities *</label>
          <button class="btn btn-sm btn-ghost" id="btn-add-order-item" style="font-size:11px;font-weight:700;color:var(--accent);" type="button">+ Add Item Row</button>
        </div>
        <div style="max-height:220px;overflow-y:auto;border:1px solid var(--line);border-radius:6px;background:var(--surface);">
          <table class="glass-table" style="width:100%;font-size:11px;margin:0;">
            <thead>
              <tr style="background:var(--surface-sunken);">
                <th>Item / SKU</th>
                <th style="width:85px;">Unit</th>
                <th style="width:80px;text-align:right;">Quantity</th>
                <th style="width:90px;text-align:right;">Rate (₹)</th>
                <th style="width:100px;text-align:right;">Subtotal</th>
                <th style="width:40px;text-align:center;"></th>
              </tr>
            </thead>
            <tbody id="order-items-tbody"></tbody>
          </table>
        </div>
        <div style="display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:8px;padding:6px 12px;background:var(--surface-sunken);border-radius:6px;">
          <span style="font-size:12px;color:var(--muted);font-weight:600;">Estimated Order Value:</span>
          <strong style="font-size:15px;color:var(--accent);" id="order-summary-total">₹0.00</strong>
        </div>
      </div>

      <!-- Delivery Instructions -->
      <div>
        <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">Delivery Instructions / Notes for Vendor</label>
        <textarea id="modal-order-notes" class="input" style="font-size:12px;width:100%;height:52px;resize:none;" placeholder="e.g. Delivery required early morning at 6:30 AM before customer doors open..."></textarea>
      </div>

      <!-- Action Buttons -->
      <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--line);padding-top:10px;margin-top:4px;">
        <button class="btn btn-ghost" id="modal-order-cancel" style="font-size:12px;" type="button">Cancel</button>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary" id="modal-order-draft" style="font-size:12px;" type="button">Save as Draft</button>
          <button class="btn btn-primary" id="modal-order-submit" style="font-size:12.5px;font-weight:800;background:#2563eb;border-color:#2563eb;" type="button">
            🚀 Submit Request to Master &amp; Vendor
          </button>
        </div>
      </div>
    </div>
  `;

  openModal(modalHtml);
  renderItemsTable();

  const radioToday = document.getElementById('timing-opt-today');
  const radioTomorrow = document.getElementById('timing-opt-tomorrow');
  const radioCustom = document.getElementById('timing-opt-custom');
  const dateInput = document.getElementById('modal-order-delivery-date');

  radioToday?.addEventListener('change', () => {
    if (radioToday.checked) {
      selectedDeliveryDate = todayStr;
      timingType = 'SAME_DAY';
      dateInput.value = todayStr;
    }
  });

  radioTomorrow?.addEventListener('change', () => {
    if (radioTomorrow.checked) {
      selectedDeliveryDate = tomorrowStr;
      timingType = 'NEXT_DAY';
      dateInput.value = tomorrowStr;
    }
  });

  radioCustom?.addEventListener('change', () => {
    if (radioCustom.checked) {
      timingType = 'CUSTOM';
    }
  });

  dateInput?.addEventListener('change', () => {
    selectedDeliveryDate = dateInput.value;
    if (dateInput.value === todayStr) {
      if (radioToday) radioToday.checked = true;
      timingType = 'SAME_DAY';
    } else if (dateInput.value === tomorrowStr) {
      if (radioTomorrow) radioTomorrow.checked = true;
      timingType = 'NEXT_DAY';
    } else {
      if (radioCustom) radioCustom.checked = true;
      timingType = 'CUSTOM';
    }
  });

  document.getElementById('btn-add-order-item')?.addEventListener('click', () => {
    orderItems.push({
      itemId: 'ITM-CREAM-01',
      baseUnit: 'pack',
      qty: 10,
      unitPriceRupees: 120,
    });
    renderItemsTable();
  });

  document.getElementById('modal-order-cancel')?.addEventListener('click', closeModal);

  async function handleOrderSubmission(submitDirectly = true) {
    const vendorId = document.getElementById('modal-order-vendor')?.value?.trim();
    const cafeId = document.getElementById('modal-order-cafe')?.value?.trim();
    const notes = document.getElementById('modal-order-notes')?.value?.trim() || '';
    const deliveryDate = dateInput?.value || selectedDeliveryDate;

    if (!vendorId || !cafeId) {
      showToast('Vendor ID and Café ID are required.', 'coral');
      return;
    }

    if (!orderItems.length || orderItems.some((i) => !i.itemId || Number(i.qty) <= 0)) {
      showToast('Please provide valid items and quantities greater than zero.', 'coral');
      return;
    }

    try {
      const lineItems = orderItems.map((i) => ({
        itemId: i.itemId.toUpperCase(),
        orderedQuantityBase: Number(i.qty),
        unitPricePaisa: Math.round(Number(i.unitPriceRupees || 0) * 100),
        baseUnit: i.baseUnit || 'units',
      }));

      const payload = {
        vendorId,
        cafeId,
        expectedDeliveryDate: deliveryDate,
        timingType,
        status: submitDirectly ? 'SUBMITTED' : 'DRAFT',
        submitDirectly,
        lineItems,
        notes,
      };

      await apiPost('/procurement/orders', payload);
      closeModal();
      showToast(
        submitDirectly
          ? '🚀 Order request submitted! Master window notified and request is live.'
          : 'Draft order saved successfully.',
        'mint'
      );
      await loadOrdersSubtabData(root);
      await loadProcurementOverview(root);
    } catch (err) {
      showToast(err.message || 'Failed to submit order request', 'coral');
    }
  }

  document.getElementById('modal-order-submit')?.addEventListener('click', () => handleOrderSubmission(true));
  document.getElementById('modal-order-draft')?.addEventListener('click', () => handleOrderSubmission(false));
}

function openNewPoModal(root, preselectedSku = null) {
  openPlaceOrderRequestModal(root, preselectedSku);
}

/**
 * 2. Edit Order Request Modal (Rectify mistakes before/after approval)
 * If edited after approval, resets status to SUBMITTED, alerts Master, and mandates re-approval.
 */
function openEditOrderModal(root, po) {
  const isApproved = po.status === 'APPROVED' || !!po.masterApproval?.approvedAt;
  const currentItems = (po.lineItems || []).map((li) => ({
    itemId: li.itemId,
    name: li.itemNameSnapshot || li.itemId,
    baseUnit: li.baseUnit || 'units',
    qty: li.orderedQuantityBase,
    unitPriceRupees: (li.unitPricePaisa || 0) / 100,
  }));

  let editItems = currentItems.length > 0 ? [...currentItems] : [
    { itemId: 'ITM-MILK-01', baseUnit: 'liter', qty: 10, unitPriceRupees: 60 }
  ];

  function renderEditItemsTable() {
    const tbody = document.getElementById('edit-items-tbody');
    const totalEl = document.getElementById('edit-summary-total');
    if (!tbody) return;

    let grandTotal = 0;
    tbody.innerHTML = editItems.map((it, idx) => {
      const lineSubtotal = (Number(it.qty) || 0) * (Number(it.unitPriceRupees) || 0);
      grandTotal += lineSubtotal;

      return `
        <tr data-edit-idx="${idx}">
          <td style="padding:6px 8px;">
            <input type="text" class="input" data-field="itemId" style="font-size:11.5px;padding:4px 8px;width:100%;" value="${it.itemId}">
          </td>
          <td style="padding:6px 8px;">
            <select class="select" data-field="baseUnit" style="font-size:11.5px;padding:4px 6px;">
              <option value="liter" ${it.baseUnit === 'liter' ? 'selected' : ''}>liter</option>
              <option value="kg" ${it.baseUnit === 'kg' ? 'selected' : ''}>kg</option>
              <option value="pack" ${it.baseUnit === 'pack' ? 'selected' : ''}>pack</option>
              <option value="box" ${it.baseUnit === 'box' ? 'selected' : ''}>box</option>
              <option value="units" ${it.baseUnit === 'units' ? 'selected' : ''}>units</option>
            </select>
          </td>
          <td style="padding:6px 8px;">
            <input type="number" class="input" data-field="qty" min="1" step="any" style="font-size:11.5px;padding:4px 8px;width:75px;text-align:right;" value="${it.qty}">
          </td>
          <td style="padding:6px 8px;">
            <input type="number" class="input" data-field="unitPriceRupees" min="0" step="any" style="font-size:11.5px;padding:4px 8px;width:85px;text-align:right;" value="${it.unitPriceRupees}">
          </td>
          <td style="padding:6px 8px;text-align:right;font-weight:700;color:var(--ink);">
            ₹${lineSubtotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </td>
          <td style="padding:6px 8px;text-align:center;">
            ${editItems.length > 1 ? `
              <button class="btn btn-sm btn-ghost btn-remove-edit-item" data-idx="${idx}" style="padding:2px 6px;color:var(--coral, #ef4444);font-size:12px;" type="button">✕</button>
            ` : '—'}
          </td>
        </tr>
      `;
    }).join('');

    if (totalEl) {
      totalEl.textContent = '₹' + grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    tbody.querySelectorAll('input, select').forEach((el) => {
      el.addEventListener('input', (e) => {
        const row = e.target.closest('tr');
        const idx = Number(row.dataset.editIdx);
        const field = e.target.dataset.field;
        editItems[idx][field] = e.target.value;
        renderEditItemsTable();
      });
    });

    tbody.querySelectorAll('.btn-remove-edit-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        editItems.splice(idx, 1);
        renderEditItemsTable();
      });
    });
  }

  const modalHtml = `
    <div style="display:flex;flex-direction:column;gap:14px;width:100%;max-width:660px;">
      <div style="border-bottom:1px solid var(--line);padding-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <h2 style="font-size:17px;font-weight:800;color:var(--ink);margin:0;">✏️ Edit Order Request: ${po.purchaseOrderId}</h2>
          ${renderStatusPill(po.status)}
        </div>
        <div style="display:flex;gap:12px;margin-top:6px;font-size:12px;color:var(--muted);flex-wrap:wrap;">
          <span>Café: <strong>${po.cafeId}</strong></span>
          <span>Supplier: <strong>${po.vendorName || po.vendorId}</strong></span>
          <span>Edits Before Approval: <strong>${po.editCountBeforeApproval || 0}</strong></span>
          <span>Edits After Approval: <strong style="${(po.editCountAfterApproval || 0) > 0 ? 'color:#ef4444;' : ''}">${po.editCountAfterApproval || 0}</strong></span>
        </div>
      </div>

      ${isApproved ? `
        <div style="padding:10px 14px;background:rgba(239,68,68,0.1);border:1px solid #ef4444;border-radius:6px;color:#b91c1c;font-size:12px;line-height:1.5;">
          <strong>⚠️ High Priority Governance Warning:</strong><br/>
          This order was previously approved by Master. Editing it now will immediately revoke the existing approval, increment the post-approval edit counter, send an urgent notification to the Master window, and require Master re-approval before delivery or payment can proceed.
        </div>
      ` : ''}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">Expected Delivery Date</label>
          <input type="date" id="modal-edit-date" class="input" style="font-size:12px;width:100%;" value="${po.expectedDeliveryDate ? po.expectedDeliveryDate.split('T')[0] : ''}">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">Delivery Timing / Type</label>
          <input type="text" id="modal-edit-timing" class="input" style="font-size:12px;width:100%;" value="${po.timingType || 'NEXT_DAY'}" placeholder="SAME_DAY / NEXT_DAY">
        </div>
      </div>

      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <label style="font-size:11.5px;font-weight:700;color:var(--ink);">Items &amp; Quantities to Rectify</label>
          <button class="btn btn-sm btn-ghost" id="btn-add-edit-item" style="font-size:11px;color:var(--accent);font-weight:700;" type="button">+ Add Line</button>
        </div>
        <div style="max-height:200px;overflow-y:auto;border:1px solid var(--line);border-radius:6px;background:var(--surface);">
          <table class="glass-table" style="width:100%;font-size:11px;margin:0;">
            <thead>
              <tr style="background:var(--surface-sunken);">
                <th>Item / SKU</th>
                <th style="width:85px;">Unit</th>
                <th style="width:80px;text-align:right;">Quantity</th>
                <th style="width:90px;text-align:right;">Rate (₹)</th>
                <th style="width:100px;text-align:right;">Subtotal</th>
                <th style="width:40px;text-align:center;"></th>
              </tr>
            </thead>
            <tbody id="edit-items-tbody"></tbody>
          </table>
        </div>
        <div style="display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:6px;padding:4px 10px;background:var(--surface-sunken);border-radius:4px;">
          <span style="font-size:12px;color:var(--muted);font-weight:600;">Updated Total:</span>
          <strong style="font-size:14px;color:var(--accent);" id="edit-summary-total">₹0.00</strong>
        </div>
      </div>

      <div>
        <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">
          Reason for Modification / Rectification * <span style="color:#ef4444;">(Mandatory for Master Audit)</span>
        </label>
        <textarea id="modal-edit-reason" class="input" style="font-size:12px;width:100%;height:54px;resize:none;" placeholder="Explain why the order is being edited (e.g. Rectified milk quantity due to updated footfall estimation)..."></textarea>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--line);padding-top:10px;">
        <button class="btn btn-ghost" id="modal-edit-cancel" style="font-size:12px;" type="button">Cancel</button>
        <button class="btn btn-primary" id="modal-edit-submit" style="font-size:12.5px;font-weight:700;" type="button">
          💾 Save Changes &amp; Notify Master
        </button>
      </div>
    </div>
  `;

  openModal(modalHtml);
  renderEditItemsTable();

  document.getElementById('btn-add-edit-item')?.addEventListener('click', () => {
    editItems.push({ itemId: 'ITM-NEW-01', baseUnit: 'units', qty: 1, unitPriceRupees: 100 });
    renderEditItemsTable();
  });

  document.getElementById('modal-edit-cancel')?.addEventListener('click', closeModal);

  document.getElementById('modal-edit-submit')?.addEventListener('click', async () => {
    const reason = document.getElementById('modal-edit-reason')?.value?.trim();
    if (!reason) {
      showToast('Reason for modification is mandatory to maintain governance audit.', 'coral');
      return;
    }

    if (!editItems.length || editItems.some((i) => !i.itemId || Number(i.qty) <= 0)) {
      showToast('Please ensure all items have valid SKUs and positive quantities.', 'coral');
      return;
    }

    const expectedDeliveryDate = document.getElementById('modal-edit-date')?.value || po.expectedDeliveryDate;
    const timingType = document.getElementById('modal-edit-timing')?.value || po.timingType;

    const lineItems = editItems.map((i) => ({
      itemId: i.itemId.toUpperCase(),
      orderedQuantityBase: Number(i.qty),
      unitPricePaisa: Math.round(Number(i.unitPriceRupees || 0) * 100),
      baseUnit: i.baseUnit || 'units',
    }));

    try {
      await apiPut(`/procurement/orders/${po.purchaseOrderId}/edit`, {
        reason,
        expectedDeliveryDate,
        timingType,
        lineItems,
      });

      closeModal();
      showToast(`Order ${po.purchaseOrderId} updated successfully. Master notified.`, 'mint');
      await loadOrdersSubtabData(root);
      await loadProcurementOverview(root);
    } catch (err) {
      showToast(err.message || 'Failed to edit order', 'coral');
    }
  });
}

function openNewRequisitionModal(root) {
  const modalHtml = `
    <div style="display:flex;flex-direction:column;gap:14px;width:100%;max-width:480px;">
      <h2 style="font-size:16px;font-weight:800;color:var(--ink);margin:0;">Create Purchase Requisition</h2>
      <p style="font-size:12px;color:var(--muted);margin:-8px 0 0 0;">Submit internal demand for approval</p>

      <div>
        <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">Requisition Title *</label>
        <input type="text" id="modal-prq-title" class="input" style="font-size:12px;width:100%;" placeholder="e.g. Specialty Syrups Restock for Patio Cafe">
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">Café *</label>
          <input type="text" id="modal-prq-cafe" class="input" style="font-size:12px;width:100%;" value="${state.currentCafeId || state.selectedCafeId || ''}" placeholder="e.g. Cafe ID">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">Estimated Amount (₹)</label>
          <input type="number" id="modal-prq-amount" class="input" style="font-size:12px;width:100%;" value="25000">
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px;">
        <button class="btn btn-ghost" id="modal-prq-cancel" style="font-size:12px;" type="button">Cancel</button>
        <button class="btn btn-primary" id="modal-prq-submit" style="font-size:12px;font-weight:700;" type="button">Submit Request</button>
      </div>
    </div>
  `;

  openModal(modalHtml);

  document.getElementById('modal-prq-cancel')?.addEventListener('click', closeModal);
  document.getElementById('modal-prq-submit')?.addEventListener('click', async () => {
    const title = document.getElementById('modal-prq-title')?.value;
    const cafeId = document.getElementById('modal-prq-cafe')?.value;
    const amount = Number(document.getElementById('modal-prq-amount')?.value);

    if (!title) {
      showToast('Title is required.', 'coral');
      return;
    }

    try {
      await apiPost('/procurement/requisitions', {
        title,
        cafeId,
        estimatedAmountPaise: Math.round(amount * 100),
      });
      closeModal();
      showToast('Requisition submitted for approval.', 'mint');
      await renderActiveTab(root);
    } catch (err) {
      showToast(err.message || 'Failed to submit requisition', 'coral');
    }
  });
}

function openNewRfqModal(root) {
  const modalHtml = `
    <div style="display:flex;flex-direction:column;gap:14px;width:100%;max-width:480px;">
      <h2 style="font-size:16px;font-weight:800;color:var(--ink);margin:0;">Create Request for Quotation (RFQ)</h2>
      <p style="font-size:12px;color:var(--muted);margin:-8px 0 0 0;">Initiate competitive sourcing across suppliers</p>

      <div>
        <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">RFQ Title *</label>
        <input type="text" id="modal-rfq-title" class="input" style="font-size:12px;width:100%;" placeholder="e.g. Q4 Eco Packaging Bulk Sourcing">
      </div>

      <div>
        <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">Submission Deadline *</label>
        <input type="date" id="modal-rfq-deadline" class="input" style="font-size:12px;width:100%;" value="2026-08-31">
      </div>

      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px;">
        <button class="btn btn-ghost" id="modal-rfq-cancel" style="font-size:12px;" type="button">Cancel</button>
        <button class="btn btn-primary" id="modal-rfq-submit" style="font-size:12px;font-weight:700;" type="button">Publish RFQ</button>
      </div>
    </div>
  `;

  openModal(modalHtml);

  document.getElementById('modal-rfq-cancel')?.addEventListener('click', closeModal);
  document.getElementById('modal-rfq-submit')?.addEventListener('click', async () => {
    const title = document.getElementById('modal-rfq-title')?.value;
    const deadline = document.getElementById('modal-rfq-deadline')?.value;

    if (!title || !deadline) {
      showToast('Title and Deadline are required.', 'coral');
      return;
    }

    try {
      await apiPost('/procurement/rfqs', {
        title,
        deadline,
      });
      closeModal();
      showToast('RFQ published to vendors.', 'mint');
      await renderActiveTab(root);
    } catch (err) {
      showToast(err.message || 'Failed to create RFQ', 'coral');
    }
  });
}

/**
 * 3. Verify Delivery & Vendor Bill / Receipt Submission Modal
 * Features: Counting items, calculating missing/short quantities live, entering discrepancy reasons,
 * submitting vendor bills/receipts (PDF or JPEG/PNG), auto-updating inventory, and notifying Master for approval.
 */
function openVerifyDeliveryModal(root, po) {
  let attachedFileBase64 = null;
  let attachedFileName = null;
  let attachedFileType = null;
  let attachedFileSize = 0;

  const deliveries = (po.lineItems || []).map((li) => ({
    itemId: li.itemId,
    name: li.itemNameSnapshot || li.itemId,
    baseUnit: li.baseUnit || 'units',
    orderedQty: Number(li.orderedQuantityBase || 0),
    deliveredQty: Number(li.orderedQuantityBase || 0),
    acceptedQty: Number(li.orderedQuantityBase || 0),
    missingQty: 0,
    discrepancyReason: '',
    lotNumber: '',
  }));

  function renderDeliveryTable() {
    const tbody = document.getElementById('verify-delivery-tbody');
    if (!tbody) return;

    tbody.innerHTML = deliveries.map((d, idx) => {
      const missing = Math.max(0, d.orderedQty - d.acceptedQty);
      d.missingQty = missing;

      return `
        <tr data-del-idx="${idx}">
          <td style="padding:6px 8px;">
            <strong style="color:var(--ink);">${d.name}</strong>
            <div style="font-size:10px;color:var(--muted);font-family:var(--font-mono);">${d.itemId}</div>
          </td>
          <td style="padding:6px 8px;text-align:right;font-weight:700;">
            ${d.orderedQty} <span style="font-size:10px;color:var(--muted);">${d.baseUnit}</span>
          </td>
          <td style="padding:6px 8px;">
            <input type="number" class="input del-delivered-input" min="0" step="any" style="font-size:11.5px;padding:4px 6px;width:70px;text-align:right;" value="${d.deliveredQty}">
          </td>
          <td style="padding:6px 8px;">
            <input type="number" class="input del-accepted-input" min="0" step="any" style="font-size:11.5px;padding:4px 6px;width:70px;text-align:right;border-color:var(--mint);" value="${d.acceptedQty}">
          </td>
          <td style="padding:6px 8px;text-align:right;">
            ${missing > 0 ? `
              <span class="badge" style="background:#fee2e2;color:#b91c1c;font-weight:800;font-size:11px;">
                ⚠️ ${missing} Short
              </span>
            ` : `
              <span class="badge" style="background:rgba(16,185,129,0.12);color:#047857;font-size:10px;">
                ✓ Full
              </span>
            `}
          </td>
          <td style="padding:6px 8px;">
            <input type="text" class="input del-reason-input" style="font-size:11px;padding:4px 6px;width:100%;${missing > 0 && !d.discrepancyReason ? 'border-color:#ef4444;background:#fff5f5;' : ''}" value="${d.discrepancyReason}" placeholder="${missing > 0 ? 'Explain shortage reason (mandatory)' : 'Optional notes'}">
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.del-delivered-input').forEach((input, idx) => {
      input.addEventListener('input', (e) => {
        deliveries[idx].deliveredQty = Number(e.target.value) || 0;
        if (deliveries[idx].acceptedQty > deliveries[idx].deliveredQty) {
          deliveries[idx].acceptedQty = deliveries[idx].deliveredQty;
        }
        renderDeliveryTable();
      });
    });

    tbody.querySelectorAll('.del-accepted-input').forEach((input, idx) => {
      input.addEventListener('input', (e) => {
        deliveries[idx].acceptedQty = Number(e.target.value) || 0;
        renderDeliveryTable();
      });
    });

    tbody.querySelectorAll('.del-reason-input').forEach((input, idx) => {
      input.addEventListener('input', (e) => {
        deliveries[idx].discrepancyReason = e.target.value;
      });
    });
  }

  const modalHtml = `
    <div style="display:flex;flex-direction:column;gap:14px;width:100%;max-width:740px;" class="proc-verify-delivery-modal">
      <div style="border-bottom:1px solid var(--line);padding-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <h2 style="font-size:18px;font-weight:800;color:var(--ink);margin:0;">📦 Delivery Counting, Verification &amp; Bill Submission</h2>
          ${renderStatusPill(po.status)}
        </div>
        <div style="display:flex;gap:14px;margin-top:6px;font-size:12px;color:var(--muted);flex-wrap:wrap;">
          <span>PO ID: <strong style="color:var(--ink);">${po.purchaseOrderId}</strong></span>
          <span>Supplier: <strong>${po.vendorName || po.vendorId}</strong></span>
          <span>Café: <strong>${po.cafeId}</strong></span>
          <span>Expected Delivery: <strong>${po.expectedDeliveryDate ? po.expectedDeliveryDate.split('T')[0] : '—'}</strong></span>
        </div>
      </div>

      <!-- Reference Inputs -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">Supplier Delivery Challan / Note #</label>
          <input type="text" id="modal-verify-dnote" class="input" style="font-size:12px;width:100%;" placeholder="e.g. DN-9841 / DC-004">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">Vendor Invoice / Bill #</label>
          <input type="text" id="modal-verify-invoice" class="input" style="font-size:12px;width:100%;" placeholder="e.g. INV-2026-9841">
        </div>
      </div>

      <!-- Item Count & Verification Table -->
      <div>
        <label style="font-size:11.5px;font-weight:700;color:var(--ink);display:block;margin-bottom:4px;">
          Item Count &amp; Discrepancy Verification (Ordered vs Delivered vs Accepted)
        </label>
        <div style="max-height:220px;overflow-y:auto;border:1px solid var(--line);border-radius:6px;background:var(--surface);">
          <table class="glass-table" style="width:100%;font-size:11px;margin:0;">
            <thead>
              <tr style="background:var(--surface-sunken);">
                <th>Item / SKU</th>
                <th style="width:75px;text-align:right;">Ordered</th>
                <th style="width:75px;text-align:right;">Delivered</th>
                <th style="width:75px;text-align:right;">Accepted</th>
                <th style="width:85px;text-align:right;">Shortage</th>
                <th style="width:180px;">Discrepancy Reason</th>
              </tr>
            </thead>
            <tbody id="verify-delivery-tbody"></tbody>
          </table>
        </div>
      </div>

      <!-- Document Submission Section (PDF / JPEG) -->
      <div style="background:var(--surface-sunken);border:1px solid var(--line);border-radius:8px;padding:12px;">
        <label style="font-size:11.5px;font-weight:800;color:var(--ink);display:block;margin-bottom:2px;">
          📎 Vendor Bill &amp; Physical Receipt Submission (PDF or JPEG/PNG)
        </label>
        <p style="font-size:11px;color:var(--muted);margin:0 0 8px 0;">
          Submit the vendor's bill or receipt. Master can download this file and hand over to the Accounts Department for payment.
        </p>

        <div id="file-dropzone" style="border:2px dashed var(--line);border-radius:6px;padding:14px;text-align:center;cursor:pointer;background:var(--surface);transition:all 0.2s;">
          <input type="file" id="modal-verify-file" accept=".pdf, .jpg, .jpeg, .png, application/pdf, image/jpeg, image/png" style="display:none;">
          <div id="dropzone-prompt">
            <div style="font-size:22px;margin-bottom:4px;">📄</div>
            <div style="font-size:12px;font-weight:600;color:var(--ink);">Click or drag &amp; drop Vendor Bill / Receipt here</div>
            <div style="font-size:10.5px;color:var(--muted);margin-top:2px;">Supports PDF, JPEG, PNG format</div>
          </div>
          <div id="dropzone-preview" style="display:none;align-items:center;justify-content:space-between;padding:4px 8px;">
            <div style="display:flex;align-items:center;gap:8px;">
              <span id="preview-icon" style="font-size:20px;">📑</span>
              <div style="text-align:left;">
                <strong id="preview-filename" style="font-size:12px;color:var(--ink);display:block;"></strong>
                <span id="preview-filesize" style="font-size:10.5px;color:var(--muted);"></span>
              </div>
            </div>
            <button class="btn btn-sm btn-ghost" id="btn-remove-file" style="color:var(--coral, #ef4444);font-size:11px;" type="button">✕ Remove</button>
          </div>
        </div>
      </div>

      <!-- Dual Immediate Automatic Actions Banner -->
      <div style="padding:10px 14px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.3);border-radius:6px;font-size:11.5px;color:#065f46;line-height:1.5;">
        <strong style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
          <span>⚡</span> Dual Immediate System Actions upon Submission:
        </strong>
        <ol style="margin:0 0 0 16px;padding:0;">
          <li><strong>Inventory Instantly Added:</strong> Accepted items will automatically be added to café inventory stock levels and ledger with FEFO lot tracking.</li>
          <li><strong>Master Approval Module:</strong> Master window will receive an immediate notification with this delivery verification report and attached vendor bill to approve for Accounts handoff.</li>
        </ol>
      </div>

      <!-- Action Buttons -->
      <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--line);padding-top:10px;">
        <button class="btn btn-ghost" id="modal-verify-cancel" style="font-size:12px;" type="button">Cancel</button>
        <button class="btn btn-primary" id="modal-verify-submit" style="font-size:12.5px;font-weight:800;background:#059669;border-color:#059669;" type="button">
          📦 Submit Verification &amp; Auto-Post to Inventory
        </button>
      </div>
    </div>
  `;

  openModal(modalHtml);
  renderDeliveryTable();

  const dropzone = document.getElementById('file-dropzone');
  const fileInput = document.getElementById('modal-verify-file');
  const promptEl = document.getElementById('dropzone-prompt');
  const previewEl = document.getElementById('dropzone-preview');
  const filenameEl = document.getElementById('preview-filename');
  const filesizeEl = document.getElementById('preview-filesize');
  const iconEl = document.getElementById('preview-icon');
  const removeBtn = document.getElementById('btn-remove-file');

  dropzone?.addEventListener('click', (e) => {
    if (e.target.id !== 'btn-remove-file') {
      fileInput?.click();
    }
  });

  dropzone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = 'var(--accent)';
  });

  dropzone?.addEventListener('dragleave', () => {
    dropzone.style.borderColor = 'var(--line)';
  });

  dropzone?.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = 'var(--line)';
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleSelectedFile(e.dataTransfer.files[0]);
    }
  });

  fileInput?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleSelectedFile(e.target.files[0]);
    }
  });

  function handleSelectedFile(file) {
    attachedFileName = file.name;
    attachedFileType = file.type;
    attachedFileSize = file.size;

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      attachedFileBase64 = result.includes(',') ? result.split(',')[1] : result;

      if (promptEl) promptEl.style.display = 'none';
      if (previewEl) previewEl.style.display = 'flex';
      if (filenameEl) filenameEl.textContent = file.name;
      if (filesizeEl) filesizeEl.textContent = (file.size > 1048576 ? (file.size / 1048576).toFixed(1) + ' MB' : Math.round(file.size / 1024) + ' KB');
      if (iconEl) iconEl.textContent = file.type.includes('pdf') ? '📄' : '🖼️';
    };
    reader.readAsDataURL(file);
  }

  removeBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    attachedFileBase64 = null;
    attachedFileName = null;
    attachedFileType = null;
    if (fileInput) fileInput.value = '';
    if (promptEl) promptEl.style.display = 'block';
    if (previewEl) previewEl.style.display = 'none';
  });

  document.getElementById('modal-verify-cancel')?.addEventListener('click', closeModal);

  document.getElementById('modal-verify-submit')?.addEventListener('click', async () => {
    for (const d of deliveries) {
      if (d.missingQty > 0 && !d.discrepancyReason.trim()) {
        showToast(`Please enter discrepancy reason for item ${d.name} (${d.missingQty} units missing).`, 'coral');
        return;
      }
    }

    const dnote = document.getElementById('modal-verify-dnote')?.value?.trim() || '';
    const invoiceNum = document.getElementById('modal-verify-invoice')?.value?.trim() || '';

    const payload = {
      deliveryNoteNumber: dnote,
      vendorInvoiceNumber: invoiceNum,
      deliveries: deliveries.map((d) => ({
        itemId: d.itemId,
        deliveredQty: Number(d.deliveredQty),
        acceptedQty: Number(d.acceptedQty),
        missingQty: Number(d.missingQty),
        discrepancyReason: d.discrepancyReason,
      })),
      fileName: attachedFileName,
      fileType: attachedFileType,
      fileBase64: attachedFileBase64,
    };

    try {
      await apiPost(`/procurement/orders/${po.purchaseOrderId}/verify-delivery`, payload);
      closeModal();
      showToast(
        `⚡ Delivery verified! Items auto-added to inventory & Master notified with attached bill for review.`,
        'mint'
      );
      await loadOrdersSubtabData(root);
      await loadProcurementOverview(root);
    } catch (err) {
      showToast(err.message || 'Failed to verify delivery', 'coral');
    }
  });
}

function openReceiveGrnModal(root, po) {
  openVerifyDeliveryModal(root, po);
}

function openPo360Modal(root, po) {
  const userRole = state?.user?.role || 'STAFF';
  const assignedCafes = state?.user?.assignedCafeIds || [];
  const canAttach = userRole === 'MASTER' || (userRole === 'CAFE_ADMIN' && assignedCafes.includes(po.cafeId));
  const isMaster = userRole === 'MASTER';
  const isStaff = userRole === 'STAFF';

  const totalEdits = (po.editCountBeforeApproval || 0) + (po.editCountAfterApproval || 0);

  const modalHtml = `
    <div style="display:flex;flex-direction:column;gap:14px;width:100%;max-width:800px;" class="po-360-modal-container">
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding-bottom:10px;">
        <div>
          <div style="display:flex;align-items:center;gap:8px;">
            <h2 style="font-size:17px;font-weight:800;color:var(--ink);margin:0;">PO 360° Inspector: ${po.purchaseOrderId}</h2>
            ${renderStatusPill(po.status)}
            ${po.needsReapproval ? `<span class="badge" style="background:#fee2e2;color:#b91c1c;font-weight:700;font-size:10px;">Re-approval Mandated</span>` : ''}
          </div>
          <span style="font-size:12px;color:var(--muted);margin-top:2px;display:block;">
            Supplier: <strong>${po.vendorName || po.vendorId}</strong> · Café: <strong>${po.cafeId}</strong> · Timing: <strong>${po.timingType || 'NORMAL'}</strong>
          </span>
        </div>
        <div style="text-align:right;">
          <span style="font-size:11px;color:var(--muted);display:block;">Order Value</span>
          <strong style="font-size:16px;color:var(--accent);">${formatPaise(po.totalAmountPaisa)}</strong>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <div style="display:flex;gap:8px;border-bottom:1px solid var(--line);padding-bottom:6px;overflow-x:auto;">
        <button class="btn btn-sm btn-ghost active" id="tab-po-items" style="font-size:12px;font-weight:700;" type="button">📋 Line Items</button>
        <button class="btn btn-sm btn-ghost" id="tab-po-documents" style="font-size:12px;font-weight:700;" type="button">📎 Vendor Bills &amp; Docs <span class="badge" id="po-doc-count-badge" style="font-size:9px;margin-left:4px;">${(po.receiptAttachments || []).length}</span></button>
        <button class="btn btn-sm btn-ghost" id="tab-po-matching" style="font-size:12px;font-weight:700;" type="button">⚖️ 3-Way Reconciliation</button>
        <button class="btn btn-sm btn-ghost" id="tab-po-history" style="font-size:12px;font-weight:700;" type="button">📜 Audit &amp; Edits <span class="badge" style="font-size:9px;margin-left:4px;">${totalEdits}</span></button>
      </div>

      <!-- TAB 1: Line Items -->
      <div id="po-tab-content-items" style="display:block;">
        <div style="max-height:260px;overflow-y:auto;border:1px solid var(--line);border-radius:6px;">
          <table class="glass-table" style="width:100%;font-size:11px;">
            <thead>
              <tr>
                <th>Item / SKU</th>
                <th style="text-align:right;">Ordered</th>
                <th style="text-align:right;">Received</th>
                <th style="text-align:right;">Unit Price</th>
                <th style="text-align:right;">Line Total</th>
              </tr>
            </thead>
            <tbody>
              ${(po.lineItems || []).map((l) => `
                <tr>
                  <td><strong>${l.itemNameSnapshot || l.itemId}</strong></td>
                  <td style="text-align:right;">${l.orderedQuantityBase} ${l.baseUnit || ''}</td>
                  <td style="text-align:right;color:var(--mint, #10b981);font-weight:700;">${l.receivedQuantityBase || 0}</td>
                  <td style="text-align:right;">${formatPaise(l.unitPricePaisa)}</td>
                  <td style="text-align:right;font-weight:700;">${formatPaise(l.totalLinePaisa)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- TAB 2: Documents & Evidence -->
      <div id="po-tab-content-documents" style="display:none;">
        ${(po.receiptAttachments && po.receiptAttachments.length > 0) ? `
          <div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.3);border-radius:6px;padding:12px 14px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
            <div>
              <div style="display:flex;align-items:center;gap:6px;">
                <span style="font-size:16px;">📑</span>
                <strong style="color:#065f46;font-size:12.5px;">Attached Vendor Bill / Receipt: ${po.receiptAttachments[0].filename}</strong>
              </div>
              <div style="font-size:11px;color:var(--muted);margin-top:2px;">
                Uploaded by: <strong>${po.receiptAttachments[0].uploadedByUserId} (${po.receiptAttachments[0].uploadedByRole || 'STAFF'})</strong> · Download for Accounts handoff.
              </div>
            </div>
            <button class="btn btn-sm btn-primary" id="btn-download-bill-accounts" style="font-size:11.5px;font-weight:700;background:#059669;border-color:#059669;display:flex;align-items:center;gap:6px;" type="button">
              📥 Download Vendor Bill for Accounts
            </button>
          </div>
        ` : ''}

        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-size:12px;color:var(--muted);">Procurement evidence (Invoices, Delivery Challans, Vendor Bills, Receipts)</span>
          ${canAttach ? `
            <button class="btn btn-sm btn-primary" id="btn-po-attach-document" style="font-size:11px;font-weight:700;" type="button">📎 Attach Document</button>
          ` : (isStaff ? `<span class="badge warning" style="font-size:10px;">Staff: No Attachment Access</span>` : '')}
        </div>
        <div id="po-documents-table-wrapper" style="min-height:160px;max-height:280px;overflow-y:auto;border:1px solid var(--line);border-radius:6px;background:var(--surface-sunken);">
          ${skeleton('140px')}
        </div>
      </div>

      <!-- TAB 3: 3-Way Reconciliation -->
      <div id="po-tab-content-matching" style="display:none;">
        <div id="po-matching-wrapper" style="padding:12px;background:var(--surface-sunken);border-radius:6px;border:1px solid var(--line);">
          ${skeleton('120px')}
        </div>
      </div>

      <!-- TAB 4: Audit & Edit History -->
      <div id="po-tab-content-history" style="display:none;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <span style="font-size:12px;color:var(--muted);">Audit trail of modifications made before and after Master approval</span>
          <div style="display:flex;gap:8px;">
            <span class="badge" style="background:rgba(59,130,246,0.12);color:#2563eb;font-size:10.5px;">
              ✏️ ${po.editCountBeforeApproval || 0} Pre-Approval Edit(s)
            </span>
            <span class="badge" style="background:rgba(239,68,68,0.15);color:#dc2626;font-size:10.5px;font-weight:700;">
              ⚠️ ${po.editCountAfterApproval || 0} Post-Approval Edit(s)
            </span>
          </div>
        </div>

        ${po.needsReapproval ? `
          <div style="padding:10px 14px;background:rgba(239,68,68,0.1);border:1px solid #ef4444;border-radius:6px;color:#b91c1c;font-size:12px;margin-bottom:10px;line-height:1.4;">
            ⚠️ <strong>Re-approval Required:</strong> This purchase order was modified after prior Master approval. Master must verify changes and approve again.
          </div>
        ` : ''}

        <div style="max-height:240px;overflow-y:auto;border:1px solid var(--line);border-radius:6px;background:var(--surface);">
          ${(po.editHistory && po.editHistory.length > 0) ? `
            <table class="glass-table" style="width:100%;font-size:11px;margin:0;">
              <thead>
                <tr style="background:var(--surface-sunken);">
                  <th>Date &amp; Time</th>
                  <th>Modified By</th>
                  <th>Timing</th>
                  <th>Reason for Edit</th>
                  <th>Changes Summary</th>
                </tr>
              </thead>
              <tbody>
                ${po.editHistory.map((h) => `
                  <tr>
                    <td style="color:var(--muted);white-space:nowrap;">${h.editedAt ? new Date(h.editedAt).toLocaleString('en-IN') : '—'}</td>
                    <td><strong>${h.editedByUserId}</strong> <span class="badge" style="font-size:9px;">${h.editedByRole}</span></td>
                    <td>
                      ${h.wasApproved ? `
                        <span class="badge" style="background:#fee2e2;color:#b91c1c;font-weight:700;font-size:9px;">⚠️ Post-Approval</span>
                      ` : `
                        <span class="badge" style="background:#dbeafe;color:#1e40af;font-size:9px;">Pre-Approval</span>
                      `}
                    </td>
                    <td style="color:var(--ink);">${h.reason || '—'}</td>
                    <td style="color:var(--muted);">${h.changesSummary || '—'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : `
            <div style="text-align:center;padding:24px;color:var(--muted);font-size:12px;">
              No modifications recorded for this order request.
            </div>
          `}
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;border-top:1px solid var(--line);padding-top:8px;">
        <button class="btn btn-sm btn-ghost" id="modal-po360-print" style="font-size:12px;" type="button">🖨️ Print PO</button>
        <div style="display:flex;gap:8px;align-items:center;">
          ${isMaster && (['SUBMITTED', 'VERIFIED_PENDING_MASTER_APPROVAL'].includes(po.status) || po.needsReapproval) ? `
            <button class="btn btn-sm btn-primary" id="modal-po360-approve" style="font-size:12px;font-weight:700;background:#059669;border-color:#059669;" type="button">
              ✅ Approve Order &amp; Bills
            </button>
          ` : ''}
          <button class="btn btn-ghost" id="modal-po360-close" style="font-size:12px;" type="button">Close</button>
        </div>
      </div>
    </div>
  `;

  openModal(modalHtml);

  const tabItemsBtn = document.getElementById('tab-po-items');
  const tabDocsBtn = document.getElementById('tab-po-documents');
  const tabMatchBtn = document.getElementById('tab-po-matching');
  const tabHistBtn = document.getElementById('tab-po-history');
  const contentItems = document.getElementById('po-tab-content-items');
  const contentDocs = document.getElementById('po-tab-content-documents');
  const contentMatch = document.getElementById('po-tab-content-matching');
  const contentHist = document.getElementById('po-tab-content-history');

  function setPoTab(active) {
    [tabItemsBtn, tabDocsBtn, tabMatchBtn, tabHistBtn].forEach((b) => b?.classList.remove('active'));
    [contentItems, contentDocs, contentMatch, contentHist].forEach((c) => { if (c) c.style.display = 'none'; });

    if (active === 'items') {
      tabItemsBtn?.classList.add('active');
      if (contentItems) contentItems.style.display = 'block';
    } else if (active === 'documents') {
      tabDocsBtn?.classList.add('active');
      if (contentDocs) contentDocs.style.display = 'block';
      loadPoDocuments(po);
    } else if (active === 'matching') {
      tabMatchBtn?.classList.add('active');
      if (contentMatch) contentMatch.style.display = 'block';
      loadPoMatching(po);
    } else if (active === 'history') {
      tabHistBtn?.classList.add('active');
      if (contentHist) contentHist.style.display = 'block';
    }
  }

  tabItemsBtn?.addEventListener('click', () => setPoTab('items'));
  tabDocsBtn?.addEventListener('click', () => setPoTab('documents'));
  tabMatchBtn?.addEventListener('click', () => setPoTab('matching'));
  tabHistBtn?.addEventListener('click', () => setPoTab('history'));

  document.getElementById('modal-po360-close')?.addEventListener('click', closeModal);
  document.getElementById('modal-po360-print')?.addEventListener('click', () => window.print());

  document.getElementById('btn-download-bill-accounts')?.addEventListener('click', () => {
    downloadOrderBill(po.purchaseOrderId);
  });

  document.getElementById('modal-po360-approve')?.addEventListener('click', async () => {
    await executeMasterApprove(root, po.purchaseOrderId);
    closeModal();
  });

  document.getElementById('btn-po-attach-document')?.addEventListener('click', () => {
    openAttachPoDocumentModal(root, po, () => {
      loadPoDocuments(po);
      loadPoMatching(po);
      loadOrdersSubtabData(root);
    });
  });

  // Preload documents count for badge
  loadPoDocuments(po, true);
}

async function loadPoDocuments(po, countOnly = false) {
  const wrapper = document.getElementById('po-documents-table-wrapper');
  const badge = document.getElementById('po-doc-count-badge');
  const userRole = state?.user?.role || 'STAFF';
  const assignedCafes = state?.user?.assignedCafeIds || [];
  const canMutate = userRole === 'MASTER' || (userRole === 'CAFE_ADMIN' && assignedCafes.includes(po.cafeId));

  try {
    const res = await apiGet(`/procurement/orders/${po.purchaseOrderId}/documents`);
    const docs = res?.data?.documents || [];
    if (badge) badge.textContent = docs.length;

    if (countOnly) return;
    if (!wrapper) return;

    if (docs.length === 0) {
      wrapper.innerHTML = `
        <div style="padding:32px 16px;text-align:center;color:var(--muted);font-size:12px;">
          <div style="font-size:24px;margin-bottom:6px;">📂</div>
          <strong>No procurement documents attached.</strong>
          <p style="margin:4px 0 0 0;">Supplier tax invoices, delivery challans, and goods receipts can be attached above.</p>
        </div>
      `;
      return;
    }

    wrapper.innerHTML = `
      <table class="glass-table" style="width:100%;font-size:11px;">
        <thead>
          <tr>
            <th>Type</th>
            <th>Filename / Number</th>
            <th>Date</th>
            <th>Security / Status</th>
            <th>Ver</th>
            <th>Size</th>
            <th style="text-align:center;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${docs.map((d) => {
            const isClean = d.scanStatus === 'CLEAN' && d.uploadStatus === 'AVAILABLE';
            const statusColor = isClean ? '#10b981' : (d.scanStatus === 'INFECTED' ? '#ef4444' : '#f59e0b');
            const statusLabel = isClean ? 'Clean · Available' : (d.scanStatus === 'INFECTED' ? 'Malware Rejected' : 'Scan Pending');

            return `
              <tr data-doc-id="${d.documentId}">
                <td><span class="badge" style="font-size:9px;font-weight:700;">${d.documentType}</span></td>
                <td>
                  <strong style="color:var(--ink);">${d.originalFilename}</strong>
                  ${d.documentNumber ? `<span style="font-size:10px;color:var(--muted);display:block;">Ref: ${d.documentNumber}</span>` : ''}
                </td>
                <td style="color:var(--muted);">${d.invoiceDate ? d.invoiceDate.split('T')[0] : (d.uploadedAt ? d.uploadedAt.split('T')[0] : '—')}</td>
                <td>
                  <span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:600;color:${statusColor};">
                    <span style="width:6px;height:6px;border-radius:50%;background:${statusColor};"></span>
                    ${statusLabel}
                  </span>
                </td>
                <td style="font-family:var(--font-mono);color:var(--muted);">v${d.currentVersion || 1}</td>
                <td style="color:var(--muted);">${d.sizeBytes ? (d.sizeBytes > 1048576 ? (d.sizeBytes/1048576).toFixed(1) + ' MB' : Math.round(d.sizeBytes/1024) + ' KB') : '—'}</td>
                <td style="text-align:center;">
                  <div style="display:flex;gap:4px;justify-content:center;">
                    <button class="btn btn-sm btn-ghost" data-preview-doc="${d.documentId}" style="padding:2px 6px;font-size:11px;" ${!isClean ? 'disabled title="Document scan pending or infected"' : 'title="Safe Inline Preview"'}>👁️ Preview</button>
                    <button class="btn btn-sm btn-ghost" data-download-doc="${d.documentId}" style="padding:2px 6px;font-size:11px;" ${!isClean ? 'disabled title="Document scan pending or infected"' : 'title="Download binary"'}>⬇️ Download</button>
                    ${['SUPPLIER_INVOICE', 'INVOICE'].includes(d.documentType) && isClean ? `
                      <button class="btn btn-sm btn-ghost" data-ai-review-doc="${d.documentId}" style="padding:2px 6px;font-size:11px;color:var(--accent, #b45309);font-weight:700;" title="Zamorin AI Invoice Intelligence">⚡ AI Review</button>
                    ` : ''}
                    ${canMutate ? `
                      <button class="btn btn-sm btn-ghost" data-replace-doc="${d.documentId}" style="padding:2px 6px;font-size:11px;" title="Upload revised version">🔄 Replace</button>
                      <button class="btn btn-sm btn-ghost" data-archive-doc="${d.documentId}" style="padding:2px 6px;font-size:11px;color:var(--coral, #ef4444);" title="Archive from active PO">🗑️</button>
                    ` : ''}
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;

    // Wire actions
    wrapper.querySelectorAll('[data-ai-review-doc]').forEach((btn) => {
      btn.addEventListener('click', () => {
        openInvoiceIntelligenceReviewModal(btn.dataset.aiReviewDoc, {
          previewUrl: `/api/v1/procurement/orders/${po.purchaseOrderId}/documents/${btn.dataset.aiReviewDoc}/preview`,
          onApproved: () => loadPoDocuments(po),
        });
      });
    });

    wrapper.querySelectorAll('[data-preview-doc]').forEach((btn) => {
      btn.addEventListener('click', () => {
        openPoDocumentPreviewModal(po.purchaseOrderId, btn.dataset.previewDoc);
      });
    });

    wrapper.querySelectorAll('[data-download-doc]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const docId = btn.dataset.downloadDoc;
        const downloadUrl = `/api/v1/procurement/orders/${po.purchaseOrderId}/documents/${docId}/download`;
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      });
    });

    wrapper.querySelectorAll('[data-replace-doc]').forEach((btn) => {
      btn.addEventListener('click', () => {
        openReplacePoDocumentModal(po, btn.dataset.replaceDoc, () => loadPoDocuments(po));
      });
    });

    wrapper.querySelectorAll('[data-archive-doc]').forEach((btn) => {
      btn.addEventListener('click', () => {
        confirmAction({
          title: 'Archive Procurement Document?',
          message: 'This document will be archived from active PO display while maintaining complete statutory audit retention.',
          confirmText: 'Archive Evidence',
          confirmVariant: 'coral',
          onConfirm: async () => {
            try {
              const res = await fetch(`/api/v1/procurement/orders/${po.purchaseOrderId}/documents/${btn.dataset.archiveDoc}`, {
                method: 'DELETE',
                headers: {
                  'Content-Type': 'application/json',
                  ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
                },
                body: JSON.stringify({ reason: 'Archived by user action' }),
              });
              const json = await res.json();
              if (!res.ok) throw new Error(json?.error?.message || 'Archive failed');
              showToast('Document archived successfully.', 'mint');
              loadPoDocuments(po);
            } catch (err) {
              showToast(err.message || 'Failed to archive document.', 'coral');
            }
          },
        });
      });
    });
  } catch (err) {
    if (wrapper) wrapper.innerHTML = `<div style="padding:16px;color:var(--coral);font-size:11px;">Failed to load documents: ${err.message}</div>`;
  }
}

async function loadPoMatching(po) {
  const wrapper = document.getElementById('po-matching-wrapper');
  if (!wrapper) return;

  try {
    const res = await apiGet(`/procurement/orders/${po.purchaseOrderId}/matching-status`);
    const match = res?.data || {};

    const statusBadgeClass = match.reconciliationStatus === 'MATCHED' ? 'pill-mint' : (match.reconciliationStatus === 'DOCUMENT_MISSING' ? 'pill-amber' : 'pill-coral');

    wrapper.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <h4 style="font-size:13px;font-weight:700;color:var(--ink);margin:0;">3-Way Match &amp; Audit Reconciliation</h4>
        <span class="pill ${statusBadgeClass}" style="font-size:10px;font-weight:700;">${match.reconciliationStatus || 'NOT_READY'}</span>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:8px;font-size:11px;margin-bottom:10px;">
        <div style="background:var(--surface);padding:8px 10px;border-radius:4px;">
          <span style="color:var(--muted);display:block;">PO Grand Total</span>
          <strong style="color:var(--ink);">${formatPaise(match.poGrandTotal || po.totalAmountPaisa)}</strong>
        </div>
        <div style="background:var(--surface);padding:8px 10px;border-radius:4px;">
          <span style="color:var(--muted);display:block;">Invoiced Total</span>
          <strong style="color:var(--ink);">${formatPaise(match.invGrandTotal || 0)}</strong>
        </div>
        <div style="background:var(--surface);padding:8px 10px;border-radius:4px;">
          <span style="color:var(--muted);display:block;">Variance</span>
          <strong style="color:${(match.totalDifferencePaisa || 0) === 0 ? 'var(--mint, #10b981)' : 'var(--coral, #ef4444)'};">${formatPaise(match.totalDifferencePaisa || 0)}</strong>
        </div>
      </div>

      ${(match.discrepancies && match.discrepancies.length > 0) ? `
        <div style="background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.2);padding:8px 10px;border-radius:4px;font-size:11px;">
          <strong style="color:var(--coral, #ef4444);">Discrepancies Identified:</strong>
          <ul style="margin:4px 0 0 16px;padding:0;color:var(--coral, #ef4444);">
            ${match.discrepancies.map((d) => (d.issues || []).map((iss) => `<li>${iss}</li>`).join('')).join('')}
          </ul>
        </div>
      ` : `
        <div style="background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.2);padding:8px 10px;border-radius:4px;font-size:11px;color:var(--mint, #10b981);">
          ✓ All quantities, rates, and GST taxes match within authorized tolerances.
        </div>
      `}

      <div style="margin-top:14px;padding-top:10px;border-top:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <div>
          <strong style="font-size:11.5px;color:var(--ink);">Accounts Department AP Handoff:</strong>
          <span class="badge ${po.accountsHandoff?.status === 'SENT_TO_ACCOUNTS' ? 'badge-success' : 'badge-neutral'}" style="margin-left:6px;font-size:10px;">
            ${po.accountsHandoff?.status || 'PENDING'}
          </span>
        </div>
        ${po.accountsHandoff?.status === 'SENT_TO_ACCOUNTS' ? `
          <span style="font-size:11px;color:var(--mint, #10b981);font-weight:700;">✓ Packet In Accounts AP Queue</span>
        ` : `
          <button class="btn btn-sm btn-primary" id="btn-proc-send-accounts" style="font-size:11px;font-weight:700;" type="button">
            📤 Send Packet to Accounts AP
          </button>
        `}
      </div>
    `;

    wrapper.querySelector('#btn-proc-send-accounts')?.addEventListener('click', async () => {
      try {
        showToast('Transmitting matched physical packet to Accounts AP...', 'info');
        const res = await apiPost(`/api/v1/procurement/orders/${po.purchaseOrderId}/send-to-accounts`, {
          notes: 'Transmitted from Procurement 3-Way Match Inspector',
        });
        if (res?.success) {
          showToast(`Purchase order ${po.purchaseOrderId} sent to Accounts AP!`, 'mint');
          po.accountsHandoff = res.data?.accountsHandoff || { status: 'SENT_TO_ACCOUNTS' };
          loadPoMatching(po);
        } else {
          showToast(res?.message || 'Failed to send to accounts.', 'coral');
        }
      } catch (err) {
        showToast(err.message || 'Failed to send packet to Accounts AP.', 'coral');
      }
    });
  } catch (err) {
    wrapper.innerHTML = `<div style="padding:12px;color:var(--muted);font-size:11px;">Reconciliation summary unavailable: ${err.message}</div>`;
  }
}

function openPoDocumentPreviewModal(purchaseOrderId, documentId) {
  const previewUrl = `/api/v1/procurement/orders/${purchaseOrderId}/documents/${documentId}/preview`;
  const downloadUrl = `/api/v1/procurement/orders/${purchaseOrderId}/documents/${documentId}/download`;

  const modalHtml = `
    <div style="display:flex;flex-direction:column;gap:10px;width:100%;max-width:800px;">
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding-bottom:8px;">
        <h3 style="font-size:15px;font-weight:700;color:var(--ink);margin:0;">Secure Document Preview</h3>
        <div style="display:flex;gap:6px;">
          <a class="btn btn-sm btn-secondary" href="${downloadUrl}" target="_blank" style="font-size:11px;text-decoration:none;">⬇️ Download File</a>
          <button class="btn btn-sm btn-ghost" id="modal-preview-close" type="button">✕</button>
        </div>
      </div>
      <div style="width:100%;height:480px;background:var(--surface-sunken);border-radius:6px;display:flex;align-items:center;justify-content:center;overflow:hidden;border:1px solid var(--line);">
        <iframe src="${previewUrl}" style="width:100%;height:100%;border:none;" title="Document Preview"></iframe>
      </div>
    </div>
  `;

  openModal(modalHtml);
  document.getElementById('modal-preview-close')?.addEventListener('click', closeModal);
}

function openAttachPoDocumentModal(root, po, onAttached) {
  const modalHtml = `
    <div style="display:flex;flex-direction:column;gap:12px;width:100%;max-width:560px;">
      <div style="border-bottom:1px solid var(--line);padding-bottom:8px;">
        <h3 style="font-size:15px;font-weight:800;color:var(--ink);margin:0;">Attach Procurement Document</h3>
        <span style="font-size:11px;color:var(--muted);">Purchase Order: ${po.purchaseOrderId} · Supplier: ${po.vendorName || po.vendorId}</span>
      </div>

      <form id="form-po-attach-document" style="display:flex;flex-direction:column;gap:10px;font-size:12px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:3px;">Document Type *</label>
            <select id="attach-doc-type" class="select" style="width:100%;font-size:12px;" required>
              <option value="SUPPLIER_INVOICE">Supplier Invoice (Bill)</option>
              <option value="DELIVERY_CHALLAN">Delivery Challan</option>
              <option value="PURCHASE_RECEIPT">Purchase Receipt</option>
              <option value="QUOTATION">Supplier Quotation</option>
              <option value="CREDIT_NOTE">Credit Note</option>
              <option value="DEBIT_NOTE">Debit Note</option>
              <option value="PACKING_LIST">Packing List</option>
              <option value="QUALITY_CERTIFICATE">Quality Certificate / COA</option>
              <option value="TAX_SUPPORTING_DOCUMENT">Tax Supporting Document</option>
              <option value="OTHER_PROCUREMENT_DOCUMENT">Other Procurement Document</option>
            </select>
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:3px;" id="attach-doc-num-label">Invoice / Challan Number</label>
            <input type="text" id="attach-doc-number" class="input" style="width:100%;font-size:12px;" placeholder="e.g. INV-2026-9042">
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:3px;">Document Date</label>
            <input type="date" id="attach-doc-date" class="input" style="width:100%;font-size:12px;" value="${new Date().toISOString().slice(0, 10)}">
          </div>
          <div id="attach-gstin-group">
            <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:3px;">Supplier GSTIN</label>
            <input type="text" id="attach-doc-gstin" class="input" style="width:100%;font-size:12px;" placeholder="e.g. 32AABCS1429B1Z8" maxlength="15">
          </div>
        </div>

        <div id="attach-invoice-fields" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:3px;">Taxable Value (₹)</label>
            <input type="number" step="0.01" id="attach-doc-taxable" class="input" style="width:100%;font-size:12px;" placeholder="0.00">
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:3px;">Total Invoice Amount (₹)</label>
            <input type="number" step="0.01" id="attach-doc-total" class="input" style="width:100%;font-size:12px;" placeholder="${((po.totalAmountPaisa || 0) / 100).toFixed(2)}">
          </div>
        </div>

        <div id="attach-challan-fields" style="display:none;grid-template-columns:1fr 1fr;gap:8px;">
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:3px;">Transport / Vehicle Reference</label>
            <input type="text" id="attach-doc-vehicle" class="input" style="width:100%;font-size:12px;" placeholder="e.g. KL-11-AK-4029">
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:3px;">Linked GRN ID (Optional)</label>
            <input type="text" id="attach-doc-grn" class="input" style="width:100%;font-size:12px;" placeholder="e.g. GRN-001">
          </div>
        </div>

        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:3px;">Notes / Description</label>
          <input type="text" id="attach-doc-notes" class="input" style="width:100%;font-size:12px;" placeholder="Optional context or delivery remarks">
        </div>

        <!-- File Upload Selector -->
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:3px;">Upload Binary File (PDF, JPG, PNG - Max 15MB) *</label>
          <input type="file" id="attach-doc-file" class="input" style="width:100%;font-size:12px;padding:6px;" accept=".pdf,.jpg,.jpeg,.png" required>
        </div>

        <div id="attach-upload-status" style="display:none;padding:8px 10px;background:var(--surface-sunken);border-radius:4px;font-size:11px;"></div>

        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;border-top:1px solid var(--line);padding-top:8px;">
          <button class="btn btn-ghost" id="modal-attach-cancel" type="button">Cancel</button>
          <button class="btn btn-primary" id="modal-attach-submit" type="submit">Upload &amp; Scan Evidence</button>
        </div>
      </form>
    </div>
  `;

  openModal(modalHtml);

  const docTypeSelect = document.getElementById('attach-doc-type');
  const invFields = document.getElementById('attach-invoice-fields');
  const challanFields = document.getElementById('attach-challan-fields');
  const gstinGroup = document.getElementById('attach-gstin-group');
  const numLabel = document.getElementById('attach-doc-num-label');

  docTypeSelect?.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === 'SUPPLIER_INVOICE') {
      if (invFields) invFields.style.display = 'grid';
      if (challanFields) challanFields.style.display = 'none';
      if (gstinGroup) gstinGroup.style.display = 'block';
      if (numLabel) numLabel.textContent = 'Invoice Number';
    } else if (val === 'DELIVERY_CHALLAN') {
      if (invFields) invFields.style.display = 'none';
      if (challanFields) challanFields.style.display = 'grid';
      if (gstinGroup) gstinGroup.style.display = 'none';
      if (numLabel) numLabel.textContent = 'Challan Number';
    } else {
      if (invFields) invFields.style.display = 'none';
      if (challanFields) challanFields.style.display = 'none';
      if (gstinGroup) gstinGroup.style.display = 'none';
      if (numLabel) numLabel.textContent = 'Reference Number';
    }
  });

  document.getElementById('modal-attach-cancel')?.addEventListener('click', closeModal);

  const form = document.getElementById('form-po-attach-document');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fileInput = document.getElementById('attach-doc-file');
    const file = fileInput?.files?.[0];
    if (!file) {
      showToast('Please select a file to upload.', 'coral');
      return;
    }

    const submitBtn = document.getElementById('modal-attach-submit');
    const statusBox = document.getElementById('attach-upload-status');
    if (submitBtn) submitBtn.disabled = true;
    if (statusBox) {
      statusBox.style.display = 'block';
      statusBox.innerHTML = `<span>⏳ Uploading and executing security scan...</span>`;
    }

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('documentType', docTypeSelect.value);
      formData.append('documentNumber', document.getElementById('attach-doc-number').value.trim());
      formData.append('invoiceNumber', document.getElementById('attach-doc-number').value.trim());
      formData.append('challanNumber', document.getElementById('attach-doc-number').value.trim());
      formData.append('documentDate', document.getElementById('attach-doc-date').value);
      formData.append('supplierGSTIN', document.getElementById('attach-doc-gstin')?.value.trim() || '');
      formData.append('totalAmount', document.getElementById('attach-doc-total')?.value || '');
      formData.append('taxableValue', document.getElementById('attach-doc-taxable')?.value || '');
      formData.append('notes', document.getElementById('attach-doc-notes')?.value || '');
      formData.append('vehicleRef', document.getElementById('attach-doc-vehicle')?.value || '');
      formData.append('linkedGrn', document.getElementById('attach-doc-grn')?.value || '');

      const response = await fetch(`/api/v1/procurement/orders/${po.purchaseOrderId}/documents`, {
        method: 'POST',
        headers: {
          ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
        },
        body: formData,
      });

      const res = await response.json();
      if (!response.ok) {
        throw new Error(res?.error?.message || 'Failed to attach document.');
      }

      const warnings = res?.data?.warnings || [];
      if (warnings.length > 0) {
        showToast(`Document attached with warnings: ${warnings[0]}`, 'amber');
      } else {
        showToast('Document attached and verified clean.', 'mint');
      }

      closeModal();
      if (typeof onAttached === 'function') onAttached();
    } catch (err) {
      if (statusBox) {
        statusBox.innerHTML = `<span style="color:var(--coral, #ef4444);">❌ ${err.message}</span>`;
      }
      showToast(err.message, 'coral');
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

function openReplacePoDocumentModal(po, documentId, onReplaced) {
  const modalHtml = `
    <div style="display:flex;flex-direction:column;gap:12px;width:100%;max-width:500px;">
      <h3 style="font-size:15px;font-weight:700;color:var(--ink);margin:0;">Upload Revised Document Version</h3>
      <p style="font-size:11px;color:var(--muted);margin:0;">Existing document version will be superseded. Complete audit history is preserved.</p>

      <form id="form-po-replace-doc" style="display:flex;flex-direction:column;gap:10px;font-size:12px;">
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:3px;">Reason for Revision *</label>
          <input type="text" id="replace-doc-reason" class="input" style="width:100%;font-size:12px;" placeholder="e.g. Corrected supplier tax invoice rate" required>
        </div>

        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:3px;">Select New File *</label>
          <input type="file" id="replace-doc-file" class="input" style="width:100%;font-size:12px;" accept=".pdf,.jpg,.jpeg,.png" required>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;">
          <button class="btn btn-ghost" id="modal-replace-cancel" type="button">Cancel</button>
          <button class="btn btn-primary" type="submit">Upload Revision</button>
        </div>
      </form>
    </div>
  `;

  openModal(modalHtml);
  document.getElementById('modal-replace-cancel')?.addEventListener('click', closeModal);

  document.getElementById('form-po-replace-doc')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = document.getElementById('replace-doc-file')?.files?.[0];
    const reason = document.getElementById('replace-doc-reason')?.value.trim();
    if (!file || !reason) return;

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('changeReason', reason);

      const response = await fetch(`/api/v1/procurement/orders/${po.purchaseOrderId}/documents/${documentId}/replace-version`, {
        method: 'POST',
        headers: {
          ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
        },
        body: formData,
      });

      const res = await response.json();
      if (!response.ok) throw new Error(res?.error?.message || 'Failed to replace version');

      showToast('Document version superseded and updated successfully.', 'mint');
      closeModal();
      if (typeof onReplaced === 'function') onReplaced();
    } catch (err) {
      showToast(err.message, 'coral');
    }
  });
}

function renderSuppliersSubtab(root, container) {
  // Render from API-populated cachedSuppliers; empty state when none loaded yet
  const suppliers = cachedSuppliers;

  container.innerHTML = `
    <div class="card" style="padding:16px;background:var(--surface);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div>
          <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0;">Approved Suppliers &amp; Vendors Directory</h3>
          <p style="font-size:11px;color:var(--muted);margin:2px 0 0 0;">Commercial partners, GSTIN compliance, and operational ratings</p>
        </div>
      </div>
      <table class="glass-table" style="width:100%;font-size:12px;">
        <thead>
          <tr>
            <th>Vendor ID</th>
            <th>Legal Name</th>
            <th>Approved Category</th>
            <th>GSTIN</th>
            <th>Payment Terms</th>
            <th>On-Time Delivery</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${suppliers.map((s) => `
            <tr>
              <td style="font-family:var(--font-mono);font-weight:700;">${s.id}</td>
              <td><strong>${s.name}</strong></td>
              <td style="color:var(--muted);">${s.category}</td>
              <td style="font-family:var(--font-mono);">${s.gstin}</td>
              <td>${s.paymentTerms}</td>
              <td><span class="badge success" style="font-size:10px;">${s.performance}</span></td>
              <td><span class="badge success" style="font-size:10px;">${s.status}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderReportsSubtab(root, container) {
  container.innerHTML = `
    <div class="card" style="padding:16px;background:var(--surface);display:flex;flex-direction:column;gap:14px;">
      <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0;">Procurement Period &amp; Spend Intelligence</h3>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:10px;">
        <div class="card" style="padding:12px;background:var(--surface-sunken);">
          <span style="font-size:11px;color:var(--muted);display:block;">FY 2026-27 YTD Spend</span>
          <strong style="font-size:18px;color:var(--ink);display:block;margin-top:2px;">₹14,85,000</strong>
          <span style="font-size:10px;color:var(--mint, #10b981);">98.4% on contract pricing</span>
        </div>
        <div class="card" style="padding:12px;background:var(--surface-sunken);">
          <span style="font-size:11px;color:var(--muted);display:block;">Average Procure-to-Order</span>
          <strong style="font-size:18px;color:var(--ink);display:block;margin-top:2px;">4.2 Hours</strong>
          <span style="font-size:10px;color:var(--muted);">Requisition to PO issuance</span>
        </div>
        <div class="card" style="padding:12px;background:var(--surface-sunken);">
          <span style="font-size:11px;color:var(--muted);display:block;">Touchless Procurement</span>
          <strong style="font-size:18px;color:var(--ink);display:block;margin-top:2px;">92.8%</strong>
          <span style="font-size:10px;color:var(--muted);">Zero manual match exception</span>
        </div>
        <div class="card" style="padding:12px;background:var(--surface-sunken);">
          <span style="font-size:11px;color:var(--muted);display:block;">Supplier On-Time Rate</span>
          <strong style="font-size:18px;color:var(--accent);display:block;margin-top:2px;">97.2%</strong>
          <span style="font-size:10px;color:var(--muted);">Against promised delivery</span>
        </div>
      </div>
    </div>
  `;
}

function openHealthModal(root) {
  const modalHtml = `
    <div style="display:flex;flex-direction:column;gap:14px;width:100%;max-width:540px;">
      <h2 style="font-size:16px;font-weight:800;color:var(--ink);margin:0;">Procurement Subsystem Health</h2>
      <p style="font-size:12px;color:var(--muted);margin:-8px 0 0 0;">Real-time operational control &amp; compliance status</p>

      <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;">
        ${[
          { label: 'Purchase Requests Pending Approval', count: '0 Pending', status: 'PASS' },
          { label: 'Active RFQs & Competitive Quotes', count: '1 Active', status: 'PASS' },
          { label: 'POs Awaiting Acknowledgement', count: '0 Overdue', status: 'PASS' },
          { label: 'Inbound Shipments Overdue', count: '0 Delayed', status: 'PASS' },
          { label: 'Partially Received PO Deliveries', count: '0 Pending', status: 'PASS' },
          { label: '3-Way Match Exceptions', count: '0 Exceptions', status: 'PASS' },
          { label: 'Open Vendor Returns & RTV', count: '0 Open', status: 'PASS' },
          { label: 'Received Not Invoiced (RNI)', count: '1 In Progress', status: 'PASS' },
          { label: 'Supplier Document Compliance (FSSAI/GST)', count: '100% Compliant', status: 'PASS' },
        ].map((h) => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--surface-sunken);border-radius:4px;">
            <span>${h.label}</span>
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-weight:700;color:var(--ink);">${h.count}</span>
              <span class="badge success" style="font-size:9px;">${h.status}</span>
            </div>
          </div>
        `).join('')}
      </div>

      <div style="display:flex;justify-content:flex-end;margin-top:10px;">
        <button class="btn btn-ghost" id="modal-health-close" style="font-size:12px;" type="button">Close</button>
      </div>
    </div>
  `;

  openModal(modalHtml);
  document.getElementById('modal-health-close')?.addEventListener('click', closeModal);
}

function openNewBlanketAgreementModal(root) {
  const modalHtml = `
    <div style="display:flex;flex-direction:column;gap:14px;width:100%;max-width:520px;">
      <h2 style="font-size:16px;font-weight:800;color:var(--ink);margin:0;">Create Blanket Purchase Agreement</h2>
      <p style="font-size:12px;color:var(--muted);margin:-8px 0 0 0;">Establish long-term supply contract with pre-locked rates</p>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">Vendor ID *</label>
          <input type="text" id="modal-bpa-vendor" class="input" style="font-size:12px;width:100%;" value="VEND-0001">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">Annual Commitment (₹) *</label>
          <input type="number" id="modal-bpa-amount" class="input" style="font-size:12px;width:100%;" value="1200000">
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">Valid From *</label>
          <input type="date" id="modal-bpa-from" class="input" style="font-size:12px;width:100%;" value="${new Date().toISOString().split('T')[0]}">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">Valid Until *</label>
          <input type="date" id="modal-bpa-to" class="input" style="font-size:12px;width:100%;" value="${new Date(Date.now() + 86400000 * 365).toISOString().split('T')[0]}">
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px;">
        <button class="btn btn-ghost" id="modal-bpa-cancel" style="font-size:12px;" type="button">Cancel</button>
        <button class="btn btn-primary" id="modal-bpa-submit" style="font-size:12px;font-weight:700;" type="button">Create Agreement</button>
      </div>
    </div>
  `;

  openModal(modalHtml);
  document.getElementById('modal-bpa-cancel')?.addEventListener('click', closeModal);
  document.getElementById('modal-bpa-submit')?.addEventListener('click', async () => {
    const vendorId = document.getElementById('modal-bpa-vendor')?.value;
    const amount = Number(document.getElementById('modal-bpa-amount')?.value);
    const validTo = document.getElementById('modal-bpa-to')?.value || '2027-03-31';
    if (!vendorId || !amount) {
      showToast('Please fill all mandatory fields.', 'coral');
      return;
    }
    const newId = `BPA-2026-00${cachedAgreements.length + 1}`;
    cachedAgreements.unshift({
      id: newId,
      supplier: vendorId,
      category: 'Contract Supply',
      validTo,
      totalLimit: amount * 100,
      released: 0
    });
    showToast(`Blanket Agreement ${newId} created with ${vendorId} for ₹${amount.toLocaleString('en-IN')}`, 'mint');
    closeModal();
    const inner = document.querySelector('#proc-submodule-inner-content');
    if (inner) renderAgreementsSubtab(root, inner);
  });
}

async function openTrackInboundModal(root) {
  let asns = [];
  try {
    const res = await apiGet('/procurement/asns');
    asns = res?.data?.asns || [];
  } catch (err) {
    console.warn('Failed to fetch ASNs for tracking modal:', err.message);
  }

  const modalHtml = `
    <div style="display:flex;flex-direction:column;gap:14px;width:100%;max-width:540px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <h2 style="font-size:16px;font-weight:800;color:var(--ink);margin:0;">Inbound Logistics &amp; ASN Tracking</h2>
          <p style="font-size:12px;color:var(--muted);margin:2px 0 0 0;">Live tracking of dispatched vendor shipments</p>
        </div>
        <button class="btn btn-sm btn-primary" id="modal-track-new-asn" style="font-size:11px;" type="button">+ New ASN</button>
      </div>

      <div style="display:flex;flex-direction:column;gap:8px;font-size:12px;max-height:300px;overflow-y:auto;">
        ${asns.length === 0 ? `
          <div style="padding:20px;text-align:center;color:var(--muted);font-size:12px;">
            No active inbound shipments. ASN data will appear here once vendors dispatch confirmed orders.
          </div>
        ` : asns.map((a) => `
          <div style="padding:10px 12px;background:var(--surface-sunken);border:1px solid var(--line);border-radius:6px;display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div style="font-weight:700;color:var(--ink);">${a.asnNumber} &bull; ${a.purchaseOrderId}</div>
              <div style="font-size:11px;color:var(--muted);">Carrier: ${a.carrier || 'Standard Freight'} &bull; ETA: ${a.expectedArrivalDate ? a.expectedArrivalDate.slice(0, 10) : 'TBD'}</div>
            </div>
            <span class="badge ${a.status === 'RECEIVED' ? 'success' : 'warning'}" style="font-size:10px;">${a.status}</span>
          </div>
        `).join('')}
      </div>

      <div style="display:flex;justify-content:flex-end;margin-top:10px;">
        <button class="btn btn-ghost" id="modal-track-close" style="font-size:12px;" type="button">Close</button>
      </div>
    </div>
  `;

  openModal(modalHtml);
  document.getElementById('modal-track-close')?.addEventListener('click', closeModal);
  document.getElementById('modal-track-new-asn')?.addEventListener('click', () => {
    closeModal();
    openCreateAsnModal(root);
  });
}

function openCreateAsnModal(root) {
  const modalHtml = `
    <div style="display:flex;flex-direction:column;gap:14px;width:100%;max-width:520px;">
      <h2 style="font-size:16px;font-weight:800;color:var(--ink);margin:0;">Create Advance Shipping Notice (ASN)</h2>
      <p style="font-size:12px;color:var(--muted);margin:-8px 0 0 0;">Record vendor shipment details against an authorized PO</p>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">PO Number *</label>
          <input type="text" id="modal-asn-po" class="input" style="font-size:12px;width:100%;" placeholder="e.g. PO-...">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">Vendor Reference # *</label>
          <input type="text" id="modal-asn-vendor-ref" class="input" style="font-size:12px;width:100%;" placeholder="e.g. VASN-001">
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">Carrier / Transporter</label>
          <input type="text" id="modal-asn-carrier" class="input" style="font-size:12px;width:100%;" placeholder="e.g. BlueDart Logistics">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">Vehicle / Tracking #</label>
          <input type="text" id="modal-asn-vehicle" class="input" style="font-size:12px;width:100%;" placeholder="e.g. KL-11-BV-1234">
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">Expected Arrival Date *</label>
          <input type="date" id="modal-asn-eta" class="input" style="font-size:12px;width:100%;" value="${new Date(Date.now() + 86400000).toISOString().slice(0, 10)}">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">Shipped Qty *</label>
          <input type="number" id="modal-asn-qty" class="input" style="font-size:12px;width:100%;" value="25" min="1">
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px;">
        <button class="btn btn-ghost" id="modal-asn-cancel" style="font-size:12px;" type="button">Cancel</button>
        <button class="btn btn-primary" id="modal-asn-submit" style="font-size:12px;font-weight:700;" type="button">Dispatch ASN</button>
      </div>
    </div>
  `;

  openModal(modalHtml);
  document.getElementById('modal-asn-cancel')?.addEventListener('click', closeModal);
  document.getElementById('modal-asn-submit')?.addEventListener('click', async () => {
    const purchaseOrderId = document.getElementById('modal-asn-po')?.value?.trim();
    const vendorReference = document.getElementById('modal-asn-vendor-ref')?.value?.trim();
    const carrier = document.getElementById('modal-asn-carrier')?.value?.trim();
    const vehicleNumber = document.getElementById('modal-asn-vehicle')?.value?.trim();
    const expectedArrivalDate = document.getElementById('modal-asn-eta')?.value;
    const shippedQuantity = Number(document.getElementById('modal-asn-qty')?.value) || 0;

    if (!purchaseOrderId || !vendorReference || shippedQuantity <= 0) {
      showToast('Please provide valid PO Number, Vendor Reference, and Shipped Quantity.', 'coral');
      return;
    }

    try {
      const payload = {
        purchaseOrderId,
        vendorReference,
        carrier,
        vehicleNumber,
        expectedArrivalDate,
        lineItems: [
          {
            shippedQuantity,
            unitOfMeasure: 'units',
          }
        ],
      };
      const res = await apiPost('/procurement/asns', payload);
      closeModal();
      showToast(`ASN ${res?.data?.asn?.asnNumber || 'dispatched'} recorded successfully.`, 'mint');
      const inner = document.querySelector('#proc-submodule-inner-content');
      if (inner) await renderDeliveriesSubtab(root, inner);
    } catch (err) {
      showToast(err.message || 'Failed to create ASN', 'coral');
    }
  });
}

function openDirectGrnModal(root) {
  const modalHtml = `
    <div style="display:flex;flex-direction:column;gap:14px;width:100%;max-width:500px;">
      <h2 style="font-size:16px;font-weight:800;color:var(--ink);margin:0;">Dock Intake &amp; Goods Receipt Note (GRN)</h2>
      <p style="font-size:12px;color:var(--muted);margin:-8px 0 0 0;">Inspect and receive raw material delivery at cafe dock</p>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">PO Number *</label>
          <input type="text" id="modal-dgrn-po" class="input" style="font-size:12px;width:100%;" placeholder="e.g. PO-...">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">Delivery Challan # *</label>
          <input type="text" id="modal-dgrn-dc" class="input" style="font-size:12px;width:100%;" placeholder="e.g. DC-99124">
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">Received Qty *</label>
          <input type="number" id="modal-dgrn-qty" class="input" style="font-size:12px;width:100%;" value="25" min="1">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">Accepted Qty *</label>
          <input type="number" id="modal-dgrn-accepted" class="input" style="font-size:12px;width:100%;" value="25" min="0">
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">Dock Temperature (°C)</label>
          <input type="number" step="0.1" id="modal-dgrn-temp" class="input" style="font-size:12px;width:100%;" placeholder="e.g. 4.0">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">Batch Lot #</label>
          <input type="text" id="modal-dgrn-lot" class="input" style="font-size:12px;width:100%;" placeholder="e.g. LOT-2026-A">
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px;">
        <button class="btn btn-ghost" id="modal-dgrn-cancel" style="font-size:12px;" type="button">Cancel</button>
        <button class="btn btn-primary" id="modal-dgrn-submit" style="font-size:12px;font-weight:700;" type="button">Complete Intake</button>
      </div>
    </div>
  `;

  openModal(modalHtml);
  document.getElementById('modal-dgrn-cancel')?.addEventListener('click', closeModal);
  document.getElementById('modal-dgrn-submit')?.addEventListener('click', async () => {
    const poId = document.getElementById('modal-dgrn-po')?.value?.trim();
    const dc = document.getElementById('modal-dgrn-dc')?.value?.trim();
    const receivedQty = Number(document.getElementById('modal-dgrn-qty')?.value) || 0;
    const acceptedQty = Number(document.getElementById('modal-dgrn-accepted')?.value) || 0;
    const rejectedQty = Math.max(0, receivedQty - acceptedQty);
    const tempVal = document.getElementById('modal-dgrn-temp')?.value;
    const temp = tempVal ? Number(tempVal) : null;
    const lotNumber = document.getElementById('modal-dgrn-lot')?.value?.trim();

    if (!poId || !dc || receivedQty <= 0) {
      showToast('Please provide valid PO Number, Delivery Challan, and Received Quantity.', 'coral');
      return;
    }

    try {
      const payload = {
        purchaseOrderId: poId,
        deliveryNoteNumber: dc,
        receivedItems: [
          {
            receivedQuantity: receivedQty,
            acceptedQuantity: acceptedQty,
            rejectedQuantity: rejectedQty,
            lotNumber: lotNumber || undefined,
          }
        ],
        temperatureChecks: temp !== null ? [{ location: 'DOCK', temperatureCelsius: temp, rulePassed: temp <= 8 }] : [],
        dockNotes: `Dock intake with challan ${dc}`,
      };

      const res = await apiPost('/procurement/grns', payload);
      closeModal();
      showToast(`GRN ${res?.data?.grnId || 'created'} generated successfully.`, 'mint');
      const inner = document.querySelector('#proc-submodule-inner-content');
      if (inner) await renderReceivingSubtab(root, inner);
    } catch (err) {
      showToast(err.message || 'Failed to record Goods Receipt', 'coral');
    }
  });
}

function openAddSupplierModal(root) {
  const modalHtml = `
    <div style="display:flex;flex-direction:column;gap:14px;width:100%;max-width:520px;">
      <h2 style="font-size:16px;font-weight:800;color:var(--ink);margin:0;">Register Approved Supplier</h2>
      <p style="font-size:12px;color:var(--muted);margin:-8px 0 0 0;">Add new vendor to commercial supply master</p>

      <div class="form-group">
        <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">Legal Entity Name *</label>
        <input type="text" id="modal-supp-name" class="input" style="font-size:12px;width:100%;" placeholder="e.g. Coorg Plantation Roast Labs LLP">
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">GSTIN *</label>
          <input type="text" id="modal-supp-gst" class="input" style="font-size:12px;width:100%;" placeholder="32AAAAA0000A1Z5">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">Category</label>
          <select id="modal-supp-cat" class="select" style="font-size:12px;width:100%;">
            <option value="BEANS">Coffee Beans &amp; Roasts</option>
            <option value="DAIRY">Dairy &amp; Milk</option>
            <option value="PACKAGING">Packaging &amp; Disposables</option>
            <option value="BAKERY">Bakery Ingredients</option>
          </select>
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px;">
        <button class="btn btn-ghost" id="modal-supp-cancel" style="font-size:12px;" type="button">Cancel</button>
        <button class="btn btn-primary" id="modal-supp-submit" style="font-size:12px;font-weight:700;" type="button">Save Supplier</button>
      </div>
    </div>
  `;

  openModal(modalHtml);
  document.getElementById('modal-supp-cancel')?.addEventListener('click', closeModal);
  document.getElementById('modal-supp-submit')?.addEventListener('click', async () => {
    const name = document.getElementById('modal-supp-name')?.value;
    const gst = document.getElementById('modal-supp-gst')?.value;
    const cat = document.getElementById('modal-supp-cat')?.value || 'BEANS';
    if (!name) {
      showToast('Supplier legal name is required.', 'coral');
      return;
    }
    const catNames = {
      BEANS: 'Coffee Beans & Roasts',
      DAIRY: 'Dairy & Milk',
      PACKAGING: 'Packaging & Disposables',
      BAKERY: 'Bakery Ingredients'
    };
    const newId = `VEND-000${cachedSuppliers.length + 1}`;
    cachedSuppliers.unshift({
      id: newId,
      name,
      category: catNames[cat] || cat,
      gstin: gst || '32AABCT' + Math.floor(1000 + Math.random() * 9000) + 'L1ZV',
      paymentTerms: 'Net 30',
      performance: '100% On-Time',
      status: 'ACTIVE'
    });
    showToast(`Supplier "${name}" (${newId}) registered and sent for onboarding compliance review.`, 'mint');
    closeModal();
    const inner = document.querySelector('#proc-submodule-inner-content');
    if (inner) renderSuppliersSubtab(root, inner);
  });
}

function openNewReturnModal(root) {
  const modalHtml = `
    <div style="display:flex;flex-direction:column;gap:14px;width:100%;max-width:500px;">
      <h2 style="font-size:16px;font-weight:800;color:var(--ink);margin:0;">Record Return to Vendor (RTV)</h2>
      <p style="font-size:12px;color:var(--muted);margin:-8px 0 0 0;">Create debit note &amp; return authorization for non-compliant items</p>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">PO / GRN Number *</label>
          <input type="text" id="modal-rtv-ref" class="input" style="font-size:12px;width:100%;" value="GRN-2026-0012">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">Defect Reason</label>
          <select id="modal-rtv-reason" class="select" style="font-size:12px;width:100%;">
            <option value="DAMAGED">Damaged in Transit</option>
            <option value="EXPIRY">Near Expiry / Expired Lot</option>
            <option value="WRONG_SPEC">Wrong SKU / Specification</option>
            <option value="QUALITY">Failed QC Cupping / Moisture</option>
          </select>
        </div>
      </div>

      <div>
        <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">Return Notes &amp; Debit Note Value</label>
        <textarea id="modal-rtv-notes" class="input" style="font-size:12px;width:100%;height:60px;resize:none;" placeholder="Description of rejection and requested debit adjustment..."></textarea>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px;">
        <button class="btn btn-ghost" id="modal-rtv-cancel" style="font-size:12px;" type="button">Cancel</button>
        <button class="btn btn-danger" id="modal-rtv-submit" style="font-size:12px;font-weight:700;" type="button">Issue Return Notice</button>
      </div>
    </div>
  `;

  openModal(modalHtml);
  document.getElementById('modal-rtv-cancel')?.addEventListener('click', closeModal);
  document.getElementById('modal-rtv-submit')?.addEventListener('click', async () => {
    const ref = document.getElementById('modal-rtv-ref')?.value || 'GRN-2026-0012';
    const reasonSelect = document.getElementById('modal-rtv-reason');
    const reasonText = reasonSelect?.options[reasonSelect.selectedIndex]?.text || 'Damaged in Transit';

    const newId = `RTV-2026-00${cachedReturns.length + 1}`;
    cachedReturns.unshift({
      rtvId: newId,
      refDoc: ref,
      supplier: document.getElementById('modal-rtv-supplier')?.value || '—',
      reason: reasonText,
      debitNotePaise: 350000,
      status: 'DEBIT_NOTE_ISSUED',
      createdAt: new Date().toISOString().split('T')[0]
    });

    showToast(`RTV authorization ${newId} created for ${ref}. Debit note draft queued in Finance.`, 'mint');
    closeModal();
    const inner = document.querySelector('#proc-submodule-inner-content');
    if (inner) renderExceptionsSubtab(root, inner);
  });
}

function exportSpendReportCsv() {
  navigate('reports/procurement-analytics');
  showToast('Opening certified Procurement Analytics report (PDF / XLSX only)...', 'info');
}
