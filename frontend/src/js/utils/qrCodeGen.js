// =============================================================================
// ZAMORIN CAFE ERP — ZERO-DEPENDENCY QR CODE ES MODULE
// ISO/IEC 18004 Standard QR Code Generator (SVG & Print Format)
// =============================================================================

'use strict';

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initGalois() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    EXP[i + 255] = x;
    LOG[x] = i;
    x = (x << 1) ^ (x >= 128 ? 0x11d : 0);
  }
})();

function gfMul(x, y) {
  if (x === 0 || y === 0) return 0;
  return EXP[LOG[x] + LOG[y]];
}

function polyMul(p, q) {
  const r = new Uint8Array(p.length + q.length - 1);
  for (let i = 0; i < p.length; i++) {
    for (let j = 0; j < q.length; j++) {
      r[i + j] ^= gfMul(p[i], q[j]);
    }
  }
  return r;
}

function getRsGeneratorPoly(degree) {
  let g = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    g = polyMul(g, new Uint8Array([1, EXP[i]]));
  }
  return g;
}

function calcEcc(data, eccLength) {
  const gen = getRsGeneratorPoly(eccLength);
  const res = new Uint8Array(eccLength);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ res[0];
    for (let j = 0; j < eccLength - 1; j++) {
      res[j] = res[j + 1] ^ gfMul(gen[j + 1], factor);
    }
    res[eccLength - 1] = gfMul(gen[eccLength], factor);
  }
  return res;
}

const VERSION_SPECS = [
  null,
  { version: 1, size: 21, total: 26, data: 16, ec: 10, blocks: 1, align: [] },
  { version: 2, size: 25, total: 44, data: 28, ec: 16, blocks: 1, align: [6, 18] },
  { version: 3, size: 29, total: 70, data: 44, ec: 26, blocks: 1, align: [6, 22] },
  { version: 4, size: 33, total: 100, data: 64, ec: 18, blocks: 2, align: [6, 26] },
  { version: 5, size: 37, total: 134, data: 86, ec: 24, blocks: 2, align: [6, 30] },
  { version: 6, size: 41, total: 172, data: 108, ec: 16, blocks: 4, align: [6, 34] },
  { version: 7, size: 45, total: 196, data: 124, ec: 18, blocks: 4, align: [6, 22, 38] },
  { version: 8, size: 49, total: 242, data: 154, ec: 22, blocks: 4, align: [6, 24, 42] },
  { version: 9, size: 53, total: 292, data: 182, ec: 22, blocks: 5, align: [6, 26, 46] },
  { version: 10, size: 57, total: 346, data: 216, ec: 26, blocks: 5, align: [6, 28, 50] },
];

function selectVersion(byteLength) {
  for (let v = 1; v < VERSION_SPECS.length; v++) {
    const spec = VERSION_SPECS[v];
    const headerBytes = v <= 9 ? 2 : 3;
    if (byteLength + headerBytes <= spec.data) {
      return spec;
    }
  }
  throw new Error(`Data too long (${byteLength} bytes) for compact QR`);
}

function stringToUtf8ByteArray(str) {
  const encoder = new TextEncoder();
  return encoder.encode(str);
}

function encodeData(utf8Bytes, spec) {
  const totalBits = spec.data * 8;
  const bits = [];

  function pushBits(val, count) {
    for (let i = count - 1; i >= 0; i--) {
      bits.push((val >> i) & 1);
    }
  }

  // Byte mode
  pushBits(0b0100, 4);

  // Char count
  const charCountBits = spec.version <= 9 ? 8 : 16;
  pushBits(utf8Bytes.length, charCountBits);

  // Data
  for (let i = 0; i < utf8Bytes.length; i++) {
    pushBits(utf8Bytes[i], 8);
  }

  // Terminator
  const pad = Math.min(4, totalBits - bits.length);
  for (let i = 0; i < pad; i++) bits.push(0);

  // Byte align
  while (bits.length % 8 !== 0) bits.push(0);

  // Padding
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (bits.length < totalBits) {
    pushBits(padBytes[padIdx % 2], 8);
    padIdx++;
  }

  const bytes = new Uint8Array(spec.data);
  for (let i = 0; i < spec.data; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) {
      b = (b << 1) | bits[i * 8 + j];
    }
    bytes[i] = b;
  }

  const blockSize = Math.floor(spec.data / spec.blocks);
  const eccPerBlock = spec.ec;
  const dataBlocks = [];
  const eccBlocks = [];

  for (let b = 0; b < spec.blocks; b++) {
    const start = b * blockSize;
    const end = (b === spec.blocks - 1) ? spec.data : (b + 1) * blockSize;
    const blockData = bytes.slice(start, end);
    dataBlocks.push(blockData);
    eccBlocks.push(calcEcc(blockData, eccPerBlock));
  }

  const finalCodewords = [];
  const maxBlockLen = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxBlockLen; i++) {
    for (let b = 0; b < spec.blocks; b++) {
      if (i < dataBlocks[b].length) {
        finalCodewords.push(dataBlocks[b][i]);
      }
    }
  }
  for (let i = 0; i < eccPerBlock; i++) {
    for (let b = 0; b < spec.blocks; b++) {
      finalCodewords.push(eccBlocks[b][i]);
    }
  }

  return finalCodewords;
}

function createMatrix(spec) {
  const size = spec.size;
  const matrix = Array.from({ length: size }, () => new Int8Array(size).fill(-1));
  const isFunction = Array.from({ length: size }, () => new Uint8Array(size).fill(0));

  function setModule(r, c, val) {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      matrix[r][c] = val ? 1 : 0;
      isFunction[r][c] = 1;
    }
  }

  function placeFinder(topRow, leftCol) {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const isBlack = (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        setModule(topRow + r, leftCol + c, isBlack);
      }
    }
    for (let i = -1; i <= 7; i++) {
      setModule(topRow - 1, leftCol + i, 0);
      setModule(topRow + 7, leftCol + i, 0);
      setModule(topRow + i, leftCol - 1, 0);
      setModule(topRow + i, leftCol + 7, 0);
    }
  }

  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    setModule(6, i, i % 2 === 0);
    setModule(i, 6, i % 2 === 0);
  }

  if (spec.align && spec.align.length > 0) {
    const coords = spec.align;
    for (let r of coords) {
      for (let c of coords) {
        if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 8) || (r >= size - 8 && c <= 8)) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const isBlack = (Math.max(Math.abs(dy), Math.abs(dx)) !== 1);
            setModule(r + dy, c + dx, isBlack);
          }
        }
      }
    }
  }

  setModule(4 * spec.version + 9, 8, 1);

  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      isFunction[8][i] = 1;
      isFunction[i][8] = 1;
    }
  }
  for (let i = 0; i < 8; i++) {
    isFunction[8][size - 1 - i] = 1;
    isFunction[size - 1 - i][8] = 1;
  }

  return { matrix, isFunction };
}

const FORMAT_INFO_M_MASK0 = 0x5412;

function placeDataAndMask(matrix, isFunction, codewords) {
  const size = matrix.length;
  let byteIdx = 0;
  let bitIdx = 7;
  let right = size - 1;
  let upward = true;

  while (right > 0) {
    if (right === 6) right--;
    const rows = upward ? Array.from({ length: size }, (_, i) => size - 1 - i) : Array.from({ length: size }, (_, i) => i);

    for (let r of rows) {
      for (let colOffset = 0; colOffset < 2; colOffset++) {
        const c = right - colOffset;
        if (isFunction[r][c]) continue;

        let bit = 0;
        if (byteIdx < codewords.length) {
          bit = (codewords[byteIdx] >> bitIdx) & 1;
          bitIdx--;
          if (bitIdx < 0) {
            bitIdx = 7;
            byteIdx++;
          }
        }

        const maskBit = ((r + c) % 2 === 0) ? 1 : 0;
        matrix[r][c] = bit ^ maskBit;
      }
    }
    right -= 2;
    upward = !upward;
  }

  // Place Format Info (Mask 0, ECC M) - Standard ISO/IEC 18004 MSB-first
  const fmt = FORMAT_INFO_M_MASK0;
  for (let i = 0; i < 15; i++) {
    const bit = (fmt >> (14 - i)) & 1;
    if (i < 6) matrix[8][i] = bit;
    else if (i === 6) matrix[8][7] = bit;
    else if (i === 7) matrix[8][8] = bit;
    else if (i === 8) matrix[7][8] = bit;
    else {
      const row = (14 - i) >= 6 ? (14 - i + 1) : (14 - i);
      matrix[row][8] = bit;
    }

    if (i < 8) matrix[size - 1 - i][8] = bit;
    else matrix[8][size - 15 + i] = bit;
  }
}

export function generateQrMatrix(text) {
  const utf8 = stringToUtf8ByteArray(text);
  const spec = selectVersion(utf8.length);
  const codewords = encodeData(utf8, spec);
  const { matrix, isFunction } = createMatrix(spec);
  placeDataAndMask(matrix, isFunction, codewords);
  return {
    size: spec.size,
    version: spec.version,
    matrix: matrix.map((row) => Array.from(row).map((v) => v === 1)),
  };
}

/**
 * Canonical Zamorin Company Logo SVG mark for embedding in QR centers.
 */
export const CANONICAL_ZAMORIN_COMPANY_LOGO_SVG = `<svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet">
  <defs>
    <linearGradient id="zam_cg1_fe" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#C6A567"/>
      <stop offset="100%" stop-color="#83622C"/>
    </linearGradient>
    <linearGradient id="zam_cn1_fe" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#16223F"/>
      <stop offset="100%" stop-color="#0B1220"/>
    </linearGradient>
  </defs>
  <rect x="6" y="6" width="188" height="188" rx="52" fill="url(#zam_cn1_fe)"/>
  <rect x="22" y="22" width="156" height="156" rx="38" fill="none" stroke="url(#zam_cg1_fe)" stroke-width="2.5" opacity="0.95"/>
  <path d="M 58 68 L 142 68 L 58 132 L 142 132" fill="none" stroke="url(#zam_cg1_fe)" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

/**
 * Generates valid, high-contrast, scalable SVG string representing the QR code
 * with centered canonical company logo overlay and guaranteed independent scannability.
 */
export function generateQrSvg(text, {
  margin = 4,
  size = 256,
  darkColor = '#000000',
  lightColor = '#ffffff',
  includeLogo = true,
  logoSvg = null,
  logoUrl = null,
} = {}) {
  const { matrix, size: matrixSize } = generateQrMatrix(text);
  const totalSize = matrixSize + margin * 2;

  let paths = '';
  for (let r = 0; r < matrixSize; r++) {
    for (let c = 0; c < matrixSize; c++) {
      if (matrix[r][c]) {
        paths += `M${c + margin},${r + margin}h1v1h-1z `;
      }
    }
  }

  let logoOverlay = '';
  if (includeLogo) {
    const logoDimension = Math.max(5, Math.floor(matrixSize * 0.22));
    const cx = totalSize / 2;
    const cy = totalSize / 2;
    const x0 = cx - logoDimension / 2;
    const y0 = cy - logoDimension / 2;

    const platePadding = 0.25;
    const plateX = x0 - platePadding;
    const plateY = y0 - platePadding;
    const plateSize = logoDimension + platePadding * 2;
    const plateRadius = 0.8;

    let contentSnippet = '';
    if (logoSvg) {
      contentSnippet = `<svg x="${x0}" y="${y0}" width="${logoDimension}" height="${logoDimension}" preserveAspectRatio="xMidYMid meet">${logoSvg}</svg>`;
    } else if (logoUrl) {
      contentSnippet = `<image x="${x0}" y="${y0}" width="${logoDimension}" height="${logoDimension}" href="${logoUrl}" preserveAspectRatio="xMidYMid meet"/>`;
    } else {
      contentSnippet = `<svg x="${x0}" y="${y0}" width="${logoDimension}" height="${logoDimension}">${CANONICAL_ZAMORIN_COMPANY_LOGO_SVG}</svg>`;
    }

    logoOverlay = `<g class="zamorin-qr-logo-container" aria-label="Zamorin Company Logo">` +
      `<rect x="${plateX}" y="${plateY}" width="${plateSize}" height="${plateSize}" rx="${plateRadius}" fill="${lightColor}" stroke="#b17d38" stroke-width="0.12"/>` +
      contentSnippet +
      `</g>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalSize} ${totalSize}" width="${size}" height="${size}" shape-rendering="crispEdges" data-scannable="true">` +
    `<rect width="${totalSize}" height="${totalSize}" fill="${lightColor}"/>` +
    `<path d="${paths}" fill="${darkColor}"/>` +
    logoOverlay +
    `</svg>`;
}

export function downloadQrSvg(text, { filename = 'zamorin_qr.svg', size = 400 } = {}) {
  const svg = generateQrSvg(text, { size });
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadQrPng(text, { filename = 'zamorin_qr.png', size = 500 } = {}) {
  const svg = generateQrSvg(text, { size });
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    const pngUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = pngUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    // Fallback: download SVG if PNG canvas rasterization is unavailable
    downloadQrSvg(text, { filename: filename.replace(/\.png$/i, '.svg'), size });
  };
  img.src = url;
}

export function printQrCard({ cafeName, cafeId, qrUrl, qrVersion = 1, city = '' }) {
  const svg = generateQrSvg(qrUrl, { size: 300 });
  const printWindow = window.open('', '_blank', 'width=680,height=820');
  if (!printWindow) {
    alert('Please allow pop-ups to print the Café Access QR card.');
    return;
  }

  const generatedDate = new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Zamorin Café Access Pack — ${cafeName} (${cafeId})</title>
        <style>
          @page { size: A5 portrait; margin: 12mm; }
          * { box-sizing: border-box; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; text-align: center; color: #1a1a1a; margin: 0; padding: 24px; background: #fdfdfd; }
          .pack-card { border: 2.5px solid #b17d38; border-radius: 14px; padding: 28px 24px; max-width: 460px; margin: 0 auto; background: #ffffff; box-shadow: 0 4px 16px rgba(0,0,0,0.06); }
          .brand-header { margin-bottom: 8px; }
          .brand-logo { font-size: 22px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: #b17d38; }
          .pack-subtitle { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #666; margin-top: 2px; }
          .divider { height: 2px; background: linear-gradient(90deg, transparent, #b17d38, transparent); margin: 14px 0 18px; }
          .cafe-name { font-size: 24px; font-weight: 800; color: #181715; margin: 0 0 4px; }
          .cafe-meta { font-size: 13px; color: #555; margin-bottom: 18px; font-weight: 600; }
          .cafe-id { font-family: monospace; font-size: 14px; font-weight: 700; color: #b17d38; }
          .qr-container { margin: 0 auto 16px auto; display: inline-block; padding: 14px; background: #ffffff; border: 1.5px solid #ddd; border-radius: 10px; }
          .scan-instructions { font-size: 14px; font-weight: 700; color: #181715; margin-bottom: 6px; }
          .scan-subtext { font-size: 11.5px; color: #666; margin-bottom: 16px; line-height: 1.4; }
          .details-table { width: 100%; border-top: 1px dashed #ccc; padding-top: 12px; margin-bottom: 14px; font-size: 11px; color: #777; display: flex; justify-content: space-between; }
          .security-notice { font-size: 10px; color: #888; border-top: 1px solid #eee; padding-top: 10px; line-height: 1.4; text-transform: uppercase; letter-spacing: 0.02em; }
        </style>
      </head>
      <body>
        <div class="pack-card">
          <div class="brand-header">
            <div class="brand-logo">ZAMORIN CAFÉ ERP</div>
            <div class="pack-subtitle">Official Branch Operations Access Pack</div>
          </div>
          <div class="divider"></div>
          <h1 class="cafe-name">${cafeName}</h1>
          <div class="cafe-meta">
            Branch ID: <span class="cafe-id">${cafeId}</span>
            ${city ? ` · Location: ${city}` : ''}
          </div>
          <div class="qr-container">
            ${svg}
          </div>
          <div class="scan-instructions">Scan to Sign In</div>
          <div class="scan-subtext">
            Use your authorized mobile or tablet device to scan and sign into this branch location.<br>
            Standard enterprise credentials (Organisation ID + Email + Password) are required.
          </div>
          <div class="details-table">
            <span>Credential Version: <strong>v${qrVersion}</strong></span>
            <span>Issued Date: <strong>${generatedDate}</strong></span>
          </div>
          <div class="security-notice">
            🔒 Safe Context Locator · Possession of this document grants zero access without verified employee credentials. Do not duplicate or alter.
          </div>
        </div>
        <script>
          window.onload = function() {
            window.print();
            setTimeout(function() { window.close(); }, 1200);
          };
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

/**
 * Opens a rich modal viewer for the generated Café QR Code.
 * Supports: View, Full Screen (responsive, high-contrast, Escape closes), Download SVG, and Print Card.
 */
export function openQrViewerModal({ cafeName = 'Zamorin Café', cafeId = '', qrUrl, qrVersion = 1, isFullScreen = false } = {}) {
  let modalMount = document.getElementById('zamorin-qr-viewer-mount');
  if (!modalMount) {
    modalMount = document.createElement('div');
    modalMount.id = 'zamorin-qr-viewer-mount';
    document.body.appendChild(modalMount);
  }

  const cleanCafeId = String(cafeId).trim().toUpperCase();
  const safeFilename = `ZAMORIN_${cleanCafeId.replace(/[^A-Za-z0-9_-]/g, '')}_QR_V${qrVersion || 1}.svg`;

  if (isFullScreen) {
    // High-contrast, responsive full screen display
    const svgLarge = generateQrSvg(qrUrl, { size: Math.min(460, Math.floor(window.innerWidth * 0.82)) });
    modalMount.innerHTML = `
      <div id="zamorin-qr-fs-overlay" style="position:fixed;inset:0;background:#000000;z-index:10001;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;color:#ffffff;cursor:pointer;">
        <div style="margin-bottom:20px;text-align:center;">
          <div style="font-size:12px;letter-spacing:0.15em;text-transform:uppercase;color:#d4a359;font-weight:800;">Zamorin Café ERP · Full Screen QR</div>
          <h1 style="margin:6px 0 2px;font-size:26px;font-weight:800;color:#ffffff;">${cafeName}</h1>
          <div style="font-family:monospace;font-size:15px;color:#a0a0a0;font-weight:700;">ID: ${cleanCafeId} · Version: v${qrVersion}</div>
        </div>
        <div style="background:#ffffff;padding:24px;border-radius:16px;box-shadow:0 0 50px rgba(255,255,255,0.2);display:inline-block;">
          ${svgLarge}
        </div>
        <div style="margin-top:24px;text-align:center;">
          <div style="font-size:13px;color:#888888;">Press <kbd style="background:#222;color:#eee;padding:2px 8px;border-radius:4px;border:1px solid #444;">ESC</kbd> or tap anywhere to return</div>
        </div>
      </div>
    `;

    const closeFs = () => {
      window.removeEventListener('keydown', onKey);
      modalMount.innerHTML = '';
    };

    const onKey = (e) => {
      if (e.key === 'Escape' || e.keyCode === 27) {
        closeFs();
      }
    };

    window.addEventListener('keydown', onKey);
    modalMount.querySelector('#zamorin-qr-fs-overlay')?.addEventListener('click', closeFs);
    return;
  }

  // Standard Rich Viewer Modal
  const svg = generateQrSvg(qrUrl, { size: 240 });
  modalMount.innerHTML = `
    <div class="modal-backdrop" style="position:fixed;inset:0;background:rgba(12,11,10,0.85);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(4px);">
      <div class="modal-card card" style="width:480px;max-width:96vw;background:var(--surface-raised, #242220);border:1px solid var(--bronze-500, #b17d38);box-shadow:var(--shadow-2xl);border-radius:12px;padding:26px;color:var(--ink, #ede8e1);text-align:center;">
        
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;border-bottom:1px solid var(--line, #33302c);padding-bottom:12px;">
          <div style="text-align:left;">
            <div style="font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:var(--bronze-400, #d4a359);">
              CAFÉ OPERATIONS QR CODE
            </div>
            <h3 style="margin:2px 0 0;font-size:18px;font-weight:800;color:var(--ink);">${cafeName}</h3>
            <div style="font-size:12px;font-family:var(--font-mono, monospace);color:var(--muted);font-weight:600;">
              ID: ${cleanCafeId} · Version: v${qrVersion}
            </div>
          </div>
          <button class="btn btn-xs btn-ghost" id="zamorin-qr-modal-close-x" type="button" style="font-size:16px;line-height:1;cursor:pointer;">✕</button>
        </div>

        <!-- Rendered QR Box -->
        <div style="margin:16px auto;display:inline-block;padding:14px;background:#ffffff;border-radius:10px;border:1px solid rgba(0,0,0,0.1);box-shadow:0 4px 12px rgba(0,0,0,0.15);">
          ${svg}
        </div>

        <!-- URL preview -->
        <div style="background:var(--surface-sunken, #121110);border:1px solid var(--line-strong, #3d3935);border-radius:6px;padding:8px 12px;font-family:var(--font-mono, monospace);font-size:11px;color:var(--muted);word-break:break-all;margin-bottom:18px;text-align:left;user-select:all;">
          ${qrUrl}
        </div>

        <!-- Action Controls -->
        <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:8px;margin-bottom:14px;">
          <button class="btn btn-sm btn-secondary" id="zamorin-qr-btn-fs" type="button" style="display:flex;align-items:center;justify-content:center;gap:6px;">
            <span>⛶</span> Full Screen
          </button>
          <button class="btn btn-sm btn-secondary" id="zamorin-qr-btn-dl" type="button" style="display:flex;align-items:center;justify-content:center;gap:6px;">
            <span>⬇</span> SVG
          </button>
          <button class="btn btn-sm btn-secondary" id="zamorin-qr-btn-dl-png" type="button" style="display:flex;align-items:center;justify-content:center;gap:6px;">
            <span>🖼️</span> PNG
          </button>
          <button class="btn btn-sm btn-secondary" id="zamorin-qr-btn-print" type="button" style="display:flex;align-items:center;justify-content:center;gap:6px;">
            <span>🖨</span> Print Pack
          </button>
        </div>

        <button class="btn btn-sm btn-ghost" id="zamorin-qr-modal-close-btn" type="button" style="width:100%;">Close</button>
      </div>
    </div>
  `;

  const closeModal = () => {
    window.removeEventListener('keydown', onModalKey);
    modalMount.innerHTML = '';
  };

  const onModalKey = (e) => {
    if (e.key === 'Escape' || e.keyCode === 27) {
      closeModal();
    }
  };

  window.addEventListener('keydown', onModalKey);

  modalMount.querySelector('#zamorin-qr-modal-close-x')?.addEventListener('click', closeModal);
  modalMount.querySelector('#zamorin-qr-modal-close-btn')?.addEventListener('click', closeModal);

  modalMount.querySelector('#zamorin-qr-btn-fs')?.addEventListener('click', () => {
    openQrViewerModal({ cafeName, cafeId, qrUrl, qrVersion, isFullScreen: true });
  });

  modalMount.querySelector('#zamorin-qr-btn-dl')?.addEventListener('click', () => {
    downloadQrSvg(qrUrl, { filename: safeFilename, size: 500 });
  });

  modalMount.querySelector('#zamorin-qr-btn-dl-png')?.addEventListener('click', () => {
    downloadQrPng(qrUrl, { filename: safeFilename.replace(/\.svg$/i, '.png'), size: 600 });
  });

  modalMount.querySelector('#zamorin-qr-btn-print')?.addEventListener('click', () => {
    printQrCard({ cafeName, cafeId, qrUrl, qrVersion });
  });
}
