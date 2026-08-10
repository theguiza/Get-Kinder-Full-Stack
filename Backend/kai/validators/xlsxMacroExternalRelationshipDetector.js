import { inflateRawSync } from "node:zlib";

import { detectOoxmlPathTraversalPolicy } from "./ooxmlPathTraversalDetector.js";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_EOCD_MINIMUM_LENGTH = 22;
const ZIP_MAX_COMMENT_LENGTH = 0xffff;
const MAX_XML_TAG_LENGTH = 64 * 1024;
const CONTENT_TYPES_ENTRY_NAME = "[Content_Types].xml";
const RELATIONSHIP_PART_SUFFIX = ".rels";

const VBA_PROJECT_PART_NAMES = Object.freeze(new Set([
  "xl/vbaProject.bin",
  "xl/vbaProjectSignature.bin",
]));

const MACRO_OR_SIGNATURE_CONTENT_TYPES = Object.freeze(new Set([
  "application/vnd.ms-excel.sheet.macroEnabled.main+xml",
  "application/vnd.ms-excel.macrosheet+xml",
  "application/vnd.ms-excel.intlmacrosheet+xml",
  "application/vnd.ms-office.vbaProject",
  "application/vnd.ms-office.vbaProjectSignature",
]));

const MACRO_OR_SIGNATURE_RELATIONSHIP_TYPES = Object.freeze(new Set([
  "http://schemas.microsoft.com/office/2006/relationships/vbaProject",
  "http://schemas.microsoft.com/office/2006/relationships/vbaProjectSignature",
  "http://schemas.microsoft.com/office/2006/relationships/xlMacrosheet",
  "http://schemas.microsoft.com/office/2006/relationships/xlIntlMacrosheet",
]));

const XLSX_MACRO_OR_EXTERNAL_RELATIONSHIP_RESULT = Object.freeze({
  policy: "block",
  category: "xlsx_macro_or_external_relationship",
});

class XlsxMacroOrExternalRelationshipDetected extends Error {}

function sanitizedXlsxActiveContentFailure() {
  return new Error("XLSX macro/external relationship inspection failed.");
}

function failXlsxActiveContentInspection() {
  throw sanitizedXlsxActiveContentFailure();
}

function blockXlsxActiveContent() {
  throw new XlsxMacroOrExternalRelationshipDetected("XLSX macro or external relationship detected.");
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

function decodeUtf8(bytes, offset, length) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(offset, offset + length));
  } catch {
    failXlsxActiveContentInspection();
  }
}

function parseZipCentralDirectoryEntries(bytes) {
  const eocdOffset = findZipEocdOffset(bytes);
  if (eocdOffset === -1) failXlsxActiveContentInspection();

  const diskNumber = readUint16LE(bytes, eocdOffset + 4);
  const centralDirectoryDisk = readUint16LE(bytes, eocdOffset + 6);
  const diskEntryCount = readUint16LE(bytes, eocdOffset + 8);
  const totalEntryCount = readUint16LE(bytes, eocdOffset + 10);
  const centralDirectoryLength = readUint32LE(bytes, eocdOffset + 12);
  const centralDirectoryOffset = readUint32LE(bytes, eocdOffset + 16);

  if (diskNumber !== 0 || centralDirectoryDisk !== 0) failXlsxActiveContentInspection();
  if (diskEntryCount !== totalEntryCount) failXlsxActiveContentInspection();
  if (centralDirectoryOffset > bytes.byteLength) failXlsxActiveContentInspection();
  if (centralDirectoryLength > bytes.byteLength - centralDirectoryOffset) failXlsxActiveContentInspection();
  if (centralDirectoryOffset + centralDirectoryLength !== eocdOffset) failXlsxActiveContentInspection();

  const entries = [];
  let recordOffset = centralDirectoryOffset;
  let parsedRecordCount = 0;

  while (recordOffset < eocdOffset) {
    if (eocdOffset - recordOffset < 46) failXlsxActiveContentInspection();
    if (readUint32LE(bytes, recordOffset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      failXlsxActiveContentInspection();
    }

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

    if (recordLength > eocdOffset - recordOffset) failXlsxActiveContentInspection();
    if (localHeaderOffset > bytes.byteLength - 4) failXlsxActiveContentInspection();
    if (readUint32LE(bytes, localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
      failXlsxActiveContentInspection();
    }
    if (generalPurposeFlag & 0x1) failXlsxActiveContentInspection();
    if (![0, 8].includes(compressionMethod)) failXlsxActiveContentInspection();

    entries.push(Object.freeze({
      name: decodeUtf8(bytes, fileNameOffset, fileNameLength),
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    }));

    recordOffset += recordLength;
    parsedRecordCount += 1;
  }

  if (recordOffset !== centralDirectoryOffset + centralDirectoryLength) failXlsxActiveContentInspection();
  if (parsedRecordCount !== totalEntryCount) failXlsxActiveContentInspection();

  return Object.freeze(entries);
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
  if (index === 0) failXlsxActiveContentInspection();

  const qualifiedName = body.slice(0, index);
  const attributes = new Map();

  while (index < body.length) {
    index = skipXmlWhitespace(body, index);
    if (index >= body.length) break;

    const nameStart = index;
    while (index < body.length && !/[\t\n\f\r =]/.test(body[index])) index += 1;
    if (nameStart === index) failXlsxActiveContentInspection();
    const attributeName = body.slice(nameStart, index);
    if (attributes.has(attributeName)) failXlsxActiveContentInspection();

    index = skipXmlWhitespace(body, index);
    if (body[index] !== "=") failXlsxActiveContentInspection();
    index += 1;
    index = skipXmlWhitespace(body, index);

    const quote = body[index];
    if (quote !== "\"" && quote !== "'") failXlsxActiveContentInspection();
    index += 1;

    const valueStart = index;
    while (index < body.length && body[index] !== quote) index += 1;
    if (index >= body.length) failXlsxActiveContentInspection();
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
  constructor({ onStart } = {}) {
    this.decoder = new TextDecoder("utf-8", { fatal: true });
    this.onStart = onStart;
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
      failXlsxActiveContentInspection();
    }

    for (const character of text) this.consume(character);
  }

  finish() {
    try {
      const text = this.decoder.decode();
      for (const character of text) this.consume(character);
    } catch {
      failXlsxActiveContentInspection();
    }

    if (this.state !== "text" || this.stack.length !== 0) failXlsxActiveContentInspection();
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
    if (this.markup.length > MAX_XML_TAG_LENGTH) failXlsxActiveContentInspection();

    if (this.markup === "<?") {
      this.state = "processing_instruction";
      this.markup = "";
      this.tail = "";
      return;
    }

    if (this.markup.length === 3 && this.markup.startsWith("<!")) {
      const third = this.markup[2];
      if (third !== "-" && third !== "[") failXlsxActiveContentInspection();
    }

    if (this.markup === "<!--") {
      this.state = "comment";
      this.markup = "";
      this.tail = "";
      return;
    }

    if (this.markup.length >= 3 && this.markup.startsWith("<![") && !"![CDATA[".startsWith(this.markup.slice(1))) {
      failXlsxActiveContentInspection();
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
      if (!name || /[\t\n\f\r />]/.test(name)) failXlsxActiveContentInspection();
      const localName = localNameFor(name);
      const current = this.stack.pop();
      if (current !== localName) failXlsxActiveContentInspection();
      return;
    }

    const element = parseXmlStartTag(tag);
    if (this.onStart) this.onStart(element);
    if (!element.selfClosing) this.stack.push(element.localName);
  }
}

function getLocalEntryDataBounds(bytes, entry) {
  const offset = entry.localHeaderOffset;
  if (offset > bytes.byteLength - 30) failXlsxActiveContentInspection();
  if (readUint32LE(bytes, offset) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
    failXlsxActiveContentInspection();
  }

  const localCompressionMethod = readUint16LE(bytes, offset + 8);
  const fileNameLength = readUint16LE(bytes, offset + 26);
  const extraFieldLength = readUint16LE(bytes, offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraFieldLength;

  if (localCompressionMethod !== entry.compressionMethod) failXlsxActiveContentInspection();
  if (dataStart > bytes.byteLength) failXlsxActiveContentInspection();
  if (entry.compressedSize > bytes.byteLength - dataStart) failXlsxActiveContentInspection();

  return Object.freeze({
    start: dataStart,
    end: dataStart + entry.compressedSize,
  });
}

function readEntryBytes({ bytes, entry }) {
  const bounds = getLocalEntryDataBounds(bytes, entry);
  const compressed = bytes.subarray(bounds.start, bounds.end);

  if (entry.compressionMethod === 0) return compressed;
  if (entry.compressionMethod !== 8) failXlsxActiveContentInspection();

  try {
    return inflateRawSync(compressed);
  } catch {
    failXlsxActiveContentInspection();
  }
}

function attributeValue(attributes, name) {
  const value = attributes.get(name);
  return typeof value === "string" ? value : undefined;
}

function inspectContentTypes({ bytes, entries }) {
  const contentTypesEntry = entries.find((entry) => entry.name === CONTENT_TYPES_ENTRY_NAME);
  if (!contentTypesEntry) failXlsxActiveContentInspection();

  const scanner = new XmlElementScanner({
    onStart: ({ localName, attributes }) => {
      if (localName === "Default") {
        const extension = attributeValue(attributes, "Extension");
        const contentType = attributeValue(attributes, "ContentType");
        if (typeof extension !== "string" || extension.length === 0) failXlsxActiveContentInspection();
        if (typeof contentType !== "string" || contentType.length === 0) failXlsxActiveContentInspection();
        if (MACRO_OR_SIGNATURE_CONTENT_TYPES.has(contentType)) blockXlsxActiveContent();
        return;
      }

      if (localName === "Override") {
        const partName = attributeValue(attributes, "PartName");
        const contentType = attributeValue(attributes, "ContentType");
        if (typeof partName !== "string" || !partName.startsWith("/")) failXlsxActiveContentInspection();
        if (typeof contentType !== "string" || contentType.length === 0) failXlsxActiveContentInspection();
        if (MACRO_OR_SIGNATURE_CONTENT_TYPES.has(contentType)) blockXlsxActiveContent();
      }
    },
  });

  scanner.feed(readEntryBytes({ bytes, entry: contentTypesEntry }));
  scanner.finish();
}

function inspectRelationshipAttributes(attributes) {
  const targetMode = attributeValue(attributes, "TargetMode");

  if (targetMode !== undefined && targetMode !== "Internal" && targetMode !== "External") {
    failXlsxActiveContentInspection();
  }
  if (targetMode === "External") blockXlsxActiveContent();

  const type = attributeValue(attributes, "Type");
  if (typeof type === "string" && MACRO_OR_SIGNATURE_RELATIONSHIP_TYPES.has(type)) {
    blockXlsxActiveContent();
  }

  const target = attributeValue(attributes, "Target");
  if (typeof type !== "string" || type.length === 0) failXlsxActiveContentInspection();
  if (typeof target !== "string" || target.length === 0) failXlsxActiveContentInspection();
}

function inspectRelationships({ bytes, entries }) {
  for (const entry of entries) {
    if (entry.name.endsWith("/") || !entry.name.endsWith(RELATIONSHIP_PART_SUFFIX)) continue;

    const scanner = new XmlElementScanner({
      onStart: ({ localName, attributes }) => {
        if (localName === "Relationship") inspectRelationshipAttributes(attributes);
      },
    });
    scanner.feed(readEntryBytes({ bytes, entry }));
    scanner.finish();
  }
}

function inspectVbaPartPresence(entries) {
  for (const entry of entries) {
    if (VBA_PROJECT_PART_NAMES.has(entry.name)) blockXlsxActiveContent();
  }
}

async function assertPriorOoxmlTraversalNoBlock(input) {
  const result = await detectOoxmlPathTraversalPolicy(input);
  if (result !== undefined) return result;
  return undefined;
}

export async function detectXlsxMacroExternalRelationshipPolicy({ extension, declaredMime, bytes } = {}) {
  if (typeof extension !== "string") throw sanitizedXlsxActiveContentFailure();
  if (typeof declaredMime !== "string") throw sanitizedXlsxActiveContentFailure();
  if (!(bytes instanceof Uint8Array)) throw sanitizedXlsxActiveContentFailure();
  if (extension.toLowerCase() !== ".xlsx" || declaredMime !== XLSX_MIME) {
    throw sanitizedXlsxActiveContentFailure();
  }

  let priorResult;
  try {
    priorResult = await assertPriorOoxmlTraversalNoBlock({ extension, declaredMime, bytes });
  } catch {
    throw sanitizedXlsxActiveContentFailure();
  }
  if (priorResult !== undefined) return priorResult;

  try {
    const entries = parseZipCentralDirectoryEntries(bytes);
    inspectVbaPartPresence(entries);
    inspectContentTypes({ bytes, entries });
    inspectRelationships({ bytes, entries });
  } catch (error) {
    if (error instanceof XlsxMacroOrExternalRelationshipDetected) {
      return XLSX_MACRO_OR_EXTERNAL_RELATIONSHIP_RESULT;
    }
    throw sanitizedXlsxActiveContentFailure();
  }

  return undefined;
}

export const __testables = Object.freeze({
  parseZipCentralDirectoryEntries,
  sanitizedXlsxActiveContentFailure,
});
