import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";

import { KAI_SPRINT2_P0_ARCHIVE_LIMITS } from "../Backend/kai/config/kaiSprint2P0Contract.js";
import {
  detectOoxmlArchiveResourceLimitPolicy,
  __testables,
} from "../Backend/kai/validators/ooxmlArchiveResourceLimitDetector.js";

const textEncoder = new TextEncoder();
const XLSX_EXTENSION = ".xlsx";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const WORKSHEET_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";

const ENTRY_LIMIT_RESULT = Object.freeze({
  policy: "block",
  category: "archive_entry_limit_exceeded",
});
const EXPANDED_LIMIT_RESULT = Object.freeze({
  policy: "block",
  category: "archive_expanded_size_limit_exceeded",
});
const RATIO_LIMIT_RESULT = Object.freeze({
  policy: "block",
  category: "archive_compression_ratio_limit_exceeded",
});
const MACRO_EXTERNAL_RESULT = Object.freeze({
  policy: "block",
  category: "xlsx_macro_or_external_relationship",
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

function contentBytesFor(entry) {
  if (entry.compressedBytes) return entry.compressedBytes;
  const contentBytes = typeof entry.content === "string" ? textEncoder.encode(entry.content) : entry.content;
  if (entry.deflate) return deflateRawSync(contentBytes, entry.deflateOptions || {});
  return contentBytes;
}

function uncompressedSizeFor(entry) {
  if (Number.isInteger(entry.uncompressedSize)) return entry.uncompressedSize;
  const contentBytes = typeof entry.content === "string" ? textEncoder.encode(entry.content) : entry.content;
  return contentBytes.byteLength;
}

function createZip(entries) {
  const localRecords = [];
  const localBytes = [];
  let localHeaderOffset = 0;

  for (const entry of entries) {
    const nameBytes = textEncoder.encode(entry.name);
    const compressedBytes = contentBytesFor(entry);
    const compressionMethod = entry.compressionMethod ?? (entry.deflate || entry.compressedBytes ? 8 : 0);
    const uncompressedSize = uncompressedSizeFor(entry);
    const header = new Uint8Array(30 + nameBytes.byteLength);

    writeUint32LE(header, 0, 0x04034b50);
    writeUint16LE(header, 4, 20);
    writeUint16LE(header, 8, compressionMethod);
    writeUint32LE(header, 18, compressedBytes.byteLength);
    writeUint32LE(header, 22, uncompressedSize);
    writeUint16LE(header, 26, nameBytes.byteLength);
    header.set(nameBytes, 30);

    localRecords.push(Object.freeze({
      name: entry.name,
      nameBytes,
      compressionMethod,
      compressedSize: compressedBytes.byteLength,
      uncompressedSize,
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

function workbookXml() {
  return "<?xml version=\"1.0\"?><workbook xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"S1\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>";
}

function relsXml() {
  return `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="${WORKSHEET_REL_TYPE}" Target="worksheets/sheet1.xml"/></Relationships>`;
}

function worksheetXml() {
  return "<?xml version=\"1.0\"?><worksheet><sheetData><row><c/></row></sheetData></worksheet>";
}

function baseWorkbookEntries(extraEntries = []) {
  return [
    { name: "[Content_Types].xml", content: "<?xml version=\"1.0\"?><Types><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/></Types>" },
    { name: "_rels/.rels", content: "<?xml version=\"1.0\"?><Relationships/>" },
    { name: "xl/workbook.xml", content: workbookXml() },
    { name: "xl/_rels/workbook.xml.rels", content: relsXml() },
    { name: "xl/worksheets/sheet1.xml", content: worksheetXml() },
    ...extraEntries,
  ];
}

function baseWorkbookExpandedBytes() {
  return baseWorkbookEntries().reduce((sum, entry) => sum + uncompressedSizeFor(entry), 0);
}

function createWorkbook(extraEntries = []) {
  return createZip(baseWorkbookEntries(extraEntries));
}

async function detect(bytes) {
  return detectOoxmlArchiveResourceLimitPolicy({
    extension: XLSX_EXTENSION,
    declaredMime: XLSX_MIME,
    bytes,
  });
}

function assertExactResult(result, expected) {
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(Object.keys(result), ["policy", "category"]);
  assert.deepEqual(result, expected);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("xl/"), false);
  assert.equal(serialized.includes("workbook"), false);
  assert.equal(serialized.includes("Relationship"), false);
  assert.equal(serialized.includes("stack"), false);
}

async function assertSanitizedFailure(bytes) {
  await assert.rejects(
    () => detect(bytes),
    (error) => {
      assert.equal(error instanceof Error, true);
      assert.equal(error.message, "OOXML archive resource limit inspection failed.");
      assert.equal(error.message.includes("xl/"), false);
      assert.equal(error.message.includes("workbook"), false);
      assert.equal(error.message.includes("Relationship"), false);
      assert.equal(error.message.includes("stack"), false);
      return true;
    },
  );
}

function centralDirectoryRecordOffset(bytes, entryName) {
  const eocdOffset = bytes.byteLength - 22;
  let offset = readUint32LE(bytes, eocdOffset + 16);
  const end = offset + readUint32LE(bytes, eocdOffset + 12);
  const encoded = textEncoder.encode(entryName);

  while (offset < end) {
    const nameLength = readUint16LE(bytes, offset + 28);
    const extraLength = readUint16LE(bytes, offset + 30);
    const commentLength = readUint16LE(bytes, offset + 32);
    if (nameLength === encoded.byteLength) {
      let matches = true;
      for (let index = 0; index < encoded.byteLength; index += 1) {
        if (bytes[offset + 46 + index] !== encoded[index]) {
          matches = false;
          break;
        }
      }
      if (matches) return offset;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error("test entry not found");
}

function rawDeflateStoredBlocks(uncompressedLength, { corruptHeaderAfterExpandedByte } = {}) {
  const blocks = [];
  let remaining = uncompressedLength;
  let expandedOffset = 0;

  while (remaining > 0) {
    const blockLength = Math.min(65535, remaining);
    const isFinal = blockLength === remaining;
    const header = new Uint8Array(5);
    header[0] = isFinal ? 0x01 : 0x00;
    writeUint16LE(header, 1, blockLength);
    writeUint16LE(header, 3, (~blockLength) & 0xffff);
    if (
      corruptHeaderAfterExpandedByte !== undefined &&
      expandedOffset > corruptHeaderAfterExpandedByte
    ) {
      header[0] = 0x06;
    }
    blocks.push(header, new Uint8Array(blockLength));
    expandedOffset += blockLength;
    remaining -= blockLength;
  }

  return concatBytes(blocks);
}

test("P0-05 OOXML archive detector passes exactly 2000 entries and blocks entry 2001", async () => {
  const baseCount = baseWorkbookEntries().length;
  const exactExtras = Array.from(
    { length: KAI_SPRINT2_P0_ARCHIVE_LIMITS.maxEntries - baseCount },
    (_, index) => ({ name: `custom/exact-${index}/`, content: new Uint8Array(0) }),
  );
  assert.equal(await detect(createWorkbook(exactExtras)), undefined);

  const overExtras = Array.from(
    { length: KAI_SPRINT2_P0_ARCHIVE_LIMITS.maxEntries - baseCount + 1 },
    (_, index) => ({ name: `custom/over-${index}/`, content: new Uint8Array(0) }),
  );
  assertExactResult(await detect(createWorkbook(overExtras)), ENTRY_LIMIT_RESULT);
});

test("P0-05 OOXML archive detector counts directory entries", async () => {
  const baseCount = baseWorkbookEntries().length;
  const directoryExtras = Array.from(
    { length: KAI_SPRINT2_P0_ARCHIVE_LIMITS.maxEntries - baseCount + 1 },
    (_, index) => ({ name: `directory-count-${index}/`, content: new Uint8Array(0) }),
  );

  assertExactResult(await detect(createWorkbook(directoryExtras)), ENTRY_LIMIT_RESULT);
});

test("P0-05 OOXML archive detector passes exact expanded bytes for stored 1:1 content", { timeout: 30000 }, async () => {
  const payloadBytes = KAI_SPRINT2_P0_ARCHIVE_LIMITS.maxExpandedBytes - baseWorkbookExpandedBytes();
  assert.equal(await detect(createWorkbook([
    {
      name: "xl/media/exact-expanded.bin",
      content: new Uint8Array(payloadBytes),
    },
  ])), undefined);
});

test("P0-05 OOXML archive detector stops at expanded byte plus one without inflating the remainder", { timeout: 30000 }, async () => {
  const compressedBytes = rawDeflateStoredBlocks(
    KAI_SPRINT2_P0_ARCHIVE_LIMITS.maxExpandedBytes + 1 + 65535,
    { corruptHeaderAfterExpandedByte: KAI_SPRINT2_P0_ARCHIVE_LIMITS.maxExpandedBytes + 1 },
  );
  const result = await detect(createWorkbook([
    {
      name: "xl/media/expanded-over.bin",
      compressedBytes,
      uncompressedSize: KAI_SPRINT2_P0_ARCHIVE_LIMITS.maxExpandedBytes + 1 + 65535,
      compressionMethod: 8,
    },
  ]));

  assertExactResult(result, EXPANDED_LIMIT_RESULT);
});

test("P0-05 OOXML archive detector passes exact 100:1 per-entry ratio and stored 1:1 entries", async () => {
  const exactRatioBytes = new Uint8Array(1200);
  assert.equal(deflateRawSync(exactRatioBytes).byteLength, 12);

  assert.equal(await detect(createWorkbook([
    { name: "xl/media/stored-one-to-one.bin", content: new Uint8Array(321) },
    { name: "xl/media/exact-ratio.bin", content: exactRatioBytes, deflate: true },
  ])), undefined);
});

test("P0-05 OOXML archive detector blocks over-limit per-entry and aggregate compression ratios", async () => {
  const overRatioBytes = new Uint8Array(1201);
  assert.equal(deflateRawSync(overRatioBytes).byteLength, 12);

  assertExactResult(await detect(createWorkbook([
    { name: "xl/media/ratio-over.bin", content: overRatioBytes, deflate: true },
  ])), RATIO_LIMIT_RESULT);

  assertExactResult(await detect(createWorkbook([
    { name: "xl/media/ratio-over-a.bin", content: new Uint8Array(1201), deflate: true },
    { name: "xl/media/ratio-over-b.bin", content: new Uint8Array(1201), deflate: true },
  ])), RATIO_LIMIT_RESULT);
});

test("P0-05 OOXML archive detector blocks non-empty zero-compressed entries as ratio exceeded", async () => {
  const bytes = createWorkbook([{ name: "xl/media/zero-compressed.bin", content: new Uint8Array(0) }]);
  const copy = new Uint8Array(bytes);
  const offset = centralDirectoryRecordOffset(copy, "xl/media/zero-compressed.bin");
  const localHeaderOffset = readUint32LE(copy, offset + 42);
  writeUint32LE(copy, offset + 24, 1);
  writeUint32LE(copy, localHeaderOffset + 22, 1);

  assertExactResult(await detect(copy), RATIO_LIMIT_RESULT);
});

test("P0-05 OOXML archive detector sanitizes forged metadata and inconsistent output", async () => {
  const bytes = createWorkbook([
    { name: "xl/media/forged-deflate.bin", content: new Uint8Array([1, 2, 3]), deflate: true },
  ]);
  const copy = new Uint8Array(bytes);
  const offset = centralDirectoryRecordOffset(copy, "xl/media/forged-deflate.bin");
  const localHeaderOffset = readUint32LE(copy, offset + 42);
  writeUint32LE(copy, offset + 24, 4);
  writeUint32LE(copy, localHeaderOffset + 22, 4);
  await assertSanitizedFailure(copy);

  const unsupported = createWorkbook([
    { name: "xl/media/unsupported.bin", content: new Uint8Array([1]) },
  ]);
  const unsupportedCopy = new Uint8Array(unsupported);
  const unsupportedOffset = centralDirectoryRecordOffset(unsupportedCopy, "xl/media/unsupported.bin");
  const unsupportedLocalOffset = readUint32LE(unsupportedCopy, unsupportedOffset + 42);
  writeUint16LE(unsupportedCopy, unsupportedOffset + 10, 12);
  writeUint16LE(unsupportedCopy, unsupportedLocalOffset + 8, 12);
  await assertSanitizedFailure(unsupportedCopy);
});

test("P0-05 OOXML archive detector returns entry-count first for many tiny entries", async () => {
  const baseCount = baseWorkbookEntries().length;
  const extras = Array.from(
    { length: KAI_SPRINT2_P0_ARCHIVE_LIMITS.maxEntries - baseCount + 1 },
    (_, index) => ({
      name: `tiny-first-${index}/`,
      content: index === 0 ? new Uint8Array(1201) : new Uint8Array(0),
      deflate: index === 0,
    }),
  );

  assertExactResult(await detect(createWorkbook(extras)), ENTRY_LIMIT_RESULT);
});

test("P0-05 OOXML archive detector runs only after macro/external no-block", async () => {
  const result = await detect(createWorkbook([
    { name: "xl/vbaProject.bin", content: new Uint8Array([0]) },
    ...Array.from({ length: KAI_SPRINT2_P0_ARCHIVE_LIMITS.maxEntries }, (_, index) => ({
      name: `archive-not-reached-${index}/`,
      content: new Uint8Array(0),
    })),
  ]));

  assertExactResult(result, MACRO_EXTERNAL_RESULT);
});

test("P0-05 OOXML archive detector returns expanded-size when size and ratio breach together", { timeout: 30000 }, async () => {
  const compressedBytes = deflateRawSync(new Uint8Array(KAI_SPRINT2_P0_ARCHIVE_LIMITS.maxExpandedBytes + 1));
  const result = await detect(createWorkbook([
    {
      name: "xl/media/size-and-ratio.bin",
      compressedBytes,
      uncompressedSize: KAI_SPRINT2_P0_ARCHIVE_LIMITS.maxExpandedBytes + 1,
      compressionMethod: 8,
    },
  ]));

  assertExactResult(result, EXPANDED_LIMIT_RESULT);
});

test("P0-05 OOXML archive detector is exact, deterministic, sanitized, and non-exposing", async () => {
  const bytes = createWorkbook([
    { name: "xl/media/private-ratio-name.bin", content: new Uint8Array(1201), deflate: true },
  ]);

  const first = await detect(bytes);
  const second = await detect(bytes);
  assertExactResult(first, RATIO_LIMIT_RESULT);
  assert.deepEqual(second, first);

  const malformed = createWorkbook([
    { name: "xl/media/malformed-private-name.bin", content: new Uint8Array([1]), deflate: true },
  ]);
  const copy = new Uint8Array(malformed);
  const offset = centralDirectoryRecordOffset(copy, "xl/media/malformed-private-name.bin");
  const localHeaderOffset = readUint32LE(copy, offset + 42);
  const nameLength = readUint16LE(copy, localHeaderOffset + 26);
  copy[localHeaderOffset + 30 + nameLength] ^= 0xff;
  await assertSanitizedFailure(copy);

  assert.equal(typeof __testables.parseZipCentralDirectoryEntries, "function");
});
