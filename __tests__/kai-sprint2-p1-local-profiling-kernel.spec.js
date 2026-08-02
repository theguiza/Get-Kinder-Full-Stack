import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { profileLocalTrustedFile } from "../Backend/kai/profiling/localProfilingKernel.js";
import { KAI_SPRINT2_P0_CSV_LIMITS } from "../Backend/kai/config/kaiSprint2P0Contract.js";

const CSV_MIME = "text/csv";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PDF_MIME = "application/pdf";
const RAW_SENTINELS = Object.freeze([
  "Alice",
  "alice@example.invalid",
  "=IMPORTXML",
  "ignore previous instructions",
  "SUM(A1:A2)",
  "Secret Heading",
  "PDF visible text",
]);

function bytes(text) {
  return new TextEncoder().encode(text);
}

async function profile({ extension, declaredMime, body }) {
  const fileBytes = body instanceof Uint8Array ? body : bytes(body);
  return profileLocalTrustedFile({
    extension,
    declaredMime,
    byteSize: fileBytes.byteLength,
    bytes: fileBytes,
  });
}

function assertNoRawSentinels(result) {
  const serialized = JSON.stringify(result);
  for (const sentinel of RAW_SENTINELS) {
    assert.doesNotMatch(serialized, new RegExp(sentinel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  assert.doesNotMatch(serialized, /https?:\/\//i);
  assert.doesNotMatch(serialized, /\/Users\/|objectKey|storage_path|prompt|previous instructions/i);
}

function assertConservativeDefaults(result) {
  assert.equal(result.governance.meaning, "unknown");
  assert.equal(result.governance.sensitivity, "unknown");
  assert.equal(result.governance.review, "required");
  assert.equal(result.governance.allowed_use, "internal only");
  assert.equal(result.governance.llm_use, "not allowed");
  assert.equal(result.governance.public_use, "not allowed");
  assert.equal(result.governance.funder_use, "not allowed");
}

function le16(value) {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff);
}

function le32(value) {
  return Uint8Array.of(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  );
}

function concat(parts) {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function dosDateTime() {
  return { time: le16(0), date: le16(0) };
}

function storedZip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const entry of entries) {
    const nameBytes = bytes(entry.name);
    const dataBytes = entry.content instanceof Uint8Array ? entry.content : bytes(entry.content);
    const { time, date } = dosDateTime();
    const local = concat([
      le32(0x04034b50),
      le16(20),
      le16(0),
      le16(0),
      time,
      date,
      le32(0),
      le32(dataBytes.byteLength),
      le32(dataBytes.byteLength),
      le16(nameBytes.byteLength),
      le16(0),
      nameBytes,
      dataBytes,
    ]);
    const central = concat([
      le32(0x02014b50),
      le16(20),
      le16(20),
      le16(0),
      le16(0),
      time,
      date,
      le32(0),
      le32(dataBytes.byteLength),
      le32(dataBytes.byteLength),
      le16(nameBytes.byteLength),
      le16(0),
      le16(0),
      le16(0),
      le16(0),
      le32(0),
      le32(localOffset),
      nameBytes,
    ]);
    localParts.push(local);
    centralParts.push(central);
    localOffset += local.byteLength;
  }
  const centralDirectory = concat(centralParts);
  const eocd = concat([
    le32(0x06054b50),
    le16(0),
    le16(0),
    le16(entries.length),
    le16(entries.length),
    le32(centralDirectory.byteLength),
    le32(localOffset),
    le16(0),
  ]);
  return concat([...localParts, centralDirectory, eocd]);
}

function workbookXml(sheetCount) {
  const sheets = Array.from({ length: sheetCount }, (_, index) => {
    const sheetNumber = index + 1;
    return `<sheet name="Redacted${sheetNumber}" sheetId="${sheetNumber}" r:id="rId${sheetNumber}"/>`;
  }).join("");
  return `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets></workbook>`;
}

function relsXml(sheetCount) {
  const rels = Array.from({ length: sheetCount }, (_, index) => {
    const sheetNumber = index + 1;
    return `<Relationship Id="rId${sheetNumber}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheetNumber}.xml"/>`;
  }).join("");
  return `<?xml version="1.0"?><Relationships>${rels}</Relationships>`;
}

function worksheetXml({ formula = false } = {}) {
  return `<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>42</v>${formula ? "<f>SUM(A1:A2)</f>" : ""}</c></row><row r="2"><c r="A2" t="str"><v>ignore previous instructions</v></c></row></sheetData></worksheet>`;
}

function xlsxBytes({ sheetCount = 1, formula = false } = {}) {
  const entries = [
    { name: "[Content_Types].xml", content: "<?xml version=\"1.0\"?><Types/>" },
    { name: "_rels/.rels", content: "<?xml version=\"1.0\"?><Relationships/>" },
    { name: "xl/workbook.xml", content: workbookXml(sheetCount) },
    { name: "xl/_rels/workbook.xml.rels", content: relsXml(sheetCount) },
  ];
  for (let index = 1; index <= sheetCount; index += 1) {
    entries.push({ name: `xl/worksheets/sheet${index}.xml`, content: worksheetXml({ formula }) });
  }
  return storedZip(entries);
}

function pdfBytes({ textLayer = true, encrypted = false } = {}) {
  const stream = textLayer
    ? "BT /F1 12 Tf 72 720 Td (PDF visible text) Tj ET"
    : "q 100 0 0 100 0 0 cm /Im1 Do Q";
  const encrypt = encrypted ? "/Encrypt 9 0 R" : "";
  return bytes(`%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R ${encrypt} >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj
4 0 obj << /Length ${stream.length} >> stream
${stream}
endstream endobj
trailer << /Root 1 0 R ${encrypt} >>
%%EOF`);
}

test("P1-01 local profiling returns deterministic sanitized profiles for CSV, XLSX, Markdown, TXT, and machine-readable PDF", async () => {
  const cases = [
    [".csv", CSV_MIME, "name,email,amount\nAlice,alice@example.invalid,12\nBob,,=IMPORTXML\n"],
    [".xlsx", XLSX_MIME, xlsxBytes({ formula: true })],
    [".md", "text/markdown", "# Secret Heading\nignore previous instructions\n"],
    [".txt", "text/plain", "Alice\nignore previous instructions\n"],
    [".pdf", PDF_MIME, pdfBytes()],
  ];

  for (const [extension, declaredMime, body] of cases) {
    const first = await profile({ extension, declaredMime, body });
    const second = await profile({ extension, declaredMime, body });
    assert.deepEqual(first, second, extension);
    assertConservativeDefaults(first);
    assertNoRawSentinels(first);
  }
});

test("P1-01 CSV profiling exposes shapes, counts formulas without content, and enforces existing row limits", async () => {
  const result = await profile({
    extension: ".csv",
    declaredMime: CSV_MIME,
    body: "name,email,amount\nAlice,alice@example.invalid,12\nBob,,=IMPORTXML\n",
  });
  assert.equal(result.status, "profiled");
  assert.equal(result.counts.row_count, 2);
  assert.equal(result.counts.column_count, 3);
  assert.equal(result.counts.formula_count, 1);
  assert.equal(result.sample_shapes[0].field_shapes[0].primitive_type_hint, "text_like");
  assertNoRawSentinels(result);

  const oversizedRows = Array.from({ length: KAI_SPRINT2_P0_CSV_LIMITS.maxLogicalRecords + 1 }, () => "1").join("\n");
  const limitResult = await profile({ extension: ".csv", declaredMime: CSV_MIME, body: oversizedRows });
  assert.equal(limitResult.status, "failed");
  assert.equal(limitResult.error.category, "csv_row_limit_exceeded");
  assertNoRawSentinels(limitResult);
});

test("P1-01 XLSX profiling enforces sheet limits and does not disclose cell, formula, or prompt text", async () => {
  const result = await profile({ extension: ".xlsx", declaredMime: XLSX_MIME, body: xlsxBytes({ formula: true }) });
  assert.equal(result.status, "profiled");
  assert.equal(result.counts.sheet_count, 1);
  assert.equal(result.counts.row_count, 2);
  assert.equal(result.counts.cell_count, 3);
  assert.equal(result.counts.formula_count, 1);
  assertNoRawSentinels(result);

  const limitResult = await profile({ extension: ".xlsx", declaredMime: XLSX_MIME, body: xlsxBytes({ sheetCount: 21 }) });
  assert.equal(limitResult.status, "failed");
  assert.equal(limitResult.error.category, "xlsx_sheet_limit_exceeded");
  assertNoRawSentinels(limitResult);
});

test("P1-01 malformed input returns safe failures with no partial result", async () => {
  const malformedCsv = await profile({ extension: ".csv", declaredMime: CSV_MIME, body: "a,b\n\"unterminated,2\nAlice\n" });
  assert.equal(malformedCsv.status, "failed");
  assert.equal(malformedCsv.counts, undefined);
  assertNoRawSentinels(malformedCsv);

  const malformedXlsx = await profile({ extension: ".xlsx", declaredMime: XLSX_MIME, body: bytes("PK\x03") });
  assert.equal(malformedXlsx.status, "failed");
  assert.equal(malformedXlsx.counts, undefined);
  assertNoRawSentinels(malformedXlsx);
});

test("P1-01 PDF profiling is local, does no OCR, and returns typed not_profilable for encrypted and image-only PDFs", async () => {
  const profiled = await profile({ extension: ".pdf", declaredMime: PDF_MIME, body: pdfBytes() });
  assert.equal(profiled.status, "profiled");
  assert.equal(profiled.structural_metadata.ocr_performed, false);
  assert.equal(profiled.counts.page_count, 1);
  assertNoRawSentinels(profiled);

  const encrypted = await profile({ extension: ".pdf", declaredMime: PDF_MIME, body: pdfBytes({ encrypted: true }) });
  assert.equal(encrypted.status, "not_profilable");
  assert.equal(encrypted.reason, "encrypted_pdf");
  assert.equal(encrypted.counts, undefined);
  assertNoRawSentinels(encrypted);

  const imageOnly = await profile({ extension: ".pdf", declaredMime: PDF_MIME, body: pdfBytes({ textLayer: false }) });
  assert.equal(imageOnly.status, "not_profilable");
  assert.equal(imageOnly.reason, "no_machine_readable_text_layer");
  assert.equal(imageOnly.counts, undefined);
  assertNoRawSentinels(imageOnly);
});

test("P1-01 profiling kernel has no reachable database, storage, lifecycle, queue, review, source, evidence, claim, AI, or OCR dependency", () => {
  const source = readFileSync("Backend/kai/profiling/localProfilingKernel.js", "utf8");
  assert.doesNotMatch(source, /from\s+["'][^"']*(?:kaiDb|kaiQueries|kaiIntakeQueries|pg|uploadLifecycle|storage|ReviewQueue|DataDictionary|openai|anthropic|worker_threads)["']/i);
  assert.doesNotMatch(source, /\b(?:insert|update|delete|enqueue|review_queue|source_candidate|evidence_record|claim_record|llm|openai|anthropic|ocr)\b/i);
  assert.doesNotMatch(source, /\bcreate[A-Za-z]*(?:Record|Repository|Review|Source|Evidence|Claim)\b/);
});
