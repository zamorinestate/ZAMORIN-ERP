/**
 * Zamorin Café ERP — Universal Attachment & Document Modal
 * Mobile & Desktop workflow:
 * - Direct Camera Capture ("Take Photo" via capture="environment")
 * - Gallery / Choose Photo (image/*)
 * - File Explorer (PDF, JPG, PNG)
 * - Safe magic bytes & mime validation with client check
 * - Destination Manager / Device Folder Integration
 * - Multi-version replacement history
 */

import { apiPost, apiGet } from '../apiClient.js';
import { showToast } from '../components.js';

class UniversalAttachmentModal {
  constructor() {
    this.modalEl = null;
    this.activeConfig = null;
    this.selectedFile = null;
    this.versionHistory = [];
  }

  /**
   * Open attachment modal
   * @param {Object} opts
   * @param {string} opts.relatedModule - 'PURCHASE', 'EXPENSE', 'COMPLIANCE', 'HR', etc.
   * @param {string} opts.relatedRecordId - PO ID, Expense ID, etc.
   * @param {string} [opts.documentId] - Existing document ID (if viewing/updating)
   * @param {string} [opts.title] - Modal title
   * @param {Function} [opts.onSuccess] - Callback after successful attach/replace
   */
  async open(opts = {}) {
    this.close();
    this.activeConfig = {
      relatedModule: opts.relatedModule || 'GENERAL',
      relatedRecordId: opts.relatedRecordId || '',
      documentId: opts.documentId || null,
      title: opts.title || 'Document & Attachment Manager',
      documentType: opts.documentType || 'TAX_INVOICE',
      supplierOrEntity: opts.supplierOrEntity || '',
      documentNumber: opts.documentNumber || '',
      onSuccess: opts.onSuccess || null,
    };

    if (this.activeConfig.documentId) {
      await this.loadDocumentDetails(this.activeConfig.documentId);
    }

    this.render();
  }

  close() {
    if (this.modalEl && this.modalEl.parentNode) {
      this.modalEl.parentNode.removeChild(this.modalEl);
    }
    this.modalEl = null;
    this.activeConfig = null;
    this.selectedFile = null;
    this.versionHistory = [];
  }

  async loadDocumentDetails(docId) {
    try {
      const res = await apiGet(`/documents/${docId}`);
      if (res?.data) {
        this.activeDoc = res.data;
        this.versionHistory = res.data.versions || [];
      }
    } catch (err) {
      console.warn('Failed to load document details:', err);
    }
  }

  render() {
    const { title, documentId, relatedModule, relatedRecordId, documentType } = this.activeConfig;

    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4';
    overlay.id = 'universalAttachmentOverlay';

    overlay.innerHTML = `
      <div class="relative w-full max-w-xl bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <!-- Header -->
        <div class="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
          <div class="flex items-center space-x-3">
            <div class="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              📎
            </div>
            <div>
              <h3 class="text-base font-semibold text-white">${title}</h3>
              <p class="text-xs text-slate-400 font-mono">${relatedModule} · ${relatedRecordId || 'New Document'}</p>
            </div>
          </div>
          <button id="attCloseBtn" class="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition">
            ✕
          </button>
        </div>

        <!-- Body -->
        <div class="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          <!-- Mobile Capture Action Surface -->
          <div>
            <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Select / Capture Attachment</label>
            <div class="grid grid-cols-3 gap-2">
              <label class="cursor-pointer border border-slate-700 hover:border-amber-500 bg-slate-950/60 rounded-lg p-3 text-center transition flex flex-col items-center justify-center">
                <span class="text-2xl mb-1">📷</span>
                <span class="text-xs font-medium text-white">Take Photo</span>
                <span class="text-[10px] text-slate-400">Camera</span>
                <input type="file" id="attCameraInput" accept="image/*" capture="environment" class="sr-only" />
              </label>

              <label class="cursor-pointer border border-slate-700 hover:border-amber-500 bg-slate-950/60 rounded-lg p-3 text-center transition flex flex-col items-center justify-center">
                <span class="text-2xl mb-1">🖼️</span>
                <span class="text-xs font-medium text-white">Choose Photo</span>
                <span class="text-[10px] text-slate-400">Gallery</span>
                <input type="file" id="attGalleryInput" accept="image/jpeg,image/png" class="sr-only" />
              </label>

              <label class="cursor-pointer border border-slate-700 hover:border-amber-500 bg-slate-950/60 rounded-lg p-3 text-center transition flex flex-col items-center justify-center">
                <span class="text-2xl mb-1">📁</span>
                <span class="text-xs font-medium text-white">Choose File</span>
                <span class="text-[10px] text-slate-400">PDF, PNG, JPG</span>
                <input type="file" id="attFileInput" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" class="sr-only" />
              </label>
            </div>
          </div>

          <!-- Staged File Details -->
          <div id="attStagedInfo" class="hidden bg-slate-950/80 border border-slate-800 rounded-lg p-3">
            <div class="flex items-center justify-between">
              <div class="truncate">
                <div class="text-xs text-slate-400">Selected Payload</div>
                <div id="attStagedFilename" class="text-sm font-semibold text-white truncate font-mono"></div>
                <div id="attStagedMeta" class="text-[11px] text-slate-500"></div>
              </div>
              <button type="button" id="attClearStagedBtn" class="text-xs text-red-400 hover:text-red-300">Remove</button>
            </div>
          </div>

          <!-- Metadata Fields -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">Document Number</label>
              <input type="text" id="attDocNumInput" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono" placeholder="e.g. INV-2026-0042" value="${this.activeConfig.documentNumber || ''}">
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">Supplier / Entity</label>
              <input type="text" id="attSupplierInput" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" placeholder="e.g. Malabar Coffee Beans" value="${this.activeConfig.supplierOrEntity || ''}">
            </div>
          </div>

          <!-- Version Replacement Reason (if updating) -->
          ${documentId ? `
            <div>
              <label class="block text-xs font-semibold text-amber-400 uppercase tracking-wider mb-1">Replacement Reason (Mandatory for Version Update)</label>
              <input type="text" id="attChangeReasonInput" class="w-full bg-slate-950 border border-amber-500/50 rounded-lg px-3 py-2 text-sm text-white" placeholder="e.g. Correction of GSTIN or clearer invoice scan">
            </div>
          ` : ''}

          <!-- Version History Table (if existing) -->
          ${this.versionHistory.length > 0 ? `
            <div>
              <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">Version History</label>
              <div class="bg-slate-950/60 border border-slate-800 rounded-lg overflow-hidden text-xs">
                <table class="w-full text-left">
                  <thead class="bg-slate-900 border-b border-slate-800 text-slate-400">
                    <tr>
                      <th class="p-2">Ver</th>
                      <th class="p-2">File</th>
                      <th class="p-2">Uploaded</th>
                      <th class="p-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-800/60">
                    ${this.versionHistory.map(v => `
                      <tr>
                        <td class="p-2 font-mono font-bold text-amber-400">v${v.versionNumber}</td>
                        <td class="p-2 truncate max-w-[140px] text-white font-mono">${v.originalFilename}</td>
                        <td class="p-2 text-slate-400">${new Date(v.uploadedAt).toLocaleDateString()}</td>
                        <td class="p-2 text-right">
                          <a href="#" data-att-dl="/documents/${documentId}/versions/${v.versionNumber}/download" data-att-name="${v.originalFilename}" class="text-amber-400 hover:underline">Download</a>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          ` : ''}
        </div>

        <!-- Footer -->
        <div class="px-6 py-4 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between">
          <button type="button" id="attCancelBtn" class="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white transition">Cancel</button>
          <button type="button" id="attSubmitBtn" class="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs rounded-lg shadow-lg shadow-amber-500/20 transition flex items-center space-x-1.5">
            <span>${documentId ? 'Upload New Version' : 'Attach Document'}</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    this.modalEl = overlay;
    this.bindEvents();
  }

  bindEvents() {
    const overlay = this.modalEl;
    if (!overlay) return;

    overlay.querySelector('#attCloseBtn')?.addEventListener('click', () => this.close());
    overlay.querySelector('#attCancelBtn')?.addEventListener('click', () => this.close());

    const handleFile = (file) => {
      if (!file) return;
      // Client-side file size check (15MB)
      if (file.size > 15 * 1024 * 1024) {
        showToast('File exceeds the 15MB limit.', 'error');
        return;
      }
      // Filename length limit
      if (file.name.length > 255) {
        showToast('Original filename exceeds 255 characters.', 'error');
        return;
      }

      this.selectedFile = file;
      const infoEl = overlay.querySelector('#attStagedInfo');
      const nameEl = overlay.querySelector('#attStagedFilename');
      const metaEl = overlay.querySelector('#attStagedMeta');

      if (infoEl && nameEl && metaEl) {
        infoEl.classList.remove('hidden');
        nameEl.textContent = file.name;
        metaEl.textContent = `${(file.size / 1024).toFixed(1)} KB · ${file.type || 'Unknown type'}`;
      }
    };

    overlay.querySelector('#attCameraInput')?.addEventListener('change', (e) => handleFile(e.target.files[0]));
    overlay.querySelector('#attGalleryInput')?.addEventListener('change', (e) => handleFile(e.target.files[0]));
    overlay.querySelector('#attFileInput')?.addEventListener('change', (e) => handleFile(e.target.files[0]));

    overlay.querySelector('#attClearStagedBtn')?.addEventListener('click', () => {
      this.selectedFile = null;
      overlay.querySelector('#attStagedInfo')?.classList.add('hidden');
    });

    overlay.querySelector('#attSubmitBtn')?.addEventListener('click', async () => {
      if (!this.selectedFile) {
        showToast('Please select or capture a file first.', 'error');
        return;
      }

      const submitBtn = overlay.querySelector('#attSubmitBtn');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Uploading...';

      try {
        const formData = new FormData();
        formData.append('file', this.selectedFile);
        formData.append('relatedModule', this.activeConfig.relatedModule);
        formData.append('relatedRecordId', this.activeConfig.relatedRecordId);
        formData.append('documentType', this.activeConfig.documentType);
        formData.append('documentNumber', overlay.querySelector('#attDocNumInput')?.value || '');
        formData.append('supplierOrEntity', overlay.querySelector('#attSupplierInput')?.value || '');

        const token = localStorage.getItem('zamorin_auth_token') || sessionStorage.getItem('zamorin_auth_token');

        if (this.activeConfig.documentId) {
          const reason = overlay.querySelector('#attChangeReasonInput')?.value?.trim();
          if (!reason) {
            showToast('Replacement reason is mandatory for version updates.', 'error');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Upload New Version';
            return;
          }
          formData.append('changeReason', reason);

          const res = await fetch(`/api/v1/documents/${this.activeConfig.documentId}/replace-version`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            credentials: 'include',
            body: formData,
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.message || 'Version replacement failed');
          showToast('New version uploaded successfully.', 'mint');
        } else {
          const res = await fetch('/api/v1/documents/attach', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            credentials: 'include',
            body: formData,
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.message || 'Attachment upload failed');
          showToast('Document attached successfully.', 'mint');
        }

        if (typeof this.activeConfig.onSuccess === 'function') {
          this.activeConfig.onSuccess();
        }
        this.close();
      } catch (err) {
        showToast(err.message || 'Upload failed', 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = this.activeConfig.documentId ? 'Upload New Version' : 'Attach Document';
      }
    });
  }
}

export const universalAttachmentModal = new UniversalAttachmentModal();
export default universalAttachmentModal;


// Authenticated download for version links (a plain <a href> carries no credentials).
if (typeof document !== 'undefined' && !window.__attDlWired) {
  window.__attDlWired = true;
  document.addEventListener('click', async (e) => {
    const a = e.target.closest?.('[data-att-dl]');
    if (!a) return;
    e.preventDefault();
    try {
      const { apiBlob } = await import('../apiClient.js');
      const blob = await apiBlob(a.getAttribute('data-att-dl'));
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = a.getAttribute('data-att-name') || 'document';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (err) {
      const { showToast } = await import('../components.js');
      showToast(err?.message || 'The document could not be downloaded.', 'error');
    }
  });
}
