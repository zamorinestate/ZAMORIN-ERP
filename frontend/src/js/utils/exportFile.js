// Genuine XLSX + PDF export for in-page tables (no CSV anywhere). Dependency-free.
const enc = new TextEncoder();
const xml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
let _crcT; function crc32(b) { if (!_crcT) { _crcT = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; _crcT[n] = c >>> 0; } } let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = _crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipStore(files) {
  const parts = [], central = []; let off = 0;
  const u16 = (v) => [v & 255, (v >> 8) & 255], u32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
  for (const [name, data] of files) {
    const n = enc.encode(name), c = crc32(data);
    const h = new Uint8Array([0x50, 0x4b, 3, 4, 20, 0, 0, 8, 0, 0, 0, 0, 0x21, 0, ...u32(c), ...u32(data.length), ...u32(data.length), ...u16(n.length), 0, 0]);
    parts.push(h, n, data);
    central.push(new Uint8Array([0x50, 0x4b, 1, 2, 20, 0, 20, 0, 0, 8, 0, 0, 0, 0, 0x21, 0, ...u32(c), ...u32(data.length), ...u32(data.length), ...u16(n.length), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...u32(off)]), n);
    off += h.length + n.length + data.length;
  }
  const cs = central.reduce((a, b) => a + b.length, 0), cnt = files.length;
  const end = new Uint8Array([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(cnt), ...u16(cnt), ...u32(cs), ...u32(off), 0, 0]);
  const all = [...parts, ...central, end]; const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0)); let p = 0; for (const a of all) { out.set(a, p); p += a.length; } return out;
}
const colName = (i) => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
/** columns: [{key,label,type?:'text'|'number'|'money'|'date'}], rows: array of objects. Returns Uint8Array (.xlsx). */
export function buildXlsx({ title = "Sheet1", columns, rows }) {
  const sheetName = xml(String(title).replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet1");
  const cell = (v, r, c, t, style) => {
    const ref = colName(c) + r;
    if ((t === "number" || t === "money") && v !== "" && v != null && !isNaN(Number(v))) return `<c r="${ref}" s="${t === "money" ? 2 : 0}"><v>${Number(v)}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  };
  let sd = `<row r="1">${columns.map((c, i) => cell(c.label, 1, i, "text", 1)).join("")}</row>`;
  rows.forEach((row, ri) => { sd += `<row r="${ri + 2}">${columns.map((c, i) => cell(row[c.key], ri + 2, i, c.type)).join("")}</row>`; });
  const cols = columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(40, Math.max(12, String(c.label).length + 4))}" customWidth="1"/>`).join("");
  const files = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="[$₹-4009]#,##,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ["xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${sd}</sheetData></worksheet>`],
  ].map(([n, s]) => [n, enc.encode(s)]);
  return zipStore(files);
}

const latin = (s) => String(s ?? "").replace(/₹/g, "Rs ").replace(/[^\x20-\x7E]/g, "?").replace(/([\\()])/g, "\\$1");
/** Simple multi-page A4 landscape table PDF (Helvetica). */
export function buildPdf({ title, subtitle = "", columns, rows }) {
  const W = 842, H = 595, M = 36, rowH = 18, perPage = Math.floor((H - M * 2 - 60) / rowH);
  const usable = W - M * 2, cw = usable / columns.length, maxCh = Math.max(6, Math.floor(cw / 5));
  const pages = []; for (let i = 0; i < Math.max(1, rows.length); i += perPage) pages.push(rows.slice(i, i + perPage));
  const objs = []; const add = (s) => { objs.push(s); return objs.length; };
  add("<< /Type /Catalog /Pages 2 0 R >>"); add(""); const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"); const fontB = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const kids = [];
  pages.forEach((pr, pi) => {
    let s = `BT /F2 14 Tf ${M} ${H - M} Td (${latin(title)}) Tj ET\nBT /F1 9 Tf ${M} ${H - M - 14} Td (${latin(subtitle)}  -  Page ${pi + 1} of ${pages.length}) Tj ET\n`;
    let y = H - M - 40;
    s += columns.map((c, i) => `BT /F2 9 Tf ${M + i * cw} ${y} Td (${latin(c.label).slice(0, maxCh)}) Tj ET`).join("\n") + `\n${M} ${y - 5} m ${W - M} ${y - 5} l S\n`;
    pr.forEach((r, ri) => { const yy = y - (ri + 1) * rowH; s += columns.map((c, i) => `BT /F1 9 Tf ${M + i * cw} ${yy} Td (${latin(r[c.key]).slice(0, maxCh)}) Tj ET`).join("\n") + "\n"; });
    const cont = add(`<< /Length ${s.length} >>\nstream\n${s}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${cont} 0 R /Resources << /Font << /F1 ${font} 0 R /F2 ${fontB} 0 R >> >> >>`));
  });
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n"; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length; out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return enc.encode(out);
}

function download(bytes, filename, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
}
/** Download rows as a genuine .xlsx or .pdf. format: 'xlsx' | 'pdf'. */
export function exportTable({ format = "xlsx", title, subtitle = "", filename, columns, rows }) {
  const base = (filename || title || "export").replace(/[^\w.-]+/g, "_").replace(/\.(xlsx|pdf|csv)$/i, "");
  if (String(format).toLowerCase() === "pdf") return download(buildPdf({ title, subtitle, columns, rows }), `${base}.pdf`, "application/pdf");
  return download(buildXlsx({ title, columns, rows }), `${base}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

/** Export a header row + array-of-arrays grid as XLSX (default) or PDF. Wrapping quotes are stripped. */
export function exportGrid({ headers, rows, title, filename, format = "xlsx", subtitle = "" }) {
  const clean = (v) => (typeof v === "string" ? v.replace(/^"([\s\S]*)"$/, "$1").replace(/""/g, '"') : v);
  const columns = headers.map((h, i) => ({ key: "c" + i, label: clean(h) }));
  const objs = rows.map((r) => Object.fromEntries(headers.map((_, i) => ["c" + i, clean(r[i])])));
  return exportTable({ format, title: title || filename || "Export", subtitle, filename, columns, rows: objs });
}

/** Export the first data table found inside `scope` (element or selector) as XLSX/PDF. Includes rows hidden by the pager. Returns false if none. */
export function exportDomTable(scope, { format = "xlsx", title = "Export", filename } = {}) {
  const el = typeof scope === "string" ? document.querySelector(scope) : scope;
  const table = el?.tagName === "TABLE" ? el : el?.querySelector("table");
  if (!table || !table.tBodies[0]?.rows.length) return false;
  const head = [...(table.tHead?.rows[0]?.cells || table.rows[0].cells)];
  const headers = head.map((c) => c.textContent.trim());
  const rows = [...table.tBodies[0].rows].filter((r) => r.style.display !== "none" && r.cells.length === headers.length).map((r) => [...r.cells].map((c) => c.textContent.replace(/\s+/g, " ").trim()));
  if (!rows.length) return false;
  const stamp = new Date().toISOString().slice(0, 10);
  exportGrid({ headers, rows, title, filename: filename || `${title}_${stamp}`, format });
  return true;
}
