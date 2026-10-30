import { crc32, deflateRawSync } from "node:zlib";

/**
 * A synthetic Excel workbook in the real Office Open XML package shape, as a
 * spreadsheet application saves one: [Content_Types].xml, package and
 * workbook relationships, workbook, styles, a shared-string table, and one
 * deflated worksheet part per sheet, each ZIP entry with its CRC-32. Text
 * cells are shared strings unless `inline: true`; numbers and booleans are
 * stored values. Test support only; it writes no file and reads no input.
 *
 * A row is an array of cell values (null/undefined = no cell) or
 * { cells, hidden, styledEmpty } where styledEmpty stores an empty styled
 * cell for every column (as a formatted but empty row is saved). A cell
 * value may be a string, number, boolean, or { formula, value }.
 */
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const SYNTHETIC_XLSX_MIME = XLSX_MIME;

function escapeXml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function columnName(index) {
  let name = "";
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, content } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(content, "utf8");
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.byteLength, 18);
    local.writeUInt32LE(data.byteLength, 22);
    local.writeUInt16LE(nameBytes.byteLength, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.byteLength, 20);
    central.writeUInt32LE(data.byteLength, 24);
    central.writeUInt16LE(nameBytes.byteLength, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, compressed);
    centrals.push(central, nameBytes);
    offset += local.byteLength + nameBytes.byteLength + compressed.byteLength;
  }
  const centralDirectory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.byteLength, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, centralDirectory, eocd]));
}

function worksheetXml({ rows, merged = [], hiddenColumns = [] }, sharedString, { inline }) {
  let width = 0;
  const rowXml = rows.map((row, rowOffset) => {
    if (row === null) return "";
    const spec = Array.isArray(row) ? { cells: row } : row;
    width = Math.max(width, spec.cells.length);
    const r = rowOffset + 1;
    const cells = spec.cells.map((value, columnOffset) => {
      const ref = `${columnName(columnOffset + 1)}${r}`;
      if (value === null || value === undefined) return spec.styledEmpty ? `<c r="${ref}" s="1"/>` : "";
      if (typeof value === "object") {
        return `<c r="${ref}"${typeof value.value === "string" ? " t=\"str\"" : ""}><f>${escapeXml(value.formula)}</f><v>${escapeXml(value.value)}</v></c>`;
      }
      if (typeof value === "number") return `<c r="${ref}"><v>${value}</v></c>`;
      if (typeof value === "boolean") return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
      if (inline) return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
      return `<c r="${ref}" t="s"><v>${sharedString(value)}</v></c>`;
    }).join("");
    return `<row r="${r}"${spec.hidden ? " hidden=\"1\"" : ""}>${cells}</row>`;
  }).join("");
  const cols = hiddenColumns.length > 0
    ? `<cols>${hiddenColumns.map((index) => `<col min="${index}" max="${index}" width="0" hidden="1" customWidth="1"/>`).join("")}</cols>`
    : "";
  const merges = merged.length > 0 ? `<mergeCells count="${merged.length}">${merged.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + `<dimension ref="A1:${columnName(Math.max(width, 1))}${Math.max(rows.length, 1)}"/>${cols}<sheetData>${rowXml}</sheetData>${merges}</worksheet>`;
}

export function syntheticXlsxWorkbook({ sheets, inline = false }) {
  const strings = [];
  const index = new Map();
  const sharedString = (text) => {
    if (!index.has(text)) {
      index.set(text, strings.length);
      strings.push(text);
    }
    return index.get(text);
  };
  const sheetParts = sheets.map((sheet) => worksheetXml(sheet, sharedString, { inline }));
  const main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const entries = [
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
        + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
        + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
        + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")
        + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
        + `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
        + `<Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="${main}" xmlns:r="${rel}"><sheets>`
        + sheets.map((sheet, i) => `<sheet name="${escapeXml(sheet.name ?? `Sheet${i + 1}`)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")
        + `</sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
        + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")
        + `<Relationship Id="rId${sheets.length + 1}" Type="${rel}/styles" Target="styles.xml"/>`
        + `<Relationship Id="rId${sheets.length + 2}" Type="${rel}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    },
    {
      name: "xl/styles.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="${main}"><fonts count="1"><font/></fonts><fills count="1"><fill/></fills>`
        + `<borders count="1"><border/></borders><cellXfs count="2"><xf/><xf fillId="0"/></cellXfs></styleSheet>`,
    },
    ...sheetParts.map((content, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, content })),
    {
      name: "xl/sharedStrings.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="${main}" count="${strings.length}" uniqueCount="${strings.length}">`
        + strings.map((text) => `<si><t xml:space="preserve">${escapeXml(text)}</t></si>`).join("") + `</sst>`,
    },
  ];
  return zip(entries);
}

/**
 * The established synthetic programme-session log as a one-worksheet
 * workbook: one header row, six data rows after it - one genuinely blank
 * (a formatted but empty row) - so five countable records, two of which are
 * exact duplicates. `tag` is an extra value making each workbook's bytes
 * distinct; it never reaches a profile. programmeSessionRows is that
 * worksheet's row list, for workbooks that place it among other worksheets.
 */
export function programmeSessionRows({ tag = "w1", styledBlank = true } = {}) {
  const header = ["session_date", "programme", "facilitator_code", "run_tag"];
  return [
    header,
    ["2026-09-02", "literacy", "F1", tag],
    ["2026-09-09", "literacy", "F1", tag],
    styledBlank ? { cells: [null, null, null, null], styledEmpty: true } : null,
    ["2026-09-16", "mentoring", "F2", tag],
    ["2026-09-16", "mentoring", "F2", tag],
    ["2026-09-23", "literacy", 0, tag],
  ];
}

export function programmeSessionWorkbook({ tag = "w1", styledBlank = true, extraSheet = false } = {}) {
  const rows = programmeSessionRows({ tag, styledBlank });
  const sheets = [{ name: "Sessions", rows }];
  if (extraSheet) sheets.push({ name: "Notes", rows: [["note"], ["second table"]] });
  return syntheticXlsxWorkbook({ sheets });
}
