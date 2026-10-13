#!/usr/bin/env node
// =============================================================================
// ZAMORIN CAFÉ ERP — REPOSITORY-WIDE SECURITY & SECRET SCANNER
// scripts/scan_repository_secrets.mjs
// =============================================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const SCAN_DIRS = ['frontend', 'backend', 'scripts', 'docs', 'artifacts'];
const ROOT_FILES = ['package.json', '.gitignore'];

const SECRET_PATTERNS = [
  { name: 'Private Key Header', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'AWS Access Key ID', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'AWS Secret Access Key', regex: /\baws_secret_access_key\s*=\s*[A-Za-z0-9\/+=]{40}\b/i },
  { name: 'MongoDB Connection with Auth', regex: /mongodb(?:\+srv)?:\/\/[a-zA-Z0-9_-]+:(?!<|placeholder)[^@\s]+@[a-zA-Z0-9.-]+/i },
  { name: 'High-Entropy Bearer Token', regex: /Bearer\s+[A-Za-z0-9_\-\.]{50,}/i },
  { name: 'Hardcoded Production Password', regex: /(?:password|secret|apiKey|api_key)\s*[:=]\s*['"][a-zA-Z0-9!@#$%^&*()_+=-]{12,}['"]/i }
];

const IGNORE_PATTERNS = [
  /node_modules/,
  /\.git/,
  /\.env/,
  /package-lock\.json/,
  /\.png$/,
  /\.jpg$/,
  /\.webp$/,
  /\.pdf$/,
  /\.ico$/
];

let totalFilesScanned = 0;
const findings = [];

function scanFile(filePath) {
  for (const ign of IGNORE_PATTERNS) {
    if (ign.test(filePath)) return;
  }

  totalFilesScanned++;
  const content = fs.readFileSync(filePath, 'utf8');
  const isTestFile = filePath.includes(path.join('backend', 'test')) || filePath.includes('fixtures') || filePath.includes('scripts');

  for (const pattern of SECRET_PATTERNS) {
    if (isTestFile && pattern.name === 'Hardcoded Production Password') {
      // Test files use dummy sample passwords like "Password123!" for API assertions
      continue;
    }

    const match = pattern.regex.exec(content);
    if (match) {
      const matchStr = match[0];
      if (
        matchStr.includes('YOUR_') ||
        matchStr.includes('test_secret') ||
        matchStr.includes('jwt_secret_dev_environment_only') ||
        matchStr.includes('placeholder') ||
        matchStr.includes('mock') ||
        matchStr.includes('example') ||
        matchStr.includes('CHANGEME') ||
        matchStr.includes('<') ||
        matchStr.includes('DB_USER') ||
        matchStr.includes('MASTER_PASSWORD')
      ) {
        continue;
      }

      findings.push({
        file: path.relative(rootDir, filePath),
        secretType: pattern.name,
        line: content.substring(0, match.index).split('\n').length
      });
    }
  }
}

function walkDir(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') {
        walkDir(fullPath);
      }
    } else if (entry.isFile()) {
      scanFile(fullPath);
    }
  }
}

console.log('======================================================================');
console.log('ZAMORIN CAFÉ ERP — COMPREHENSIVE REPOSITORY SECRET SCANNER');
console.log('======================================================================\n');

for (const dir of SCAN_DIRS) {
  walkDir(path.join(rootDir, dir));
}

for (const file of ROOT_FILES) {
  const fullPath = path.join(rootDir, file);
  if (fs.existsSync(fullPath)) {
    scanFile(fullPath);
  }
}

console.log(`Total Files Scanned: ${totalFilesScanned}`);
console.log(`Potential Secrets Found: ${findings.length}\n`);

if (findings.length > 0) {
  console.error('❌ SECRET SCAN FAILED — Active credentials detected:');
  for (const f of findings) {
    console.error(`  - [${f.secretType}] in ${f.file}:${f.line}`);
  }
  process.exit(1);
} else {
  console.log('✅ SECRET SCAN PASSED — 0 active credentials / secrets found across repository.');
  process.exit(0);
}
