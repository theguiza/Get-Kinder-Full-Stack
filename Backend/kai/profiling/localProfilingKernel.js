import { inflateRawSync } from "node:zlib";

import {
  KAI_SPRINT2_MAX_FILE_SIZE_BYTES,
  KAI_SPRINT2_P0_CSV_LIMITS,
  KAI_SPRINT2_P0_XLSX_LIMITS,
} from "../config/kaiSprint2P0Contract.js";
import { detectCsvRowLimitPolicy } from "../validators/csvRowLimitDetector.js";
import { detectP0FileTypeAgreement } from "../validators/p0FileTypeAgreementDetector.js";
import { detectOoxmlArchiveResourceLimitPolicy } from "../validators/ooxmlArchiveResourceLimitDetector.js";
import { detectXlsxSheetCellLimitPolicy } from "../validators/xlsxSheetCellLimitDetector.js";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const MAX_REDACTED_SAMPLE_RECORDS = 20;
export const MAX_SAMPLE_VALUE_CHARACTERS = 120;
const UTF8_BOM_BYTES = Object.freeze([0xef, 0xbb, 0xbf]);
const CSV_FORMULA_PREFIXES = Object.freeze(new Set(["=", "+", "-", "@", "\t", "\r"]));
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_EOCD_MINIMUM_LENGTH = 22;
const ZIP_MAX_COMMENT_LENGTH = 0xffff;
const XML_CHUNK_SIZE = 16 * 1024;
const PROVISIONAL_GOVERNANCE = Object.freeze({
  meaning: "unknown",
  sensitivity: "unknown",
  review: "required",
  allowed_use: "internal only",
  llm_use: "not allowed",
  public_use: "not allowed",
  funder_use: "not allowed",
});

function governance() {
  return { ...PROVISIONAL_GOVERNANCE };
}

function safeFailure(format, category = "safe_parser_error") {
  return Object.freeze({
    status: "failed",
    format,
    error: Object.freeze({
      category,
      safe_message: "Local profiling could not safely parse this file.",
    }),
    governance: Object.freeze(governance()),
  });
}

function notProfilablePdf(reason) {
  return Object.freeze({
    status: "not_profilable",
    format: "pdf",
    reason,
    governance: Object.freeze(governance()),
  });
}

function pdfWorkerBoundaryEnvelope() {
  return notProfilablePdf("structural_pdf_profiling_requires_separately_governed_worker_boundary");
}

function okProfile(format, body) {
  return Object.freeze({
    status: "profiled",
    format,
    ...body,
    governance: Object.freeze(governance()),
  });
}

function assertProfilingInput({ extension, declaredMime, byteSize, bytes } = {}) {
  if (typeof extension !== "string") throw new TypeError("profileLocalTrustedFile requires extension as a string.");
  if (typeof declaredMime !== "string") throw new TypeError("profileLocalTrustedFile requires declaredMime as a string.");
  if (!Number.isSafeInteger(byteSize) || byteSize < 0) {
    throw new TypeError("profileLocalTrustedFile requires verified byteSize as a non-negative safe integer.");
  }
  if (!(bytes instanceof Uint8Array)) throw new TypeError("profileLocalTrustedFile requires immutable bytes as a Uint8Array.");
  if (bytes.byteLength !== byteSize) throw new TypeError("profileLocalTrustedFile requires byteSize to match bytes.");
  if (byteSize > KAI_SPRINT2_MAX_FILE_SIZE_BYTES) {
    return Object.freeze({
      status: "failed",
      format: normalizeExtension(extension).slice(1) || "unknown",
      error: Object.freeze({
        category: "input_size_exceeds_pre_parse_gate",
        safe_message: "Local profiling input exceeds the configured pre-parse byte gate.",
      }),
      governance: Object.freeze(governance()),
    });
  }
  return null;
}

function normalizeExtension(extension) {
  return extension.trim().toLowerCase();
}

function normalizeDeclaredMime(declaredMime) {
  const trimmed = declaredMime.trim();
  const parameterStart = trimmed.indexOf(";");
  return parameterStart === -1
    ? trimmed.toLowerCase()
    : `${trimmed.slice(0, parameterStart).toLowerCase()}${trimmed.slice(parameterStart)}`;
}

function hasUtf8Bom(bytes) {
  return UTF8_BOM_BYTES.every((byte, index) => bytes[index] === byte);
}

function decodeTrustedUtf8(bytes) {
  const source = hasUtf8Bom(bytes) ? bytes.subarray(UTF8_BOM_BYTES.length) : bytes;
  return TEXT_DECODER.decode(source);
}

function primitiveType(value) {
  if (value.length === 0) return "missing";
  const trimmed = value.trim();
  if (trimmed.length === 0) return "blank";
  if (/^(?:true|false)$/i.test(trimmed)) return "boolean";
  if (/^[+-]?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) return "number";
  if (/^\d{4}-\d{2}-\d{2}(?:[tT ][0-2]\d:[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-][0-2]\d:?[0-5]\d)?)?$/.test(trimmed)) {
    return "date_like";
  }
  return "text_like";
}

function redactedValue(value) {
  const characterCount = [...String(value ?? "")].length;
  return Object.freeze({
    redacted: true,
    value: "[redacted]",
    character_count: Math.min(characterCount, MAX_SAMPLE_VALUE_CHARACTERS),
    truncated: characterCount > MAX_SAMPLE_VALUE_CHARACTERS,
    primitive_type_hint: primitiveType(String(value ?? "")),
  });
}

function redactedName(value) {
  return Object.freeze({
    redacted: true,
    value: "[redacted]",
    present: typeof value === "string" && value.length > 0,
    character_count: Math.min([...(value ?? "")].length, MAX_SAMPLE_VALUE_CHARACTERS),
    truncated: [...(value ?? "")].length > MAX_SAMPLE_VALUE_CHARACTERS,
  });
}

function createColumnProfiles(columnCount) {
  return Array.from({ length: columnCount }, (_, index) => ({
    field_key: `field_${index + 1}`,
    header_present: false,
    present_count: 0,
    missing_count: 0,
    primitive_type_hints: {
      blank: 0,
      boolean: 0,
      number: 0,
      date_like: 0,
      text_like: 0,
    },
  }));
}

function isFormulaLike(value) {
  if (value.length === 0) return false;
  return CSV_FORMULA_PREFIXES.has(value[0]);
}

function parseCsvRecords(text) {
  const records = [];
  let row = [];
  let field = "";
  let state = "field_start";
  let recordHasContent = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRecord = () => {
    pushField();
    records.push(row);
    row = [];
    recordHasContent = false;
    state = "field_start";
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (state === "quoted") {
      if (char === "\"") {
        state = "after_quote";
      } else {
        field += char;
      }
      continue;
    }
    if (state === "after_quote") {
      if (char === "\"") {
        field += "\"";
        state = "quoted";
      } else if (char === ",") {
        pushField();
        state = "field_start";
      } else if (char === "\n") {
        pushRecord();
      } else if (char === "\r" && text[index + 1] === "\n") {
        pushRecord();
        index += 1;
      } else {
        throw new Error("safe_csv_parse_failure");
      }
      continue;
    }
    if (state === "field_start") {
      if (char === "\"") {
        recordHasContent = true;
        state = "quoted";
      } else if (char === ",") {
        recordHasContent = true;
        pushField();
      } else if (char === "\n") {
        pushRecord();
      } else if (char === "\r" && text[index + 1] === "\n") {
        pushRecord();
        index += 1;
      } else {
        recordHasContent = true;
        field += char;
        state = "unquoted";
      }
      continue;
    }
    if (char === ",") {
      pushField();
      state = "field_start";
    } else if (char === "\"") {
      throw new Error("safe_csv_parse_failure");
    } else if (char === "\n") {
      pushRecord();
    } else if (char === "\r" && text[index + 1] === "\n") {
      pushRecord();
      index += 1;
    } else {
      field += char;
    }
  }
  if (state === "quoted") throw new Error("safe_csv_parse_failure");
  if (recordHasContent || field.length > 0 || row.length > 0) pushRecord();
  return records;
}

function summarizeTabularRecords(records, { headerRow = true } = {}) {
  const header = headerRow && records.length > 0 ? records[0] : [];
  const dataRows = headerRow && records.length > 0 ? records.slice(1) : records;
  const columnCount = records.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  const columns = createColumnProfiles(columnCount);
  let formula_count = 0;
  const rowSignatures = new Map();

  for (let index = 0; index < columnCount; index += 1) {
    columns[index].header_present = typeof header[index] === "string" && header[index].trim().length > 0;
  }
  for (const row of dataRows) {
    const signature = JSON.stringify(Array.from({ length: columnCount }, (_, index) => row[index] ?? ""));
    rowSignatures.set(signature, (rowSignatures.get(signature) ?? 0) + 1);
    for (let index = 0; index < columnCount; index += 1) {
      const value = row[index] ?? "";
      const hint = primitiveType(value);
      if (hint === "missing" || hint === "blank") {
        columns[index].missing_count += 1;
      } else {
        columns[index].present_count += 1;
      }
      if (hint !== "missing") columns[index].primitive_type_hints[hint] += 1;
      if (isFormulaLike(value)) formula_count += 1;
    }
  }

  const duplicate_row_count = [...rowSignatures.values()]
    .filter((count) => count > 1)
    .reduce((total, count) => total + count, 0);
  const headers = columns.map((column, index) => Object.freeze({
    field_key: column.field_key,
    position: index + 1,
    present: column.header_present,
    name: redactedName(header[index] ?? ""),
  }));
  const sample_records = dataRows.slice(0, MAX_REDACTED_SAMPLE_RECORDS).map((row, rowIndex) => Object.freeze({
    sample_index: rowIndex,
    values: Object.freeze(columns.map((column, columnIndex) => Object.freeze({
      field_key: column.field_key,
      value: redactedValue(row[columnIndex] ?? ""),
    }))),
  }));
  const draft_dictionary_fields = columns.map((column) => Object.freeze({
    field_key: column.field_key,
    meaning: "unknown",
    sensitivity: "unknown",
    review: "required",
    allowed_use: "internal only",
    primitive_type_hints: Object.freeze({ ...column.primitive_type_hints }),
    missing_count: column.missing_count,
    present_count: column.present_count,
  }));

  return {
    header_count: headers.filter((headerShape) => headerShape.present).length,
    headers,
    row_count: dataRows.length,
    column_count: columnCount,
    field_count: columnCount,
    formula_count,
    duplicate_row_count,
    has_duplicate_rows: duplicate_row_count > 0,
    fields: columns.map((column) => Object.freeze({
      field_key: column.field_key,
      meaning: "unknown",
      sensitivity: "unknown",
      review: "required",
      allowed_use: "internal only",
      missing_count: column.missing_count,
      present_count: column.present_count,
      primitive_type_hints: Object.freeze({ ...column.primitive_type_hints }),
    })),
    sample_shapes: dataRows.slice(0, MAX_REDACTED_SAMPLE_RECORDS).map((row, rowIndex) => Object.freeze({
      sample_index: rowIndex,
      field_shapes: columns.map((column, columnIndex) => Object.freeze({
        field_key: column.field_key,
        presence: row[columnIndex] === undefined || row[columnIndex] === "" ? "missing" : "present",
        primitive_type_hint: primitiveType(row[columnIndex] ?? ""),
      })),
    })),
    sample_records,
    draft_dictionary_fields,
  };
}

async function profileCsv({ extension, declaredMime, bytes }) {
  try {
    const typeResult = detectP0FileTypeAgreement({ extension, declaredMime, bytes });
    if (typeResult.policy !== "allow") return safeFailure("csv", typeResult.category);
    const limitResult = detectCsvRowLimitPolicy({ extension, declaredMime, bytes });
    if (limitResult) return safeFailure("csv", limitResult.category);
    const text = decodeTrustedUtf8(bytes);
    const records = parseCsvRecords(text);
    const summary = summarizeTabularRecords(records);
    return okProfile("csv", {
      structural_metadata: Object.freeze({
        byte_size: bytes.byteLength,
        encoding: "utf-8",
        header_row_assumed: true,
        max_logical_records: KAI_SPRINT2_P0_CSV_LIMITS.maxLogicalRecords,
      }),
      counts: Object.freeze({
        header_count: summary.header_count,
        row_count: summary.row_count,
        column_count: summary.column_count,
        field_count: summary.field_count,
        formula_count: summary.formula_count,
        duplicate_row_count: summary.duplicate_row_count,
      }),
      headers: Object.freeze(summary.headers),
      fields: Object.freeze(summary.fields),
      sample_shapes: Object.freeze(summary.sample_shapes),
      sample_records: Object.freeze(summary.sample_records),
      duplicate_row_hints: Object.freeze({
        has_duplicate_rows: summary.has_duplicate_rows,
        duplicate_row_count: summary.duplicate_row_count,
      }),
      draft_dictionary_fields: Object.freeze(summary.draft_dictionary_fields),
      quality_findings: Object.freeze([]),
      proposals: Object.freeze({
        sensitivity: "unknown",
        allowed_use: "internal only",
      }),
    });
  } catch {
    return safeFailure("csv");
  }
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
  return TEXT_DECODER.decode(bytes.subarray(offset, offset + length));
}

function parseZipEntries(bytes) {
  const eocdOffset = findZipEocdOffset(bytes);
  if (eocdOffset === -1) throw new Error("safe_zip_parse_failure");
  const totalEntryCount = readUint16LE(bytes, eocdOffset + 10);
  const centralDirectoryLength = readUint32LE(bytes, eocdOffset + 12);
  const centralDirectoryOffset = readUint32LE(bytes, eocdOffset + 16);
  if (centralDirectoryOffset + centralDirectoryLength !== eocdOffset) throw new Error("safe_zip_parse_failure");

  const entries = new Map();
  let recordOffset = centralDirectoryOffset;
  while (recordOffset < eocdOffset) {
    if (readUint32LE(bytes, recordOffset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) throw new Error("safe_zip_parse_failure");
    const compressionMethod = readUint16LE(bytes, recordOffset + 10);
    const compressedSize = readUint32LE(bytes, recordOffset + 20);
    const uncompressedSize = readUint32LE(bytes, recordOffset + 24);
    const fileNameLength = readUint16LE(bytes, recordOffset + 28);
    const extraFieldLength = readUint16LE(bytes, recordOffset + 30);
    const fileCommentLength = readUint16LE(bytes, recordOffset + 32);
    const localHeaderOffset = readUint32LE(bytes, recordOffset + 42);
    const name = decodeZipEntryName(bytes, recordOffset + 46, fileNameLength);
    entries.set(name, Object.freeze({ name, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset }));
    recordOffset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }
  if (entries.size !== totalEntryCount) throw new Error("safe_zip_parse_failure");
  return entries;
}

function inflateEntry(bytes, entry) {
  const offset = entry.localHeaderOffset;
  if (readUint32LE(bytes, offset) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) throw new Error("safe_zip_parse_failure");
  const fileNameLength = readUint16LE(bytes, offset + 26);
  const extraFieldLength = readUint16LE(bytes, offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraFieldLength;
  const compressed = bytes.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.compressionMethod === 0) return compressed;
  if (entry.compressionMethod === 8) return inflateRawSync(compressed);
  throw new Error("safe_zip_parse_failure");
}

function scanXmlElements(xmlBytes, onElement) {
  const text = TEXT_DECODER.decode(xmlBytes);
  for (let offset = 0; offset < text.length;) {
    const open = text.indexOf("<", offset);
    if (open === -1) break;
    if (text.startsWith("<!--", open)) {
      const close = text.indexOf("-->", open + 4);
      if (close === -1) throw new Error("safe_xml_parse_failure");
      offset = close + 3;
      continue;
    }
    if (text.startsWith("<?", open)) {
      const close = text.indexOf("?>", open + 2);
      if (close === -1) throw new Error("safe_xml_parse_failure");
      offset = close + 2;
      continue;
    }
    const close = text.indexOf(">", open + 1);
    if (close === -1 || close - open > XML_CHUNK_SIZE * 4) throw new Error("safe_xml_parse_failure");
    const tag = text.slice(open + 1, close).trim();
    offset = close + 1;
    if (!tag || tag[0] === "/" || tag[0] === "!") continue;
    const body = tag.endsWith("/") ? tag.slice(0, -1).trim() : tag;
    const nameEnd = body.search(/[\t\n\f\r /]/);
    const qualifiedName = nameEnd === -1 ? body : body.slice(0, nameEnd);
    const localName = qualifiedName.includes(":") ? qualifiedName.slice(qualifiedName.indexOf(":") + 1) : qualifiedName;
    const attrsText = nameEnd === -1 ? "" : body.slice(nameEnd);
    const attributes = new Map();
    for (const match of attrsText.matchAll(/([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(["'])(.*?)\2/g)) {
      attributes.set(match[1], match[3]);
    }
    onElement({ localName, attributes });
  }
}

function cellColumnIndex(cellRef) {
  if (typeof cellRef !== "string") return null;
  const match = /^([A-Za-z]+)/.exec(cellRef);
  if (!match) return null;
  let index = 0;
  for (const character of match[1].toUpperCase()) {
    index = (index * 26) + character.charCodeAt(0) - 64;
  }
  return index;
}

function extractRowIndex(cellRef) {
  if (typeof cellRef !== "string") return null;
  const match = /([0-9]+)$/.exec(cellRef);
  if (!match) return null;
  const rowIndex = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(rowIndex) && rowIndex > 0 ? rowIndex : null;
}

function safeXmlAttributeValue(source, elementStart, attributeName) {
  const tagEnd = source.indexOf(">", elementStart);
  if (tagEnd === -1) return "";
  const tag = source.slice(elementStart, tagEnd + 1);
  const escapedName = attributeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escapedName}\\s*=\\s*([\"'])(.*?)\\1`).exec(tag);
  return match ? match[2] : "";
}

function parseWorkbookSheets(workbookBytes) {
  const workbookXml = TEXT_DECODER.decode(workbookBytes);
  const sheets = [];
  for (const match of workbookXml.matchAll(/<sheet\b/g)) {
    const elementStart = match.index;
    const name = safeXmlAttributeValue(workbookXml, elementStart, "name");
    const relationshipId = safeXmlAttributeValue(workbookXml, elementStart, "r:id");
    sheets.push(Object.freeze({
      sheet_key: `sheet_${sheets.length + 1}`,
      name,
      relationshipId,
    }));
  }
  return sheets;
}

function parseWorkbookRelationships(relsBytes) {
  const relsXmlText = TEXT_DECODER.decode(relsBytes);
  const relationships = new Map();
  for (const match of relsXmlText.matchAll(/<Relationship\b/g)) {
    const elementStart = match.index;
    const id = safeXmlAttributeValue(relsXmlText, elementStart, "Id");
    const target = safeXmlAttributeValue(relsXmlText, elementStart, "Target");
    if (id && /^worksheets\/sheet\d+\.xml$/.test(target)) {
      relationships.set(id, `xl/${target}`);
    }
  }
  return relationships;
}

function createXlsxSheetSummary(sheet_key, sheetName) {
  return {
    sheet_key,
    sheet_name: redactedName(sheetName),
    rowIndices: new Set(),
    cell_count: 0,
    formula_count: 0,
    maxColumn: 0,
    rows: new Map(),
    columnHints: new Map(),
  };
}

async function profileXlsx({ extension, declaredMime, bytes }) {
  try {
    const typeResult = detectP0FileTypeAgreement({ extension, declaredMime, bytes });
    if (typeResult.policy !== "allow") return safeFailure("xlsx", typeResult.category);
    const archiveLimitResult = await detectOoxmlArchiveResourceLimitPolicy({ extension, declaredMime, bytes });
    if (archiveLimitResult) return safeFailure("xlsx", archiveLimitResult.category);
    const sheetCellLimitResult = await detectXlsxSheetCellLimitPolicy({ extension, declaredMime, bytes });
    if (sheetCellLimitResult) return safeFailure("xlsx", sheetCellLimitResult.category);

    const entries = parseZipEntries(bytes);
    const relationshipEntry = entries.get("xl/_rels/workbook.xml.rels");
    const workbookEntry = entries.get("xl/workbook.xml");
    const workbookSheets = workbookEntry ? parseWorkbookSheets(inflateEntry(bytes, workbookEntry)) : [];
    const relationships = relationshipEntry ? parseWorkbookRelationships(inflateEntry(bytes, relationshipEntry)) : new Map();
    const discoveredWorksheetEntries = [...entries.keys()].filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort();
    const worksheetRefs = workbookSheets.length > 0
      ? workbookSheets.map((sheet, index) => Object.freeze({
        sheet_key: sheet.sheet_key,
        sheet_name: sheet.name,
        entry_name: relationships.get(sheet.relationshipId) ?? discoveredWorksheetEntries[index],
      })).filter((sheet) => typeof sheet.entry_name === "string" && entries.has(sheet.entry_name))
      : discoveredWorksheetEntries.map((entry_name, index) => Object.freeze({
        sheet_key: `sheet_${index + 1}`,
        sheet_name: "",
        entry_name,
      }));

    const sheetSummaries = [];

    for (const worksheetRef of worksheetRefs) {
      const sheetSummary = createXlsxSheetSummary(worksheetRef.sheet_key, worksheetRef.sheet_name);
      const xmlBytes = inflateEntry(bytes, entries.get(worksheetRef.entry_name));
      scanXmlElements(xmlBytes, ({ localName, attributes }) => {
        if (localName === "row") {
          const rowIndex = Number.parseInt(attributes.get("r") ?? `${sheetSummary.rowIndices.size + 1}`, 10);
          sheetSummary.rowIndices.add(Number.isSafeInteger(rowIndex) && rowIndex > 0 ? rowIndex : sheetSummary.rowIndices.size + 1);
        }
        if (localName === "f") sheetSummary.formula_count += 1;
        if (localName !== "c") return;
        sheetSummary.cell_count += 1;
        const rowIndex = extractRowIndex(attributes.get("r")) ?? (sheetSummary.rowIndices.size || 1);
        const row = sheetSummary.rows.get(rowIndex) ?? [];
        const columnIndex = cellColumnIndex(attributes.get("r")) ?? sheetSummary.cell_count;
        row[columnIndex - 1] = attributes.get("t") || "number_or_blank";
        sheetSummary.rows.set(rowIndex, row);
        sheetSummary.rowIndices.add(rowIndex);
        sheetSummary.maxColumn = Math.max(sheetSummary.maxColumn, columnIndex);
        const fieldKey = `field_${columnIndex}`;
        const type = attributes.get("t") || "number_or_blank";
        const hints = sheetSummary.columnHints.get(fieldKey) || { blank: 0, boolean: 0, number: 0, date_like: 0, text_like: 0 };
        if (type === "b") hints.boolean += 1;
        else if (type === "d") hints.date_like += 1;
        else if (["s", "str", "inlineStr", "e"].includes(type)) hints.text_like += 1;
        else hints.number += 1;
        sheetSummary.columnHints.set(fieldKey, hints);
      });
      sheetSummaries.push(sheetSummary);
    }

    const workbookFieldCount = sheetSummaries.reduce((maximum, sheet) => Math.max(maximum, sheet.maxColumn, sheet.columnHints.size), 0);
    const workbookHints = new Map();
    for (const sheet of sheetSummaries) {
      for (const [fieldKey, hints] of sheet.columnHints.entries()) {
        const aggregate = workbookHints.get(fieldKey) || { blank: 0, boolean: 0, number: 0, date_like: 0, text_like: 0 };
        for (const key of Object.keys(aggregate)) aggregate[key] += hints[key] ?? 0;
        workbookHints.set(fieldKey, aggregate);
      }
    }
    const fields = Array.from({ length: workbookFieldCount }, (_, index) => {
      const field_key = `field_${index + 1}`;
      return Object.freeze({
        field_key,
        meaning: "unknown",
        sensitivity: "unknown",
        review: "required",
        allowed_use: "internal only",
        primitive_type_hints: Object.freeze(workbookHints.get(field_key) || {
          blank: 0,
          boolean: 0,
          number: 0,
          date_like: 0,
          text_like: 0,
        }),
      });
    });
    const sheets = sheetSummaries.map((sheet) => {
      const fieldCount = Math.max(sheet.maxColumn, sheet.columnHints.size);
      const sortedRows = [...sheet.rows.entries()].sort(([a], [b]) => a - b);
      const headerTypes = sortedRows[0]?.[1] ?? [];
      const dataRows = sortedRows.slice(1);
      const rowSignatures = new Map();
      for (const [, row] of dataRows) {
        const signature = JSON.stringify(Array.from({ length: fieldCount }, (_, index) => row[index] ?? ""));
        rowSignatures.set(signature, (rowSignatures.get(signature) ?? 0) + 1);
      }
      const duplicate_row_count = [...rowSignatures.values()]
        .filter((count) => count > 1)
        .reduce((total, count) => total + count, 0);
      const headers = Array.from({ length: fieldCount }, (_, index) => Object.freeze({
        field_key: `field_${index + 1}`,
        position: index + 1,
        present: headerTypes[index] !== undefined,
        name: redactedName(headerTypes[index] ?? ""),
      }));
      const sheetFields = Array.from({ length: fieldCount }, (_, index) => {
        const field_key = `field_${index + 1}`;
        const rowsWithValue = [...sheet.rows.values()].filter((row) => row[index] !== undefined).length;
        return Object.freeze({
          field_key,
          meaning: "unknown",
          sensitivity: "unknown",
          review: "required",
          allowed_use: "internal only",
          missing_count: sheet.rowIndices.size - rowsWithValue,
          present_count: rowsWithValue,
          primitive_type_hints: Object.freeze(sheet.columnHints.get(field_key) || {
            blank: 0,
            boolean: 0,
            number: 0,
            date_like: 0,
            text_like: 0,
          }),
        });
      });
      const sample_records = dataRows.slice(0, MAX_REDACTED_SAMPLE_RECORDS).map(([rowIndex, row], sampleIndex) => Object.freeze({
        sample_index: sampleIndex,
        row_position: rowIndex,
        values: Object.freeze(Array.from({ length: fieldCount }, (_, index) => Object.freeze({
          field_key: `field_${index + 1}`,
          value: redactedValue(row[index] ?? ""),
        }))),
      }));
      return Object.freeze({
        sheet_key: sheet.sheet_key,
        sheet_name: sheet.sheet_name,
        counts: Object.freeze({
          header_count: headers.filter((headerShape) => headerShape.present).length,
          row_count: sheet.rowIndices.size,
          column_count: fieldCount,
          cell_count: sheet.cell_count,
          formula_count: sheet.formula_count,
          duplicate_row_count,
        }),
        headers: Object.freeze(headers),
        fields: Object.freeze(sheetFields),
        sample_records: Object.freeze(sample_records),
        duplicate_row_hints: Object.freeze({
          has_duplicate_rows: duplicate_row_count > 0,
          duplicate_row_count,
        }),
        draft_dictionary_fields: Object.freeze(sheetFields),
      });
    });

    return okProfile("xlsx", {
      structural_metadata: Object.freeze({
        byte_size: bytes.byteLength,
        archive_entry_count: entries.size,
        max_sheets: KAI_SPRINT2_P0_XLSX_LIMITS.maxSheets,
        max_cells: KAI_SPRINT2_P0_XLSX_LIMITS.maxCells,
      }),
      counts: Object.freeze({
        sheet_count: sheets.length,
        row_count: sheets.reduce((total, sheet) => total + sheet.counts.row_count, 0),
        column_count: workbookFieldCount,
        field_count: workbookFieldCount,
        cell_count: sheets.reduce((total, sheet) => total + sheet.counts.cell_count, 0),
        formula_count: sheets.reduce((total, sheet) => total + sheet.counts.formula_count, 0),
        duplicate_row_count: sheets.reduce((total, sheet) => total + sheet.counts.duplicate_row_count, 0),
      }),
      sheets: Object.freeze(sheets),
      fields: Object.freeze(fields),
      sample_shapes: Object.freeze([]),
      sample_records: Object.freeze(sheets.flatMap((sheet) => sheet.sample_records).slice(0, MAX_REDACTED_SAMPLE_RECORDS)),
      duplicate_row_hints: Object.freeze({
        has_duplicate_rows: sheets.some((sheet) => sheet.duplicate_row_hints.has_duplicate_rows),
        duplicate_row_count: sheets.reduce((total, sheet) => total + sheet.duplicate_row_hints.duplicate_row_count, 0),
      }),
      draft_dictionary_fields: Object.freeze(sheets.flatMap((sheet) => sheet.draft_dictionary_fields)),
      quality_findings: Object.freeze([]),
      proposals: Object.freeze({
        sensitivity: "unknown",
        allowed_use: "internal only",
      }),
    });
  } catch {
    return safeFailure("xlsx");
  }
}

function profileText({ format, extension, declaredMime, bytes }) {
  try {
    const typeResult = detectP0FileTypeAgreement({ extension, declaredMime, bytes });
    if (typeResult.policy !== "allow") return safeFailure(format, typeResult.category);
    const text = decodeTrustedUtf8(bytes);
    const splitLines = text.length === 0 ? [] : text.split(/\n/);
    const headings = [];
    if (format === "markdown") {
      splitLines.forEach((line, index) => {
        const match = /^\s*(#{1,6})\s+/.exec(line);
        if (match) {
          headings.push(Object.freeze({
            heading_key: `heading_${headings.length + 1}`,
            line_position: index + 1,
            level: match[1].length,
            text: redactedValue(line),
          }));
        }
      });
    }
    const paragraphPositions = [];
    let inParagraph = false;
    splitLines.forEach((line, index) => {
      if (line.trim().length === 0) {
        inParagraph = false;
        return;
      }
      if (!inParagraph) {
        paragraphPositions.push(index + 1);
        inParagraph = true;
      }
    });
    const date_candidates = [];
    splitLines.forEach((line, lineIndex) => {
      for (const match of line.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) {
        date_candidates.push(Object.freeze({
          candidate_key: `date_${date_candidates.length + 1}`,
          line_position: lineIndex + 1,
          character_position: match.index + 1,
          value: redactedValue(match[0]),
        }));
      }
    });
    const field_count = headings.length;
    const sample_records = splitLines.slice(0, MAX_REDACTED_SAMPLE_RECORDS).map((line, index) => Object.freeze({
      sample_index: index,
      line_position: index + 1,
      value: redactedValue(line),
    }));
    return okProfile(format, {
      structural_metadata: Object.freeze({
        byte_size: bytes.byteLength,
        encoding: "utf-8",
      }),
      counts: Object.freeze({
        line_count: splitLines.length,
        paragraph_count: paragraphPositions.length,
        heading_count: headings.length,
        date_candidate_count: date_candidates.length,
        row_count: splitLines.length,
        column_count: 0,
        field_count,
        formula_count: 0,
      }),
      headings: Object.freeze(headings),
      paragraph_positions: Object.freeze(paragraphPositions),
      date_candidates: Object.freeze(date_candidates),
      fields: Object.freeze(Array.from({ length: field_count }, (_, index) => Object.freeze({
        field_key: `field_${index + 1}`,
        meaning: "unknown",
        sensitivity: "unknown",
        review: "required",
        allowed_use: "internal only",
      }))),
      sample_shapes: Object.freeze(sample_records.map((sample) => Object.freeze({
        sample_index: sample.sample_index,
        line_position: sample.line_position,
        primitive_type_hint: sample.value.primitive_type_hint,
      }))),
      sample_records: Object.freeze(sample_records),
      draft_dictionary_fields: Object.freeze(Array.from({ length: field_count }, (_, index) => Object.freeze({
        field_key: `field_${index + 1}`,
        meaning: "unknown",
        sensitivity: "unknown",
        review: "required",
        allowed_use: "internal only",
      }))),
      quality_findings: Object.freeze([]),
      proposals: Object.freeze({
        sensitivity: "unknown",
        allowed_use: "internal only",
      }),
    });
  } catch {
    return safeFailure(format);
  }
}

function profilePdf({ extension, declaredMime, bytes }) {
  try {
    const typeResult = detectP0FileTypeAgreement({ extension, declaredMime, bytes });
    if (typeResult.policy !== "allow") return notProfilablePdf("pdf_identity_not_confirmed");
    return pdfWorkerBoundaryEnvelope();
  } catch {
    return notProfilablePdf("pdf_identity_not_confirmed");
  }
}

export async function profileLocalTrustedFile(input = {}) {
  const inputFailure = assertProfilingInput(input);
  if (inputFailure) return inputFailure;

  const extension = normalizeExtension(input.extension);
  const declaredMime = normalizeDeclaredMime(input.declaredMime);
  const bytes = input.bytes;

  if (extension === ".csv") return profileCsv({ extension, declaredMime, bytes });
  if (extension === ".xlsx" && declaredMime === XLSX_MIME) return profileXlsx({ extension, declaredMime, bytes });
  if (extension === ".md") return profileText({ format: "markdown", extension, declaredMime, bytes });
  if (extension === ".txt") return profileText({ format: "txt", extension, declaredMime, bytes });
  if (extension === ".pdf") return profilePdf({ extension, declaredMime, bytes });

  return safeFailure("unknown", "unsupported_file_type");
}
