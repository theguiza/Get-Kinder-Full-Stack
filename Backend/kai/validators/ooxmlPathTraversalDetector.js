import { inflateRawSync } from "node:zlib";

import { detectXlsxSheetCellLimitPolicy } from "./xlsxSheetCellLimitDetector.js";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_EOCD_MINIMUM_LENGTH = 22;
const ZIP_MAX_COMMENT_LENGTH = 0xffff;
const MAX_XML_TAG_LENGTH = 64 * 1024;
const RELATIONSHIP_PART_SUFFIX = ".rels";
const ROOT_RELATIONSHIP_PART = "_rels/.rels";

const OOXML_PATH_TRAVERSAL_RESULT = Object.freeze({
  policy: "block",
  category: "ooxml_path_traversal",
});

class OoxmlPathTraversalDetected extends Error {}

function sanitizedOoxmlFailure() {
  return new Error("OOXML path traversal inspection failed.");
}

function failOoxmlInspection() {
  throw sanitizedOoxmlFailure();
}

function blockOoxmlPathTraversal() {
  throw new OoxmlPathTraversalDetected("OOXML path traversal detected.");
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
    failOoxmlInspection();
  }
}

function parseZipCentralDirectoryEntries(bytes) {
  const eocdOffset = findZipEocdOffset(bytes);
  if (eocdOffset === -1) failOoxmlInspection();

  const diskNumber = readUint16LE(bytes, eocdOffset + 4);
  const centralDirectoryDisk = readUint16LE(bytes, eocdOffset + 6);
  const diskEntryCount = readUint16LE(bytes, eocdOffset + 8);
  const totalEntryCount = readUint16LE(bytes, eocdOffset + 10);
  const centralDirectoryLength = readUint32LE(bytes, eocdOffset + 12);
  const centralDirectoryOffset = readUint32LE(bytes, eocdOffset + 16);

  if (diskNumber !== 0 || centralDirectoryDisk !== 0) failOoxmlInspection();
  if (diskEntryCount !== totalEntryCount) failOoxmlInspection();
  if (centralDirectoryOffset > bytes.byteLength) failOoxmlInspection();
  if (centralDirectoryLength > bytes.byteLength - centralDirectoryOffset) failOoxmlInspection();
  if (centralDirectoryOffset + centralDirectoryLength !== eocdOffset) failOoxmlInspection();

  const entries = [];
  let recordOffset = centralDirectoryOffset;
  let parsedRecordCount = 0;

  while (recordOffset < eocdOffset) {
    if (eocdOffset - recordOffset < 46) failOoxmlInspection();
    if (readUint32LE(bytes, recordOffset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) failOoxmlInspection();

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

    if (recordLength > eocdOffset - recordOffset) failOoxmlInspection();
    if (localHeaderOffset > bytes.byteLength - 4) failOoxmlInspection();
    if (readUint32LE(bytes, localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) failOoxmlInspection();
    if (generalPurposeFlag & 0x1) failOoxmlInspection();
    if (![0, 8].includes(compressionMethod)) failOoxmlInspection();

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

  if (recordOffset !== centralDirectoryOffset + centralDirectoryLength) failOoxmlInspection();
  if (parsedRecordCount !== totalEntryCount) failOoxmlInspection();

  return Object.freeze(entries);
}

function normalizedZipEntryName(name) {
  const directory = name.endsWith("/");
  const segments = [];
  for (const segment of name.split("/")) {
    if (!segment || segment === ".") continue;
    segments.push(segment);
  }
  const normalized = segments.join("/");
  return directory ? `${normalized}/` : normalized;
}

function hasDriveLetterForm(value) {
  return /^[A-Za-z]:/.test(value);
}

function hasSchemeForm(value) {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

function hasUncForm(value) {
  return value.startsWith("//") || value.startsWith("\\\\");
}

function validateZipEntryNames(entries) {
  const exactNames = new Set();
  const normalizedNames = new Set();

  for (const entry of entries) {
    const name = entry.name;
    if (name.includes("\0") || name.includes("\\")) blockOoxmlPathTraversal();
    if (name.startsWith("/") || hasDriveLetterForm(name) || hasUncForm(name)) blockOoxmlPathTraversal();
    if (name.split("/").includes("..")) blockOoxmlPathTraversal();

    const normalizedName = normalizedZipEntryName(name);
    if (exactNames.has(name) || normalizedNames.has(normalizedName)) blockOoxmlPathTraversal();
    exactNames.add(name);
    normalizedNames.add(normalizedName);
  }
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
  if (index === 0) failOoxmlInspection();

  const qualifiedName = body.slice(0, index);
  const attributes = new Map();

  while (index < body.length) {
    index = skipXmlWhitespace(body, index);
    if (index >= body.length) break;

    const nameStart = index;
    while (index < body.length && !/[\t\n\f\r =]/.test(body[index])) index += 1;
    if (nameStart === index) failOoxmlInspection();
    const attributeName = body.slice(nameStart, index);
    if (attributes.has(attributeName)) failOoxmlInspection();

    index = skipXmlWhitespace(body, index);
    if (body[index] !== "=") failOoxmlInspection();
    index += 1;
    index = skipXmlWhitespace(body, index);

    const quote = body[index];
    if (quote !== "\"" && quote !== "'") failOoxmlInspection();
    index += 1;

    const valueStart = index;
    while (index < body.length && body[index] !== quote) index += 1;
    if (index >= body.length) failOoxmlInspection();
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

class XmlRelationshipScanner {
  constructor(onRelationship) {
    this.decoder = new TextDecoder("utf-8", { fatal: true });
    this.onRelationship = onRelationship;
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
      failOoxmlInspection();
    }

    for (const character of text) this.consume(character);
  }

  finish() {
    try {
      const text = this.decoder.decode();
      for (const character of text) this.consume(character);
    } catch {
      failOoxmlInspection();
    }

    if (this.state !== "text" || this.stack.length !== 0) failOoxmlInspection();
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
    if (this.markup.length > MAX_XML_TAG_LENGTH) failOoxmlInspection();

    if (this.markup === "<?") {
      this.state = "processing_instruction";
      this.markup = "";
      this.tail = "";
      return;
    }

    if (this.markup.length === 3 && this.markup.startsWith("<!")) {
      const third = this.markup[2];
      if (third !== "-" && third !== "[") failOoxmlInspection();
    }

    if (this.markup === "<!--") {
      this.state = "comment";
      this.markup = "";
      this.tail = "";
      return;
    }

    if (this.markup.length >= 3 && this.markup.startsWith("<![") && !"![CDATA[".startsWith(this.markup.slice(1))) {
      failOoxmlInspection();
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
      if (!name || /[\t\n\f\r />]/.test(name)) failOoxmlInspection();
      const localName = localNameFor(name);
      const current = this.stack.pop();
      if (current !== localName) failOoxmlInspection();
      return;
    }

    const element = parseXmlStartTag(tag);
    if (element.localName === "Relationship") {
      this.onRelationship(element.attributes);
    }
    if (!element.selfClosing) this.stack.push(element.localName);
  }
}

function getLocalEntryDataBounds(bytes, entry) {
  const offset = entry.localHeaderOffset;
  if (offset > bytes.byteLength - 30) failOoxmlInspection();
  if (readUint32LE(bytes, offset) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) failOoxmlInspection();

  const localCompressionMethod = readUint16LE(bytes, offset + 8);
  const fileNameLength = readUint16LE(bytes, offset + 26);
  const extraFieldLength = readUint16LE(bytes, offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraFieldLength;

  if (localCompressionMethod !== entry.compressionMethod) failOoxmlInspection();
  if (dataStart > bytes.byteLength) failOoxmlInspection();
  if (entry.compressedSize > bytes.byteLength - dataStart) failOoxmlInspection();

  return Object.freeze({
    start: dataStart,
    end: dataStart + entry.compressedSize,
  });
}

function readEntryBytes({ bytes, entry }) {
  const bounds = getLocalEntryDataBounds(bytes, entry);
  const compressed = bytes.subarray(bounds.start, bounds.end);

  if (entry.compressionMethod === 0) return compressed;
  if (entry.compressionMethod !== 8) failOoxmlInspection();

  try {
    return inflateRawSync(compressed);
  } catch {
    failOoxmlInspection();
  }
}

function attributeValue(attributes, name) {
  const value = attributes.get(name);
  return typeof value === "string" ? value : undefined;
}

function relationshipBaseSegments(relsEntryName) {
  if (relsEntryName === ROOT_RELATIONSHIP_PART) return Object.freeze([]);

  const segments = relsEntryName.split("/");
  const relsDirectoryIndex = segments.lastIndexOf("_rels");
  if (
    relsDirectoryIndex <= 0 ||
    relsDirectoryIndex !== segments.length - 2 ||
    !segments[segments.length - 1].endsWith(RELATIONSHIP_PART_SUFFIX)
  ) {
    failOoxmlInspection();
  }

  return Object.freeze(segments.slice(0, relsDirectoryIndex));
}

function percentDecodeOnce(value) {
  let decoded = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== "%") {
      decoded += character;
      continue;
    }

    const hex = value.slice(index + 1, index + 3);
    if (!/^[0-9A-Fa-f]{2}$/.test(hex)) blockOoxmlPathTraversal();
    decoded += String.fromCharCode(Number.parseInt(hex, 16));
    index += 2;
  }
  return decoded;
}

function targetHasBlockedPathForm(target) {
  if (target.includes("\0") || target.includes("\\")) return true;
  if (hasUncForm(target) || hasDriveLetterForm(target)) return true;
  if (/^file:/i.test(target)) return true;
  return false;
}

function targetHasUnsupportedUriForm(target) {
  if (target.includes("#") || target.includes("?")) return true;
  return hasSchemeForm(target);
}

function resolvePackageTarget({ baseSegments, target }) {
  const targetSegments = target.startsWith("/")
    ? target.slice(1).split("/")
    : [...baseSegments, ...target.split("/")];
  const resolved = [];

  for (const segment of targetSegments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (resolved.length === 0) blockOoxmlPathTraversal();
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }

  if (resolved.length === 0) failOoxmlInspection();
  return resolved.join("/");
}

function inspectInternalRelationshipTarget({ baseSegments, target }) {
  if (typeof target !== "string" || target.length === 0) failOoxmlInspection();
  if (targetHasBlockedPathForm(target)) blockOoxmlPathTraversal();
  if (targetHasUnsupportedUriForm(target)) failOoxmlInspection();

  resolvePackageTarget({ baseSegments, target });

  const decoded = percentDecodeOnce(target);
  if (targetHasBlockedPathForm(decoded)) blockOoxmlPathTraversal();
  if (targetHasUnsupportedUriForm(decoded)) failOoxmlInspection();
  if (decoded !== target && decoded.split("/").includes("..")) blockOoxmlPathTraversal();
  resolvePackageTarget({ baseSegments, target: decoded });
}

function inspectRelationship({ baseSegments, attributes }) {
  const targetMode = attributeValue(attributes, "TargetMode");
  if (targetMode === "External") return;
  if (targetMode !== undefined && targetMode !== "Internal") failOoxmlInspection();

  inspectInternalRelationshipTarget({
    baseSegments,
    target: attributeValue(attributes, "Target"),
  });
}

function inspectRelationships({ bytes, entries }) {
  for (const entry of entries) {
    if (entry.name.endsWith("/") || !entry.name.endsWith(RELATIONSHIP_PART_SUFFIX)) continue;

    const baseSegments = relationshipBaseSegments(entry.name);
    const scanner = new XmlRelationshipScanner((attributes) => {
      inspectRelationship({ baseSegments, attributes });
    });
    scanner.feed(readEntryBytes({ bytes, entry }));
    scanner.finish();
  }
}

async function assertPriorXlsxSheetCellNoBlock(input) {
  const result = await detectXlsxSheetCellLimitPolicy(input);
  if (result !== undefined) return result;
  return undefined;
}

export async function detectOoxmlPathTraversalPolicy({ extension, declaredMime, bytes } = {}) {
  if (typeof extension !== "string") throw sanitizedOoxmlFailure();
  if (typeof declaredMime !== "string") throw sanitizedOoxmlFailure();
  if (!(bytes instanceof Uint8Array)) throw sanitizedOoxmlFailure();
  if (extension.toLowerCase() !== ".xlsx" || declaredMime !== XLSX_MIME) throw sanitizedOoxmlFailure();

  let entries;

  try {
    entries = parseZipCentralDirectoryEntries(bytes);
    validateZipEntryNames(entries);
  } catch (error) {
    if (error instanceof OoxmlPathTraversalDetected) return OOXML_PATH_TRAVERSAL_RESULT;
    throw sanitizedOoxmlFailure();
  }

  let priorFailure = null;
  try {
    const priorResult = await assertPriorXlsxSheetCellNoBlock({ extension, declaredMime, bytes });
    if (priorResult !== undefined) return priorResult;
  } catch (error) {
    priorFailure = error;
  }

  try {
    inspectRelationships({ bytes, entries });
  } catch (error) {
    if (error instanceof OoxmlPathTraversalDetected) return OOXML_PATH_TRAVERSAL_RESULT;
    throw sanitizedOoxmlFailure();
  }

  if (priorFailure) throw sanitizedOoxmlFailure();

  return undefined;
}

export const __testables = Object.freeze({
  normalizedZipEntryName,
  parseZipCentralDirectoryEntries,
  sanitizedOoxmlFailure,
});
