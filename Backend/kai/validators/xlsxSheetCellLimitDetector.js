import { once } from "node:events";
import { createInflateRaw } from "node:zlib";

import { KAI_SPRINT2_P0_XLSX_LIMITS } from "../config/kaiSprint2P0Contract.js";
import { detectP0FileTypeAgreement } from "./p0FileTypeAgreementDetector.js";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_EOCD_MINIMUM_LENGTH = 22;
const ZIP_MAX_COMMENT_LENGTH = 0xffff;
const XML_CHUNK_SIZE = 16 * 1024;
const MAX_XML_TAG_LENGTH = 64 * 1024;
const WORKBOOK_ENTRY_NAME = "xl/workbook.xml";
const WORKBOOK_RELS_ENTRY_NAME = "xl/_rels/workbook.xml.rels";
const WORKBOOK_BASE_DIRECTORY = "xl";
const SHEET_RELATIONSHIP_TYPE_SUFFIX = "/worksheet";

const XLSX_SHEET_LIMIT_EXCEEDED_RESULT = Object.freeze({
  policy: "block",
  category: "xlsx_sheet_limit_exceeded",
});

const XLSX_CELL_LIMIT_EXCEEDED_RESULT = Object.freeze({
  policy: "block",
  category: "xlsx_cell_limit_exceeded",
});

class XlsxLimitExceeded extends Error {
  constructor(kind) {
    super("XLSX limit exceeded.");
    this.kind = kind;
  }
}

function sanitizedXlsxFailure() {
  return new Error("XLSX sheet/cell limit inspection failed.");
}

function failXlsxInspection() {
  throw sanitizedXlsxFailure();
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

function findZipEocdOffset(bytes) {
  if (bytes.byteLength < ZIP_EOCD_MINIMUM_LENGTH) return -1;

  const minimumOffset = Math.max(0, bytes.byteLength - ZIP_EOCD_MINIMUM_LENGTH - ZIP_MAX_COMMENT_LENGTH);
  for (let offset = bytes.byteLength - ZIP_EOCD_MINIMUM_LENGTH; offset >= minimumOffset; offset -= 1) {
    if (readUint32LE(bytes, offset) === ZIP_EOCD_SIGNATURE) {
      const commentLength = readUint16LE(bytes, offset + 20);
      if (offset + ZIP_EOCD_MINIMUM_LENGTH + commentLength === bytes.byteLength) return offset;
    }
  }

  return -1;
}

function decodeZipEntryName(bytes, offset, length) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(offset, offset + length));
  } catch {
    failXlsxInspection();
  }
}

function parseZipCentralDirectory(bytes) {
  const eocdOffset = findZipEocdOffset(bytes);
  if (eocdOffset === -1) failXlsxInspection();

  const diskNumber = readUint16LE(bytes, eocdOffset + 4);
  const centralDirectoryDisk = readUint16LE(bytes, eocdOffset + 6);
  const diskEntryCount = readUint16LE(bytes, eocdOffset + 8);
  const totalEntryCount = readUint16LE(bytes, eocdOffset + 10);
  const centralDirectoryLength = readUint32LE(bytes, eocdOffset + 12);
  const centralDirectoryOffset = readUint32LE(bytes, eocdOffset + 16);

  if (diskNumber !== 0 || centralDirectoryDisk !== 0) failXlsxInspection();
  if (diskEntryCount !== totalEntryCount) failXlsxInspection();
  if (centralDirectoryOffset > bytes.byteLength) failXlsxInspection();
  if (centralDirectoryLength > bytes.byteLength - centralDirectoryOffset) failXlsxInspection();
  if (centralDirectoryOffset + centralDirectoryLength !== eocdOffset) failXlsxInspection();

  const entries = new Map();
  let recordOffset = centralDirectoryOffset;
  let parsedRecordCount = 0;

  while (recordOffset < eocdOffset) {
    if (eocdOffset - recordOffset < 46) failXlsxInspection();
    if (readUint32LE(bytes, recordOffset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) failXlsxInspection();

    const generalPurposeFlag = readUint16LE(bytes, recordOffset + 8);
    const compressionMethod = readUint16LE(bytes, recordOffset + 10);
    const compressedSize = readUint32LE(bytes, recordOffset + 20);
    const uncompressedSize = readUint32LE(bytes, recordOffset + 24);
    const fileNameLength = readUint16LE(bytes, recordOffset + 28);
    const extraFieldLength = readUint16LE(bytes, recordOffset + 30);
    const fileCommentLength = readUint16LE(bytes, recordOffset + 32);
    const localHeaderOffset = readUint32LE(bytes, recordOffset + 42);
    const fileNameOffset = recordOffset + 46;
    const recordLength = 46 + fileNameLength + extraFieldLength + fileCommentLength;

    if (recordLength > eocdOffset - recordOffset) failXlsxInspection();
    if (localHeaderOffset > bytes.byteLength - 4) failXlsxInspection();
    if (readUint32LE(bytes, localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) failXlsxInspection();
    if (generalPurposeFlag & 0x1) failXlsxInspection();
    if (![0, 8].includes(compressionMethod)) failXlsxInspection();

    const name = decodeZipEntryName(bytes, fileNameOffset, fileNameLength);
    if (entries.has(name)) failXlsxInspection();
    entries.set(name, Object.freeze({
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    }));

    recordOffset += recordLength;
    parsedRecordCount += 1;
  }

  if (recordOffset !== centralDirectoryOffset + centralDirectoryLength) failXlsxInspection();
  if (parsedRecordCount !== totalEntryCount) failXlsxInspection();

  return entries;
}

function localNameFor(qualifiedName) {
  const colonIndex = qualifiedName.indexOf(":");
  return colonIndex === -1 ? qualifiedName : qualifiedName.slice(colonIndex + 1);
}

function skipXmlWhitespace(source, offset) {
  let index = offset;
  while (index < source.length && /[\t\n\f\r ]/.test(source[index])) index += 1;
  return index;
}

function parseXmlStartTag(tag) {
  const rawBody = tag.slice(1, -1).trim();
  const selfClosing = rawBody.endsWith("/");
  const body = selfClosing ? rawBody.slice(0, -1).trimEnd() : rawBody;
  let index = 0;

  while (index < body.length && !/[\t\n\f\r /]/.test(body[index])) index += 1;
  if (index === 0) failXlsxInspection();

  const qualifiedName = body.slice(0, index);
  const attributes = new Map();

  while (index < body.length) {
    index = skipXmlWhitespace(body, index);
    if (index >= body.length) break;

    const nameStart = index;
    while (index < body.length && !/[\t\n\f\r =]/.test(body[index])) index += 1;
    if (nameStart === index) failXlsxInspection();
    const attributeName = body.slice(nameStart, index);

    index = skipXmlWhitespace(body, index);
    if (body[index] !== "=") failXlsxInspection();
    index += 1;
    index = skipXmlWhitespace(body, index);

    const quote = body[index];
    if (quote !== "\"" && quote !== "'") failXlsxInspection();
    index += 1;

    const valueStart = index;
    while (index < body.length && body[index] !== quote) index += 1;
    if (index >= body.length) failXlsxInspection();
    attributes.set(attributeName, body.slice(valueStart, index));
    index += 1;
  }

  return Object.freeze({
    qualifiedName,
    localName: localNameFor(qualifiedName),
    attributes,
    selfClosing,
  });
}

class XmlElementScanner {
  constructor({ onStart, onEnd } = {}) {
    this.decoder = new TextDecoder("utf-8", { fatal: true });
    this.onStart = onStart;
    this.onEnd = onEnd;
    this.state = "text";
    this.markup = "";
    this.quote = null;
    this.stack = [];
    this.tail = "";
  }

  feed(bytes) {
    let text;
    try {
      text = this.decoder.decode(bytes, { stream: true });
    } catch {
      failXlsxInspection();
    }

    for (const character of text) {
      this.consume(character);
    }
  }

  finish() {
    try {
      const text = this.decoder.decode();
      for (const character of text) {
        this.consume(character);
      }
    } catch {
      failXlsxInspection();
    }

    if (this.state !== "text" || this.stack.length !== 0) failXlsxInspection();
  }

  consume(character) {
    if (this.state === "text") {
      if (character === "<") {
        this.state = "markup";
        this.markup = "<";
        this.quote = null;
      }
      return;
    }

    if (this.state === "comment") {
      this.tail = `${this.tail}${character}`.slice(-3);
      if (this.tail === "-->") {
        this.state = "text";
        this.tail = "";
      }
      return;
    }

    if (this.state === "cdata") {
      this.tail = `${this.tail}${character}`.slice(-3);
      if (this.tail === "]]>") {
        this.state = "text";
        this.tail = "";
      }
      return;
    }

    if (this.state === "processing_instruction") {
      this.tail = `${this.tail}${character}`.slice(-2);
      if (this.tail === "?>") {
        this.state = "text";
        this.tail = "";
      }
      return;
    }

    this.markup += character;
    if (this.markup.length > MAX_XML_TAG_LENGTH) failXlsxInspection();

    if (this.markup === "<?") {
      this.state = "processing_instruction";
      this.markup = "";
      this.tail = "";
      return;
    }

    if (this.markup.length === 3 && this.markup.startsWith("<!")) {
      const third = this.markup[2];
      if (third !== "-" && third !== "[") failXlsxInspection();
    }

    if (this.markup === "<!--") {
      this.state = "comment";
      this.markup = "";
      this.tail = "";
      return;
    }

    if (this.markup.length >= 3 && this.markup.startsWith("<![") && !"![CDATA[".startsWith(this.markup.slice(1))) {
      failXlsxInspection();
    }

    if (this.markup === "<![CDATA[") {
      this.state = "cdata";
      this.markup = "";
      this.tail = "";
      return;
    }

    if (this.quote) {
      if (character === this.quote) this.quote = null;
      return;
    }

    if (character === "\"" || character === "'") {
      this.quote = character;
      return;
    }

    if (character !== ">") return;

    this.handleMarkup(this.markup);
    this.state = "text";
    this.markup = "";
  }

  handleMarkup(tag) {
    if (tag.startsWith("</")) {
      const name = tag.slice(2, -1).trim();
      if (!name || /[\t\n\f\r />]/.test(name)) failXlsxInspection();
      const localName = localNameFor(name);
      const current = this.stack.pop();
      if (current !== localName) failXlsxInspection();
      if (this.onEnd) this.onEnd({ localName, depth: this.stack.length });
      return;
    }

    const element = parseXmlStartTag(tag);
    const depth = this.stack.length;
    if (this.onStart) this.onStart({ ...element, depth });
    if (!element.selfClosing) {
      this.stack.push(element.localName);
      return;
    }
    if (this.onEnd) this.onEnd({ localName: element.localName, depth });
  }
}

function getLocalEntryDataBounds(bytes, entry) {
  const offset = entry.localHeaderOffset;
  if (offset > bytes.byteLength - 30) failXlsxInspection();
  if (readUint32LE(bytes, offset) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) failXlsxInspection();

  const localCompressionMethod = readUint16LE(bytes, offset + 8);
  const fileNameLength = readUint16LE(bytes, offset + 26);
  const extraFieldLength = readUint16LE(bytes, offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraFieldLength;

  if (localCompressionMethod !== entry.compressionMethod) failXlsxInspection();
  if (dataStart > bytes.byteLength) failXlsxInspection();
  if (entry.compressedSize > bytes.byteLength - dataStart) failXlsxInspection();

  return Object.freeze({
    start: dataStart,
    end: dataStart + entry.compressedSize,
  });
}

async function feedStoredXmlEntry(bytes, bounds, scanner) {
  for (let offset = bounds.start; offset < bounds.end; offset += XML_CHUNK_SIZE) {
    scanner.feed(bytes.subarray(offset, Math.min(bounds.end, offset + XML_CHUNK_SIZE)));
  }
  scanner.finish();
}

async function feedDeflatedXmlEntry(bytes, bounds, scanner) {
  const inflater = createInflateRaw();
  let streamError = null;
  const done = new Promise((resolve, reject) => {
    inflater.on("end", resolve);
    inflater.on("error", reject);
  });

  inflater.on("data", (chunk) => {
    try {
      scanner.feed(chunk);
    } catch (error) {
      streamError = error;
      inflater.destroy(error);
    }
  });

  for (let offset = bounds.start; offset < bounds.end; offset += XML_CHUNK_SIZE) {
    if (streamError) break;
    const chunkLength = Math.min(XML_CHUNK_SIZE, bounds.end - offset);
    const chunk = Buffer.from(bytes.buffer, bytes.byteOffset + offset, chunkLength);
    if (!inflater.write(chunk)) {
      await once(inflater, "drain");
    }
  }

  if (!streamError) inflater.end();

  try {
    await done;
  } catch (error) {
    if (streamError) throw streamError;
    failXlsxInspection();
  }

  if (streamError) throw streamError;
  scanner.finish();
}

async function parseXmlZipEntry({ bytes, entry, onStart, onEnd }) {
  const scanner = new XmlElementScanner({ onStart, onEnd });
  const bounds = getLocalEntryDataBounds(bytes, entry);

  if (entry.compressionMethod === 0) {
    await feedStoredXmlEntry(bytes, bounds, scanner);
    return;
  }

  if (entry.compressionMethod === 8) {
    await feedDeflatedXmlEntry(bytes, bounds, scanner);
    return;
  }

  failXlsxInspection();
}

function attributeValue(attributes, names) {
  for (const name of names) {
    if (attributes.has(name)) return attributes.get(name);
  }
  return undefined;
}

async function parseWorkbookSheets({ bytes, entries }) {
  const workbookEntry = entries.get(WORKBOOK_ENTRY_NAME);
  if (!workbookEntry) failXlsxInspection();

  const sheetRelationshipIds = [];
  let sheetsDepth = null;

  try {
    await parseXmlZipEntry({
      bytes,
      entry: workbookEntry,
      onStart: ({ localName, attributes, depth }) => {
        if (localName === "sheets" && sheetsDepth === null) {
          sheetsDepth = depth + 1;
          return;
        }

        if (localName !== "sheet" || sheetsDepth === null || depth !== sheetsDepth) return;

        sheetRelationshipIds.push(attributeValue(attributes, ["r:id"]));
        if (sheetRelationshipIds.length > KAI_SPRINT2_P0_XLSX_LIMITS.maxSheets) {
          throw new XlsxLimitExceeded("sheet");
        }
      },
      onEnd: ({ localName, depth }) => {
        if (localName === "sheets" && sheetsDepth === depth + 1) {
          sheetsDepth = null;
        }
      },
    });
  } catch (error) {
    if (error instanceof XlsxLimitExceeded) throw error;
    failXlsxInspection();
  }

  if (sheetRelationshipIds.some((id) => typeof id !== "string" || id.length === 0)) {
    failXlsxInspection();
  }

  return Object.freeze(sheetRelationshipIds);
}

function isUnsafeRelationshipTarget(target, targetMode) {
  if (typeof targetMode === "string" && targetMode.toLowerCase() === "external") return true;
  if (typeof target !== "string" || target.length === 0) return true;
  if (target.startsWith("/") || target.startsWith("\\") || target.includes("\\")) return true;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) return true;
  if (target.includes("#") || target.includes("?")) return true;
  return false;
}

function resolveWorkbookRelationshipTarget(target) {
  if (isUnsafeRelationshipTarget(target, undefined)) failXlsxInspection();

  const segments = `${WORKBOOK_BASE_DIRECTORY}/${target}`.split("/");
  const resolved = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") failXlsxInspection();
    resolved.push(segment);
  }

  const path = resolved.join("/");
  if (!path.startsWith(`${WORKBOOK_BASE_DIRECTORY}/`)) failXlsxInspection();
  return path;
}

async function parseWorkbookRelationships({ bytes, entries, sheetRelationshipIds }) {
  const relsEntry = entries.get(WORKBOOK_RELS_ENTRY_NAME);
  if (!relsEntry) failXlsxInspection();

  const neededIds = new Set(sheetRelationshipIds);
  const seenIds = new Set();
  const resolvedTargetsById = new Map();

  try {
    await parseXmlZipEntry({
      bytes,
      entry: relsEntry,
      onStart: ({ localName, attributes }) => {
        if (localName !== "Relationship") return;

        const id = attributeValue(attributes, ["Id"]);
        if (typeof id !== "string" || id.length === 0) failXlsxInspection();
        if (seenIds.has(id)) failXlsxInspection();
        seenIds.add(id);

        if (!neededIds.has(id)) return;

        const type = attributeValue(attributes, ["Type"]);
        const target = attributeValue(attributes, ["Target"]);
        const targetMode = attributeValue(attributes, ["TargetMode"]);

        if (typeof type !== "string" || !type.endsWith(SHEET_RELATIONSHIP_TYPE_SUFFIX)) {
          failXlsxInspection();
        }
        if (isUnsafeRelationshipTarget(target, targetMode)) failXlsxInspection();

        resolvedTargetsById.set(id, resolveWorkbookRelationshipTarget(target));
      },
    });
  } catch (error) {
    if (error instanceof XlsxLimitExceeded) throw error;
    failXlsxInspection();
  }

  return Object.freeze(sheetRelationshipIds.map((id) => {
    const target = resolvedTargetsById.get(id);
    if (!target) failXlsxInspection();
    if (!entries.has(target)) failXlsxInspection();
    return target;
  }));
}

async function countWorksheetCellsUntilLimit({ bytes, entries, worksheetTargets }) {
  let cells = 0;

  for (const target of worksheetTargets) {
    const entry = entries.get(target);
    if (!entry) failXlsxInspection();

    try {
      await parseXmlZipEntry({
        bytes,
        entry,
        onStart: ({ localName }) => {
          if (localName !== "c") return;
          cells += 1;
          if (cells > KAI_SPRINT2_P0_XLSX_LIMITS.maxCells) {
            throw new XlsxLimitExceeded("cell");
          }
        },
      });
    } catch (error) {
      if (error instanceof XlsxLimitExceeded) throw error;
      failXlsxInspection();
    }
  }

  return Object.freeze({ cells, exceeded: false });
}

function isXlsxTypeAgreementPass(result) {
  return (
    result &&
    typeof result === "object" &&
    result.policy === "allow" &&
    result.category === "type_agreement_pass" &&
    result.evidence?.normalized_extension === ".xlsx" &&
    result.evidence?.normalized_declared_mime === XLSX_MIME &&
    result.evidence?.zip_classification === "complete_xlsx_shallow_identity"
  );
}

export async function detectXlsxSheetCellLimitPolicy({ extension, declaredMime, bytes } = {}) {
  const typeAgreementResult = detectP0FileTypeAgreement({ extension, declaredMime, bytes });
  if (!isXlsxTypeAgreementPass(typeAgreementResult)) {
    throw sanitizedXlsxFailure();
  }

  const entries = parseZipCentralDirectory(bytes);

  try {
    const sheetRelationshipIds = await parseWorkbookSheets({ bytes, entries });
    const worksheetTargets = await parseWorkbookRelationships({ bytes, entries, sheetRelationshipIds });
    await countWorksheetCellsUntilLimit({ bytes, entries, worksheetTargets });
  } catch (error) {
    if (error instanceof XlsxLimitExceeded) {
      return error.kind === "sheet"
        ? XLSX_SHEET_LIMIT_EXCEEDED_RESULT
        : XLSX_CELL_LIMIT_EXCEEDED_RESULT;
    }
    throw sanitizedXlsxFailure();
  }

  return undefined;
}

export const __testables = Object.freeze({
  XmlElementScanner,
  parseZipCentralDirectory,
  sanitizedXlsxFailure,
});
