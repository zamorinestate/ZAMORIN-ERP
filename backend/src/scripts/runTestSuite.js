'use strict';

/**
 * Zamorin Café ERP — Reliable Test Suite Runner
 *
 * Usage:
 *   node src/scripts/runTestSuite.js --release   # curated critical release gates
 *   node src/scripts/runTestSuite.js --full      # every test file not formally archived
 *
 * Options:
 *   --concurrency=N   parallel files (default 4)
 *   --timeout=MS      per-file timeout (default 300000)
 *   --report=PATH     JSON report output path (default test-results/<mode>-report.json)
 *
 * Each file runs in its own `node --test` process so one broken file can never
 * hide the results of another. Archived files are listed in test/ARCHIVED_TESTS.json
 * with a documented rationale and are reported as SKIPPED (never silently dropped).
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const BACKEND_ROOT = path.resolve(__dirname, '..', '..');
const TEST_ROOT = path.join(BACKEND_ROOT, 'test');
const ARCHIVE_MANIFEST = path.join(TEST_ROOT, 'ARCHIVED_TESTS.json');

const RELEASE_SUITE = [
  'aiInvoiceIntelligence.test.js',
  'aiInvoiceStagingValidation.test.js',
  'normalMasterDecommission.test.js',
  'p1RemediationSuite.test.js',
  'p0BC_posAtomicityFefoConcurrency.test.js',
  'p0D_p1A_grnIdempotencyDiscrepancy.test.js',
  'canonicalAccessMatrix.test.js',
  'ownerAuthorizationMatrix.test.js',
  'staffScopeSecurity.test.js',
  'p13_workforceAttendancePayroll.test.js',
  'p14_customersLoyaltyFeedbackCampaigns.test.js',
  'p15_channelsQrOrderingFrontService.test.js',
];

function parseArgs(argv) {
  let explicitConcurrency = false;
  const args = { mode: 'full', concurrency: 4, timeout: 300000, report: null };
  for (const a of argv) {
    if (a === '--release') args.mode = 'release';
    else if (a === '--full') args.mode = 'full';
    else if (a.startsWith('--concurrency=')) {
      args.concurrency = Math.max(1, Number(a.split('=')[1]) || 4);
      explicitConcurrency = true;
    }
    else if (a.startsWith('--timeout=')) args.timeout = Number(a.split('=')[1]) || 300000;
    else if (a.startsWith('--report=')) args.report = a.split('=')[1];
  }
  if (!explicitConcurrency && args.mode === 'release') {
    args.concurrency = 2;
  }
  if (!args.report) args.report = path.join(BACKEND_ROOT, 'test-results', `${args.mode}-report.json`);
  return args;
}

function discover(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'fixtures') continue;
      out.push(...discover(full));
    } else if (entry.name.endsWith('.test.js')) {
      out.push(path.relative(TEST_ROOT, full).split(path.sep).join('/'));
    }
  }
  return out.sort();
}

function loadArchive() {
  if (!fs.existsSync(ARCHIVE_MANIFEST)) return {};
  const data = JSON.parse(fs.readFileSync(ARCHIVE_MANIFEST, 'utf8'));
  const map = {};
  for (const e of data.archived || []) map[e.file] = e;
  return map;
}

function parseSummary(output) {
  const pick = (k) => {
    const m = output.match(new RegExp(`ℹ ${k} (\\d+)`));
    return m ? Number(m[1]) : null;
  };
  return {
    tests: pick('tests'),
    pass: pick('pass'),
    fail: pick('fail'),
    skipped: pick('skipped'),
    cancelled: pick('cancelled'),
    todo: pick('todo'),
  };
}

function classifyFailure(output) {
  if (/Normal Master persona is permanently retired/.test(output)) return 'NORMAL_MASTER_FIXTURE';
  if (/primaryMasterDesignat\w+.*is required/.test(output)) return 'PRIMARY_MASTER_FIXTURE_INCOMPLETE';
  if (/Cannot find module/.test(output)) return 'MISSING_MODULE';
  if (/ENOENT/.test(output)) return 'MISSING_FILE';
  return 'ASSERTION_OR_RUNTIME';
}

function runFile(file, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, ['--test', '--test-concurrency=1', path.join('test', file)], {
      cwd: BACKEND_ROOT,
      env: { ...process.env, NODE_ENV: 'test' },
    });
    let output = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (d) => { output += d.toString(); });
    child.stderr.on('data', (d) => { output += d.toString(); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const summary = parseSummary(output);
      const completed = !timedOut && summary.tests !== null;
      const status = timedOut ? 'TIMEOUT' : (code === 0 ? 'PASS' : 'FAIL');
      resolve({
        file,
        status,
        exitCode: code,
        completed,
        durationMs: Date.now() - started,
        ...summary,
        failureClass: status === 'PASS' ? null : (timedOut ? 'TIMEOUT' : classifyFailure(output)),
      });
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const discovered = discover(TEST_ROOT);
  const archive = loadArchive();

  let selected;
  const skipped = [];
  if (args.mode === 'release') {
    selected = RELEASE_SUITE.filter((f) => discovered.includes(f));
  } else {
    selected = [];
    for (const f of discovered) {
      if (archive[f]) skipped.push({ file: f, reason: archive[f].rationale, classification: archive[f].classification });
      else selected.push(f);
    }
  }

  console.log(`[runTestSuite] mode=${args.mode} discovered=${discovered.length} selected=${selected.length} skipped=${skipped.length} concurrency=${args.concurrency}`);

  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < selected.length) {
      const file = selected[cursor++];
      const r = await runFile(file, args.timeout);
      results.push(r);
      console.log(`[${results.length}/${selected.length}] ${r.status.padEnd(7)} ${file} (tests=${r.tests ?? '?'} pass=${r.pass ?? '?'} fail=${r.fail ?? '?'}) ${r.durationMs}ms`);
    }
  }
  const startedAt = new Date().toISOString();
  await Promise.all(Array.from({ length: args.concurrency }, worker));
  const finishedAt = new Date().toISOString();

  results.sort((a, b) => a.file.localeCompare(b.file));
  const sum = (k) => results.reduce((acc, r) => acc + (r[k] || 0), 0);
  const totals = {
    filesDiscovered: discovered.length,
    filesAttempted: selected.length,
    filesCompleted: results.filter((r) => r.completed).length,
    filesSkipped: skipped.length,
    filesPassed: results.filter((r) => r.status === 'PASS').length,
    filesFailed: results.filter((r) => r.status === 'FAIL').length,
    filesTimedOut: results.filter((r) => r.status === 'TIMEOUT').length,
    testsTotal: sum('tests'),
    testsPassed: sum('pass'),
    testsFailed: sum('fail'),
    testsSkipped: sum('skipped'),
    testsCancelled: sum('cancelled'),
  };

  const report = { mode: args.mode, startedAt, finishedAt, totals, results, skipped };
  fs.mkdirSync(path.dirname(args.report), { recursive: true });
  fs.writeFileSync(args.report, JSON.stringify(report, null, 2));

  console.log('\n=== SUMMARY ===');
  for (const [k, v] of Object.entries(totals)) console.log(`${k.padEnd(18)} ${v}`);
  console.log(`report: ${args.report}`);
  process.exit(totals.filesFailed + totals.filesTimedOut === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[runTestSuite] fatal:', err.message);
  process.exit(2);
});
