import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";

import { detectOoxmlPathTraversalPolicy } from "../Backend/kai/validators/ooxmlPathTraversalDetector.js";
import { detectXlsxSheetCellLimitPolicy } from "../Backend/kai/validators/xlsxSheetCellLimitDetector.js";

const textEncoder = new TextEncoder();
const XLSX_EXTENSION = ".xlsx";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const WORKSHEET_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";
const OOXML_PATH_TRAVERSAL_RESULT = Object.freeze({
  policy: "block",
  category: "ooxml_path_traversal",
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

function readUint16LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32LE(bytes, offset) {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
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
    writeUint32LE(header, 18, compressedBytes.byteLength);
    writeUint32LE(header, 22, contentBytes.byteLength);
    writeUint16LE(header, 26, nameBytes.byteLength);
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
    writeUint16LE(record, 10, entry.compressionMethod);
    writeUint32LE(record, 20, entry.compressedSize);
    writeUint32LE(record, 24, entry.uncompressedSize);
    writeUint16LE(record, 28, entry.nameBytes.byteLength);
    writeUint32LE(record, 42, entry.localHeaderOffset);
    record.set(entry.nameBytes, 46);
    return record;
  });
  const centralDirectoryLength = centralDirectoryBytes.reduce((sum, record) => sum + record.byteLength, 0);
  const eocd = new Uint8Array(22);

  writeUint32LE(eocd, 0, 0x06054b50);
  writeUint16LE(eocd, 8, entries.length);
  writeUint16LE(eocd, 10, entries.length);
  writeUint32LE(eocd, 12, centralDirectoryLength);
  writeUint32LE(eocd, 16, centralDirectoryOffset);

  return concatBytes([...localBytes, ...centralDirectoryBytes, eocd]);
}

function workbookXml(sheetCount = 1) {
  const sheets = [];
  for (let index = 1; index <= sheetCount; index += 1) {
    sheets.push(`<sheet name="S${index}" sheetId="${index}" r:id="rId${index}"/>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.join("")}</sheets></workbook>`;
}

function relsXml(target = "worksheets/sheet1.xml", targetMode = undefined, count = 1) {
  const relationships = [];
  const mode = targetMode ? ` TargetMode="${targetMode}"` : "";
  for (let index = 1; index <= count; index += 1) {
    relationships.push(`<Relationship Id="rId${index}" Type="${WORKSHEET_REL_TYPE}"${mode} Target="${target}"/>`);
  }
  return `<?xml version="1.0"?><Relationships>${relationships.join("")}</Relationships>`;
}

function worksheetXml() {
  return "<?xml version=\"1.0\"?><worksheet><sheetData><row><c/></row></sheetData></worksheet>";
}

function createWorkbook({ sheetCount = 1, workbookRels = relsXml(), extraEntries = [] } = {}) {
  return createZip([
    { name: "[Content_Types].xml", content: "<?xml version=\"1.0\"?><Types/>" },
    { name: "_rels/.rels", content: "<?xml version=\"1.0\"?><Relationships/>" },
    { name: "xl/workbook.xml", content: workbookXml(sheetCount) },
    { name: "xl/_rels/workbook.xml.rels", content: workbookRels },
    { name: "xl/worksheets/sheet1.xml", content: worksheetXml() },
    ...extraEntries,
  ]);
}

async function detect(bytes) {
  return detectOoxmlPathTraversalPolicy({
    extension: XLSX_EXTENSION,
    declaredMime: XLSX_MIME,
    bytes,
  });
}

async function assertNoSheetCellBlockBeforeTraversal(bytes) {
  assert.equal(await detectXlsxSheetCellLimitPolicy({
    extension: XLSX_EXTENSION,
    declaredMime: XLSX_MIME,
    bytes,
  }), undefined);
}

function assertExactTraversalResult(result) {
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(Object.keys(result), ["policy", "category"]);
  assert.deepEqual(result, OOXML_PATH_TRAVERSAL_RESULT);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("sheet1"), false);
  assert.equal(serialized.includes(".."), false);
  assert.equal(serialized.includes("%2e"), false);
  assert.equal(serialized.includes("\\"), false);
}

async function assertSanitizedFailure(bytes) {
  await assert.rejects(
    () => detect(bytes),
    (error) => {
      assert.equal(error instanceof Error, true);
      assert.equal(error.message, "OOXML path traversal inspection failed.");
      assert.equal(error.message.includes("sheet1"), false);
      assert.equal(error.message.includes("Target"), false);
      assert.equal(error.message.includes("Relationship"), false);
      assert.equal(error.message.includes("stack"), false);
      return true;
    },
  );
}

function findCentralDirectoryRecordOffset(bytes, entryName) {
  const encoded = textEncoder.encode(entryName);
  for (let offset = 0; offset <= bytes.byteLength - 46; offset += 1) {
    if (readUint32LE(bytes, offset) !== 0x02014b50) continue;
    const length = readUint16LE(bytes, offset + 28);
    if (length !== encoded.byteLength) continue;
    let matches = true;
    for (let index = 0; index < encoded.byteLength; index += 1) {
      if (bytes[offset + 46 + index] !== encoded[index]) {
        matches = false;
        break;
      }
    }
    if (matches) return offset;
  }
  throw new Error("test fixture entry not found");
}

test("P0-05 OOXML path detector allows safe relative and package-absolute targets after XLSX sheet/cell no-block", async () => {
  const relative = createWorkbook();
  await assertNoSheetCellBlockBeforeTraversal(relative);
  assert.equal(await detect(relative), undefined);

  const absolute = createWorkbook({
    extraEntries: [{
      name: "docProps/_rels/app.xml.rels",
      content: "<?xml version=\"1.0\"?><Relationships><Relationship Id=\"safe\" TargetMode=\"Internal\" Target=\"/xl/worksheets/sheet1.xml\"/></Relationships>",
      deflate: true,
    }],
  });
  await assertNoSheetCellBlockBeforeTraversal(absolute);
  assert.equal(await detect(absolute), undefined);
});

test("P0-05 OOXML path detector allows literal relative parent segments that remain inside package", async () => {
  const bytes = createWorkbook({
    extraEntries: [{
      name: "xl/worksheets/_rels/sheet1.xml.rels",
      content: "<?xml version=\"1.0\"?><Relationships><Relationship Id=\"safe\" Target=\"../sharedStrings.xml\"/></Relationships>",
    }],
  });

  await assertNoSheetCellBlockBeforeTraversal(bytes);
  assert.equal(await detect(bytes), undefined);
});

test("P0-05 OOXML path detector blocks root escape and percent-encoded traversal", async () => {
  const rootEscape = createWorkbook({
    extraEntries: [{
      name: "custom/_rels/item.xml.rels",
      content: "<?xml version=\"1.0\"?><Relationships><Relationship Id=\"bad\" Target=\"../../outside.xml\"/></Relationships>",
    }],
  });
  await assertNoSheetCellBlockBeforeTraversal(rootEscape);
  assertExactTraversalResult(await detect(rootEscape));

  const encodedTraversal = createWorkbook({
    extraEntries: [{
      name: "xl/_rels/styles.xml.rels",
      content: "<?xml version=\"1.0\"?><Relationships><Relationship Id=\"bad\" Target=\"%2e%2e/workbook.xml\"/></Relationships>",
    }],
  });
  await assertNoSheetCellBlockBeforeTraversal(encodedTraversal);
  assertExactTraversalResult(await detect(encodedTraversal));

  assertExactTraversalResult(await detect(createWorkbook({
    workbookRels: relsXml("../../outside.xml"),
  })));
});

test("P0-05 OOXML path detector preserves sheet-limit precedence over relationship traversal", async () => {
  const result = await detect(createWorkbook({
    sheetCount: 21,
    workbookRels: relsXml("../../outside.xml", undefined, 21),
  }));

  assert.deepEqual(result, {
    policy: "block",
    category: "xlsx_sheet_limit_exceeded",
  });
});

test("P0-05 OOXML path detector blocks ZIP traversal, backslash, NUL, drive, UNC, and absolute entry names", async () => {
  const cases = [
    "../evil.xml",
    "xl\\evil.xml",
    "xl/evil\0.xml",
    "C:/evil.xml",
    "//server/share/evil.xml",
    "/xl/evil.xml",
  ];

  for (const name of cases) {
    assertExactTraversalResult(await detect(createWorkbook({
      extraEntries: [{ name, content: "" }],
    })));
  }
});

test("P0-05 OOXML path detector blocks exact and normalized duplicate ZIP entry names", async () => {
  assertExactTraversalResult(await detect(createWorkbook({
    extraEntries: [
      { name: "xl/media/image.png", content: "" },
      { name: "xl/media/image.png", content: "" },
    ],
  })));

  assertExactTraversalResult(await detect(createWorkbook({
    extraEntries: [
      { name: "xl/media/image.png", content: "" },
      { name: "xl/./media//image.png", content: "" },
    ],
  })));

  const distinctDirectoryAndFile = createWorkbook({
    extraEntries: [
      { name: "xl/media", content: "" },
      { name: "xl/./media/", content: "" },
    ],
  });
  await assertNoSheetCellBlockBeforeTraversal(distinctDirectoryAndFile);
  assert.equal(await detect(distinctDirectoryAndFile), undefined);
});

test("P0-05 OOXML path detector ignores TargetMode External traversal-like targets here", async () => {
  const bytes = createWorkbook({
    extraEntries: [{
      name: "xl/_rels/styles.xml.rels",
      content: "<?xml version=\"1.0\"?><Relationships><Relationship Id=\"external\" TargetMode=\"External\" Target=\"../../outside.xml\"/></Relationships>",
    }],
  });

  await assertNoSheetCellBlockBeforeTraversal(bytes);
  assert.equal(await detect(bytes), undefined);
});

test("P0-05 OOXML path detector result is exact, deterministic, sanitized, and non-exposing", async () => {
  const bytes = createWorkbook({
    extraEntries: [{
      name: "xl/_rels/styles.xml.rels",
      content: "<?xml version=\"1.0\"?><Relationships><Relationship Id=\"bad\" Target=\"%2e%2e/workbook.xml\"/></Relationships>",
    }],
  });

  const first = await detect(bytes);
  const second = await detect(bytes);
  assertExactTraversalResult(first);
  assert.deepEqual(second, first);

  await assertSanitizedFailure(createWorkbook({
    extraEntries: [{
      name: "xl/_rels/styles.xml.rels",
      content: "<?xml version=\"1.0\"?><Relationships><Relationship Id=\"missing\" TargetMode=\"Internal\"/></Relationships>",
    }],
  }));

  await assertSanitizedFailure(createWorkbook({
    extraEntries: [{
      name: "xl/_rels/styles.xml.rels",
      content: "<?xml version=\"1.0\"?><!DOCTYPE Relationships [<!ENTITY x \"y\">]><Relationships/>",
    }],
  }));

  const corrupted = createWorkbook({
    extraEntries: [{
      name: "xl/_rels/styles.xml.rels",
      content: "<?xml version=\"1.0\"?><Relationships><Relationship Id=\"safe\" Target=\"theme/theme1.xml\"/></Relationships>",
      deflate: true,
    }],
  });
  const copy = new Uint8Array(corrupted);
  const offset = findCentralDirectoryRecordOffset(copy, "xl/_rels/styles.xml.rels");
  writeUint16LE(copy, offset + 10, 12);
  await assertSanitizedFailure(copy);
});
