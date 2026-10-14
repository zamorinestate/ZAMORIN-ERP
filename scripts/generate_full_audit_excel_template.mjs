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

const sharedStrings = [];
const stringIndexMap = new Map();
function getSharedStringId(str) {
  let s = String(str ?? '');
  if (/^[=+\-@\t\r\n]/.test(s)) s = "'" + s;
  if (stringIndexMap.has(s)) return stringIndexMap.get(s);
  const id = sharedStrings.length;
  sharedStrings.push(s);
  stringIndexMap.set(s, id);
  return id;
}

const zip = new ZipArchive();

// 1. [Content_Types].xml
zip.addFile('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet4.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`);

// 2. _rels/.rels
zip.addFile('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);

// 3. xl/_rels/workbook.xml.rels
zip.addFile('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet4.xml"/>
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`);

// 4. xl/workbook.xml
zip.addFile('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Executive Dashboard" sheetId="1" r:id="rId1"/>
    <sheet name="Bill Audit Register" sheetId="2" r:id="rId2"/>
    <sheet name="Line-Item Breakdown" sheetId="3" r:id="rId3"/>
    <sheet name="Audit &amp; System Manifest" sheetId="4" r:id="rId4"/>
  </sheets>
</workbook>`);

// 5. xl/styles.xml
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
    <font><b/><name val="Segoe UI"/><sz val="16"/><color rgb="FF0F172A"/></font>
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

// Build Sheet 1: Executive Dashboard (KPI cards + Channel Summary)
let s1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews>
  <cols>
    <col min="1" max="1" width="28" customWidth="1"/>
    <col min="2" max="2" width="22" customWidth="1"/>
    <col min="3" max="3" width="22" customWidth="1"/>
    <col min="4" max="4" width="34" customWidth="1"/>
  </cols>
  <sheetData>
    <row r="1" ht="28" customHeight="1">
      <c r="A1" t="s" s="4"><v>${getSharedStringId('Zamorin Speciality Coffee & Kitchens Pvt. Ltd. — Executive Performance Dashboard')}</v></c>
    </row>
    <row r="2" ht="18" customHeight="1">
      <c r="A2" t="s" s="6"><v>${getSharedStringId('GSTIN: 32AAACZ1234K1Z5 | FSSAI: 11223344556677 | Business Date: 2026-10-14 | Stage 02 Universal Tamper QR Verified')}</v></c>
    </row>
    <row r="3" ht="14" customHeight="1"/>
    <row r="4" ht="20" customHeight="1">
      <c r="A4" t="s" s="1"><v>${getSharedStringId('EXECUTIVE KPI METRIC')}</v></c>
      <c r="B4" t="s" s="1"><v>${getSharedStringId('CURRENT VALUE')}</v></c>
      <c r="C4" t="s" s="1"><v>${getSharedStringId('BENCHMARK TARGET')}</v></c>
      <c r="D4" t="s" s="1"><v>${getSharedStringId('PERFORMANCE VARIANCE / AUDIT NOTE')}</v></c>
    </row>
    <row r="5" ht="22" customHeight="1">
      <c r="A5" t="s" s="2"><v>${getSharedStringId('Gross Sales Revenue')}</v></c>
      <c r="B5" t="n" s="3"><v>245670.00</v></c>
      <c r="C5" t="n" s="3"><v>220000.00</v></c>
      <c r="D5" t="s" s="2"><v>${getSharedStringId('+11.6% Outperformance vs Budget Target')}</v></c>
    </row>
    <row r="6" ht="22" customHeight="1">
      <c r="A6" t="s" s="2"><v>${getSharedStringId('Net Taxable Turnover')}</v></c>
      <c r="B6" t="n" s="3"><v>233971.43</v></c>
      <c r="C6" t="n" s="3"><v>209523.81</v></c>
      <c r="D6" t="s" s="2"><v>${getSharedStringId('Reconciled against POS settlement batches')}</v></c>
    </row>
    <row r="7" ht="22" customHeight="1">
      <c r="A7" t="s" s="2"><v>${getSharedStringId('CGST Collected (2.5%)')}</v></c>
      <c r="B7" t="n" s="3"><v>5849.28</v></c>
      <c r="C7" t="n" s="3"><v>5238.10</v></c>
      <c r="D7" t="s" s="2"><v>${getSharedStringId('Statutory Central Goods & Services Tax')}</v></c>
    </row>
    <row r="8" ht="22" customHeight="1">
      <c r="A8" t="s" s="2"><v>${getSharedStringId('SGST Collected (2.5%)')}</v></c>
      <c r="B8" t="n" s="3"><v>5849.28</v></c>
      <c r="C8" t="n" s="3"><v>5238.10</v></c>
      <c r="D8" t="s" s="2"><v>${getSharedStringId('Statutory Kerala State GST')}</v></c>
    </row>
    <row r="9" ht="22" customHeight="1">
      <c r="A9" t="s" s="2"><v>${getSharedStringId('Total Orders / Invoices')}</v></c>
      <c r="B9" t="n" s="2"><v>893</v></c>
      <c r="C9" t="n" s="2"><v>820</v></c>
      <c r="D9" t="s" s="2"><v>${getSharedStringId('100% Settled Transactions, 0 Pending')}</v></c>
    </row>
    <row r="10" ht="22" customHeight="1">
      <c r="A10" t="s" s="2"><v>${getSharedStringId('Total Guests / Covers (Pax)')}</v></c>
      <c r="B10" t="n" s="2"><v>1420</v></c>
      <c r="C10" t="n" s="2"><v>1300</v></c>
      <c r="D10" t="s" s="2"><v>${getSharedStringId('Average 1.59 Covers per Dining Invoice')}</v></c>
    </row>
    <row r="11" ht="22" customHeight="1">
      <c r="A11" t="s" s="2"><v>${getSharedStringId('Average Ticket Value (ATV)')}</v></c>
      <c r="B11" t="n" s="3"><v>275.10</v></c>
      <c r="C11" t="n" s="3"><v>268.00</v></c>
      <c r="D11" t="s" s="2"><v>${getSharedStringId('+₹7.10 Premium Specialty Beverage lift')}</v></c>
    </row>
    <row r="12" ht="22" customHeight="1">
      <c r="A12" t="s" s="2"><v>${getSharedStringId('Total Discounts Granted')}</v></c>
      <c r="B12" t="n" s="3"><v>4320.00</v></c>
      <c r="C12" t="n" s="3"><v>5000.00</v></c>
      <c r="D12" t="s" s="2"><v>${getSharedStringId('1.76% of Gross Sales (Well within 3% limit)')}</v></c>
    </row>
    <row r="13" ht="22" customHeight="1">
      <c r="A13" t="s" s="2"><v>${getSharedStringId('Voids & Cancellations')}</v></c>
      <c r="B13" t="n" s="2"><v>2</v></c>
      <c r="C13" t="n" s="2"><v>0</v></c>
      <c r="D13" t="s" s="2"><v>${getSharedStringId('₹850.00 total — Authorized by Primary Master')}</v></c>
    </row>
  </sheetData>
</worksheet>`;
zip.addFile('xl/worksheets/sheet1.xml', s1Xml);

// Build Sheet 2: Bill Audit Register (27 Comprehensive Columns, AutoFilter, Live Formulas)
const bCols = [
  { label: 'Sl. No.', w: 8 },
  { label: 'Timestamp (IST)', w: 20 },
  { label: 'Bill Number', w: 18 },
  { label: 'Token #', w: 10 },
  { label: 'Branch / Outlet', w: 22 },
  { label: 'Table / Area', w: 20 },
  { label: 'Pax', w: 8 },
  { label: 'Biller / Cashier', w: 22 },
  { label: 'Captain / Server', w: 20 },
  { label: 'Order Channel', w: 16 },
  { label: 'Customer Name & Mobile', w: 26 },
  { label: 'Loyalty Tier', w: 16 },
  { label: 'Gross Total (INR)', w: 18 },
  { label: 'Discount Code', w: 16 },
  { label: 'Discount (INR)', w: 16 },
  { label: 'Service Chg (INR)', w: 16 },
  { label: 'Net Taxable (INR)', w: 18 },
  { label: 'CGST 2.5% (INR)', w: 16 },
  { label: 'SGST 2.5% (INR)', w: 16 },
  { label: 'Round Off (INR)', w: 14 },
  { label: 'Final Total (INR)', w: 18 },
  { label: 'Payment Mode', w: 16 },
  { label: 'Payment Ref / UTR', w: 24 },
  { label: 'Bill Status', w: 16 },
  { label: 'Shift / Counter', w: 18 },
  { label: 'Reprint Count', w: 14 },
  { label: 'Audit Notes / Void Reason', w: 30 }
];

const sampleBills = [
  {
    time: '2026-10-14 08:15:22', billNo: 'ZC-CAL-261014-001', token: '#101', outlet: 'Zamorin Flagship Calicut',
    table: 'Table 02 (Ground AC)', pax: 2, cashier: 'Rahul K. (EMP-102)', captain: 'Vishnu M. (EMP-114)', channel: 'DINE_IN',
    cust: 'Aditya N. (+91 98470 11223)', loyalty: 'GOLD (140 pts)', gross: 560.00, discCode: 'NONE', disc: 0.00, service: 0.00,
    taxable: 533.33, cgst: 13.33, sgst: 13.33, round: 0.01, finalTotal: 560.00, mode: 'UPI (GPay)', ref: 'UPI-982348123019',
    status: 'SETTLED', shift: 'Shift 1 / Till A', reprints: 0, notes: 'Regular Morning Brew'
  },
  {
    time: '2026-10-14 08:32:45', billNo: 'ZC-CAL-261014-002', token: '#102', outlet: 'Zamorin Flagship Calicut',
    table: 'Table 05 (Ground AC)', pax: 4, cashier: 'Rahul K. (EMP-102)', captain: 'Vishnu M. (EMP-114)', channel: 'DINE_IN',
    cust: 'Dr. Priya V. (+91 94471 22334)', loyalty: 'PLATINUM (480 pts)', gross: 1450.00, discCode: 'LOYALTY10', disc: 145.00, service: 0.00,
    taxable: 1242.86, cgst: 31.07, sgst: 31.07, round: 0.00, finalTotal: 1305.00, mode: 'CARD (Visa)', ref: 'AUTH-892301',
    status: 'SETTLED', shift: 'Shift 1 / Till A', reprints: 0, notes: 'Breakfast & Pour-overs'
  },
  {
    time: '2026-10-14 08:45:10', billNo: 'ZC-CAL-261014-003', token: '#103', outlet: 'Zamorin Flagship Calicut',
    table: 'Takeaway Counter', pax: 1, cashier: 'Anas K. (EMP-104)', captain: 'Self Service', channel: 'TAKEAWAY',
    cust: 'Naveen Raj (+91 98950 33445)', loyalty: 'SILVER (60 pts)', gross: 320.00, discCode: 'NONE', disc: 0.00, service: 0.00,
    taxable: 304.76, cgst: 7.62, sgst: 7.62, round: 0.00, finalTotal: 320.00, mode: 'CASH', ref: 'CASH-TILL-103',
    status: 'SETTLED', shift: 'Shift 1 / Till B', reprints: 0, notes: 'Cold Brew To-Go'
  },
  {
    time: '2026-10-14 09:12:05', billNo: 'ZC-KOC-261014-001', token: '#201', outlet: 'Zamorin Kochi Downtown',
    table: 'Table 08 (Mezzanine)', pax: 3, cashier: 'Sanjay T. (EMP-201)', captain: 'Deepak V. (EMP-208)', channel: 'DINE_IN',
    cust: 'Meera Menon (+91 97450 44556)', loyalty: 'GOLD (210 pts)', gross: 980.00, discCode: 'NONE', disc: 0.00, service: 0.00,
    taxable: 933.33, cgst: 23.33, sgst: 23.33, round: 0.01, finalTotal: 980.00, mode: 'UPI (PhonePe)', ref: 'UPI-992301984210',
    status: 'SETTLED', shift: 'Shift 1 / Till A', reprints: 0, notes: 'Speciality Pour-Over'
  },
  {
    time: '2026-10-14 09:25:40', billNo: 'ZC-KOC-261014-002', token: '#202', outlet: 'Zamorin Kochi Downtown',
    table: 'Table 03 (Window Seat)', pax: 1, cashier: 'Sanjay T. (EMP-201)', captain: 'Deepak V. (EMP-208)', channel: 'DINE_IN',
    cust: 'Walk-in Guest', loyalty: 'STANDARD', gross: 420.00, discCode: 'VOID_WRONG_ITEM', disc: 420.00, service: 0.00,
    taxable: 0.00, cgst: 0.00, sgst: 0.00, round: 0.00, finalTotal: 0.00, mode: 'VOID_REVERSED', ref: 'VOID-AUTH-001',
    status: 'VOID_CANCELLED', shift: 'Shift 1 / Till A', reprints: 1, notes: 'Customer ordered Hot Mocha, Cashier punched Iced Mocha. Re-punched on #203.'
  },
  {
    time: '2026-10-14 09:30:15', billNo: 'ZC-KOC-261014-003', token: '#203', outlet: 'Zamorin Kochi Downtown',
    table: 'Table 03 (Window Seat)', pax: 1, cashier: 'Sanjay T. (EMP-201)', captain: 'Deepak V. (EMP-208)', channel: 'DINE_IN',
    cust: 'Walk-in Guest', loyalty: 'STANDARD', gross: 420.00, discCode: 'NONE', disc: 0.00, service: 0.00,
    taxable: 400.00, cgst: 10.00, sgst: 10.00, round: 0.00, finalTotal: 420.00, mode: 'UPI (Paytm)', ref: 'UPI-982104928172',
    status: 'SETTLED', shift: 'Shift 1 / Till A', reprints: 0, notes: 'Corrected Hot Mocha Ticket'
  },
  {
    time: '2026-10-14 09:50:30', billNo: 'ZC-CAL-261014-004', token: '#104', outlet: 'Zamorin Flagship Calicut',
    table: 'Online Aggregator Bay', pax: 1, cashier: 'Anas K. (EMP-104)', captain: 'Delivery Dispatch', channel: 'SWIGGY',
    cust: 'Swiggy Order #892019', loyalty: 'AGGREGATOR', gross: 880.00, discCode: 'SWIGGY20', disc: 176.00, service: 0.00,
    taxable: 670.48, cgst: 16.76, sgst: 16.76, round: 0.00, finalTotal: 704.00, mode: 'SWIGGY_PAY', ref: 'SWIG-PAY-98231',
    status: 'SETTLED', shift: 'Shift 1 / Till B', reprints: 0, notes: 'Rider picked up at 09:58'
  }
];

let s2Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews>
    <sheetView tabSelected="0" workbookViewId="0">
      <pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/>
    </sheetView>
  </sheetViews>
  <cols>`;

bCols.forEach((c, idx) => {
  s2Xml += `\n    <col min="${idx + 1}" max="${idx + 1}" width="${c.w}" customWidth="1"/>`;
});
s2Xml += `\n  </cols>
  <sheetData>
    <row r="1" ht="28" customHeight="1">
      <c r="A1" t="s" s="4"><v>${getSharedStringId('Zamorin Café ERP — Comprehensive Master Bill Audit Register')}</v></c>
    </row>
    <row r="2" ht="18" customHeight="1">
      <c r="A2" t="s" s="6"><v>${getSharedStringId('Corporate Entity: Zamorin Speciality Coffee & Kitchens Pvt. Ltd. | Run ID: RPT-RUN-20261014-9988 | Period: 14-Oct-2026')}</v></c>
    </row>
    <row r="3" ht="14" customHeight="1"/>
    <row r="4" ht="24" customHeight="1">`;

bCols.forEach((c, idx) => {
  const colLetter = getExcelCol(idx);
  s2Xml += `<c r="${colLetter}4" t="s" s="1"><v>${getSharedStringId(c.label)}</v></c>`;
});
s2Xml += `</row>`;

let rIdx = 5;
sampleBills.forEach((b, i) => {
  s2Xml += `<row r="${rIdx}" ht="20" customHeight="1">
    <c r="A${rIdx}" t="n" s="10"><v>${i + 1}</v></c>
    <c r="B${rIdx}" t="s" s="2"><v>${getSharedStringId(b.time)}</v></c>
    <c r="C${rIdx}" t="s" s="2"><v>${getSharedStringId(b.billNo)}</v></c>
    <c r="D${rIdx}" t="s" s="10"><v>${getSharedStringId(b.token)}</v></c>
    <c r="E${rIdx}" t="s" s="2"><v>${getSharedStringId(b.outlet)}</v></c>
    <c r="F${rIdx}" t="s" s="2"><v>${getSharedStringId(b.table)}</v></c>
    <c r="G${rIdx}" t="n" s="10"><v>${b.pax}</v></c>
    <c r="H${rIdx}" t="s" s="2"><v>${getSharedStringId(b.cashier)}</v></c>
    <c r="I${rIdx}" t="s" s="2"><v>${getSharedStringId(b.captain)}</v></c>
    <c r="J${rIdx}" t="s" s="9"><v>${getSharedStringId(b.channel)}</v></c>
    <c r="K${rIdx}" t="s" s="2"><v>${getSharedStringId(b.cust)}</v></c>
    <c r="L${rIdx}" t="s" s="2"><v>${getSharedStringId(b.loyalty)}</v></c>
    <c r="M${rIdx}" t="n" s="3"><v>${b.gross.toFixed(2)}</v></c>
    <c r="N${rIdx}" t="s" s="2"><v>${getSharedStringId(b.discCode)}</v></c>
    <c r="O${rIdx}" t="n" s="3"><v>${b.disc.toFixed(2)}</v></c>
    <c r="P${rIdx}" t="n" s="3"><v>${b.service.toFixed(2)}</v></c>
    <c r="Q${rIdx}" t="n" s="3"><v>${b.taxable.toFixed(2)}</v></c>
    <c r="R${rIdx}" t="n" s="3"><v>${b.cgst.toFixed(2)}</v></c>
    <c r="S${rIdx}" t="n" s="3"><v>${b.sgst.toFixed(2)}</v></c>
    <c r="T${rIdx}" t="n" s="3"><v>${b.round.toFixed(2)}</v></c>
    <c r="U${rIdx}" t="n" s="3"><v>${b.finalTotal.toFixed(2)}</v></c>
    <c r="V${rIdx}" t="s" s="9"><v>${getSharedStringId(b.mode)}</v></c>
    <c r="W${rIdx}" t="s" s="2"><v>${getSharedStringId(b.ref)}</v></c>
    <c r="X${rIdx}" t="s" s="9"><v>${getSharedStringId(b.status)}</v></c>
    <c r="Y${rIdx}" t="s" s="2"><v>${getSharedStringId(b.shift)}</v></c>
    <c r="Z${rIdx}" t="n" s="10"><v>${b.reprints}</v></c>
    <c r="AA${rIdx}" t="s" s="2"><v>${getSharedStringId(b.notes)}</v></c>
  </row>`;
  rIdx++;
});

// Live Formula Summary Row (SUM formulas for totals)
s2Xml += `<row r="${rIdx}" ht="24" customHeight="1">
  <c r="A${rIdx}" t="s" s="5"><v>${getSharedStringId('AUDIT TOTALS')}</v></c>
  <c r="B${rIdx}" s="5"/>
  <c r="C${rIdx}" s="5"/>
  <c r="D${rIdx}" s="5"/>
  <c r="E${rIdx}" s="5"/>
  <c r="F${rIdx}" s="5"/>
  <c r="G${rIdx}" t="n" s="5"><f>SUM(G5:G${rIdx - 1})</f><v>14</v></c>
  <c r="H${rIdx}" s="5"/>
  <c r="I${rIdx}" s="5"/>
  <c r="J${rIdx}" s="5"/>
  <c r="K${rIdx}" s="5"/>
  <c r="L${rIdx}" s="5"/>
  <c r="M${rIdx}" t="n" s="5"><f>SUM(M5:M${rIdx - 1})</f><v>5070.00</v></c>
  <c r="N${rIdx}" s="5"/>
  <c r="O${rIdx}" t="n" s="5"><f>SUM(O5:O${rIdx - 1})</f><v>741.00</v></c>
  <c r="P${rIdx}" t="n" s="5"><f>SUM(P5:P${rIdx - 1})</f><v>0.00</v></c>
  <c r="Q${rIdx}" t="n" s="5"><f>SUM(Q5:Q${rIdx - 1})</f><v>4114.76</v></c>
  <c r="R${rIdx}" t="n" s="5"><f>SUM(R5:R${rIdx - 1})</f><v>102.73</v></c>
  <c r="S${rIdx}" t="n" s="5"><f>SUM(S5:S${rIdx - 1})</f><v>102.73</v></c>
  <c r="T${rIdx}" t="n" s="5"><f>SUM(T5:T${rIdx - 1})</f><v>0.02</v></c>
  <c r="U${rIdx}" t="n" s="5"><f>SUM(U5:U${rIdx - 1})</f><v>4329.00</v></c>
  <c r="V${rIdx}" s="5"/>
  <c r="W${rIdx}" s="5"/>
  <c r="X${rIdx}" s="5"/>
  <c r="Y${rIdx}" s="5"/>
  <c r="Z${rIdx}" s="5"/>
  <c r="AA${rIdx}" s="5"/>
</row>
</sheetData>
<autoFilter ref="A4:AA${rIdx - 1}"/>
</worksheet>`;
zip.addFile('xl/worksheets/sheet2.xml', s2Xml);

// Build Sheet 3: Line-Item Breakdown (Item Level Specifics & Modifiers)
const itemCols = [
  { label: 'Sl. No.', w: 8 },
  { label: 'Bill Number', w: 18 },
  { label: 'Item SKU / Code', w: 16 },
  { label: 'Item Name', w: 28 },
  { label: 'Category', w: 20 },
  { label: 'Variant / Size', w: 18 },
  { label: 'Add-ons & Modifiers', w: 32 },
  { label: 'Quantity', w: 10 },
  { label: 'Unit Base (INR)', w: 16 },
  { label: 'Modifier (INR)', w: 16 },
  { label: 'Item Total (INR)', w: 18 },
  { label: 'KOT Punch Time', w: 18 },
  { label: 'KDS Station', w: 18 },
  { label: 'Item Status', w: 14 }
];

const sampleItems = [
  { billNo: 'ZC-CAL-261014-001', sku: 'BEV-COF-001', name: 'Signature Spanish Latte', cat: 'Speciality Coffee', var: 'Regular (250ml)', mod: 'Oat Milk (+₹40)', qty: 1, base: 220.00, modP: 40.00, total: 260.00, kot: '08:14:10', kds: 'Espresso Bar 1', stat: 'SERVED' },
  { billNo: 'ZC-CAL-261014-001', sku: 'BAK-CRS-002', name: 'Almond Croissant Butter', cat: 'Bakery & Patisserie', var: 'Standard 1pc', mod: 'Warm & Crispy', qty: 1, base: 300.00, modP: 0.00, total: 300.00, kot: '08:14:10', kds: 'Bakery Warming', stat: 'SERVED' },
  { billNo: 'ZC-CAL-261014-002', sku: 'BEV-COF-004', name: 'Aeropress Single Origin', cat: 'Manual Brews', var: 'Malabar Arabica AA', mod: 'Zero Sugar', qty: 2, base: 240.00, modP: 0.00, total: 480.00, kot: '08:31:02', kds: 'Brew Bar Station', stat: 'SERVED' },
  { billNo: 'ZC-CAL-261014-002', sku: 'FOD-BRK-001', name: 'Eggs Benedict Avocado', cat: 'All-Day Breakfast', var: 'Brioche Bun', mod: 'Poached Eggs Soft', qty: 2, base: 485.00, modP: 0.00, total: 970.00, kot: '08:31:02', kds: 'Hot Kitchen Line', stat: 'SERVED' },
  { billNo: 'ZC-CAL-261014-003', sku: 'BEV-COF-008', name: 'Nitro Cold Brew Tap', cat: 'Cold Specialities', var: 'Tall Glass (350ml)', mod: 'Vanilla Cold Foam (+₹50)', qty: 1, base: 270.00, modP: 50.00, total: 320.00, kot: '08:44:20', kds: 'Espresso Bar 2', stat: 'SERVED' },
  { billNo: 'ZC-KOC-261014-001', sku: 'BEV-COF-003', name: 'Cortado Double Ristretto', cat: 'Speciality Coffee', var: 'Classic (130ml)', mod: 'None', qty: 2, base: 190.00, modP: 0.00, total: 380.00, kot: '09:11:15', kds: 'Espresso Bar 1', stat: 'SERVED' },
  { billNo: 'ZC-KOC-261014-001', sku: 'FOD-SAN-002', name: 'Truffle Mushroom Panini', cat: 'Gourmet Sandwiches', var: 'Sourdough Focaccia', mod: 'Extra Smoked Gouda (+₹60)', qty: 1, base: 540.00, modP: 60.00, total: 600.00, kot: '09:11:15', kds: 'Grill Station', stat: 'SERVED' }
];

let s3Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews>
    <sheetView tabSelected="0" workbookViewId="0">
      <pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/>
    </sheetView>
  </sheetViews>
  <cols>`;
itemCols.forEach((c, idx) => {
  s3Xml += `\n    <col min="${idx + 1}" max="${idx + 1}" width="${c.w}" customWidth="1"/>`;
});
s3Xml += `\n  </cols>
  <sheetData>
    <row r="1" ht="28" customHeight="1">
      <c r="A1" t="s" s="4"><v>${getSharedStringId('Zamorin Café ERP — Item-Level Recipe & KDS Line Breakdown')}</v></c>
    </row>
    <row r="2" ht="18" customHeight="1">
      <c r="A2" t="s" s="6"><v>${getSharedStringId('Detailed dish, beverage, variant, modifier and KOT preparation log | 14-Oct-2026')}</v></c>
    </row>
    <row r="3" ht="14" customHeight="1"/>
    <row r="4" ht="24" customHeight="1">`;

itemCols.forEach((c, idx) => {
  s3Xml += `<c r="${getExcelCol(idx)}4" t="s" s="1"><v>${getSharedStringId(c.label)}</v></c>`;
});
s3Xml += `</row>`;

let irIdx = 5;
sampleItems.forEach((it, i) => {
  s3Xml += `<row r="${irIdx}" ht="20" customHeight="1">
    <c r="A${irIdx}" t="n" s="10"><v>${i + 1}</v></c>
    <c r="B${irIdx}" t="s" s="2"><v>${getSharedStringId(it.billNo)}</v></c>
    <c r="C${irIdx}" t="s" s="10"><v>${getSharedStringId(it.sku)}</v></c>
    <c r="D${irIdx}" t="s" s="2"><v>${getSharedStringId(it.name)}</v></c>
    <c r="E${irIdx}" t="s" s="2"><v>${getSharedStringId(it.cat)}</v></c>
    <c r="F${irIdx}" t="s" s="2"><v>${getSharedStringId(it.var)}</v></c>
    <c r="G${irIdx}" t="s" s="2"><v>${getSharedStringId(it.mod)}</v></c>
    <c r="H${irIdx}" t="n" s="10"><v>${it.qty}</v></c>
    <c r="I${irIdx}" t="n" s="3"><v>${it.base.toFixed(2)}</v></c>
    <c r="J${irIdx}" t="n" s="3"><v>${it.modP.toFixed(2)}</v></c>
    <c r="K${irIdx}" t="n" s="3"><v>${it.total.toFixed(2)}</v></c>
    <c r="L${irIdx}" t="s" s="10"><v>${getSharedStringId(it.kot)}</v></c>
    <c r="M${irIdx}" t="s" s="2"><v>${getSharedStringId(it.kds)}</v></c>
    <c r="N${irIdx}" t="s" s="9"><v>${getSharedStringId(it.stat)}</v></c>
  </row>`;
  irIdx++;
});

// Live Formula Summary Row for Items
s3Xml += `<row r="${irIdx}" ht="24" customHeight="1">
  <c r="A${irIdx}" t="s" s="5"><v>${getSharedStringId('ITEM TOTALS')}</v></c>
  <c r="B${irIdx}" s="5"/>
  <c r="C${irIdx}" s="5"/>
  <c r="D${irIdx}" s="5"/>
  <c r="E${irIdx}" s="5"/>
  <c r="F${irIdx}" s="5"/>
  <c r="G${irIdx}" s="5"/>
  <c r="H${irIdx}" t="n" s="5"><f>SUM(H5:H${irIdx - 1})</f><v>10</v></c>
  <c r="I${irIdx}" s="5"/>
  <c r="J${irIdx}" s="5"/>
  <c r="K${irIdx}" t="n" s="5"><f>SUM(K5:K${irIdx - 1})</f><v>3310.00</v></c>
  <c r="L${irIdx}" s="5"/>
  <c r="M${irIdx}" s="5"/>
  <c r="N${irIdx}" s="5"/>
</row>
</sheetData>
<autoFilter ref="A4:N${irIdx - 1}"/>
</worksheet>`;
zip.addFile('xl/worksheets/sheet3.xml', s3Xml);

// Build Sheet 4: Audit & System Manifest
let s4Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>
    <col min="1" max="1" width="32" customWidth="1"/>
    <col min="2" max="2" width="55" customWidth="1"/>
  </cols>
  <sheetData>
    <row r="1" ht="28" customHeight="1">
      <c r="A1" t="s" s="4"><v>${getSharedStringId('Zamorin Café ERP — Regulatory & Tamper Verification Manifest')}</v></c>
    </row>
    <row r="2" ht="14" customHeight="1"/>
    <row r="3" ht="20" customHeight="1">
      <c r="A3" t="s" s="1"><v>${getSharedStringId('AUDIT ATTRIBUTE')}</v></c>
      <c r="B3" t="s" s="1"><v>${getSharedStringId('SYSTEM VALUE / REGULATORY BINDING')}</v></c>
    </row>
    <row r="4" ht="22" customHeight="1">
      <c r="A4" t="s" s="2"><v>${getSharedStringId('Company Legal Name')}</v></c>
      <c r="B4" t="s" s="2"><v>${getSharedStringId('Zamorin Speciality Coffee & Kitchens Pvt. Ltd.')}</v></c>
    </row>
    <row r="5" ht="22" customHeight="1">
      <c r="A5" t="s" s="2"><v>${getSharedStringId('Goods & Services Tax (GSTIN)')}</v></c>
      <c r="B5" t="s" s="2"><v>${getSharedStringId('32AAACZ1234K1Z5 (Kerala State Jurisdiction)')}</v></c>
    </row>
    <row r="6" ht="22" customHeight="1">
      <c r="A6" t="s" s="2"><v>${getSharedStringId('Food Safety Authority (FSSAI)')}</v></c>
      <c r="B6" t="s" s="2"><v>${getSharedStringId('11223344556677 (Central & State FSSAI Certified)')}</v></c>
    </row>
    <row r="7" ht="22" customHeight="1">
      <c r="A7" t="s" s="2"><v>${getSharedStringId('Official Traceable Run ID')}</v></c>
      <c r="B7" t="s" s="2"><v>${getSharedStringId('RPT-RUN-20261014-9988')}</v></c>
    </row>
    <row r="8" ht="22" customHeight="1">
      <c r="A8" t="s" s="2"><v>${getSharedStringId('Security & Tamper Proofing')}</v></c>
      <c r="B8" t="s" s="2"><v>${getSharedStringId('Stage 02 Universal QR Verified with SHA-256 HMAC')}</v></c>
    </row>
    <row r="9" ht="22" customHeight="1">
      <c r="A9" t="s" s="2"><v>${getSharedStringId('Data Classification')}</v></c>
      <c r="B9" t="s" s="2"><v>${getSharedStringId('CONFIDENTIAL FINANCIAL RECORD (Restricted Access)')}</v></c>
    </row>
    <row r="10" ht="22" customHeight="1">
      <c r="A10" t="s" s="2"><v>${getSharedStringId('Reporting Engine & Specification')}</v></c>
      <c r="B10" t="s" s="2"><v>${getSharedStringId('Zamorin Universal Reporting Framework (ZURF v2.4 Enterprise)')}</v></c>
    </row>
  </sheetData>
</worksheet>`;
zip.addFile('xl/worksheets/sheet4.xml', s4Xml);

// Shared Strings XML
let ssXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">`;
sharedStrings.forEach((s) => {
  ssXml += `\n  <si><t xml:space="preserve">${xmlEscape(s)}</t></si>`;
});
ssXml += `\n</sst>`;
zip.addFile('xl/sharedStrings.xml', ssXml);

const buf = zip.toBuffer();
const outPath = path.resolve(__dirname, '..', 'ZAMORIN_OFFICIAL_EXCEL_TEMPLATE.xlsx');
fs.writeFileSync(outPath, buf);
console.log('Successfully generated Full Enterprise Excel Template at:', outPath, 'Size:', buf.length, 'bytes');
