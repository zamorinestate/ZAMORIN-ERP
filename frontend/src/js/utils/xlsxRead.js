// Dependency-free XLSX reader (first worksheet -> array of row objects). Browser + Node 22.
// Replaces CSV import: the migration preview endpoint takes JSON rows, so we parse the workbook here.
export const XLSX_MAX_BYTES = 10 * 1024 * 1024;
export const XLSX_MAX_ROWS = 5000;
const dec = new TextDecoder();
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function inflate(raw) {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([raw]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function unzip(bytes) {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("This file is not a valid .xlsx workbook.");
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (u32(bytes, p) !== 0x02014b50) break;
    const method = u16(bytes, p + 10), csize = u32(bytes, p + 20), nlen = u16(bytes, p + 28), elen = u16(bytes, p + 30), clen = u16(bytes, p + 32), lho = u32(bytes, p + 42);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    files.set(name, { method, csize, lho });
    p += 46 + nlen + elen + clen;
  }
  return async (name) => {
    const f = files.get(name); if (!f) return null;
    const ln = u16(bytes, f.lho + 26), le = u16(bytes, f.lho + 28);
    const start = f.lho + 30 + ln + le;
    const raw = bytes.subarray(start, start + f.csize);
    return f.method === 0 ? raw : inflate(raw);
  };
}
const xmlText = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, "&");
const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

/** @param {File|Blob|ArrayBuffer|Uint8Array} src @returns {Promise<{headers:string[], rows:Object[]}>} */
export async function readXlsx(src) {
  const size = src.size ?? src.byteLength ?? src.length;
  if (size > XLSX_MAX_BYTES) throw new Error("File is larger than 10 MB.");
  const bytes = src instanceof Uint8Array ? src : new Uint8Array(src.arrayBuffer ? await src.arrayBuffer() : src);
  const get = await unzip(bytes);
  const text = async (n) => { const b = await get(n); return b ? dec.decode(b) : ""; };
  const wb = await text("xl/workbook.xml");
  if (!wb) throw new Error("This file is not a valid .xlsx workbook.");
  const rid = (wb.match(/<sheet\b[^>]*r:id="([^"]+)"/) || [])[1];
  const rels = await text("xl/_rels/workbook.xml.rels");
  let target = "worksheets/sheet1.xml";
  if (rid) { const m = rels.match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*>`)); const t = m && (m[0].match(/Target="([^"]+)"/) || [])[1]; if (t) target = t.replace(/^\//, "").replace(/^xl\//, ""); }
  const sheet = await text("xl/" + target);
  if (!sheet) throw new Error("The first worksheet could not be read.");
  const sst = [];
  const ss = await text("xl/sharedStrings.xml");
  for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) sst.push(xmlText([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join("")));
  const grid = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], body = cm[2] || "";
      const ref = (attrs.match(/\br="([A-Z]+\d+)"/) || [])[1]; const t = (attrs.match(/\bt="(\w+)"/) || [])[1];
      const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let val = "";
      if (t === "s") val = sst[+v] ?? "";
      else if (t === "inlineStr") val = xmlText([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""));
      else if (t === "b") val = v === "1";
      else if (t === "str" || t === "e") val = xmlText(v ?? "");
      else if (v !== undefined && v !== "") val = isNaN(Number(v)) ? xmlText(v) : Number(v);
      row[ref ? colIndex(ref) : row.length] = val;
    }
    grid.push(row);
  }
  while (grid.length && grid[grid.length - 1].every((c) => c === "" || c == null)) grid.pop();
  if (!grid.length) return { headers: [], rows: [] };
  const headers = (grid[0] || []).map((h, i) => String(h ?? "").trim() || `column_${i + 1}`);
  if (grid.length - 1 > XLSX_MAX_ROWS) throw new Error(`The workbook has ${grid.length - 1} rows; the limit is ${XLSX_MAX_ROWS} per batch.`);
  const rows = grid.slice(1).filter((r) => r.some((c) => c !== "" && c != null)).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
  return { headers, rows };
}
