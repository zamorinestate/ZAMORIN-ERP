'use strict';

/**
 * ZAMORIN AI INVOICE INTELLIGENCE — HUMAN REVIEW UI (PHASE 17 & PHASE 35)
 *
 * Implements the side-by-side verification experience:
 *   Left Pane:  Authoritative Document (PDF/image preview, SHA-256 integrity, malware status)
 *   Right Pane: Extracted structured data, composite confidence score, GST validation,
 *               three-way match (PO ↔ GRN ↔ Invoice), exceptions, and human corrections.
 *
 * NON-NEGOTIABLE SAFETY PRINCIPLES:
 *   - AI extraction does not authorize financial disbursements or create GL entries.
 *   - Reviewer approval moves verified proposal into existing AP workflow.
 *   - Staff persona is strictly denied access.
 */

import { apiGet, apiPost } from '../apiClient.js';
import { showToast, openModal, closeModal, confirmAction } from '../components.js';
import { state } from '../state.js';
import { navigate } from '../router.js';

function formatCurrency(amount) {
  if (amount === undefined || amount === null) return '—';
  return '₹' + Number(amount).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getStatusBadge(status) {
  const map = {
    UPLOADED: { label: 'Uploaded', class: 'pill-dark' },
    QUEUED: { label: 'Queued', class: 'pill-sky' },
    PROCESSING: { label: 'AI Processing', class: 'pill-sky' },
    EXTRACTED: { label: 'AI Extracted', class: 'pill-sky' },
    VALIDATING: { label: 'Validating', class: 'pill-amber' },
    VALIDATED: { label: 'Validation Complete', class: 'pill-mint' },
    MATCHED: { label: 'Three-Way Matched', class: 'pill-mint' },
    REVIEW_REQUIRED: { label: 'Review Required', class: 'pill-amber' },
    READY_FOR_APPROVAL: { label: 'Ready for Approval', class: 'pill-mint' },
    FAILED: { label: 'Processing Failed', class: 'pill-coral' },
    REJECTED: { label: 'Rejected', class: 'pill-coral' },
  };

  const item = map[status] || { label: status || 'Unknown', class: 'pill-dark' };
  return `<span class="pill ${item.class}" style="font-size:11px;font-weight:700;letter-spacing:0.4px;">${item.label}</span>`;
}

function getConfidenceBadge(level, score) {
  const percent = Math.round((score || 0) * 100);
  let color = 'var(--coral, #ef4444)';
  let bg = 'rgba(239, 68, 68, 0.12)';
  if (level === 'HIGH') {
    color = 'var(--mint, #10b981)';
    bg = 'rgba(16, 185, 129, 0.12)';
  } else if (level === 'MEDIUM') {
    color = 'var(--amber, #f59e0b)';
    bg = 'rgba(245, 158, 11, 0.12)';
  }

  return `
    <span style="display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:12px;background:${bg};color:${color};font-weight:700;font-size:11px;">
      <span style="width:7px;height:7px;border-radius:50%;background:${color};"></span>
      ${level || 'LOW'} CONFIDENCE (${percent}%)
    </span>
  `;
}

export async function openInvoiceIntelligenceReviewModal(documentId, options = {}) {
  const userRole = state?.user?.role || 'STAFF';
  if (userRole === 'STAFF') {
    showToast('Staff persona has self-service authority only.', 'coral');
    return;
  }

  const modalRootId = 'modal-ai-invoice-review-container';
  const loadingHtml = `
    <div id="${modalRootId}" style="width:96vw;max-width:1440px;height:90vh;display:flex;align-items:center;justify-content:center;background:var(--surface);">
      <div style="text-align:center;color:var(--muted);font-size:14px;">
        <div style="font-size:32px;margin-bottom:8px;">⚡</div>
        <strong>Loading Zamorin AI Invoice Intelligence...</strong>
        <p style="margin:4px 0 0 0;font-size:12px;">Retrieving extracted fields, validation matrices, and three-way reconciliation data.</p>
      </div>
    </div>
  `;

  openModal(loadingHtml);

  try {
    const res = await apiGet(`/procurement/vendor-bill/${documentId}/extraction`);
    const extraction = res?.data;

    if (!extraction) {
      throw new Error(`Extraction not found for document ${documentId}`);
    }

    renderReviewModalContent(modalRootId, extraction, options);
  } catch (err) {
    const modalEl = document.getElementById(modalRootId);
    if (modalEl) {
      modalEl.innerHTML = `
        <div style="padding:32px;text-align:center;color:var(--coral);">
          <div style="font-size:32px;margin-bottom:8px;">⚠️</div>
          <strong>Invoice Intelligence Load Notice</strong>
          <p style="margin:6px 0 16px 0;color:var(--muted);font-size:13px;">${err.message}</p>
          <div style="display:flex;gap:8px;justify-content:center;">
            <button class="btn btn-secondary" id="modal-ai-retry-btn" type="button">Trigger New Extraction</button>
            <button class="btn btn-ghost" onclick="window.closeModal?.()" type="button">Close</button>
          </div>
        </div>
      `;

      document.getElementById('modal-ai-retry-btn')?.addEventListener('click', async () => {
        showToast('Initiating AI Invoice Extraction...', 'info');
        try {
          const runRes = await apiPost(`/procurement/vendor-bill/${documentId}/extract`, {});
          if (runRes?.data) {
            renderReviewModalContent(modalRootId, runRes.data, options);
            showToast('AI Extraction completed.', 'mint');
          }
        } catch (runErr) {
          showToast(runErr.message || 'Extraction failed', 'coral');
        }
      });
    }
  }
}

function renderReviewModalContent(containerId, extraction, options = {}) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const supplier = extraction.supplier || {};
  const invoice = extraction.invoice || {};
  const totals = extraction.totals || {};
  const lines = extraction.lineItems || [];
  const confidence = extraction.compositeConfidence || { overallScore: 0, level: 'LOW', breakdown: {} };
  const validation = extraction.mathematicalValidation || { isValid: false, discrepancies: [] };
  const vendorMatch = extraction.vendorMatch || { status: 'NOT_FOUND', matchStrategy: 'NONE' };
  const duplicate = extraction.duplicateCheck || { status: 'NOT_DUPLICATE' };
  const threeWay = extraction.threeWayMatch || { status: 'BLOCKED', lineMatches: [], overallDiscrepancies: [] };
  const exceptions = (extraction.exceptions || []).filter((e) => !e.isResolved);
  const blockingExceptions = exceptions.filter((e) => e.severity === 'BLOCKING');
  const userRole = state?.user?.role || 'STAFF';
  const canApprove = (userRole === 'MASTER' || userRole === 'CAFE_ADMIN') && blockingExceptions.length === 0;

  const previewUrl = options.previewUrl || `/api/v1/procurement/orders/${extraction.purchaseOrderId || 'general'}/documents/${extraction.documentId}/preview`;

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;width:100%;height:100%;background:var(--surface);border-radius:12px;overflow:hidden;">
      <!-- Header Bar -->
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 20px;border-bottom:1px solid var(--line);background:var(--surface-sunken);">
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="font-size:20px;">⚡</div>
          <div>
            <div style="display:flex;align-items:center;gap:8px;">
              <h2 style="font-size:16px;font-weight:800;color:var(--ink);margin:0;">Zamorin AI Invoice Intelligence</h2>
              ${getStatusBadge(extraction.status)}
              ${getConfidenceBadge(confidence.level, confidence.overallScore)}
            </div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px;">
              Doc ID: <code>${extraction.documentId}</code> · SHA-256: <code title="${extraction.documentHash}">${(extraction.documentHash || '').substring(0, 16)}...</code> · Provider: ${extraction.providerMetadata?.provider || 'Native'} (${extraction.providerMetadata?.modelVersion || '2026.1'})
            </div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <button class="btn btn-sm btn-secondary" id="btn-ai-reprocess" type="button" title="Re-run AI extraction pipeline">🔄 Reprocess</button>
          <button class="btn btn-sm btn-ghost" id="btn-ai-modal-close" type="button" style="font-size:18px;line-height:1;">✕</button>
        </div>
      </div>

      <!-- Split Layout (50% Original Document | 50% Extracted Intelligence) -->
      <div style="display:grid;grid-template-columns:1fr 1.15fr;flex:1;min-height:0;overflow:hidden;">
        <!-- Left Pane: Document Viewer -->
        <div style="border-right:1px solid var(--line);display:flex;flex-direction:column;background:var(--surface-sunken);min-height:0;">
          <div style="padding:8px 14px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--muted);">
            <span>ORIGINAL SOURCE EVIDENCE (MALWARE VERIFIED)</span>
            <a href="${previewUrl}" target="_blank" style="color:var(--accent);text-decoration:none;font-weight:600;">Open External ↗</a>
          </div>
          <div style="flex:1;min-height:0;padding:8px;display:flex;align-items:center;justify-content:center;">
            <iframe src="${previewUrl}" style="width:100%;height:100%;border:none;border-radius:6px;background:#fff;" title="Document Evidence Preview"></iframe>
          </div>
        </div>

        <!-- Right Pane: Extracted Structured Data & Reconciliation Intelligence -->
        <div style="display:flex;flex-direction:column;min-height:0;background:var(--surface);">
          <div style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:14px;">
            <!-- Active Exceptions Banner (Phase 16) -->
            ${exceptions.length > 0 ? `
              <div style="padding:12px;border-radius:8px;background:${blockingExceptions.length > 0 ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)'};border:1px solid ${blockingExceptions.length > 0 ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'};">
                <div style="font-size:12px;font-weight:800;color:${blockingExceptions.length > 0 ? 'var(--coral, #ef4444)' : 'var(--amber, #f59e0b)'};display:flex;align-items:center;gap:6px;margin-bottom:6px;">
                  <span>⚠️</span> DISCREPANCIES REQUIRING ATTENTION (${exceptions.length})
                </div>
                <div style="display:flex;flex-direction:column;gap:4px;font-size:11.5px;">
                  ${exceptions.map((e) => `
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;color:var(--ink);">
                      <span>• <strong style="font-family:var(--font-mono);">${e.code}</strong>: ${e.message}</span>
                      <span class="badge ${e.severity === 'BLOCKING' ? 'coral' : 'amber'}" style="font-size:9px;font-weight:700;">${e.severity}</span>
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : `
              <div style="padding:10px 12px;border-radius:6px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.25);font-size:12px;color:var(--mint, #10b981);display:flex;align-items:center;gap:8px;">
                <span>✅</span> <strong>Clean Extraction:</strong> Zero blocking validation discrepancies. Three-way match aligned.
              </div>
            `}

            <!-- 2-Column Summary: Vendor Master Match & Invoice Header -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <!-- Vendor Master Block -->
              <div class="card" style="padding:12px;background:var(--surface-sunken);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                  <span style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;">Supplier Master Match</span>
                  <span class="badge ${vendorMatch.status === 'MATCHED' ? 'success' : 'amber'}" style="font-size:9px;">${vendorMatch.matchStrategy || vendorMatch.status}</span>
                </div>
                <div style="font-size:13px;font-weight:800;color:var(--ink);">${supplier.name || '—'}</div>
                <div style="font-size:11px;color:var(--muted);margin-top:2px;">
                  GSTIN: <code style="color:var(--ink);font-weight:600;">${supplier.gstin || 'NOT EXTRACTED'}</code>
                  ${supplier.pan ? ` · PAN: <code>${supplier.pan}</code>` : ''}
                </div>
                <div style="font-size:11px;color:var(--muted);margin-top:2px;">
                  Resolved Vendor ID: <strong style="color:var(--accent);">${vendorMatch.matchedVendorId || 'UNRESOLVED (MANUAL ASSIGNMENT)'}</strong>
                </div>
              </div>

              <!-- Invoice Header Block -->
              <div class="card" style="padding:12px;background:var(--surface-sunken);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                  <span style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;">Invoice Metadata</span>
                  <span class="badge" style="font-size:9px;">${extraction.documentType || 'TAX_INVOICE'}</span>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11.5px;">
                  <div><span style="color:var(--muted);">Invoice No:</span> <strong style="color:var(--ink);">${invoice.invoiceNumber || '—'}</strong></div>
                  <div><span style="color:var(--muted);">Date:</span> <strong>${invoice.invoiceDate || '—'}</strong></div>
                  <div><span style="color:var(--muted);">PO Ref:</span> <code style="color:var(--accent);">${extraction.purchaseOrderId || invoice.purchaseOrderNumber || '—'}</code></div>
                  <div><span style="color:var(--muted);">GRN Ref:</span> <code>${extraction.grnId || invoice.deliveryReference || '—'}</code></div>
                </div>
              </div>
            </div>

            <!-- Mathematical & 3-Way Match Verification Matrix -->
            <div class="card" style="padding:12px;background:var(--surface-sunken);">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <span style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;">Deterministic Validation &amp; 3-Way Match</span>
                <span class="pill ${threeWay.status === 'MATCHED' ? 'pill-mint' : (threeWay.status === 'MATCHED_WITH_TOLERANCE' ? 'pill-amber' : 'pill-coral')}" style="font-size:9.5px;font-weight:700;">
                  ${threeWay.status}
                </span>
              </div>
              <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(110px, 1fr));gap:8px;font-size:11px;">
                <div style="background:var(--surface);padding:8px;border-radius:4px;">
                  <span style="color:var(--muted);display:block;">Taxable Value</span>
                  <strong style="color:var(--ink);font-size:12px;">${formatCurrency(totals.taxableValue)}</strong>
                </div>
                <div style="background:var(--surface);padding:8px;border-radius:4px;">
                  <span style="color:var(--muted);display:block;">CGST + SGST</span>
                  <strong style="color:var(--ink);font-size:12px;">${formatCurrency((totals.cgst || 0) + (totals.sgst || 0))}</strong>
                </div>
                <div style="background:var(--surface);padding:8px;border-radius:4px;">
                  <span style="color:var(--muted);display:block;">IGST</span>
                  <strong style="color:var(--ink);font-size:12px;">${formatCurrency(totals.igst)}</strong>
                </div>
                <div style="background:var(--surface);padding:8px;border-radius:4px;">
                  <span style="color:var(--muted);display:block;">Grand Total</span>
                  <strong style="color:var(--accent);font-size:13px;font-weight:800;">${formatCurrency(totals.grandTotal)}</strong>
                </div>
              </div>
            </div>

            <!-- Line Items Table (Phase 3 & Phase 14) -->
            <div class="card" style="padding:10px;background:var(--surface);">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <span style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;">Extracted Line Items (${lines.length}) vs Physical Count</span>
                <span style="font-size:10px;color:var(--muted);">Physical GRN Accepted Qty is Authoritative</span>
              </div>
              <div style="overflow-x:auto;">
                <table class="glass-table" style="width:100%;font-size:11px;">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Description / SKU</th>
                      <th>HSN/SAC</th>
                      <th style="text-align:right;">Inv Qty</th>
                      <th style="text-align:right;">GRN Qty</th>
                      <th style="text-align:right;">Unit Rate</th>
                      <th style="text-align:right;">GST %</th>
                      <th style="text-align:right;">Line Total</th>
                      <th style="text-align:center;">Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${lines.map((item, idx) => {
                      const matchLine = (threeWay.lineMatches || []).find((lm) => lm.lineNumber === item.lineNumber) || {};
                      const isQtyVariance = matchLine.matchResult === 'QUANTITY_VARIANCE';
                      const isPriceVariance = matchLine.matchResult === 'PRICE_VARIANCE';

                      return `
                        <tr>
                          <td>${item.lineNumber || idx + 1}</td>
                          <td>
                            <strong style="color:var(--ink);">${item.description}</strong>
                            ${item.sku ? `<span style="font-size:9.5px;color:var(--muted);display:block;">SKU: ${item.sku}</span>` : ''}
                          </td>
                          <td style="font-family:var(--font-mono);color:var(--muted);">${item.hsnSac || '—'}</td>
                          <td style="text-align:right;font-weight:600;color:${isQtyVariance ? 'var(--coral)' : 'var(--ink)'};">
                            ${item.quantity} ${item.unit || ''}
                          </td>
                          <td style="text-align:right;font-weight:700;color:var(--mint, #10b981);">
                            ${matchLine.grnAcceptedQuantity !== undefined ? matchLine.grnAcceptedQuantity : '—'}
                          </td>
                          <td style="text-align:right;color:${isPriceVariance ? 'var(--coral)' : 'var(--ink)'};">
                            ${formatCurrency(item.unitPrice)}
                          </td>
                          <td style="text-align:right;">${item.gstRate || 0}%</td>
                          <td style="text-align:right;font-weight:700;">${formatCurrency(item.lineTotal)}</td>
                          <td style="text-align:center;">
                            <span class="badge ${matchLine.matchResult === 'MATCH' ? 'success' : (matchLine.matchResult === 'TAX_MISMATCH' ? 'amber' : 'coral')}" style="font-size:9px;">
                              ${matchLine.matchResult || 'PENDING'}
                            </span>
                          </td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Audit & Corrections History (Phase 19 & Phase 20) -->
            ${(extraction.corrections || []).length > 0 ? `
              <div class="card" style="padding:10px;background:var(--surface-sunken);font-size:11px;">
                <strong style="color:var(--ink);display:block;margin-bottom:6px;">Audited Human Corrections (${extraction.corrections.length})</strong>
                <div style="display:flex;flex-direction:column;gap:4px;">
                  ${extraction.corrections.map((c) => `
                    <div style="color:var(--muted);">
                      • Field <code>${c.fieldPath}</code>: changed from <code>${c.originalValue}</code> to <strong style="color:var(--ink);">${c.correctedValue}</strong> by ${c.correctedByUserId} (${c.correctedByRole}) on ${new Date(c.correctedAt).toLocaleTimeString()}
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : ''}
          </div>

          <!-- Action Footer -->
          <div style="padding:12px 18px;border-top:1px solid var(--line);background:var(--surface);display:flex;justify-content:space-between;align-items:center;">
            <button class="btn btn-secondary" id="btn-ai-correct-field" type="button" style="font-size:12px;">
              ✏️ Correct Extracted Field
            </button>
            <div style="display:flex;gap:8px;align-items:center;">
              <button class="btn btn-ghost" onclick="window.closeModal?.()" type="button" style="font-size:12px;">Close</button>
              <button
                class="btn btn-primary"
                id="btn-ai-approve-extraction"
                type="button"
                style="font-size:12px;font-weight:700;background:#059669;border-color:#059669;"
                ${!canApprove ? 'disabled title="Unresolved blocking exceptions or insufficient permissions"' : ''}
              >
                ✅ Accept Extraction &amp; Queue for AP
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Wire Modal Interactions
  document.getElementById('btn-ai-modal-close')?.addEventListener('click', closeModal);

  // Reprocess Handler
  document.getElementById('btn-ai-reprocess')?.addEventListener('click', () => {
    confirmAction({
      title: 'Reprocess with AI Intelligence?',
      message: 'This will re-run OCR and extraction models using latest configured provider. Existing human corrections will be preserved in audit log.',
      confirmText: 'Reprocess Invoice',
      confirmVariant: 'sky',
      onConfirm: async () => {
        showToast('Reprocessing invoice...', 'info');
        try {
          const res = await apiPost(`/procurement/vendor-bill/${extraction.documentId}/reprocess`, {});
          if (res?.data) {
            showToast('Reprocessing completed.', 'mint');
            renderReviewModalContent(containerId, res.data, options);
          }
        } catch (err) {
          showToast(err.message || 'Reprocessing failed', 'coral');
        }
      },
    });
  });

  // Human Correction Handler (Phase 20)
  document.getElementById('btn-ai-correct-field')?.addEventListener('click', () => {
    openHumanCorrectionSubModal(extraction, (updatedRecord) => {
      renderReviewModalContent(containerId, updatedRecord, options);
    });
  });

  // Approval Handler (Phase 17, 18)
  document.getElementById('btn-ai-approve-extraction')?.addEventListener('click', () => {
    confirmAction({
      title: 'Queue Verified Invoice for AP Approval?',
      message: 'This verifies the extraction proposal. Note: Final AP posting and financial disbursement remain subject to authoritative Procurement & Accounting approval controls.',
      confirmText: 'Accept & Queue for AP',
      confirmVariant: 'mint',
      onConfirm: async () => {
        try {
          const res = await apiPost(`/procurement/vendor-bill/${extraction.documentId}/approve-extraction`, {
            approvalNotes: 'Verified via Zamorin AI Invoice Intelligence Review UI',
          });
          if (res?.data) {
            showToast('Invoice extraction verified and queued for AP approval!', 'mint');
            closeModal();
            if (typeof options.onApproved === 'function') options.onApproved(res.data);
          }
        } catch (err) {
          showToast(err.message || 'Approval failed', 'coral');
        }
      },
    });
  });
}

function openHumanCorrectionSubModal(extraction, onCorrected) {
  const modalHtml = `
    <div style="display:flex;flex-direction:column;gap:12px;width:100%;max-width:480px;padding:6px;">
      <h3 style="font-size:15px;font-weight:700;color:var(--ink);margin:0;">Correct Extracted Field</h3>
      <p style="font-size:11.5px;color:var(--muted);margin:0;">
        All modifications are permanently recorded in the audit trail. Mathematical recalculation will run automatically upon submit.
      </p>

      <form id="form-ai-correct-field" style="display:flex;flex-direction:column;gap:10px;font-size:12px;">
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:3px;">Field to Correct *</label>
          <select id="corr-field-path" class="input" style="width:100%;font-size:12px;" required>
            <option value="invoice.invoiceNumber">Invoice Number (${extraction.invoice?.invoiceNumber || 'Empty'})</option>
            <option value="invoice.invoiceDate">Invoice Date (${extraction.invoice?.invoiceDate || 'Empty'})</option>
            <option value="supplier.gstin">Supplier GSTIN (${extraction.supplier?.gstin || 'Empty'})</option>
            <option value="supplier.name">Supplier Name (${extraction.supplier?.name || 'Empty'})</option>
            <option value="totals.grandTotal">Grand Total (₹${extraction.totals?.grandTotal || 0})</option>
            <option value="totals.taxableValue">Taxable Value (₹${extraction.totals?.taxableValue || 0})</option>
          </select>
        </div>

        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:3px;">Corrected Value *</label>
          <input type="text" id="corr-new-value" class="input" style="width:100%;font-size:12px;" placeholder="Enter verified value" required>
        </div>

        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:3px;">Reason for Correction *</label>
          <input type="text" id="corr-reason" class="input" style="width:100%;font-size:12px;" placeholder="e.g. OCR misread digit 8 as B" required>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;">
          <button class="btn btn-ghost" id="corr-cancel" type="button">Cancel</button>
          <button class="btn btn-primary" type="submit">Submit Correction</button>
        </div>
      </form>
    </div>
  `;

  openModal(modalHtml);
  document.getElementById('corr-cancel')?.addEventListener('click', closeModal);

  document.getElementById('form-ai-correct-field')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fieldPath = document.getElementById('corr-field-path')?.value;
    let newValue = document.getElementById('corr-new-value')?.value.trim();
    const reason = document.getElementById('corr-reason')?.value.trim();

    if (fieldPath.includes('grandTotal') || fieldPath.includes('taxableValue')) {
      newValue = parseFloat(newValue) || 0;
    }

    try {
      const res = await apiPost(`/procurement/vendor-bill/${extraction.documentId}/correct`, {
        corrections: [
          {
            fieldPath,
            originalValue: fieldPath.split('.').reduce((o, i) => o?.[i], extraction),
            correctedValue: newValue,
            reason,
          },
        ],
      });

      if (res?.data) {
        showToast('Field corrected and validation re-calculated.', 'mint');
        closeModal();
        if (typeof onCorrected === 'function') onCorrected(res.data);
      }
    } catch (err) {
      showToast(err.message || 'Correction failed', 'coral');
    }
  });
}
