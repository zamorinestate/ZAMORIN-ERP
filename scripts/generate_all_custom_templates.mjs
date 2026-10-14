import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ZipArchive {
  constructor() { this.files = []; }
  addFile(name, content) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const compressed = zlib.deflateRawSync(data);
    const crc = crc32(data);
    this.files.push({ name, uncompressedSize: data.length, compressedSize: compressed.length, crc, data: compressed });
  }
  toBuffer() {
    const localHeaders = [];
    const centralDirs = [];
    let offset = 0;
    for (const file of this.files) {
      const nameBuf = Buffer.from(file.name, 'utf8');
      const localHeader = Buffer.alloc(30 + nameBuf.length);
      localHeader.writeUInt32LE(0x04034b50, 0);
      localHeader.writeUInt16LE(20, 4);
      localHeader.writeUInt16LE(0, 6);
      localHeader.writeUInt16LE(8, 8);
      localHeader.writeUInt32LE(file.crc, 14);
      localHeader.writeUInt32LE(file.compressedSize, 18);
      localHeader.writeUInt32LE(file.uncompressedSize, 22);
      localHeader.writeUInt16LE(nameBuf.length, 26);
      nameBuf.copy(localHeader, 30);
      localHeaders.push(localHeader, file.data);

      const centralDir = Buffer.alloc(46 + nameBuf.length);
      centralDir.writeUInt32LE(0x02014b50, 0);
      centralDir.writeUInt16LE(20, 4);
      centralDir.writeUInt16LE(20, 6);
      centralDir.writeUInt16LE(8, 10);
      centralDir.writeUInt32LE(file.crc, 16);
      centralDir.writeUInt32LE(file.compressedSize, 20);
      centralDir.writeUInt32LE(file.uncompressedSize, 24);
      centralDir.writeUInt16LE(nameBuf.length, 28);
      centralDir.writeUInt32LE(offset, 42);
      nameBuf.copy(centralDir, 46);
      centralDirs.push(centralDir);
      offset += localHeader.length + file.data.length;
    }
    const centralDirOffset = offset;
    let centralDirSize = centralDirs.reduce((acc, cd) => acc + cd.length, 0);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(this.files.length, 8);
    eocd.writeUInt16LE(this.files.length, 10);
    eocd.writeUInt32LE(centralDirSize, 12);
    eocd.writeUInt32LE(centralDirOffset, 16);
    return Buffer.concat([...localHeaders, ...centralDirs, eocd]);
  }
}

function crc32(buf) {
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xFF];
  return (crc ^ (-1)) >>> 0;
}
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  return table;
})();

function getExcelCol(idx) {
  let temp = idx + 1;
  let letter = '';
  while (temp > 0) {
    let mod = (temp - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    temp = Math.floor((temp - mod) / 26);
  }
  return letter;
}

function xmlEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildWorkbook({ title, sheets, filename }) {
  const sharedStrings = [];
  const stringIndexMap = new Map();
  function getStrId(str) {
    let s = String(str ?? '');
    if (/^[=+\-@\t\r\n]/.test(s)) s = "'" + s;
    if (stringIndexMap.has(s)) return stringIndexMap.get(s);
    const id = sharedStrings.length;
    sharedStrings.push(s);
    stringIndexMap.set(s, id);
    return id;
  }

  const zip = new ZipArchive();

  // Content Types
  let ctXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n  <Default Extension="xml" ContentType="application/xml"/>\n  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`;
  sheets.forEach((_, i) => {
    ctXml += `\n  <Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
  });
  ctXml += `\n  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>\n  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>\n</Types>`;
  zip.addFile('[Content_Types].xml', ctXml);

  // _rels/.rels
  zip.addFile('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>\n</Relationships>`);

  // workbook rels
  let wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`;
  sheets.forEach((_, i) => {
    wbRels += `\n  <Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`;
  });
  wbRels += `\n  <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>\n  <Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>\n</Relationships>`;
  zip.addFile('xl/_rels/workbook.xml.rels', wbRels);

  // workbook.xml
  let wbXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n  <sheets>`;
  sheets.forEach((s, i) => {
    wbXml += `\n    <sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`;
  });
  wbXml += `\n  </sheets>\n</workbook>`;
  zip.addFile('xl/workbook.xml', wbXml);

  // styles.xml
  zip.addFile('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="&#x20B9;#,##0.00"/>
    <numFmt numFmtId="165" formatCode="#,##0"/>
  </numFmts>
  <fonts count="7">
    <font><name val="Segoe UI"/><sz val="10"/><color rgb="FF1E293B"/></font>
    <font><b/><name val="Segoe UI"/><sz val="10"/><color rgb="FFFFFFFF"/></font>
    <font><b/><name val="Segoe UI"/><sz val="13"/><color rgb="FF0F172A"/></font>
    <font><b/><name val="Segoe UI"/><sz val="10"/><color rgb="FF0F172A"/></font>
    <font><name val="Segoe UI"/><sz val="9"/><color rgb="FF64748B"/></font>
    <font><b/><name val="Segoe UI"/><sz val="14"/><color rgb="FF0F172A"/></font>
    <font><name val="Times New Roman"/><sz val="10"/></font>
  </fonts>
  <fills count="6">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0F172A"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/></border>
    <border>
      <left style="thin"><color rgb="FFE2E8F0"/></left>
      <right style="thin"><color rgb="FFE2E8F0"/></right>
      <top style="thin"><color rgb="FFE2E8F0"/></top>
      <bottom style="thin"><color rgb="FFE2E8F0"/></bottom>
    </border>
    <border>
      <left style="thin"><color rgb="FFE2E8F0"/></left>
      <right style="thin"><color rgb="FFE2E8F0"/></right>
      <top style="thin"><color rgb="FF0F172A"/></top>
      <bottom style="double"><color rgb="FF0F172A"/></bottom>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="11">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="164" fontId="3" fillId="4" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"/>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="164" fontId="5" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"/>
    <xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
  </cellXfs>
</styleSheet>`);

  // Build Each Worksheet
  sheets.forEach((s, sIdx) => {
    let ws = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews>
    <sheetView tabSelected="${sIdx === 0 ? 1 : 0}" workbookViewId="0">
      <pane ySplit="${s.freezeRow || 4}" topLeftCell="A${(s.freezeRow || 4) + 1}" activePane="bottomLeft" state="frozen"/>
    </sheetView>
  </sheetViews>
  <cols>`;
    (s.cols || []).forEach((c, idx) => {
      ws += `\n    <col min="${idx + 1}" max="${idx + 1}" width="${c.w || 18}" customWidth="1"/>`;
    });
    ws += `\n  </cols>
  <sheetData>
    <row r="1" ht="28" customHeight="1">
      <c r="A1" t="s" s="4"><v>${getStrId(s.title || title)}</v></c>
    </row>
    <row r="2" ht="18" customHeight="1">
      <c r="A2" t="s" s="6"><v>${getStrId('Zamorin Speciality Coffee & Kitchens Pvt. Ltd. | GSTIN: 32AAACZ1234K1Z5 | ' + (s.subtitle || 'Official Corporate Template'))}</v></c>
    </row>
    <row r="3" ht="14" customHeight="1"/>
    <row r="4" ht="24" customHeight="1">`;

    (s.cols || []).forEach((c, idx) => {
      ws += `<c r="${getExcelCol(idx)}4" t="s" s="1"><v>${getStrId(c.label)}</v></c>`;
    });
    ws += `</row>`;

    let rowNum = 5;
    (s.rows || []).forEach((r) => {
      ws += `<row r="${rowNum}" ht="20" customHeight="1">`;
      (s.cols || []).forEach((c, cIdx) => {
        const cellRef = `${getExcelCol(cIdx)}${rowNum}`;
        const val = r[c.key];
        if (typeof val === 'number') {
          const style = c.isNum ? 3 : 2;
          ws += `<c r="${cellRef}" t="n" s="${style}"><v>${val}</v></c>`;
        } else {
          ws += `<c r="${cellRef}" t="s" s="2"><v>${getStrId(val)}</v></c>`;
        }
      });
      ws += `</row>`;
      rowNum++;
    });

    if (s.summaryRow) {
      ws += `<row r="${rowNum}" ht="24" customHeight="1">`;
      (s.cols || []).forEach((c, cIdx) => {
        const cellRef = `${getExcelCol(cIdx)}${rowNum}`;
        const sumDef = s.summaryRow[c.key];
        if (sumDef && sumDef.formula) {
          const fStr = sumDef.formula.replace(/\{START\}/g, '5').replace(/\{END\}/g, String(rowNum - 1));
          ws += `<c r="${cellRef}" t="n" s="5"><f>${fStr}</f><v>${sumDef.val || 0}</v></c>`;
        } else if (sumDef && sumDef.label) {
          ws += `<c r="${cellRef}" t="s" s="5"><v>${getStrId(sumDef.label)}</v></c>`;
        } else {
          ws += `<c r="${cellRef}" s="5"/>`;
        }
      });
      ws += `</row>`;
    }

    ws += `\n  </sheetData>`;
    if (s.hasAutoFilter && s.cols && s.cols.length > 0) {
      const lastCol = getExcelCol(s.cols.length - 1);
      ws += `\n  <autoFilter ref="A4:${lastCol}${rowNum - (s.summaryRow ? 1 : 1)}"/>`;
    }
    ws += `\n</worksheet>`;
    zip.addFile(`xl/worksheets/sheet${sIdx + 1}.xml`, ws);
  });

  // sharedStrings.xml
  let ssXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">`;
  sharedStrings.forEach((s) => {
    ssXml += `\n  <si><t xml:space="preserve">${xmlEscape(s)}</t></si>`;
  });
  ssXml += `\n</sst>`;
  zip.addFile('xl/sharedStrings.xml', ssXml);

  const buf = zip.toBuffer();
  const out = path.resolve(__dirname, '..', filename);
  fs.writeFileSync(out, buf);
  console.log(`Generated: ${filename} (${buf.length} bytes)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. ZAMORIN_GST_TAX_FILING_TEMPLATE.xlsx
// ─────────────────────────────────────────────────────────────────────────────
buildWorkbook({
  title: 'Statutory GST Outward Supply & Tax Filing Register',
  filename: 'ZAMORIN_GST_TAX_FILING_TEMPLATE.xlsx',
  sheets: [
    {
      name: 'GSTR-1 Outward Supplies',
      title: 'GSTR-1 Section 7 & 9 Outward Supplies Register',
      subtitle: 'Tax Period: October 2026 | State: 32-Kerala | CGST & SGST Split Audit',
      hasAutoFilter: true,
      cols: [
        { key: 'sl', label: 'Sl.', w: 8 },
        { key: 'invNo', label: 'Invoice Number', w: 18 },
        { key: 'date', label: 'Invoice Date', w: 14 },
        { key: 'pos', label: 'Place of Supply', w: 16 },
        { key: 'hsn', label: 'HSN / SAC Code', w: 14 },
        { key: 'desc', label: 'Item / Service Description', w: 26 },
        { key: 'taxable', label: 'Taxable Turnover (INR)', w: 20, isNum: true },
        { key: 'rate', label: 'GST Rate', w: 10 },
        { key: 'cgst', label: 'CGST 2.5% (INR)', w: 16, isNum: true },
        { key: 'sgst', label: 'SGST 2.5% (INR)', w: 16, isNum: true },
        { key: 'total', label: 'Invoice Total (INR)', w: 18, isNum: true }
      ],
      rows: [
        { sl: 1, invNo: 'INV-2610-001', date: '2026-10-14', pos: '32-Kerala', hsn: '996331', desc: 'Restaurant Dining & Food Service', taxable: 1250.00, rate: '5%', cgst: 31.25, sgst: 31.25, total: 1312.50 },
        { sl: 2, invNo: 'INV-2610-002', date: '2026-10-14', pos: '32-Kerala', hsn: '996331', desc: 'Hot & Cold Speciality Beverages', taxable: 480.00, rate: '5%', cgst: 12.00, sgst: 12.00, total: 504.00 },
        { sl: 3, invNo: 'INV-2610-003', date: '2026-10-14', pos: '32-Kerala', hsn: '210111', desc: 'Packaged Roasted Coffee Beans 250g', taxable: 650.00, rate: '5%', cgst: 16.25, sgst: 16.25, total: 682.50 },
        { sl: 4, invNo: 'INV-2610-004', date: '2026-10-14', pos: '32-Kerala', hsn: '996331', desc: 'Takeaway Bakery & Patisserie', taxable: 380.00, rate: '5%', cgst: 9.50, sgst: 9.50, total: 399.00 }
      ],
      summaryRow: {
        sl: { label: 'TOTALS' },
        taxable: { formula: 'SUM(G{START}:G{END})', val: 2760.00 },
        cgst: { formula: 'SUM(I{START}:I{END})', val: 69.00 },
        sgst: { formula: 'SUM(J{START}:J{END})', val: 69.00 },
        total: { formula: 'SUM(K{START}:K{END})', val: 2898.00 }
      }
    },
    {
      name: 'HSN Summary',
      title: 'HSN-Wise Summary of Outward Supplies (Table 12)',
      subtitle: 'Mandatory GSTR-1 Return Table 12 Compliant',
      hasAutoFilter: true,
      cols: [
        { key: 'hsn', label: 'HSN Code', w: 14 },
        { key: 'desc', label: 'Description', w: 26 },
        { key: 'uom', label: 'UQC / UOM', w: 12 },
        { key: 'qty', label: 'Total Quantity', w: 14 },
        { key: 'taxable', label: 'Total Taxable (INR)', w: 18, isNum: true },
        { key: 'cgst', label: 'CGST Amount (INR)', w: 16, isNum: true },
        { key: 'sgst', label: 'SGST Amount (INR)', w: 16, isNum: true }
      ],
      rows: [
        { hsn: '996331', desc: 'Restaurant & Café Food Service', uom: 'OTH', qty: 3, taxable: 2110.00, cgst: 52.75, sgst: 52.75 },
        { hsn: '210111', desc: 'Retail Roasted Coffee Packets', uom: 'NOS', qty: 1, taxable: 650.00, cgst: 16.25, sgst: 16.25 }
      ],
      summaryRow: {
        hsn: { label: 'HSN TOTAL' },
        taxable: { formula: 'SUM(E{START}:E{END})', val: 2760.00 },
        cgst: { formula: 'SUM(F{START}:F{END})', val: 69.00 },
        sgst: { formula: 'SUM(G{START}:G{END})', val: 69.00 }
      }
    }
  ]
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. ZAMORIN_INVENTORY_STOCK_EXPIRY_TEMPLATE.xlsx
// ─────────────────────────────────────────────────────────────────────────────
buildWorkbook({
  title: 'Inventory Stock Valuation & Batch Expiry Register',
  filename: 'ZAMORIN_INVENTORY_STOCK_EXPIRY_TEMPLATE.xlsx',
  sheets: [
    {
      name: 'Stock Valuation',
      title: 'Perpetual Stock Valuation Register',
      subtitle: 'FIFO Valuation Method | Calicut Central Warehouse & Outlets',
      hasAutoFilter: true,
      cols: [
        { key: 'sku', label: 'Item SKU', w: 14 },
        { key: 'name', label: 'Material Description', w: 28 },
        { key: 'cat', label: 'Category', w: 18 },
        { key: 'bin', label: 'Storage Bin', w: 16 },
        { key: 'qty', label: 'On Hand Qty', w: 14 },
        { key: 'uom', label: 'UOM', w: 10 },
        { key: 'cost', label: 'Unit Cost (INR)', w: 16, isNum: true },
        { key: 'val', label: 'Total Valuation (INR)', w: 20, isNum: true },
        { key: 'reorder', label: 'Reorder Level', w: 14 },
        { key: 'status', label: 'Stock Health', w: 14 }
      ],
      rows: [
        { sku: 'RAW-COF-001', name: 'Arabica Roasted Malabar AA', cat: 'Coffee Beans', bin: 'DRY-A1-04', qty: 85.5, uom: 'kg', cost: 650.00, val: 55575.00, reorder: '20 kg', status: 'HEALTHY' },
        { sku: 'RAW-MLK-001', name: 'Fresh Whole Milk Pastuerized', cat: 'Dairy & Fresh', bin: 'CHILLER-01', qty: 45.0, uom: 'L', cost: 54.00, val: 2430.00, reorder: '15 L', status: 'HEALTHY' },
        { sku: 'PKG-CUP-001', name: 'Biodegradable Hot Cup 8oz', cat: 'Packaging', bin: 'DRY-B2-12', qty: 1200, uom: 'pcs', cost: 3.20, val: 3840.00, reorder: '500 pcs', status: 'HEALTHY' },
        { sku: 'SYR-VAN-001', name: 'Artisan Vanilla Bean Syrup', cat: 'Syrups & Flavour', bin: 'DRY-A3-02', qty: 12.0, uom: 'Btl', cost: 320.00, val: 3840.00, reorder: '5 Btl', status: 'HEALTHY' }
      ],
      summaryRow: {
        sku: { label: 'TOTAL VALUATION' },
        val: { formula: 'SUM(H{START}:H{END})', val: 65685.00 }
      }
    },
    {
      name: 'Batch & Expiry Tracker',
      title: 'Perishable Batch & Expiry Timeline Tracker',
      subtitle: 'Monitors food safety, shelf-life, and FEFO compliance',
      hasAutoFilter: true,
      cols: [
        { key: 'lot', label: 'Batch / Lot #', w: 16 },
        { key: 'sku', label: 'Item SKU', w: 14 },
        { key: 'name', label: 'Item Description', w: 26 },
        { key: 'exp', label: 'Expiry Date', w: 14 },
        { key: 'days', label: 'Days Left', w: 12 },
        { key: 'remQty', label: 'Remaining Qty', w: 14 },
        { key: 'uom', label: 'UOM', w: 10 },
        { key: 'action', label: 'Quality Action', w: 20 }
      ],
      rows: [
        { lot: 'LOT-MLK-261012', sku: 'RAW-MLK-001', name: 'Fresh Whole Milk Pastuerized', exp: '2026-10-16', days: 2, remQty: 18.0, uom: 'L', action: 'PRIORITY_CONSUME (FEFO)' },
        { lot: 'LOT-COF-260901', sku: 'RAW-COF-001', name: 'Arabica Roasted Malabar AA', exp: '2027-03-01', days: 138, remQty: 85.5, uom: 'kg', action: 'NORMAL_CYCLE' }
      ]
    }
  ]
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. ZAMORIN_RECIPE_BOM_FOOD_COST_TEMPLATE.xlsx
// ─────────────────────────────────────────────────────────────────────────────
buildWorkbook({
  title: 'Recipe BOM Depletion & Food Cost Variance Register',
  filename: 'ZAMORIN_RECIPE_BOM_FOOD_COST_TEMPLATE.xlsx',
  sheets: [
    {
      name: 'Recipe Food Cost',
      title: 'Dish Recipe & Target Food Cost Analysis',
      subtitle: 'Benchmark target food cost variance against standard bill of materials',
      hasAutoFilter: true,
      cols: [
        { key: 'sku', label: 'Recipe Code', w: 14 },
        { key: 'name', label: 'Menu Item Name', w: 28 },
        { key: 'price', label: 'Selling Price (INR)', w: 18, isNum: true },
        { key: 'targetPct', label: 'Target FC %', w: 14 },
        { key: 'stdCost', label: 'BOM Standard Cost (INR)', w: 22, isNum: true },
        { key: 'actCost', label: 'Actual Depletion Cost (INR)', w: 22, isNum: true },
        { key: 'variance', label: 'Variance %', w: 14 },
        { key: 'status', label: 'Margin Status', w: 16 }
      ],
      rows: [
        { sku: 'RCP-ESP-01', name: 'Signature Spanish Latte', price: 220.00, targetPct: '22.0%', stdCost: 44.50, actCost: 46.20, variance: '+0.77%', status: 'OPTIMAL' },
        { sku: 'RCP-BRK-01', name: 'Eggs Benedict Avocado Brioche', price: 485.00, targetPct: '28.0%', stdCost: 128.00, actCost: 139.50, variance: '+2.37%', status: 'MONITOR' },
        { sku: 'RCP-DRW-01', name: 'Cold Brew Malabar Reserve', price: 200.00, targetPct: '16.0%', stdCost: 28.00, actCost: 28.50, variance: '+0.25%', status: 'EXCELLENT' }
      ]
    }
  ]
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. ZAMORIN_WORKFORCE_ATTENDANCE_TEMPLATE.xlsx
// ─────────────────────────────────────────────────────────────────────────────
buildWorkbook({
  title: 'Workforce Attendance & Shift Overtime Register',
  filename: 'ZAMORIN_WORKFORCE_ATTENDANCE_TEMPLATE.xlsx',
  sheets: [
    {
      name: 'Daily Shift Log',
      title: 'Biometric Attendance & Overtime Shift Log',
      subtitle: 'Daily clock-in reconciliation and statutory overtime tracking',
      hasAutoFilter: true,
      cols: [
        { key: 'empId', label: 'Employee ID', w: 14 },
        { key: 'name', label: 'Staff Name', w: 22 },
        { key: 'role', label: 'Designation / Station', w: 20 },
        { key: 'shift', label: 'Scheduled Shift', w: 18 },
        { key: 'inTime', label: 'Punch In', w: 12 },
        { key: 'outTime', label: 'Punch Out', w: 12 },
        { key: 'hours', label: 'Worked Hours', w: 14 },
        { key: 'ot', label: 'Overtime (Hrs)', w: 14 },
        { key: 'late', label: 'Late Mins', w: 12 },
        { key: 'status', label: 'Shift Status', w: 14 }
      ],
      rows: [
        { empId: 'EMP-102', name: 'Rahul Krishnan', role: 'Head Cashier / Till A', shift: 'Morning (07:30-15:30)', inTime: '07:28', outTime: '15:42', hours: '8.2', ot: '0.2', late: '0', status: 'ON_TIME' },
        { empId: 'EMP-104', name: 'Anas Kabeer', role: 'Lead Barista', shift: 'Morning (07:30-15:30)', inTime: '07:41', outTime: '15:35', hours: '7.9', ot: '0.0', late: '11', status: 'LATE' },
        { empId: 'EMP-114', name: 'Vishnu Madhav', role: 'Captain / Floor Lead', shift: 'Full Day (08:00-20:00)', inTime: '07:55', outTime: '20:30', hours: '12.5', ot: '0.5', late: '0', status: 'ON_TIME' }
      ]
    }
  ]
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. ZAMORIN_TILL_PAYMENT_RECONCILIATION_TEMPLATE.xlsx
// ─────────────────────────────────────────────────────────────────────────────
buildWorkbook({
  title: 'Cash Drawer Till & Payment Gateway Reconciliation',
  filename: 'ZAMORIN_TILL_PAYMENT_RECONCILIATION_TEMPLATE.xlsx',
  sheets: [
    {
      name: 'Cash Till Reconcile',
      title: 'Physical Cash Drawer vs Shift POS Balancing',
      subtitle: 'Mandatory end-of-shift cash drop and drawer balancing register',
      hasAutoFilter: true,
      cols: [
        { key: 'shift', label: 'Shift ID', w: 14 },
        { key: 'till', label: 'Counter Till', w: 16 },
        { key: 'cashier', label: 'Cashier In-Charge', w: 22 },
        { key: 'openFloat', label: 'Opening Float (INR)', w: 18, isNum: true },
        { key: 'cashSales', label: 'Cash Sales (INR)', w: 18, isNum: true },
        { key: 'payouts', label: 'Petty Outflows (INR)', w: 18, isNum: true },
        { key: 'expected', label: 'Expected Drawer (INR)', w: 20, isNum: true },
        { key: 'actual', label: 'Actual Counted (INR)', w: 20, isNum: true },
        { key: 'variance', label: 'Over / Short (INR)', w: 18, isNum: true },
        { key: 'status', label: 'Audit Result', w: 14 }
      ],
      rows: [
        { shift: 'SH-261014-01', till: 'Till A - Front Till', cashier: 'Rahul K. (EMP-102)', openFloat: 5000.00, cashSales: 34250.00, payouts: 850.00, expected: 38400.00, actual: 38400.00, variance: 0.00, status: 'BALANCED' },
        { shift: 'SH-261014-01', till: 'Till B - Takeaway', cashier: 'Anas K. (EMP-104)', openFloat: 3000.00, cashSales: 18900.00, payouts: 0.00, expected: 21900.00, actual: 21890.00, variance: -10.00, status: 'SHORT (-₹10)' }
      ]
    }
  ]
});

console.log('All 5 Specialized Domain Excel Templates generated successfully!');
