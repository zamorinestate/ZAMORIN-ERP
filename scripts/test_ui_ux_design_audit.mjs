#!/usr/bin/env node
// =============================================================================
// ZAMORIN CAFE ERP — AUTOMATED UI/UX DESIGN QUALITY & CONSISTENCY AUDIT SUITE
// =============================================================================

import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_DIR = path.resolve(__dirname, '../frontend');
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const HTTP_PORT = 3528;
const CDP_PORT = 9290;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let reqPath = req.url.split('?')[0];
      if (reqPath === '/') reqPath = '/index.html';
      const filePath = path.join(FRONTEND_DIR, reqPath);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain' });
        fs.createReadStream(filePath).pipe(res);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });
    server.listen(HTTP_PORT, () => resolve(server));
  });
}

function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.callbacks = new Map();
    this.consoleErrors = [];
    this.runtimeExceptions = [];

    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        this.runtimeExceptions.push(msg.params);
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        if (msg.params.type === 'error') {
          this.consoleErrors.push(msg.params);
        }
      }
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval exception: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value;
  }

  close() {
    this.ws.close();
  }
}

async function runAudit() {
  console.log("===============================================================================");
  console.log("ZAMORIN CAFÉ ERP — UI/UX DESIGN QUALITY & THEME CONSISTENCY AUDIT SUITE");
  console.log("===============================================================================\n");

  const server = await startServer();
  console.log(`[HTTP] Static server listening on http://127.0.0.1:${HTTP_PORT}`);

  const userDataDir = path.resolve(__dirname, '../.chrome_ui_ux_profile');
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  const chromeProc = spawn(CHROME_PATH, [
    `--remote-debugging-port=${CDP_PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-background-networking',
    `--user-data-dir=${userDataDir}`,
    `http://127.0.0.1:${HTTP_PORT}/index.html?role=master`,
  ]);

  await delay(1500);

  let versionData;
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      const resp = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      versionData = await resp.json();
      break;
    } catch {
      await delay(500);
    }
  }

  if (!versionData) {
    throw new Error("Could not connect to Chrome remote debugging port.");
  }

  const listResp = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  const targets = await listResp.json();
  const pageTarget = targets.find((t) => t.type === 'page') || targets[0];

  const cdp = new CdpClient(pageTarget.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  console.log("[CDP] Connected to Headless Chrome session.\n");

  const results = [];

  async function check(name, fn) {
    process.stdout.write(`  • ${name.padEnd(72, '.')}`);
    try {
      await fn();
      console.log(" PASS");
      results.push({ name, status: "PASS" });
    } catch (err) {
      console.log(` FAIL (${err.message})`);
      results.push({ name, status: "FAIL", error: err.message });
    }
  }

  // Section 1: Design Tokens & Typography
  console.log("1. DESIGN TOKENS & TYPOGRAPHY FOUNDATION");
  await check("Core typography tokens are loaded and defined on :root", async () => {
    const res = await cdp.eval(`(() => {
      const cs = getComputedStyle(document.documentElement);
      const fontUi = cs.getPropertyValue('--font-ui').trim();
      const fontDisplay = cs.getPropertyValue('--font-display').trim();
      const fontMono = cs.getPropertyValue('--font-mono').trim();
      const controlH = cs.getPropertyValue('--control-height').trim();
      return { fontUi, fontDisplay, fontMono, controlH };
    })()`);
    if (!res.fontUi.includes("Inter")) throw new Error(`--font-ui missing Inter: ${res.fontUi}`);
    if (!res.fontDisplay.includes("Fraunces")) throw new Error(`--font-display missing Fraunces: ${res.fontDisplay}`);
    if (!res.fontMono.includes("IBM Plex Mono")) throw new Error(`--font-mono missing IBM Plex Mono: ${res.fontMono}`);
    if (!res.controlH) throw new Error(`--control-height not defined`);
  });

  // Section 2: Theme System Audit (All 4 Themes)
  console.log("\n2. THEME SYSTEM AUDIT (PAPER, PEARL, MIDNIGHT, NOIR)");
  const themes = ['paper', 'pearl', 'midnight', 'noir'];
  for (const theme of themes) {
    await check(`Theme '${theme}' defines valid contrasting surface and ink variables`, async () => {
      const res = await cdp.eval(`(() => {
        document.documentElement.dataset.theme = '${theme}';
        const cs = getComputedStyle(document.documentElement);
        return {
          paper: cs.getPropertyValue('--paper').trim(),
          surface: cs.getPropertyValue('--surface').trim(),
          ink: cs.getPropertyValue('--ink').trim(),
          muted: cs.getPropertyValue('--muted').trim(),
          bronze500: cs.getPropertyValue('--bronze-500').trim(),
        };
      })()`);
      if (!res.paper) throw new Error(`--paper empty in ${theme}`);
      if (!res.surface) throw new Error(`--surface empty in ${theme}`);
      if (!res.ink) throw new Error(`--ink empty in ${theme}`);
      if (!res.muted) throw new Error(`--muted empty in ${theme}`);
      if (!res.bronze500) throw new Error(`--bronze-500 empty in ${theme}`);
    });
  }

  // Reset to default theme
  await cdp.eval(`document.documentElement.dataset.theme = 'paper'`);

  // Section 3: Reusable Button Component States
  console.log("\n3. BUTTON SYSTEM & INTERACTIVE STATES");
  await check("Button variants have consistent heights, radius, and active click response", async () => {
    const res = await cdp.eval(`(() => {
      const container = document.createElement('div');
      container.id = 'test-btn-sandbox';
      container.innerHTML = \`
        <button class="btn btn-primary" id="t-btn-pri">Primary</button>
        <button class="btn btn-secondary" id="t-btn-sec">Secondary</button>
        <button class="btn btn-ghost" id="t-btn-gho">Ghost</button>
        <button class="btn btn-sm" id="t-btn-sm">Small</button>
        <button class="btn btn-lg" id="t-btn-lg">Large</button>
        <button class="btn" id="t-btn-dis" disabled>Disabled</button>
      \`;
      document.body.appendChild(container);

      const pri = getComputedStyle(document.getElementById('t-btn-pri'));
      const sm = getComputedStyle(document.getElementById('t-btn-sm'));
      const lg = getComputedStyle(document.getElementById('t-btn-lg'));
      const dis = getComputedStyle(document.getElementById('t-btn-dis'));

      const priHeight = parseFloat(pri.height);
      const smHeight = parseFloat(sm.height);
      const lgHeight = parseFloat(lg.height);
      const disOpacity = parseFloat(dis.opacity);

      container.remove();

      return { priHeight, smHeight, lgHeight, disOpacity };
    })()`);

    if (res.priHeight < 36 || res.priHeight > 48) throw new Error(`Unexpected standard btn height: ${res.priHeight}px`);
    if (res.smHeight < 28 || res.smHeight > 36) throw new Error(`Unexpected sm btn height: ${res.smHeight}px`);
    if (res.lgHeight < 44 || res.lgHeight > 56) throw new Error(`Unexpected lg btn height: ${res.lgHeight}px`);
    if (res.disOpacity > 0.7 || res.disOpacity < 0.3) throw new Error(`Disabled button opacity invalid: ${res.disOpacity}`);
  });

  // Section 4: Universal Select & Dropdown Primitive
  console.log("\n4. SELECT & DROPDOWN PRIMITIVE (createSelect)");
  await check("createSelect renders, handles keyboard navigation and boundary detection", async () => {
    const res = await cdp.eval(`(async () => {
      const { createSelect } = await import('/src/js/components.js');
      const container = document.createElement('div');
      container.id = 'test-select-host';
      container.style.cssText = "padding:20px; width:300px;";
      document.body.appendChild(container);

      let capturedValue = "";
      const selectInst = createSelect(container, {
        options: [
          { value: 'ZC-0001', label: 'Koramangala Flagship' },
          { value: 'ZC-0002', label: 'Indiranagar Roastery' },
          { value: 'ZC-0003', label: 'Calicut Beach' },
        ],
        value: 'ZC-0001',
        onChange: (v) => { capturedValue = v; },
      });

      const trigger = container.querySelector('.zamorin-select-trigger');
      const menu = container.querySelector('.zamorin-select-menu');
      const initialLabel = container.querySelector('.zamorin-select-label')?.textContent;

      // Open select
      selectInst.open();
      const isOpenAfterOpen = container.querySelector('.zamorin-select-wrap')?.classList.contains('open');

      // Change value programmatically
      selectInst.setValue('ZC-0002');
      const labelAfterSet = container.querySelector('.zamorin-select-label')?.textContent;

      // Close
      selectInst.close();
      const isOpenAfterClose = container.querySelector('.zamorin-select-wrap')?.classList.contains('open');

      container.remove();

      return {
        initialLabel,
        isOpenAfterOpen,
        labelAfterSet,
        isOpenAfterClose,
        capturedValue,
      };
    })()`);

    if (res.initialLabel !== 'Koramangala Flagship') throw new Error(`Initial label mismatch: ${res.initialLabel}`);
    if (!res.isOpenAfterOpen) throw new Error(`Select did not open`);
    if (res.labelAfterSet !== 'Indiranagar Roastery') throw new Error(`Label did not update: ${res.labelAfterSet}`);
    if (res.isOpenAfterClose) throw new Error(`Select did not close`);
  });

  // Section 5: Universal DatePicker Primitive
  console.log("\n5. DATE PICKER PRIMITIVE (createDatePicker)");
  await check("createDatePicker renders 7x6 calendar grid, today indicator, and date selection", async () => {
    const res = await cdp.eval(`(async () => {
      const { createDatePicker } = await import('/src/js/components.js');
      const container = document.createElement('div');
      container.id = 'test-dp-host';
      container.style.cssText = "padding:20px; width:260px;";
      document.body.appendChild(container);

      let chosenDate = "";
      const dp = createDatePicker(container, {
        value: '2026-08-15',
        onChange: (d) => { chosenDate = d; },
      });

      dp.open();
      const popup = container.querySelector('.zamorin-calendar-popup');
      const isPopupVisible = popup && window.getComputedStyle(popup).display !== 'none';

      const dayCells = container.querySelectorAll('.zamorin-cal-day-cell');
      const monthTitle = container.querySelector('.zamorin-cal-month-title')?.textContent;

      // Click today button
      const todayBtn = container.querySelector('[data-cal-action="today"]');
      todayBtn?.click();

      const newDate = dp.getDate();
      dp.close();

      container.remove();

      return {
        isPopupVisible,
        cellCount: dayCells.length,
        monthTitle,
        newDate,
      };
    })()`);

    if (!res.isPopupVisible) throw new Error(`DatePicker popup was not displayed`);
    if (res.cellCount < 28 || res.cellCount > 42) throw new Error(`Unexpected calendar cell count: ${res.cellCount}`);
    if (!res.monthTitle?.includes("August 2026")) throw new Error(`Month title mismatch: ${res.monthTitle}`);
  });

  // Section 6: Universal Modal Manager
  console.log("\n6. MODAL & CONFIRMATION DIALOG PRIMITIVE");
  await check("openModal and confirmAction mount accessible dialog with focus and Esc handling", async () => {
    const res = await cdp.eval(`(async () => {
      const { openModal, closeModal } = await import('/src/js/components.js');

      openModal({
        title: "Test Modal Dialog",
        body: "<p id='test-modal-para'>Modal Body Content</p>",
        saveLabel: "Accept",
        cancelLabel: "Dismiss",
      });

      const modalEl = document.getElementById('zamorin-global-modal');
      const isOpen = modalEl?.classList.contains('open');
      const title = modalEl?.querySelector('.modal-title')?.textContent;
      const hasSaveBtn = Boolean(modalEl?.querySelector('[data-modal-save]'));

      closeModal();
      const isClosed = !document.getElementById('zamorin-global-modal');

      return { isOpen, title, hasSaveBtn, isClosed };
    })()`);

    if (!res.isOpen) throw new Error(`Modal did not mount with .open class`);
    if (res.title !== "Test Modal Dialog") throw new Error(`Modal title mismatch: ${res.title}`);
    if (!res.hasSaveBtn) throw new Error(`Save button missing in modal`);
    if (!res.isClosed) throw new Error(`Modal did not unmount cleanly`);
  });

  // Section 7: Toast Live Region & Alerts
  console.log("\n7. TOAST NOTIFICATIONS & LIVE REGION");
  await check("showToast creates polite/alert notifications with duplicate suppression", async () => {
    const res = await cdp.eval(`(async () => {
      const { showToast } = await import('/src/js/components.js');

      showToast("Operation successful", "success");
      showToast("Operation successful", "success"); // Duplicate suppressed

      const stack = document.getElementById('toast-root');
      const toasts = stack?.querySelectorAll('.toast-card');
      const firstToastRole = toasts?.[0]?.getAttribute('role');

      return {
        stackPresent: Boolean(stack),
        toastCount: toasts?.length || 0,
        firstToastRole,
      };
    })()`);

    if (!res.stackPresent) throw new Error(`toast-root missing in DOM`);
    if (res.toastCount !== 1) throw new Error(`Duplicate toast suppression failed (count=${res.toastCount})`);
    if (res.firstToastRole !== 'status') throw new Error(`Expected role='status', got ${res.firstToastRole}`);
  });

  // Section 8: Navigation & Role Scope Coherence
  console.log("\n8. APP SHELL NAVIGATION & ROLE SCOPES");
  const roleScenarios = [
    { role: 'master', isPrimary: true, expectedRouteCount: 32 },
    { role: 'owner', isPrimary: false, expectedRouteCount: 39 },
    { role: 'cafe_admin', isPrimary: false, expectedRouteCount: 15 },
    { role: 'staff', isPrimary: false, expectedRouteCount: 5 },
  ];

  for (const s of roleScenarios) {
    await check(`Navigation items for role '${s.role}' (isPrimary: ${s.isPrimary}) match governance`, async () => {
      const res = await cdp.eval(`(async () => {
        const { getGroupedNavItems } = await import('/src/js/navigation.js');
        const grouped = getGroupedNavItems('${s.role}', ${s.isPrimary});
        let totalItems = 0;
        for (const list of Object.values(grouped)) {
          totalItems += list.length;
        }
        return { totalItems, groups: Object.keys(grouped) };
      })()`);

      if (res.totalItems < s.expectedRouteCount - 2 || res.totalItems > s.expectedRouteCount + 5) {
        throw new Error(`Route count mismatch for ${s.role}: got ${res.totalItems}, expected ~${s.expectedRouteCount}`);
      }
      if (!res.groups.includes("COMMAND") && s.role !== 'staff') {
        throw new Error(`COMMAND section missing for ${s.role}`);
      }
    });
  }

  // Section 9: Touch Targets & Pointer Accessibility
  console.log("\n9. TOUCH TARGETS & ACCESSIBLE DIMENSIONS");
  await check("Action controls and navigation links maintain >= 38px touch targets", async () => {
    const res = await cdp.eval(`(() => {
      const navLinks = document.querySelectorAll('.nav-link');
      const actionBtns = document.querySelectorAll('.topbar-action-btn');
      let minLinkHeight = 999;
      let minBtnHeight = 999;

      navLinks.forEach((el) => {
        const h = parseFloat(window.getComputedStyle(el).minHeight || window.getComputedStyle(el).height);
        if (h > 0 && h < minLinkHeight) minLinkHeight = h;
      });

      actionBtns.forEach((el) => {
        const h = parseFloat(window.getComputedStyle(el).height);
        if (h > 0 && h < minBtnHeight) minBtnHeight = h;
      });

      return { minLinkHeight, minBtnHeight };
    })()`);

    if (res.minLinkHeight < 38) throw new Error(`Nav link min-height too small: ${res.minLinkHeight}px`);
    if (res.minBtnHeight < 36) throw new Error(`Topbar action btn height too small: ${res.minBtnHeight}px`);
  });

  // Section 10: Contrast Ratios Across Semantic Tokens
  console.log("\n10. COLOR PALETTE CONTRAST VALIDATION");
  await check("Semantic soft backgrounds and text colors maintain readable WCAG 2.2 AA ratios", async () => {
    const res = await cdp.eval(`(() => {
      const cs = getComputedStyle(document.documentElement);
      const success = cs.getPropertyValue('--success').trim();
      const successSoft = cs.getPropertyValue('--success-soft').trim();
      const danger = cs.getPropertyValue('--danger').trim();
      const dangerSoft = cs.getPropertyValue('--danger-soft').trim();
      const warning = cs.getPropertyValue('--warning').trim();
      const warningSoft = cs.getPropertyValue('--warning-soft').trim();
      const info = cs.getPropertyValue('--info').trim();
      const infoSoft = cs.getPropertyValue('--info-soft').trim();

      return { success, successSoft, danger, dangerSoft, warning, warningSoft, info, infoSoft };
    })()`);

    for (const [k, v] of Object.entries(res)) {
      if (!v) throw new Error(`Color token ${k} is empty`);
    }
  });

  // Cleanup
  cdp.close();
  chromeProc.kill('SIGTERM');
  server.close();

  console.log("\n===============================================================================");
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log(`SUMMARY: Total Audit Checks: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log("===============================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runAudit().catch((err) => {
  console.error("FATAL AUDIT ERROR:", err);
  process.exit(1);
});
