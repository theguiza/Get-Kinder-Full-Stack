import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";

import { detectXlsxMacroExternalRelationshipPolicy } from "../Backend/kai/validators/xlsxMacroExternalRelationshipDetector.js";

const textEncoder = new TextEncoder();
const XLSX_EXTENSION = ".xlsx";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const WORKSHEET_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";
const HYPERLINK_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
const IMAGE_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const OLE_OBJECT_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject";
const XLSX_ACTIVE_CONTENT_RESULT = Object.freeze({
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

function contentTypesXml(extra = "") {
  return `<?xml version="1.0"?><Types><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${extra}</Types>`;
}

function workbookXml(sheetCount = 1) {
  const sheets = [];
  for (let index = 1; index <= sheetCount; index += 1) {
    sheets.push(`<sheet name="S${index}" sheetId="${index}" r:id="rId${index}"/>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.join("")}</sheets></workbook>`;
}

function relationshipXml({
  id = "rId1",
  type = WORKSHEET_REL_TYPE,
  target = "worksheets/sheet1.xml",
  targetMode,
} = {}) {
  const mode = targetMode === undefined ? "" : ` TargetMode="${targetMode}"`;
  return `<Relationship Id="${id}" Type="${type}"${mode} Target="${target}"/>`;
}

function relsXml(relationships = [relationshipXml()]) {
  return `<?xml version="1.0"?><Relationships>${relationships.join("")}</Relationships>`;
}

function worksheetXml() {
  return "<?xml version=\"1.0\"?><worksheet><sheetData><row><c/></row></sheetData></worksheet>";
}

function createWorkbook({
  contentTypes = contentTypesXml(),
  workbookRels = relsXml(),
  sheetRels = null,
  extraEntries = [],
} = {}) {
  const entries = [
    { name: "[Content_Types].xml", content: contentTypes },
    { name: "_rels/.rels", content: "<?xml version=\"1.0\"?><Relationships/>" },
    { name: "xl/workbook.xml", content: workbookXml() },
    { name: "xl/_rels/workbook.xml.rels", content: workbookRels, deflate: true },
    { name: "xl/worksheets/sheet1.xml", content: worksheetXml() },
  ];
  if (sheetRels !== null) {
    entries.push({ name: "xl/worksheets/_rels/sheet1.xml.rels", content: sheetRels });
  }
  return createZip([...entries, ...extraEntries]);
}

async function detect(bytes) {
  return detectXlsxMacroExternalRelationshipPolicy({
    extension: XLSX_EXTENSION,
    declaredMime: XLSX_MIME,
    bytes,
  });
}

function assertExactActiveContentResult(result) {
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(Object.keys(result), ["policy", "category"]);
  assert.deepEqual(result, XLSX_ACTIVE_CONTENT_RESULT);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("vbaProject"), false);
  assert.equal(serialized.includes("Target"), false);
  assert.equal(serialized.includes("http"), false);
  assert.equal(serialized.includes("Relationship"), false);
}

async function assertSanitizedFailure(bytes) {
  await assert.rejects(
    () => detect(bytes),
    (error) => {
      assert.equal(error instanceof Error, true);
      assert.equal(error.message, "XLSX macro/external relationship inspection failed.");
      assert.equal(error.message.includes("Target"), false);
      assert.equal(error.message.includes("Relationship"), false);
      assert.equal(error.message.includes("vbaProject"), false);
      assert.equal(error.message.includes("stack"), false);
      return true;
    },
  );
}

test("P0-05 XLSX macro/external detector returns undefined for clean XLSX", async () => {
  assert.equal(await detect(createWorkbook()), undefined);
});

test("P0-05 XLSX macro/external detector blocks VBA project and signature parts", async () => {
  for (const name of ["xl/vbaProject.bin", "xl/vbaProjectSignature.bin"]) {
    assertExactActiveContentResult(await detect(createWorkbook({
      extraEntries: [{ name, content: new Uint8Array([0x00, 0x01, 0x02]) }],
    })));
  }
});

test("P0-05 XLSX macro/external detector blocks macro and macrosheet Default/Override content types", async () => {
  const cases = [
    "<Default Extension=\"bin\" ContentType=\"application/vnd.ms-office.vbaProject\"/>",
    "<Default Extension=\"xml\" ContentType=\"application/vnd.ms-excel.macrosheet+xml\"/>",
    "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.ms-excel.sheet.macroEnabled.main+xml\"/>",
    "<Override PartName=\"/xl/macrosheets/sheet1.xml\" ContentType=\"application/vnd.ms-excel.macrosheet+xml\"/>",
    "<Override PartName=\"/xl/macrosheets/sheet2.xml\" ContentType=\"application/vnd.ms-excel.intlmacrosheet+xml\"/>",
    "<Override PartName=\"/xl/vbaProjectSignature.bin\" ContentType=\"application/vnd.ms-office.vbaProjectSignature\"/>",
  ];

  for (const extra of cases) {
    assertExactActiveContentResult(await detect(createWorkbook({
      contentTypes: contentTypesXml(extra),
    })));
  }
});

test("P0-05 XLSX macro/external detector blocks macro relationship types", async () => {
  const cases = [
    "http://schemas.microsoft.com/office/2006/relationships/vbaProject",
    "http://schemas.microsoft.com/office/2006/relationships/vbaProjectSignature",
    "http://schemas.microsoft.com/office/2006/relationships/xlMacrosheet",
    "http://schemas.microsoft.com/office/2006/relationships/xlIntlMacrosheet",
  ];

  for (const type of cases) {
    assertExactActiveContentResult(await detect(createWorkbook({
      sheetRels: relsXml([relationshipXml({
        id: "macro",
        type,
        target: "../activeContent.bin",
      })]),
    })));
  }
});

test("P0-05 XLSX macro/external detector blocks all external relationship types", async () => {
  const cases = [
    { type: HYPERLINK_REL_TYPE, target: "https://example.invalid/link" },
    { type: IMAGE_REL_TYPE, target: "https://example.invalid/image.png" },
    { type: OLE_OBJECT_REL_TYPE, target: "file:///example/ole.bin" },
    { type: "https://example.invalid/unknown-relationship-type", target: "https://example.invalid/unknown" },
  ];

  for (const item of cases) {
    assertExactActiveContentResult(await detect(createWorkbook({
      sheetRels: relsXml([relationshipXml({
        id: "external",
        type: item.type,
        target: item.target,
        targetMode: "External",
      })]),
    })));
  }
});

test("P0-05 XLSX macro/external detector allows absent and Internal TargetMode here", async () => {
  assert.equal(await detect(createWorkbook({
    sheetRels: relsXml([relationshipXml({
      id: "absent",
      type: IMAGE_REL_TYPE,
      target: "../media/image1.png",
    })]),
    extraEntries: [{ name: "xl/media/image1.png", content: "" }],
  })), undefined);

  assert.equal(await detect(createWorkbook({
    sheetRels: relsXml([relationshipXml({
      id: "internal",
      type: IMAGE_REL_TYPE,
      target: "../media/image2.png",
      targetMode: "Internal",
    })]),
    extraEntries: [{ name: "xl/media/image2.png", content: "" }],
  })), undefined);
});

test("P0-05 XLSX macro/external detector sanitizes malformed TargetMode", async () => {
  await assertSanitizedFailure(createWorkbook({
    sheetRels: relsXml([relationshipXml({
      id: "malformed",
      type: IMAGE_REL_TYPE,
      target: "../media/image3.png",
      targetMode: "external",
    })]),
    extraEntries: [{ name: "xl/media/image3.png", content: "" }],
  }));
});

test("P0-05 XLSX macro/external detector preserves earlier traversal-block precedence", async () => {
  const result = await detect(createWorkbook({
    sheetRels: relsXml([relationshipXml({
      id: "traversal",
      type: IMAGE_REL_TYPE,
      target: "../../../outside.bin",
    })]),
    extraEntries: [{ name: "xl/vbaProject.bin", content: new Uint8Array([0x00]) }],
  }));

  assert.deepEqual(result, {
    policy: "block",
    category: "ooxml_path_traversal",
  });
});

test("P0-05 XLSX macro/external detector result is exact, deterministic, sanitized, and non-exposing", async () => {
  const bytes = createWorkbook({
    sheetRels: relsXml([relationshipXml({
      id: "external",
      type: HYPERLINK_REL_TYPE,
      target: "https://example.invalid/private-path",
      targetMode: "External",
    })]),
  });

  const first = await detect(bytes);
  const second = await detect(bytes);
  assertExactActiveContentResult(first);
  assert.deepEqual(second, first);

  await assertSanitizedFailure(createWorkbook({
    contentTypes: "<?xml version=\"1.0\"?><Types><Default Extension=\"bin\"/></Types>",
  }));
});
