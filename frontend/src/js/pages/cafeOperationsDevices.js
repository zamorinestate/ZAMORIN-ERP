import { state } from "../state.js";
import { apiGet, apiPost } from "../apiClient.js";
import { showToast, openModal, closeModal, confirmAction, kpiCard, skeleton, renderModuleErrorState } from "../components.js";
import { icon } from "../icons.js";
import { navigate } from "../router.js";

let activeTab = "overview"; // "overview" | "devices" | "sessions" | "pins"
let cachedDevices = [];
let cachedSessions = [];
let cachedCafes = [];

async function loadCafesList() {
  if (cachedCafes.length) return cachedCafes;
  try {
    const res = await apiGet("/cafes");
    cachedCafes = res?.data || res?.cafes || (Array.isArray(res) ? res : []);
  } catch (err) {
    cachedCafes = [];
  }
  return cachedCafes;
}

function escapeHtml(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function setCafeDevicesActiveTab(tab) {
  activeTab = tab || "overview";
}

export function renderCafeOperationsDevices(subroute) {
  if (subroute !== undefined) {
    activeTab = subroute || "overview";
  }
  const user = state.auth?.user || state.user || {};
  const isMaster = (state.role === "master") || Boolean(user.isPrimaryMaster);
  const cafeId = state.currentCafeId || user.primaryCafeId || "";

  // If on child subroute, render dedicated child shell directly
  if (activeTab && activeTab !== "overview") {
    return `
      <div class="page-container" style="padding: 24px; max-width: 1380px; margin: 0 auto; padding-bottom:60px;">
        <div id="devices-tab-content">
          ${skeleton("240px")}
        </div>
      </div>
    `;
  }

  return `
    <div class="page-container" style="padding: 24px; max-width: 1380px; margin: 0 auto; padding-bottom:60px;">
      <!-- Page Header -->
      <div class="page-header" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:24px; flex-wrap:wrap; gap:16px;">
        <div>
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
            <span class="status info" style="font-weight:700; font-size:11px;">TRUSTED FLEET &amp; OPERATOR GOVERNANCE</span>
            <span style="color:var(--muted); font-size:12px;">· Cafe Operations</span>
          </div>
          <h1 style="font-size:24px; font-weight:800; color:var(--ink); margin:0 0 6px;">Devices &amp; Operator Sessions</h1>
          <p style="color:var(--muted); font-size:13.5px; margin:0; max-width:680px;">
            Manage cafe-owned trusted terminal hardware, track active operator sessions, handovers, and configure operator PINs.
          </p>
        </div>

        <div style="display:flex; gap:10px; align-items:center;">
          <button class="btn btn-secondary" id="btn-run-diagnostic" type="button" title="Run Terminal Diagnostic" style="display:flex; align-items:center; gap:6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            Run Diagnostic
          </button>
          <button class="btn btn-secondary" id="btn-refresh-data" type="button" title="Refresh Fleet &amp; Session Data" style="display:flex; align-items:center; gap:6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Refresh Fleet
          </button>
          <button class="btn btn-primary" id="btn-prep-label-studio" type="button" title="Thermal Prep Sticky Label Studio (F178-F184)" style="display:flex; align-items:center; gap:6px; font-weight:700;">
            🏷️ Sticky Label Studio (F178–F184)
          </button>
        </div>
      </div>

      <!-- Quick KPI Strip -->
      <div class="kpi-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:16px; margin-bottom:24px;">
        <div class="card" style="padding:16px;">
          <div style="font-size:12px; font-weight:700; color:var(--muted); text-transform:uppercase;">Enrolled Devices</div>
          <div style="font-size:24px; font-weight:800; color:var(--ink); margin:4px 0;" id="kpi-device-count">--</div>
          <div style="font-size:12px; color:var(--muted);" id="kpi-device-status-sub">Assigned cafe terminals</div>
        </div>
        <div class="card" style="padding:16px;">
          <div style="font-size:12px; font-weight:700; color:var(--muted); text-transform:uppercase;">Active Operator Sessions</div>
          <div style="font-size:24px; font-weight:800; color:var(--ink); margin:4px 0;" id="kpi-active-sessions">--</div>
          <div style="font-size:12px; color:var(--muted);">Live across registered terminals</div>
        </div>
        <div class="card" style="padding:16px;">
          <div style="font-size:12px; font-weight:700; color:var(--muted); text-transform:uppercase;">Device Trust Health</div>
          <div style="font-size:24px; font-weight:800; color:var(--ink); margin:4px 0;" id="kpi-trust-health">--</div>
          <div style="font-size:12px; color:var(--muted);" id="kpi-trust-sub">Hardware posture monitoring</div>
        </div>
      </div>

      <!-- Dynamic Content Body -->
      <div id="devices-tab-content">
        ${skeleton("240px")}
      </div>
    </div>
  `;
}

export function wireCafeOperationsDevices(root, subroute) {
  if (subroute !== undefined) {
    activeTab = subroute || "overview";
  }
  renderActiveTabContent(root);
  loadFleetData(root);

  // Run Terminal Diagnostic
  root.querySelector("#btn-run-diagnostic")?.addEventListener("click", () => {
    openDiagnosticModal();
  });

  // Refresh
  root.querySelector("#btn-refresh-data")?.addEventListener("click", () => {
    showToast("Refreshing fleet and session status...");
    loadFleetData(root);
  });

  // Sticky Label Studio (F178-F184)
  root.querySelector("#btn-prep-label-studio")?.addEventListener("click", () => {
    openPrepLabelStudioModal();
  });
}

function openPrepLabelStudioModal() {
  openModal({
    title: "Thermal Prep Sticky Label Studio (F178–F184)",
    maxWidth: "680px",
    body: `
      <div style="display:flex; flex-direction:column; gap:14px; font-size:12.5px; color:var(--ink);">
        <div style="background:var(--surface-sunken); padding:10px 12px; border-radius:6px; border:1px solid var(--line); font-size:11.5px; color:var(--muted);">
          ℹ️ Generates high-density thermal sticky labels (ESC/POS & ZPL) for in-house bakery prep, cold brew bottles, vacuum packs, and FSSAI allergen compliance.
        </div>

        <div style="display:grid; grid-template-columns:1.5fr 1fr; gap:12px;">
          <div>
            <label style="font-weight:700; display:block; margin-bottom:3px;">Item / Preparation Name *</label>
            <input type="text" id="label-item-name" class="input" value="Cold Brew Concentrate (Single Origin)" style="width:100%; box-sizing:border-box; font-size:12.5px; font-weight:700;" />
          </div>
          <div>
            <label style="font-weight:700; display:block; margin-bottom:3px;">Batch Number *</label>
            <input type="text" id="label-batch-num" class="input" value="BATCH-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-01" style="width:100%; box-sizing:border-box; font-size:12.5px; font-family:var(--font-mono);" />
          </div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px;">
          <div>
            <label style="font-weight:700; display:block; margin-bottom:3px;">Shelf Life (Hours)</label>
            <input type="number" id="label-shelf-life" class="input" value="72" min="1" max="720" style="width:100%; box-sizing:border-box; font-size:12px; font-weight:700;" />
          </div>
          <div>
            <label style="font-weight:700; display:block; margin-bottom:3px;">Storage Condition</label>
            <select id="label-storage-cond" class="select" style="width:100%; font-size:12px;">
              <option value="REFRIGERATED (2°C - 4°C)" selected>Refrigerated (2°C - 4°C)</option>
              <option value="FROZEN (-18°C)">Frozen (-18°C)</option>
              <option value="AMBIENT DRY (< 25°C)">Ambient Dry (< 25°C)</option>
              <option value="COOL & DRY (15°C - 20°C)">Cool & Dry (15°C - 20°C)</option>
            </select>
          </div>
          <div>
            <label style="font-weight:700; display:block; margin-bottom:3px;">Net Weight / Vol</label>
            <input type="text" id="label-net-wt" class="input" value="500 ml" style="width:100%; box-sizing:border-box; font-size:12px;" />
          </div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <div>
            <label style="font-weight:700; display:block; margin-bottom:3px;">Retail MRP (₹)</label>
            <input type="number" id="label-mrp" class="input" value="380" min="0" style="width:100%; box-sizing:border-box; font-size:12px; font-weight:700;" />
          </div>
          <div>
            <label style="font-weight:700; display:block; margin-bottom:3px;">Prepared By Station / Person</label>
            <input type="text" id="label-prep-by" class="input" value="Artisanal Roastery Lab" style="width:100%; box-sizing:border-box; font-size:12px;" />
          </div>
        </div>

        <div>
          <label style="font-weight:700; display:block; margin-bottom:4px;">Declared Allergens</label>
          <div style="display:flex; gap:12px; flex-wrap:wrap; background:var(--surface-sunken); padding:8px 12px; border-radius:6px; border:1px solid var(--line);">
            ${["Gluten", "Dairy", "Tree Nuts", "Soy", "Egg", "None / Nil"].map((a, i) => `
              <label style="display:flex; align-items:center; gap:4px; font-size:12px; cursor:pointer;">
                <input type="checkbox" class="label-allergen-cb" value="${a}" ${i === 5 ? "checked" : ""} />
                <span>${a}</span>
              </label>
            `).join("")}
          </div>
        </div>

        <button class="btn btn-secondary" id="btn-generate-prep-label" type="button" style="padding:8px 14px; font-weight:700; font-size:12px; align-self:flex-start;">
          👁️ Preview Label (ESC/POS & ZPL)
        </button>

        <div id="prep-label-preview-container" style="display:none; flex-direction:column; gap:10px; border-top:1px dashed var(--line); padding-top:12px;">
        </div>
      </div>
    `,
    saveLabel: "🖨️ Print Label via Thermal Station",
    cancelLabel: "Close",
    onSave: async (modalEl) => {
      const itemName = modalEl.querySelector("#label-item-name")?.value?.trim();
      const batchNumber = modalEl.querySelector("#label-batch-num")?.value?.trim();
      const shelfLifeHours = Number(modalEl.querySelector("#label-shelf-life")?.value) || 48;
      const storageCondition = modalEl.querySelector("#label-storage-cond")?.value || "REFRIGERATED (2°C - 4°C)";
      const netWeight = modalEl.querySelector("#label-net-wt")?.value?.trim() || "";
      const mrp = Number(modalEl.querySelector("#label-mrp")?.value) || 0;
      const preparedBy = modalEl.querySelector("#label-prep-by")?.value?.trim() || "Kitchen Team";
      const allergens = Array.from(modalEl.querySelectorAll(".label-allergen-cb:checked")).map(cb => cb.value).filter(v => v !== "None / Nil");

      try {
        const res = await apiPost("/hardware/prep-label", {
          itemName,
          batchNumber,
          shelfLifeHours,
          storageCondition,
          netWeight,
          mrpPaisa: mrp * 100,
          preparedBy,
          allergens,
        });

        showToast(`Sticky label queued for printer (${res.data?.batch || batchNumber}). ESC/POS buffer emitted.`, "mint");
        window.print();
        return true;
      } catch (err) {
        showToast(err.message || "Failed to generate prep label", "coral");
        return false;
      }
    },
  });

  setTimeout(() => {
    document.getElementById("btn-generate-prep-label")?.addEventListener("click", async () => {
      const container = document.getElementById("prep-label-preview-container");
      if (!container) return;

      const itemName = document.getElementById("label-item-name")?.value?.trim() || "Item";
      const batchNumber = document.getElementById("label-batch-num")?.value?.trim() || "BATCH-01";
      const shelfLifeHours = Number(document.getElementById("label-shelf-life")?.value) || 48;
      const storageCondition = document.getElementById("label-storage-cond")?.value || "REFRIGERATED";
      const netWeight = document.getElementById("label-net-wt")?.value?.trim() || "";
      const mrp = Number(document.getElementById("label-mrp")?.value) || 0;
      const preparedBy = document.getElementById("label-prep-by")?.value?.trim() || "Prep Team";
      const allergens = Array.from(document.querySelectorAll(".label-allergen-cb:checked")).map(cb => cb.value).filter(v => v !== "None / Nil");

      try {
        const res = await apiPost("/hardware/prep-label", {
          itemName,
          batchNumber,
          shelfLifeHours,
          storageCondition,
          netWeight,
          mrpPaisa: mrp * 100,
          preparedBy,
          allergens,
        });

        const data = res?.data || {};
        container.style.display = "flex";
        container.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px;">
            <div style="flex:1; background:#FFFFFF; border:2px solid #16223F; border-radius:6px; padding:12px; font-family:'Courier New', monospace; font-size:11px; line-height:1.4; color:#000000; box-shadow:0 2px 8px rgba(0,0,0,0.06);">
              <div style="text-align:center; font-weight:bold; font-size:12px; border-bottom:1px solid #000; padding-bottom:4px; margin-bottom:6px;">
                ZAMORIN CAFE & ARTISANAL ROASTERY
              </div>
              <div><strong>ITEM:</strong> ${escapeHtml(data.itemName || itemName)}</div>
              <div><strong>BATCH:</strong> ${escapeHtml(data.batch || batchNumber)}</div>
              <div><strong>PACKED:</strong> ${escapeHtml(data.formattedPrepDate || 'Now')}</div>
              <div style="color:#B91C1C; font-weight:bold;"><strong>USE BY:</strong> ${escapeHtml(data.formattedExpiryDate || 'In 48h')}</div>
              <div><strong>STORAGE:</strong> ${escapeHtml(data.storageCondition || storageCondition)}</div>
              <div><strong>ALLERGENS:</strong> ${data.allergens?.length ? escapeHtml(data.allergens.join(', ')) : 'NIL'}</div>
              ${netWeight ? `<div><strong>NET WT:</strong> ${escapeHtml(netWeight)}</div>` : ''}
              ${mrp > 0 ? `<div><strong>MRP:</strong> ₹${mrp.toFixed(2)} (INCL. TAXES)</div>` : ''}
              <div style="font-size:9.5px; margin-top:4px; border-top:1px dashed #666; padding-top:4px;">
                FSSAI LIC: 10020042000123 · PREP: ${escapeHtml(preparedBy)}
              </div>
            </div>

            <div style="flex:1; display:flex; flex-direction:column; gap:6px;">
              <span style="font-weight:700; font-size:11px; color:var(--muted);">ZPL (Zebra Direct Thermal Code):</span>
              <textarea readonly style="width:100%; height:130px; font-family:monospace; font-size:10px; background:var(--surface-sunken); border:1px solid var(--line); border-radius:6px; padding:6px; resize:none;">${escapeHtml(data.zplString || '^XA^FDZAMORIN^FS^XZ')}</textarea>
            </div>
          </div>
        `;
      } catch (err) {
        showToast(err.message || "Failed to compile label", "coral");
      }
    });
  }, 50);
}

async function openDiagnosticModal() {
  const user = state.auth?.user || state.user || {};
  const cafeId = state.currentCafeId || user.primaryCafeId || "MAIN-01";
  const operatorName = user.name || user.email || "Operator";

  const initialContent = `
    <div style="padding:4px;">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
        <h3 style="margin:0; font-size:18px; font-weight:700; color:var(--ink);">Terminal &amp; Network Diagnostic</h3>
        <span class="status info" style="font-weight:700; font-size:11px;">RUNNING CHECKS...</span>
      </div>
      <div id="diagnostic-results" aria-live="polite" style="display:flex; flex-direction:column; gap:12px; margin-bottom:20px;">
        ${skeleton("180px")}
      </div>
      <div style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid var(--border-subtle); padding-top:14px;">
        <button class="btn btn-secondary" id="diag-btn-close" type="button">Close</button>
      </div>
    </div>
  `;

  openModal(initialContent);
  const modalEl = document.getElementById("zamorin-global-modal");
  modalEl?.querySelector("#diag-btn-close")?.addEventListener("click", () => closeModal());

  const t0 = performance.now();
  let healthOk = false;
  let readinessOk = false;
  let latencyMs = 0;

  try {
    const healthRes = await apiGet("/health");
    latencyMs = Math.round(performance.now() - t0);
    healthOk = healthRes?.status === "ok" || healthRes?.success === true;
  } catch (err) {
    healthOk = false;
  }

  try {
    const readyRes = await apiGet("/readiness");
    readinessOk = readyRes?.status === "ready" || readyRes?.database === "connected";
  } catch (err) {
    readinessOk = false;
  }

  const resultsEl = modalEl?.querySelector("#diagnostic-results");
  if (resultsEl) {
    resultsEl.innerHTML = `
      <div class="card" style="padding:14px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="font-weight:700; font-size:13px; color:var(--ink);">Backend API Reachability</div>
          <div style="font-size:12px; color:var(--muted);">Round-trip latency: \${latencyMs}ms</div>
        </div>
        <span class="status \${healthOk ? "success" : "danger"}">\${healthOk ? "CONNECTED" : "UNREACHABLE"}</span>
      </div>

      <div class="card" style="padding:14px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="font-weight:700; font-size:13px; color:var(--ink);">Database Readiness</div>
          <div style="font-size:12px; color:var(--muted);">Primary database connectivity</div>
        </div>
        <span class="status \${readinessOk ? "success" : "warning"}">\${readinessOk ? "READY" : "DEGRADED"}</span>
      </div>

      <div class="card" style="padding:14px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="font-weight:700; font-size:13px; color:var(--ink);">Terminal Hardware State</div>
          <div style="font-size:12px; color:var(--muted);">Bound café: \${escapeHtml(cafeId)}</div>
        </div>
        <span class="status success">REGISTERED</span>
      </div>

      <div class="card" style="padding:14px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="font-weight:700; font-size:13px; color:var(--ink);">Active Operator</div>
          <div style="font-size:12px; color:var(--muted);">\${escapeHtml(operatorName)}</div>
        </div>
        <span class="status info">SESSION ACTIVE</span>
      </div>
    `;
  }
}

async function loadFleetData(root) {
  try {
    await loadCafesList();
    const [devicesRes, sessionsRes] = await Promise.all([
      apiGet("/devices"),
      apiGet("/cafe-operations/operator/sessions?limit=25"),
    ]);

    cachedDevices = devicesRes?.data?.devices || devicesRes?.devices || (Array.isArray(devicesRes?.data) ? devicesRes.data : []);
    cachedSessions = sessionsRes?.data?.sessions || [];

    const deviceCountEl = root.querySelector("#kpi-device-count");
    if (deviceCountEl) deviceCountEl.textContent = String(cachedDevices.length);

    const activeSessionsCount = cachedSessions.filter((s) => s.status === "ACTIVE").length;
    const activeSessionsEl = root.querySelector("#kpi-active-sessions");
    if (activeSessionsEl) activeSessionsEl.textContent = String(activeSessionsCount);

    const revokedCount = cachedDevices.filter((d) => d.status === "REVOKED" || d.status === "LOST").length;
    const trustEl = root.querySelector("#kpi-trust-health");
    if (trustEl) {
      if (cachedDevices.length === 0) {
        trustEl.textContent = "—";
        trustEl.style.color = "var(--muted)";
      } else if (revokedCount > 0) {
        trustEl.textContent = `${revokedCount} REVOKED`;
        trustEl.style.color = "var(--danger)";
      } else {
        trustEl.textContent = "STABLE";
        trustEl.style.color = "var(--success)";
      }
    }

    renderActiveTabContent(root);
  } catch (err) {
    console.warn("Failed to load fleet data (using offline fallback):", err.message);
    renderActiveTabContent(root);
  }
}

function renderActiveTabContent(root) {
  const container = root.querySelector("#devices-tab-content");
  if (!container) return;

  if (activeTab === "overview") {
    const fleetTiles = [
      { id: "devices", icon: "📱", title: "Registered Devices", subtitle: "Multi-café hardware fleet, health status & enrollment", badge: `${cachedDevices.length} Device${cachedDevices.length === 1 ? '' : 's'}`, badgeType: "accent" },
      { id: "peripherals", icon: "🖨️", title: "Hardware Peripherals", subtitle: "Receipt printers, cash drawers, scanners, scales & terminals", badge: "P20 Live", badgeType: "accent" },
      { id: "sessions", icon: "📜", title: "Operator Sessions Log", subtitle: "Real-time shifts, register handovers & active staff", badge: "Live Shifts", badgeType: "success" },
      { id: "pins", icon: "🔐", title: "Operator PIN Setup", subtitle: "Operator PIN policy, manager overrides & auth keys", badge: "Secured", badgeType: "success" },
    ];

    container.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:24px;">
        <div class="module-hub-section">
          <h3 class="module-hub-section-title">Hardware Fleet &amp; Session Workspaces</h3>
          <div class="module-tile-grid">
            ${fleetTiles.map((t) => `
              <button class="module-hub-tile" data-devices-hub-tile="${t.id}" type="button">
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
      </div>
    `;

    container.querySelectorAll("[data-devices-hub-tile]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tileId = btn.dataset.devicesHubTile;
        navigate("devices/" + tileId);
      });
    });
    return;
  }

  const submodules = {
    devices: {
      title: "Registered Fleet Devices",
      icon: "📱",
      desc: "Multi-café hardware fleet, health status and device certificates.",
      actionsHtml: `<button class="btn btn-sm btn-primary" id="btn-child-enroll-device" type="button">+ Enroll Device</button>`
    },
    peripherals: {
      title: "Hardware Peripherals & POS Devices",
      icon: "🖨️",
      desc: "Receipt printers, cash drawers, barcode/QR scanners, weighing scales, and payment terminals.",
      actionsHtml: `<button class="btn btn-sm btn-primary" id="btn-child-add-peripheral" type="button">+ Add Hardware Device</button>`
    },
    sessions: {
      title: "Operator Sessions & Handover Logs",
      icon: "📜",
      desc: "Live terminal operators, shifts, tills and handover status.",
      actionsHtml: `<button class="btn btn-sm btn-secondary" id="btn-child-refresh-sessions" type="button">Refresh Sessions</button>`
    },
    pins: {
      title: "Operator PIN Management & Policies",
      icon: "🔐",
      desc: "Operator fast-login PINs, manager overrides and complexity rules.",
      actionsHtml: `<button class="btn btn-sm btn-primary" id="btn-child-setup-pin" type="button">+ Set Operator PIN</button>`
    },
  };

  const cur = submodules[activeTab] || { title: "Submodule", icon: "📁", desc: "", actionsHtml: "" };

  let bodyHtml = "";
  if (activeTab === "devices") {
    bodyHtml = renderDevicesTable();
  } else if (activeTab === "peripherals") {
    bodyHtml = renderPeripheralsView();
  } else if (activeTab === "sessions") {
    bodyHtml = renderSessionsTable();
  } else if (activeTab === "pins") {
    bodyHtml = renderPinSetupView();
  }

  container.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:16px;">
      <div class="card" style="padding:14px 18px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 10px);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px;">
          <div>
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px; font-size:12.5px; color:var(--muted);">
              <button id="devices-back-to-hub-btn" data-back-to-hub="true" data-devices-back-to-hub="true" class="btn-link" style="color:var(--accent); text-decoration:none; display:inline-flex; align-items:center; gap:4px; font-weight:600; cursor:pointer; background:none; border:none; padding:0;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                Devices
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

  container.querySelector("#devices-back-to-hub-btn")?.addEventListener("click", () => {
    navigate("devices");
  });
  container.querySelector("#btn-child-enroll-device")?.addEventListener("click", () => openEnrollDeviceModal(root));
  container.querySelector("#btn-child-add-peripheral")?.addEventListener("click", () => openAddPeripheralModal(root));
  container.querySelector("#btn-child-refresh-sessions")?.addEventListener("click", () => {
    showToast("Operator sessions refreshed.", "info");
    loadFleetData(root);
  });
  container.querySelector("#btn-child-setup-pin")?.addEventListener("click", () => {
    activeTab = "pins";
    renderActiveTabContent(root);
  });

  if (activeTab === "devices") {
    wireDevicesTable(root);
  } else if (activeTab === "peripherals") {
    wirePeripheralsView(root);
  } else if (activeTab === "sessions") {
    wireSessionsTable(root);
  } else if (activeTab === "pins") {
    wirePinSetupView(root);
  }
}


function renderDevicesTable() {
  if (!cachedDevices.length) {
    return `<div class="card" style="padding:40px; text-align:center; color:var(--muted);">No registered devices found.</div>`;
  }

  const rows = cachedDevices
    .map((dev) => {
      const statusClass = dev.status === "ACTIVE" ? "success" : dev.status === "REVOKED" || dev.status === "LOST" ? "danger" : "warning";
      const lastSeenStr = dev.lastSeenAt ? new Date(dev.lastSeenAt).toLocaleString("en-IN") : "Never";

      return `
        <tr style="border-bottom:1px solid var(--border-subtle);">
          <td style="padding:14px 16px; font-weight:700; font-family:var(--font-mono); color:var(--ink);">
            ${escapeHtml(dev.deviceId)}
          </td>
          <td style="padding:14px 16px;">
            <div style="font-weight:700; color:var(--ink);">${escapeHtml(dev.deviceName)}</div>
            <div style="font-size:11.5px; color:var(--muted);">${escapeHtml(dev.deviceClass)} · Policy v${escapeHtml(dev.policyVersion || 1)}</div>
          </td>
          <td style="padding:14px 16px; font-weight:600;">
            📍 ${escapeHtml(dev.assignedCafeId || "Unassigned")}
          </td>
          <td style="padding:14px 16px;">
            <span class="status ${statusClass}" style="font-weight:700; font-size:11px;">${escapeHtml(dev.status)}</span>
          </td>
          <td style="padding:14px 16px; font-size:12px; color:var(--muted);">
            ${escapeHtml(lastSeenStr)}
          </td>
          <td style="padding:14px 16px; text-align:right;">
            <div style="display:inline-flex; gap:6px;">
              <button class="btn btn-sm btn-ghost" data-action="manage-device" data-id="${escapeHtml(dev.deviceId)}" title="Device Actions">Manage</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="card" style="padding:0; overflow:hidden;">
      <table style="width:100%; border-collapse:collapse; text-align:left; font-size:13px;">
        <thead>
          <tr style="background:var(--bg-surface-2); border-bottom:1px solid var(--border-subtle); font-size:11.5px; text-transform:uppercase; color:var(--muted); letter-spacing:0.04em;">
            <th style="padding:12px 16px;">Device ID</th>
            <th style="padding:12px 16px;">Hardware / Class</th>
            <th style="padding:12px 16px;">Assigned Cafe</th>
            <th style="padding:12px 16px;">Status</th>
            <th style="padding:12px 16px;">Last Active</th>
            <th style="padding:12px 16px; text-align:right;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

function wireDevicesTable(root) {
  root.querySelectorAll('[data-action="manage-device"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const devId = btn.dataset.id;
      const device = cachedDevices.find((d) => d.deviceId === devId);
      if (device) openDeviceActionModal(device, root);
    });
  });
}

function openDeviceActionModal(device, root) {
  const content = `
    <div style="max-width:480px; margin:0 auto; padding:10px 0;">
      <h3 style="font-size:17px; font-weight:800; margin:0 0 4px; color:var(--ink);">${device.deviceName}</h3>
      <p style="font-size:12.5px; color:var(--muted); margin:0 0 16px; font-family:var(--font-mono);">${device.deviceId} · Assigned: ${device.assignedCafeId}</p>

      <div style="background:var(--bg-subtle, #faf8f5); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:14px; margin-bottom:20px; font-size:13px;">
        <div>Status: <strong>${device.status}</strong></div>
        <div>Class: <strong>${device.deviceClass}</strong></div>
        <div>Trust: <strong>${device.trustLevel || "ENROLLED"}</strong></div>
      </div>

      <div style="display:flex; flex-direction:column; gap:10px;">
        <button class="btn btn-secondary" id="dev-btn-lost" type="button" style="text-align:left; justify-content:flex-start;">
          ⚠️ Mark Device as Lost (Terminates All Sessions)
        </button>
        <button class="btn btn-secondary" id="dev-btn-retire" type="button" style="text-align:left; justify-content:flex-start;">
          📦 Retire Hardware (Decommission)
        </button>
        <button class="btn btn-danger" id="dev-btn-revoke" type="button" style="text-align:left; justify-content:flex-start;">
          🚫 Emergency Revocation (Master Security Lock)
        </button>
      </div>

      <div style="display:flex; justify-content:flex-end; margin-top:20px; border-top:1px solid var(--border-subtle); padding-top:14px;">
        <button class="btn btn-ghost" id="dev-btn-close" type="button">Close</button>
      </div>
    </div>
  `;

  openModal(content);
  const modalEl = document.getElementById("zamorin-global-modal");

  modalEl?.querySelector("#dev-btn-close")?.addEventListener("click", () => closeModal());

  modalEl?.querySelector("#dev-btn-lost")?.addEventListener("click", () => {
    confirmAction({
      title: "Mark Device as Lost",
      description: `Are you sure you want to mark <strong>${device.deviceId}</strong> as LOST? All active sessions will be immediately revoked.`,
      confirmLabel: "Mark as Lost",
      danger: true,
      onConfirm: async () => {
        try {
          await apiPost(`/devices/${device.deviceId}/lost`, { reason: "Reported lost by supervisor" });
          showToast("Device marked as LOST.", "mint");
          closeModal();
          loadFleetData(root);
        } catch (err) {
          showToast(err.userMessage || err.message || "Failed to update device.", "coral");
        }
      }
    });
  });

  modalEl?.querySelector("#dev-btn-retire")?.addEventListener("click", () => {
    confirmAction({
      title: "Retire Device",
      description: `Are you sure you want to retire <strong>${device.deviceId}</strong>?`,
      confirmLabel: "Retire Device",
      onConfirm: async () => {
        try {
          await apiPost(`/devices/${device.deviceId}/retire`, { reason: "Hardware retired" });
          showToast("Device retired.", "mint");
          closeModal();
          loadFleetData(root);
        } catch (err) {
          showToast(err.userMessage || err.message || "Failed to retire device.", "coral");
        }
      }
    });
  });

  modalEl?.querySelector("#dev-btn-revoke")?.addEventListener("click", () => {
    closeModal();
    openDeviceRevocationModal(device, root);
  });
}

function openDeviceRevocationModal(device, root) {
  const content = `
    <div style="max-width:520px; margin:0 auto; padding:8px 0;">
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
        <span class="status danger" style="font-weight:800; font-size:11px;">SECURITY ACTION</span>
        <span style="font-size:12px; color:var(--muted);">· Device Trust Management</span>
      </div>
      <h3 style="font-size:18px; font-weight:800; margin:0 0 4px; color:var(--danger, #dc2626);">
        Revoke Terminal Device
      </h3>
      <p style="font-size:12.5px; color:var(--muted); margin:0 0 16px;">
        Permanently revokes hardware trust certificates and immediately invalidates active operator sessions.
      </p>

      <div style="background:var(--bg-subtle, #faf8f5); border:1px solid var(--border-subtle, #e5e7eb); border-radius:var(--radius-md, 8px); padding:12px 14px; margin-bottom:16px; font-size:12.5px;">
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
          <div><span style="color:var(--muted);">Device ID:</span> <strong style="font-family:var(--font-mono);">${escapeHtml(device.deviceId)}</strong></div>
          <div><span style="color:var(--muted);">Name:</span> <strong>${escapeHtml(device.deviceName)}</strong></div>
          <div><span style="color:var(--muted);">Assigned Café:</span> <strong>${escapeHtml(device.assignedCafeId || "Unassigned")}</strong></div>
          <div><span style="color:var(--muted);">Current Status:</span> <span class="status ${device.status === 'ACTIVE' ? 'success' : 'danger'}" style="font-size:10px; font-weight:700;">${escapeHtml(device.status)}</span></div>
        </div>
      </div>

      <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:var(--radius-md, 8px); padding:12px; margin-bottom:16px; font-size:12px; color:#991b1b;">
        <div style="font-weight:700; display:flex; align-items:center; gap:6px; margin-bottom:4px;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01"/></svg>
          Immediate Operational Impact:
        </div>
        <ul style="margin:4px 0 0 16px; padding:0; line-height:1.4;">
          <li>All active and idle operator sessions on this terminal will be terminated immediately.</li>
          <li>POS tills and attendance kiosks bound to this device will be blocked from transacting.</li>
          <li>Device will require full administrative re-enrollment to regain access.</li>
        </ul>
      </div>

      <form id="device-revocation-form" style="display:flex; flex-direction:column; gap:12px;">
        <div>
          <label for="revoke-reason-input" style="font-size:12px; font-weight:700; color:var(--ink); display:block; margin-bottom:4px;">
            Revocation Reason (Mandatory) <span style="color:var(--danger);">*</span>
          </label>
          <textarea id="revoke-reason-input" class="textarea input-sm" rows="3" placeholder="State operational or security reason (e.g., Device compromised, stolen, replaced, or operator security policy violation)" required style="width:100%; min-height:68px; font-size:12.5px;"></textarea>
        </div>

        <div style="display:flex; align-items:flex-start; gap:8px; margin-top:2px;">
          <input type="checkbox" id="revoke-confirm-checkbox" required style="margin-top:3px; cursor:pointer;" />
          <label for="revoke-confirm-checkbox" style="font-size:12px; color:var(--ink); cursor:pointer; line-height:1.3;">
            I confirm that I want to revoke <strong>${escapeHtml(device.deviceId)}</strong> and acknowledge that all active operator sessions on this device will be terminated immediately.
          </label>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:8px; border-top:1px solid var(--border-subtle); padding-top:12px;">
          <button type="button" class="btn btn-secondary" id="revoke-btn-cancel">Cancel</button>
          <button type="submit" class="btn btn-danger" id="revoke-btn-submit" style="font-weight:700;">
            🚫 Confirm Emergency Revocation
          </button>
        </div>
      </form>
    </div>
  `;

  openModal(content);
  const modalEl = document.getElementById("zamorin-global-modal");

  modalEl?.querySelector("#revoke-btn-cancel")?.addEventListener("click", () => closeModal());

  const form = modalEl?.querySelector("#device-revocation-form");
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const reason = modalEl.querySelector("#revoke-reason-input")?.value?.trim();
      const confirmed = modalEl.querySelector("#revoke-confirm-checkbox")?.checked;

      if (!reason) {
        showToast("Revocation reason is mandatory.", "coral");
        return;
      }
      if (!confirmed) {
        showToast("Please check the confirmation box to proceed.", "coral");
        return;
      }

      const submitBtn = form.querySelector("#revoke-btn-submit");
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Revoking Device...";
      }

      try {
        await apiPost(`/devices/${device.deviceId}/revoke`, { reason });
        showToast(`Device ${device.deviceId} revoked successfully. Active sessions terminated.`, "mint");
        closeModal();
        await loadFleetData(root);
      } catch (err) {
        showToast(err.userMessage || err.message || "Failed to revoke device.", "coral");
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "🚫 Confirm Emergency Revocation";
        }
      }
    };
  }
}

function renderSessionsTable() {
  if (!cachedSessions.length) {
    return `
      <div class="card" style="padding:40px; text-align:center; color:var(--muted);">
        <div style="font-size:24px; margin-bottom:8px;">📜</div>
        <div style="font-weight:700; color:var(--ink); margin-bottom:4px;">No Operator Sessions Recorded</div>
        <div style="font-size:12.5px;">Operator sessions will appear here as shift operators authenticate and switch.</div>
      </div>
    `;
  }

  const rows = cachedSessions
    .map((s) => {
      const statusClass = s.status === "ACTIVE" ? "success" : s.status === "LOCKED" ? "warning" : "info";
      const startedStr = new Date(s.sessionStartedAt).toLocaleString("en-IN");
      const endedStr = s.endedAt ? new Date(s.endedAt).toLocaleTimeString("en-IN") : "Active";

      return `
        <tr style="border-bottom:1px solid var(--border-subtle);">
          <td style="padding:14px 16px; font-weight:700; font-family:var(--font-mono); color:var(--ink);">
            ${escapeHtml(s.operatorSessionId)}
          </td>
          <td style="padding:14px 16px;">
            <div style="font-weight:700; color:var(--ink);">${escapeHtml(s.operatorNameSnapshot || s.operatorUserId)}</div>
            <div style="font-size:11.5px; color:var(--muted); font-family:var(--font-mono);">${escapeHtml(s.operatorUserId)} · ${escapeHtml(s.authMethod || "PIN")}</div>
          </td>
          <td style="padding:14px 16px;">
            📍 ${escapeHtml(s.cafeId)} · <span style="font-family:var(--font-mono); font-size:11px;">${escapeHtml(s.deviceId)}</span>
          </td>
          <td style="padding:14px 16px;">
            <span class="status ${statusClass}" style="font-weight:700; font-size:11px;">${escapeHtml(s.status)}</span>
          </td>
          <td style="padding:14px 16px; font-size:12px; color:var(--muted);">
            <div>${escapeHtml(startedStr)}</div>
            <div style="font-size:11px;">End: ${escapeHtml(endedStr)} ${s.endReason ? `(${escapeHtml(s.endReason)})` : ""}</div>
          </td>
          <td style="padding:14px 16px;">
            ${
              s.handoverNote
                ? `<div style="font-size:12px; color:var(--ink); max-width:240px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(s.handoverNote)}">📝 ${escapeHtml(s.handoverNote)}</div>`
                : `<span style="color:var(--muted); font-size:11px;">—</span>`
            }
          </td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="card" style="padding:0; overflow:hidden;">
      <table style="width:100%; border-collapse:collapse; text-align:left; font-size:13px;">
        <thead>
          <tr style="background:var(--bg-surface-2); border-bottom:1px solid var(--border-subtle); font-size:11.5px; text-transform:uppercase; color:var(--muted); letter-spacing:0.04em;">
            <th style="padding:12px 16px;">Session ID</th>
            <th style="padding:12px 16px;">Operator</th>
            <th style="padding:12px 16px;">Cafe &amp; Device</th>
            <th style="padding:12px 16px;">Status</th>
            <th style="padding:12px 16px;">Timeline</th>
            <th style="padding:12px 16px;">Handover Note</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

function wireSessionsTable(root) {
  // Session table event bindings if needed
}

function renderPinSetupView() {
  const user = state.auth?.user || state.user || {};
  return `
    <div style="max-width:560px; margin:0 auto;">
      <div class="card" style="padding:24px;">
        <h3 style="font-size:17px; font-weight:800; margin:0 0 6px; color:var(--ink);">Operator 6-Digit PIN Configuration</h3>
        <p style="font-size:12.5px; color:var(--muted); margin:0 0 20px;">
          Your Operator PIN is used to quickly sign in, lock, and unlock Zamorin Cafe Operations terminals.
        </p>

        <form id="pin-setup-form">
          <div class="form-group" style="margin-bottom:16px;">
            <label class="label" style="font-weight:700;">Target Operator User ID</label>
            <input type="text" id="pin-target-user" class="input" value="${user.userId || "AD-0001"}" ${state.role !== "master" ? "readonly" : ""} required />
            <div style="font-size:11.5px; color:var(--muted); margin-top:4px;">Only active CAFE_ADMIN and MASTER accounts are eligible.</div>
          </div>

          <div class="form-group" style="margin-bottom:16px;">
            <label class="label" style="font-weight:700;">New 6-Digit PIN*</label>
            <div style="position:relative; display:flex; align-items:center;">
              <input type="password" id="pin-new-code" class="input" placeholder="••••••" maxlength="6" inputmode="numeric" style="width:100%; font-size:20px; letter-spacing:6px; font-family:var(--font-mono); padding-right:42px; box-sizing:border-box;" required />
              <button type="button" class="pin-visibility-toggle" data-toggle-visibility="pin-new-code" title="Show PIN" aria-label="Show PIN">
                ${icon("eye", 16)}
              </button>
            </div>
            <div style="font-size:11.5px; color:var(--muted); margin-top:4px;">Avoid simple numbers like 123456 or 000000.</div>
          </div>

          <div class="form-group" style="margin-bottom:24px;">
            <label class="label" style="font-weight:700;">Confirm 6-Digit PIN*</label>
            <div style="position:relative; display:flex; align-items:center;">
              <input type="password" id="pin-confirm-code" class="input" placeholder="••••••" maxlength="6" inputmode="numeric" style="width:100%; font-size:20px; letter-spacing:6px; font-family:var(--font-mono); padding-right:42px; box-sizing:border-box;" required />
              <button type="button" class="pin-visibility-toggle" data-toggle-visibility="pin-confirm-code" title="Show PIN" aria-label="Show PIN">
                ${icon("eye", 16)}
              </button>
            </div>
          </div>

          <div style="display:flex; justify-content:flex-end;">
            <button class="btn btn-primary" type="submit" style="font-weight:700;">Save &amp; Activate PIN</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function wirePinSetupView(root) {
  const form = root.querySelector("#pin-setup-form");
  if (!form) return;

  root.querySelectorAll("[data-toggle-visibility]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const targetId = btn.getAttribute("data-toggle-visibility");
      const input = root.querySelector(`#${targetId}`);
      if (!input) return;
      const isPwd = input.type === "password";
      input.type = isPwd ? "text" : "password";
      btn.innerHTML = isPwd ? icon("eyeOff", 16) : icon("eye", 16);
      btn.setAttribute("title", isPwd ? "Hide PIN" : "Show PIN");
      btn.style.color = isPwd ? "var(--primary, #c9933b)" : "var(--muted)";
    });
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const targetUserId = root.querySelector("#pin-target-user")?.value?.trim();
    const newPin = root.querySelector("#pin-new-code")?.value?.trim();
    const confirmPin = root.querySelector("#pin-confirm-code")?.value?.trim();

    if (!newPin || newPin.length !== 6 || !/^\d{6}$/.test(newPin)) {
      showToast("Operator PIN must be exactly 6 numeric digits.", "error");
      return;
    }

    if (newPin !== confirmPin) {
      showToast("PIN confirmation does not match.", "error");
      return;
    }

    try {
      await apiPost("/cafe-operations/operator/pin/set", {
        targetUserId,
        newPin,
      });

      showToast("Operator PIN configured successfully.", "success");
      form.reset();
    } catch (err) {
      showToast(err.message || "Failed to configure PIN.", "error");
    }
  });
}

async function openEnrollDeviceModal(root) {
  await loadCafesList();
  const cafeOpts = cachedCafes.length
    ? cachedCafes.map(c => `<option value="${c.cafeId || c.code || c.id || c._id}">${c.cafeId || c.code || ''} · ${c.name || 'Outlet'}</option>`).join('')
    : '<option value="">No Active Cafes Found</option>';

  const content = `
    <div style="max-width:480px; margin:0 auto; padding:10px 0;">
      <h3 style="font-size:17px; font-weight:800; margin:0 0 6px; color:var(--ink);">Enroll Trusted Terminal Hardware</h3>
      <p style="font-size:12.5px; color:var(--muted); margin:0 0 16px;">Enroll a cafe-owned tablet or POS register into the Zamorin fleet.</p>

      <div class="form-group" style="margin-bottom:14px;">
        <label class="label">Hardware Device ID*</label>
        <input type="text" id="enr-device-id" class="input" placeholder="e.g. ZC-DEV-0003" required />
      </div>

      <div class="form-group" style="margin-bottom:14px;">
        <label class="label">Device Friendly Name*</label>
        <input type="text" id="enr-device-name" class="input" placeholder="e.g. Calicut Beach Main POS" required />
      </div>

      <div class="form-group" style="margin-bottom:14px;">
        <label class="label">Assigned Cafe Location*</label>
        <select id="enr-cafe-id" class="input">
          ${cafeOpts}
        </select>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:20px; border-top:1px solid var(--border-subtle); padding-top:14px;">
        <button class="btn btn-ghost" id="enr-btn-cancel" type="button">Cancel</button>
        <button class="btn btn-primary" id="enr-btn-submit" type="button">Enroll &amp; Approve</button>
      </div>
    </div>
  `;

  openModal(content);
  const modalEl = document.getElementById("zamorin-global-modal");

  modalEl?.querySelector("#enr-btn-cancel")?.addEventListener("click", () => closeModal());
  modalEl?.querySelector("#enr-btn-submit")?.addEventListener("click", async () => {
    const deviceId = modalEl.querySelector("#enr-device-id")?.value?.trim();
    const deviceName = modalEl.querySelector("#enr-device-name")?.value?.trim();
    const assignedCafeId = modalEl.querySelector("#enr-cafe-id")?.value;

    if (!deviceId || !deviceName) {
      showToast("Please provide device ID and name.", "error");
      return;
    }

    try {
      await apiPost("/devices/enrollment/start", {
        deviceId,
        deviceName,
        deviceClass: "CAFE_OWNED",
        platform: "ANDROID_TABLET",
      });

      // Master approval
      await apiPost(`/devices/${deviceId}/approve`, {
        assignedCafeId,
        trustLevel: "ENROLLED",
      });

      showToast(`Device ${deviceId} enrolled successfully.`, "success");
      closeModal();
      loadFleetData(root);
    } catch (err) {
      showToast(err.message || "Failed to enroll device.", "error");
    }
  });
}

// ── P20 Hardware Peripherals Management & Diagnostics ────────────────────────

let cachedPeripherals = [];
let cachedUnassignedAlert = null;

function renderPeripheralsView() {
  const user = state.auth?.user || state.user || {};
  const cafeId = state.currentCafeId || user.primaryCafeId || "MAIN-01";

  const alertBanner = cachedUnassignedAlert?.hasAlert
    ? `
      <div class="card" style="padding:14px 18px; margin-bottom:16px; background:#fffbeb; border:1px solid #fef3c7; border-left:4px solid #f59e0b; border-radius:var(--radius-md);">
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="font-size:18px;">⚠️</span>
          <div>
            <div style="font-weight:700; font-size:13px; color:#92400e;">Station Routing Alert (Petpooja Benchmark A023)</div>
            <div style="font-size:12px; color:#b45309;">${escapeHtml(cachedUnassignedAlert.alertMessage)}</div>
          </div>
        </div>
      </div>
    `
    : "";

  if (!cachedPeripherals.length) {
    return `
      ${alertBanner}
      <div class="card" style="padding:40px; text-align:center; color:var(--muted);">
        <div style="font-size:32px; margin-bottom:12px;">🖨️</div>
        <div style="font-weight:700; font-size:15px; color:var(--ink); margin-bottom:4px;">No Peripheral Devices Registered</div>
        <p style="font-size:13px; margin:0 0 16px;">Configure printers, cash drawers, weighing scales, and payment terminals for ${escapeHtml(cafeId)}.</p>
        <button class="btn btn-primary btn-sm" id="empty-add-peripheral-btn">+ Add First Hardware Device</button>
      </div>
    `;
  }

  const rows = cachedPeripherals.map((dev) => {
    let typeIcon = "🔌";
    if (dev.deviceType === "RECEIPT_PRINTER") typeIcon = "🖨️";
    else if (dev.deviceType === "CASH_DRAWER") typeIcon = "💵";
    else if (dev.deviceType === "WEIGHING_SCALE") typeIcon = "⚖️";
    else if (dev.deviceType === "BARCODE_SCANNER") typeIcon = "📷";
    else if (dev.deviceType === "PAYMENT_TERMINAL") typeIcon = "💳";
    else if (dev.deviceType === "BIOMETRIC_SCANNER") typeIcon = "👆";
    else if (dev.deviceType === "SOUNDBOX") typeIcon = "🔊";
    else if (dev.deviceType === "CALLER_ID_MODEM") typeIcon = "📞";

    const statusBadge = dev.healthStatus === "ONLINE"
      ? '<span class="status success">ONLINE</span>'
      : dev.healthStatus === "SIMULATED"
      ? '<span class="status info">SIMULATED</span>'
      : dev.healthStatus === "ERROR"
      ? '<span class="status danger">ERROR</span>'
      : '<span class="status warning">UNCONFIGURED</span>';

    let configSummary = dev.connectionMode;
    if (dev.deviceType === "RECEIPT_PRINTER") {
      configSummary += ` · ${dev.configuration?.paperWidth || 80}mm ESC/POS`;
    } else if (dev.deviceType === "CASH_DRAWER") {
      configSummary += ` · Pin ${dev.configuration?.drawerPin || 2} Kick`;
    } else if (dev.deviceType === "WEIGHING_SCALE") {
      configSummary += ` · Protocol: ${dev.configuration?.scaleProtocol || "TOLEDO"}`;
    }

    let actionButton = "";
    if (dev.deviceType === "RECEIPT_PRINTER") {
      actionButton = `<button class="btn btn-sm btn-secondary" data-peripheral-action="test-print" data-id="${escapeHtml(dev.deviceId)}">Test Print</button>`;
    } else if (dev.deviceType === "CASH_DRAWER") {
      actionButton = `<button class="btn btn-sm btn-secondary" data-peripheral-action="kick-drawer" data-id="${escapeHtml(dev.deviceId)}">Kick Drawer</button>`;
    } else if (dev.deviceType === "WEIGHING_SCALE") {
      actionButton = `<button class="btn btn-sm btn-secondary" data-peripheral-action="test-scale" data-id="${escapeHtml(dev.deviceId)}">Read Scale</button>`;
    } else if (dev.deviceType === "BARCODE_SCANNER") {
      actionButton = `<button class="btn btn-sm btn-secondary" data-peripheral-action="test-scan" data-id="${escapeHtml(dev.deviceId)}">Test Scan</button>`;
    } else if (dev.deviceType === "PAYMENT_TERMINAL") {
      actionButton = `<button class="btn btn-sm btn-secondary" data-peripheral-action="push-edc" data-id="${escapeHtml(dev.deviceId)}">Push ₹10</button>`;
    } else if (dev.deviceType === "BIOMETRIC_SCANNER") {
      actionButton = `<button class="btn btn-sm btn-secondary" data-peripheral-action="test-biometric" data-id="${escapeHtml(dev.deviceId)}">Test Scanner</button>`;
    } else if (dev.deviceType === "SOUNDBOX") {
      actionButton = `<button class="btn btn-sm btn-secondary" data-peripheral-action="test-soundbox" data-id="${escapeHtml(dev.deviceId)}">Test Audio</button>`;
    } else if (dev.deviceType === "CALLER_ID_MODEM") {
      actionButton = `<button class="btn btn-sm btn-secondary" data-peripheral-action="test-caller-id" data-id="${escapeHtml(dev.deviceId)}">Simulate Call</button>`;
    }


    return `
      <tr style="border-bottom:1px solid var(--border-subtle);">
        <td style="padding:14px 16px; font-weight:700; font-family:var(--font-mono); color:var(--ink);">
          ${escapeHtml(dev.deviceId)}
        </td>
        <td style="padding:14px 16px;">
          <div style="font-weight:700; color:var(--ink); display:flex; align-items:center; gap:6px;">
            <span>${typeIcon}</span> <span>${escapeHtml(dev.name)}</span>
          </div>
          <div style="font-size:11.5px; color:var(--muted);">${escapeHtml(dev.deviceType)} · ${escapeHtml(configSummary)}</div>
        </td>
        <td style="padding:14px 16px; font-weight:600;">
          🏷️ ${escapeHtml(dev.assignment?.station || "UNASSIGNED")}
        </td>
        <td style="padding:14px 16px;">
          ${statusBadge}
        </td>
        <td style="padding:14px 16px; font-size:12px; color:var(--muted);">
          ${dev.lastSuccessfulCheck ? new Date(dev.lastSuccessfulCheck).toLocaleTimeString() : "Never"}
        </td>
        <td style="padding:14px 16px; text-align:right;">
          <div style="display:inline-flex; gap:6px;">
            ${actionButton}
            <button class="btn btn-sm btn-ghost" data-peripheral-action="diagnostic" data-id="${escapeHtml(dev.deviceId)}">Self-Test</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  return `
    ${alertBanner}
    <div class="card" style="padding:0; overflow:hidden;">
      <table style="width:100%; border-collapse:collapse; text-align:left; font-size:13px;">
        <thead>
          <tr style="background:var(--bg-surface-2); border-bottom:1px solid var(--border-subtle); font-size:11.5px; text-transform:uppercase; color:var(--muted); letter-spacing:0.04em;">
            <th style="padding:12px 16px;">Device ID</th>
            <th style="padding:12px 16px;">Name / Type / Config</th>
            <th style="padding:12px 16px;">Station Assignment</th>
            <th style="padding:12px 16px;">Health</th>
            <th style="padding:12px 16px;">Last Checked</th>
            <th style="padding:12px 16px; text-align:right;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

async function wirePeripheralsView(root) {
  const user = state.auth?.user || state.user || {};
  const cafeId = state.currentCafeId || user.primaryCafeId || "MAIN-01";

  async function loadPeripherals() {
    try {
      const [devRes, alertRes] = await Promise.all([
        apiGet(`/hardware/devices/${cafeId}`),
        apiGet(`/hardware/unassigned-printers/${cafeId}`),
      ]);
      cachedPeripherals = devRes?.data?.devices || [];
      cachedUnassignedAlert = alertRes?.data || null;
      renderActiveTabContent(root);
    } catch (err) {
      console.warn("Failed to load peripherals:", err.message);
    }
  }

  // Load if empty
  if (!cachedPeripherals.length) {
    loadPeripherals();
  }

  root.querySelector("#empty-add-peripheral-btn")?.addEventListener("click", () => openAddPeripheralModal(root));

  root.querySelectorAll("[data-peripheral-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.dataset.peripheralAction;
      const deviceId = btn.dataset.id;
      btn.disabled = true;

      try {
        if (action === "test-print") {
          showToast(`Sending diagnostic test receipt to ${deviceId}...`, "info");
          const res = await apiPost(`/hardware/devices/${deviceId}/diagnostic`, {});
          showToast(`✅ Test receipt compiled (${res?.data?.result?.bytesLength || 0} bytes). Print dispatched.`, "success");
        } else if (action === "kick-drawer") {
          const res = await apiPost(`/hardware/devices/${deviceId}/diagnostic`, { reason: "Operator manual test" });
          showToast(`✅ Cash drawer pulse emitted on Pin ${res?.data?.result?.pin || 2}. Zero financial entries created.`, "success");
        } else if (action === "test-scale") {
          const rawPayload = prompt("Simulate serial scale stream (e.g. ST,GS,+00.450kg or W:0.820kg):", "ST,GS,+00.450kg");
          if (rawPayload) {
            const res = await apiPost("/hardware/scale/parse", { rawPayload, protocol: "TOLEDO" });
            showToast(`⚖️ Scale reading: ${res.weight} ${res.unit} (Stable: ${res.isStable})`, "success");
          }
        } else if (action === "test-scan") {
          const code = prompt("Simulate barcode/QR scan (e.g. ZC-ITEM-001 or EAN-13):", "ZC-ITEM-001");
          if (code) {
            const res = await apiPost("/hardware/scan/validate", {
              code,
              menuItems: [{ sku: "ZC-ITEM-001", name: "Malabar Filter Coffee", price: 60, soldOut: false }],
            });
            showToast(`📷 Scanned: ${res.item?.name} @ ₹${res.item?.price} (${res.scanType})`, "success");
          }
        } else if (action === "test-terminal" || action === "diagnostic") {
          const res = await apiPost(`/hardware/devices/${deviceId}/diagnostic`, {});
          showToast(`✅ Device self-test: ${res?.data?.healthStatus || "ONLINE"} (${res?.data?.durationMs || 0}ms)`, "success");
        } else if (action === "push-edc") {
          showToast(`Pushing ₹10.00 to EDC Terminal ${deviceId}...`, "info");
          const res = await apiPost("/hardware/edc/push-sale", { terminalId: deviceId, amountPaisa: 1000, provider: "PINELABS" });
          showToast(`💳 EDC Sale Pushed: ${res?.data?.status} (${res?.data?.transactionRef})`, "success");
        } else if (action === "test-biometric") {
          showToast(`Diagnosing Biometric Scanner ${deviceId}...`, "info");
          const res = await apiPost("/hardware/biometric/device-test", { model: "MANTRA_MFS100" });
          showToast(`👆 Biometric: ${res?.data?.status || "ONLINE"} (Driver: ${res?.data?.driverStatus || "ACTIVE"})`, "success");
        } else if (action === "test-soundbox") {
          showToast(`Triggering test speech broadcast on Soundbox ${deviceId}...`, "info");
          const res = await apiPost("/hardware/soundbox/broadcast", { amountPaisa: 12000, language: "en", terminalId: deviceId });
          showToast(`🔊 Soundbox: Broadcast "${res?.data?.speechText}" dispatched!`, "success");
        } else if (action === "test-caller-id") {
          const phone = prompt("Simulate incoming caller phone number:", "9876543210");
          if (phone) {
            const res = await apiPost("/hardware/caller-id/incoming", { phoneNumber: phone, rawCallerName: "Valued Guest" });
            showToast(`📞 Caller ID: ${res?.data?.customerName} (${res?.data?.customerPhone}) pop-up dispatched!`, "success");
          }
        }
      } catch (err) {

        showToast(err.message || "Action failed.", "error");
      } finally {
        btn.disabled = false;
        loadPeripherals();
      }
    });
  });
}

function openAddPeripheralModal(root) {
  const user = state.auth?.user || state.user || {};
  const defaultCafeId = state.currentCafeId || user.primaryCafeId || "MAIN-01";

  const content = `
    <div style="max-width:520px; margin:0 auto; padding:8px 0;">
      <h3 style="font-size:18px; font-weight:800; margin:0 0 6px; color:var(--ink);">Add Hardware Peripheral Device</h3>
      <p style="font-size:12.5px; color:var(--muted); margin:0 0 16px;">Configure printers, drawers, scanners, scales, and POS peripherals.</p>

      <div class="form-group" style="margin-bottom:12px;">
        <label class="label">Device Identifier*</label>
        <input type="text" id="periph-id" class="input" placeholder="e.g. PRN-COUNTER-01" required />
      </div>

      <div class="form-group" style="margin-bottom:12px;">
        <label class="label">Device Name*</label>
        <input type="text" id="periph-name" class="input" placeholder="e.g. Billing Counter Thermal Printer" required />
      </div>

      <div class="form-group" style="margin-bottom:12px;">
        <label class="label">Device Type*</label>
        <select id="periph-type" class="input">
          <option value="RECEIPT_PRINTER">Receipt Printer (ESC/POS)</option>
          <option value="CASH_DRAWER">Cash Drawer (Kick Pulse)</option>
          <option value="BARCODE_SCANNER">Barcode / QR Scanner</option>
          <option value="WEIGHING_SCALE">Weighing Scale (Serial Protocol)</option>
          <option value="PAYMENT_TERMINAL">Payment Terminal / EDC</option>
          <option value="BIOMETRIC_SCANNER">Biometric Fingerprint Scanner (Mantra/Morpho)</option>
          <option value="SOUNDBOX">Spoken UPI Soundbox (Paytm/PhonePe)</option>
          <option value="CALLER_ID_MODEM">Caller ID USB Modem (AT+VCID)</option>
          <option value="CUSTOMER_DISPLAY">Customer Pole Display</option>
        </select>

      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px;">
        <div class="form-group">
          <label class="label">Connection Mode</label>
          <select id="periph-mode" class="input">
            <option value="LAN_ETHERNET">LAN / Network (TCP)</option>
            <option value="USB">Direct USB</option>
            <option value="SERIAL_COM">Serial COM Port</option>
            <option value="LOCAL_BRIDGE_PROXY">Local Bridge Daemon (:9199)</option>
            <option value="VIRTUAL_SIMULATION">Virtual Simulation</option>
          </select>
        </div>
        <div class="form-group">
          <label class="label">Station Assignment</label>
          <select id="periph-station" class="input">
            <option value="BILLING">Billing Counter</option>
            <option value="DISPATCH">Dispatch Counter</option>
            <option value="BARISTA">Barista Station</option>
            <option value="HOT_KITCHEN">Hot Kitchen</option>
            <option value="DESSERT_BAR">Dessert Bar</option>
            <option value="UNASSIGNED">Unassigned</option>
          </select>
        </div>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:20px; border-top:1px solid var(--border-subtle); padding-top:14px;">
        <button class="btn btn-ghost" id="periph-btn-cancel" type="button">Cancel</button>
        <button class="btn btn-primary" id="periph-btn-submit" type="button">Save Device</button>
      </div>
    </div>
  `;

  openModal(content);
  const modalEl = document.getElementById("zamorin-global-modal");

  modalEl?.querySelector("#periph-btn-cancel")?.addEventListener("click", () => closeModal());
  modalEl?.querySelector("#periph-btn-submit")?.addEventListener("click", async () => {
    const deviceId = modalEl.querySelector("#periph-id")?.value?.trim();
    const name = modalEl.querySelector("#periph-name")?.value?.trim();
    const deviceType = modalEl.querySelector("#periph-type")?.value;
    const connectionMode = modalEl.querySelector("#periph-mode")?.value;
    const station = modalEl.querySelector("#periph-station")?.value;

    if (!deviceId || !name) {
      showToast("Please provide device identifier and name.", "error");
      return;
    }

    try {
      await apiPost("/hardware/devices", {
        deviceId,
        cafeId: defaultCafeId,
        name,
        deviceType,
        connectionMode,
        configuration: {
          paperWidth: 80,
          drawerPin: 2,
          scaleProtocol: "TOLEDO",
        },
        assignment: {
          station,
          counterName: "Counter 1",
          active: true,
        },
      });

      showToast(`Device ${deviceId} registered successfully.`, "success");
      closeModal();
      wirePeripheralsView(root);
    } catch (err) {
      showToast(err.message || "Failed to register hardware device.", "error");
    }
  });
}

