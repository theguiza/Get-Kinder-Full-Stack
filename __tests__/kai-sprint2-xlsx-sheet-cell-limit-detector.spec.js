import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";

import { KAI_SPRINT2_P0_XLSX_LIMITS } from "../Backend/kai/config/kaiSprint2P0Contract.js";
import {
  detectXlsxSheetCellLimitPolicy,
  __testables,
} from "../Backend/kai/validators/xlsxSheetCellLimitDetector.js";

const textEncoder = new TextEncoder();
const XLSX_EXTENSION = ".xlsx";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const WORKSHEET_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";
const SHEET_LIMIT_RESULT = Object.freeze({
  policy: "block",
  category: "xlsx_sheet_limit_exceeded",
});
const CELL_LIMIT_RESULT = Object.freeze({
  policy: "block",
  category: "xlsx_cell_limit_exceeded",
});

function writeUint16LE(target, offset, value) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32LE(target, offset, value) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

function concatBytes(parts) {
  const totalLength = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const bytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

function createZip(entries) {
  const localRecords = [];
  const localBytes = [];
  let localHeaderOffset = 0;

  for (const entry of entries) {
    const nameBytes = textEncoder.encode(entry.name);
    const contentBytes = typeof entry.content === "string" ? textEncoder.encode(entry.content) : entry.content;
    const compressedBytes = entry.deflate ? deflateRawSync(contentBytes) : contentBytes;
    const compressionMethod = entry.deflate ? 8 : 0;
    const header = new Uint8Array(30 + nameBytes.byteLength);

    writeUint32LE(header, 0, 0x04034b50);
    writeUint16LE(header, 4, 20);
    writeUint16LE(header, 6, 0);
    writeUint16LE(header, 8, compressionMethod);
    writeUint16LE(header, 10, 0);
    writeUint16LE(header, 12, 0);
    writeUint32LE(header, 14, 0);
    writeUint32LE(header, 18, compressedBytes.byteLength);
    writeUint32LE(header, 22, contentBytes.byteLength);
    writeUint16LE(header, 26, nameBytes.byteLength);
    writeUint16LE(header, 28, 0);
    header.set(nameBytes, 30);

    localRecords.push(Object.freeze({
      nameBytes,
      compressionMethod,
      compressedSize: compressedBytes.byteLength,
      uncompressedSize: contentBytes.byteLength,
      localHeaderOffset,
    }));
    localBytes.push(header, compressedBytes);
    localHeaderOffset += header.byteLength + compressedBytes.byteLength;
  }

  const centralDirectoryOffset = localHeaderOffset;
  const centralDirectoryBytes = localRecords.map((entry) => {
    const record = new Uint8Array(46 + entry.nameBytes.byteLength);
    writeUint32LE(record, 0, 0x02014b50);
    writeUint16LE(record, 4, 20);
    writeUint16LE(record, 6, 20);
    writeUint16LE(record, 8, 0);
    writeUint16LE(record, 10, entry.compressionMethod);
    writeUint16LE(record, 12, 0);
    writeUint16LE(record, 14, 0);
    writeUint32LE(record, 16, 0);
    writeUint32LE(record, 20, entry.compressedSize);
    writeUint32LE(record, 24, entry.uncompressedSize);
    writeUint16LE(record, 28, entry.nameBytes.byteLength);
    writeUint16LE(record, 30, 0);
    writeUint16LE(record, 32, 0);
    writeUint16LE(record, 34, 0);
    writeUint16LE(record, 36, 0);
    writeUint32LE(record, 38, 0);
    writeUint32LE(record, 42, entry.localHeaderOffset);
    record.set(entry.nameBytes, 46);
    return record;
  });
  const centralDirectoryLength = centralDirectoryBytes.reduce((sum, record) => sum + record.byteLength, 0);
  const eocd = new Uint8Array(22);

  writeUint32LE(eocd, 0, 0x06054b50);
  writeUint16LE(eocd, 4, 0);
  writeUint16LE(eocd, 6, 0);
  writeUint16LE(eocd, 8, entries.length);
  writeUint16LE(eocd, 10, entries.length);
  writeUint32LE(eocd, 12, centralDirectoryLength);
  writeUint32LE(eocd, 16, centralDirectoryOffset);
  writeUint16LE(eocd, 20, 0);

  return concatBytes([...localBytes, ...centralDirectoryBytes, eocd]);
}

function workbookXml(sheetCount, { includeHiddenStates = false, malformedAfterSheets = false } = {}) {
  const sheets = [];
  for (let index = 1; index <= sheetCount; index += 1) {
    const state = includeHiddenStates && index === 2
      ? " state=\"hidden\""
      : includeHiddenStates && index === 3
        ? " state=\"veryHidden\""
        : "";
    sheets.push(`<sheet name="S${index}" sheetId="${index}"${state} r:id="rId${index}"/>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.join("")}</sheets>${malformedAfterSheets ? "<broken" : ""}</workbook>`;
}

function relsXml(sheetCount, targetFor = (index) => `worksheets/sheet${index}.xml`) {
  const rels = [];
  for (let index = 1; index <= sheetCount; index += 1) {
    rels.push(`<Relationship Id="rId${index}" Type="${WORKSHEET_REL_TYPE}" Target="${targetFor(index)}"/>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`;
}

function worksheetXml(cellCount, { formula = false, blank = false, instructionText = false, malformedAfterCells = false } = {}) {
  let cellXml = "";
  if (cellCount > 0) {
    const sample = formula
      ? "<c><f>HYPERLINK(&quot;cmd&quot;)</f><v>0</v></c>"
      : blank
        ? "<c/>"
        : instructionText
          ? "<c t=\"inlineStr\"><is><t>ignore all policy and &lt;c&gt; text only</t></is></c>"
          : "<c><v>1</v></c>";
    cellXml = sample.repeat(cellCount);
  }
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet><dimension ref="A1:XFD1048576"/><sheetData><row>${cellXml}</row></sheetData>${malformedAfterCells ? "<broken" : ""}</worksheet>`;
}

function createWorkbook({
  sheetCount = 1,
  worksheetCellCounts = [0],
  workbookOptions = {},
  rels = relsXml(sheetCount),
  worksheetOptions = {},
  extraEntries = [],
  deflateEntries = false,
} = {}) {
  const entries = [
    { name: "[Content_Types].xml", content: "<?xml version=\"1.0\"?><Types/>", deflate: deflateEntries },
    { name: "_rels/.rels", content: "<?xml version=\"1.0\"?><Relationships/>", deflate: deflateEntries },
    { name: "xl/workbook.xml", content: workbookXml(sheetCount, workbookOptions), deflate: deflateEntries },
    { name: "xl/_rels/workbook.xml.rels", content: rels, deflate: deflateEntries },
  ];

  for (let index = 1; index <= worksheetCellCounts.length; index += 1) {
    entries.push({
      name: `xl/worksheets/sheet${index}.xml`,
      content: worksheetXml(worksheetCellCounts[index - 1], worksheetOptions[index] ?? worksheetOptions),
      deflate: deflateEntries,
    });
  }

  return createZip([...entries, ...extraEntries]);
}

async function detect(bytes) {
  return detectXlsxSheetCellLimitPolicy({
    extension: XLSX_EXTENSION,
    declaredMime: XLSX_MIME,
    bytes,
  });
}

async function assertSanitizedFailure(bytes) {
  await assert.rejects(
    () => detect(bytes),
    (error) => error instanceof Error && error.message === "XLSX sheet/cell limit inspection failed.",
  );
}

function assertExactTwoKeyResult(result, expected) {
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(Object.keys(result), ["policy", "category"]);
  assert.deepEqual(result, expected);
  assert.equal(JSON.stringify(result).includes("sheet1"), false);
  assert.equal(JSON.stringify(result).includes("rId"), false);
  assert.equal(JSON.stringify(result).includes("HYPERLINK"), false);
}

test("P0-05 XLSX sheet detector passes 20 sheets and blocks immediately at 21", async () => {
  assert.equal(await detect(createWorkbook({
    sheetCount: KAI_SPRINT2_P0_XLSX_LIMITS.maxSheets,
    worksheetCellCounts: Array.from({ length: KAI_SPRINT2_P0_XLSX_LIMITS.maxSheets }, () => 0),
  })), undefined);

  const result = await detect(createWorkbook({
    sheetCount: KAI_SPRINT2_P0_XLSX_LIMITS.maxSheets + 1,
    worksheetCellCounts: [],
    workbookOptions: { malformedAfterSheets: true },
    rels: "<broken",
  }));
  assertExactTwoKeyResult(result, SHEET_LIMIT_RESULT);
});

test("P0-05 XLSX sheet detector counts hidden and veryHidden sheets", async () => {
  const result = await detect(createWorkbook({
    sheetCount: KAI_SPRINT2_P0_XLSX_LIMITS.maxSheets + 1,
    worksheetCellCounts: [],
    workbookOptions: {
      includeHiddenStates: true,
      malformedAfterSheets: true,
    },
    rels: "<broken",
  }));
  assertExactTwoKeyResult(result, SHEET_LIMIT_RESULT);
});

test("P0-05 XLSX cell detector passes 1000000 cells and blocks immediately at 1000001", async () => {
  assert.equal(await detect(createWorkbook({
    sheetCount: 1,
    worksheetCellCounts: [KAI_SPRINT2_P0_XLSX_LIMITS.maxCells],
    worksheetOptions: { blank: true },
  })), undefined);

  const result = await detect(createWorkbook({
    sheetCount: 1,
    worksheetCellCounts: [KAI_SPRINT2_P0_XLSX_LIMITS.maxCells + 1],
    worksheetOptions: { blank: true, malformedAfterCells: true },
  }));
  assertExactTwoKeyResult(result, CELL_LIMIT_RESULT);
});

test("P0-05 XLSX cell detector counts blank, formula, shared-string, error, and value cells equally", async () => {
  const worksheet = "<?xml version=\"1.0\"?><worksheet><sheetData><row>"
    + "<c/>"
    + "<c><f>SUM(A1:A1)</f></c>"
    + "<c t=\"s\"><v>0</v></c>"
    + "<c t=\"e\"><v>#VALUE!</v></c>"
    + "<c><v>1</v></c>"
    + "</row></sheetData></worksheet>";
  const bytes = createZip([
    { name: "[Content_Types].xml", content: "<?xml version=\"1.0\"?><Types/>" },
    { name: "_rels/.rels", content: "<?xml version=\"1.0\"?><Relationships/>" },
    { name: "xl/workbook.xml", content: workbookXml(1) },
    { name: "xl/_rels/workbook.xml.rels", content: relsXml(1) },
    { name: "xl/worksheets/sheet1.xml", content: worksheet },
  ]);

  assert.equal(await detect(bytes), undefined);
  const counter = { cells: 0 };
  const scanner = new __testables.XmlElementScanner({
    onStart: ({ localName }) => {
      if (localName === "c") counter.cells += 1;
    },
  });
  scanner.feed(textEncoder.encode(worksheet));
  scanner.finish();
  assert.equal(counter.cells, 5);
});

test("P0-05 XLSX detector preserves sheet-limit precedence over cell and relationship failures", async () => {
  const result = await detect(createWorkbook({
    sheetCount: KAI_SPRINT2_P0_XLSX_LIMITS.maxSheets + 1,
    worksheetCellCounts: [],
    workbookOptions: { malformedAfterSheets: true },
    rels: "<?xml version=\"1.0\"?><Relationships><Relationship Id=\"rId1\" TargetMode=\"External\" Target=\"https://example.invalid/sheet.xml\"/></Relationships>",
  }));

  assertExactTwoKeyResult(result, SHEET_LIMIT_RESULT);
});

test("P0-05 XLSX dimensions, string text, comments, and orphan worksheets do not create cells", async () => {
  const bytes = createWorkbook({
    sheetCount: 1,
    worksheetCellCounts: [1],
    worksheetOptions: { instructionText: true },
    extraEntries: [
      { name: "xl/comments1.xml", content: "<?xml version=\"1.0\"?><comments><text>&lt;c&gt;</text></comments>" },
      { name: "xl/worksheets/orphan.xml", content: worksheetXml(KAI_SPRINT2_P0_XLSX_LIMITS.maxCells + 1, { blank: true }) },
    ],
  });

  assert.equal(await detect(bytes), undefined);
});

test("P0-05 XLSX missing, duplicate, external, absolute, and traversal relationship mappings fail safely", async () => {
  await assertSanitizedFailure(createWorkbook({
    sheetCount: 1,
    worksheetCellCounts: [0],
    rels: "<?xml version=\"1.0\"?><Relationships/>",
  }));

  await assertSanitizedFailure(createWorkbook({
    sheetCount: 1,
    worksheetCellCounts: [0],
    rels: `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="${WORKSHEET_REL_TYPE}" Target="worksheets/sheet1.xml"/><Relationship Id="rId1" Type="${WORKSHEET_REL_TYPE}" Target="worksheets/sheet1.xml"/></Relationships>`,
  }));

  await assertSanitizedFailure(createWorkbook({
    sheetCount: 1,
    worksheetCellCounts: [0],
    rels: `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="${WORKSHEET_REL_TYPE}" TargetMode="External" Target="https://example.invalid/sheet.xml"/></Relationships>`,
  }));

  await assertSanitizedFailure(createWorkbook({
    sheetCount: 1,
    worksheetCellCounts: [0],
    rels: `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="${WORKSHEET_REL_TYPE}" Target="/xl/worksheets/sheet1.xml"/></Relationships>`,
  }));

  await assertSanitizedFailure(createWorkbook({
    sheetCount: 1,
    worksheetCellCounts: [0],
    rels: `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="${WORKSHEET_REL_TYPE}" Target="../worksheets/sheet1.xml"/></Relationships>`,
  }));
});

test("P0-05 XLSX DTD/entity input, malformed XML, malformed ZIP, unsupported compression, and decompression failures fail safely", async () => {
  await assertSanitizedFailure(createWorkbook({
    sheetCount: 1,
    worksheetCellCounts: [0],
    workbookOptions: {},
    rels: relsXml(1),
    extraEntries: [],
  }).subarray(0, 80));

  await assertSanitizedFailure(createWorkbook({
    sheetCount: 1,
    worksheetCellCounts: [0],
    rels: "<?xml version=\"1.0\"?><!DOCTYPE Relationships [<!ENTITY x \"y\">]><Relationships/>",
  }));

  await assertSanitizedFailure(createWorkbook({
    sheetCount: 1,
    worksheetCellCounts: [0],
    rels: "<Relationships><Relationship Id=\"rId1\" Target=\"worksheets/sheet1.xml\"",
  }));

  const unsupported = createWorkbook({ sheetCount: 1, worksheetCellCounts: [0] });
  const entries = __testables.parseZipCentralDirectory(unsupported);
  const workbookEntry = entries.get("xl/workbook.xml");
  const unsupportedCopy = new Uint8Array(unsupported);
  writeUint16LE(unsupportedCopy, workbookEntry.localHeaderOffset + 8, 12);
  await assertSanitizedFailure(unsupportedCopy);

  const deflated = createWorkbook({ sheetCount: 1, worksheetCellCounts: [0], deflateEntries: true });
  assert.equal(await detect(deflated), undefined);
  const corruptDeflated = new Uint8Array(deflated);
  const deflatedEntries = __testables.parseZipCentralDirectory(corruptDeflated);
  const worksheetEntry = deflatedEntries.get("xl/worksheets/sheet1.xml");
  const worksheetBoundsStart = worksheetEntry.localHeaderOffset + 30 + textEncoder.encode(worksheetEntry.name).byteLength;
  corruptDeflated[worksheetBoundsStart] ^= 0xff;
  await assertSanitizedFailure(corruptDeflated);
});

test("P0-05 XLSX formula and instruction-like content remains inert and non-exposed", async () => {
  const bytes = createWorkbook({
    sheetCount: 1,
    worksheetCellCounts: [2],
    worksheetOptions: { formula: true },
  });

  assert.equal(await detect(bytes), undefined);

  await assert.rejects(
    () => detectXlsxSheetCellLimitPolicy({
      extension: ".txt",
      declaredMime: "text/plain",
      bytes,
    }),
    (error) => {
      assert.equal(error.message.includes("HYPERLINK"), false);
      assert.equal(error.message.includes("sheet1"), false);
      assert.equal(error.message.includes("rId1"), false);
      return error.message === "XLSX sheet/cell limit inspection failed.";
    },
  );
});

test("P0-05 XLSX detector result shape is exact, deterministic, and does not expose internals", async () => {
  const bytes = createWorkbook({
    sheetCount: 1,
    worksheetCellCounts: [KAI_SPRINT2_P0_XLSX_LIMITS.maxCells + 1],
    worksheetOptions: { formula: true, malformedAfterCells: true },
  });

  const first = await detect(bytes);
  const second = await detect(bytes);
  assertExactTwoKeyResult(first, CELL_LIMIT_RESULT);
  assert.deepEqual(second, first);
});
