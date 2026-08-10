import { once } from "node:events";
import { createInflateRaw } from "node:zlib";

import { KAI_SPRINT2_P0_ARCHIVE_LIMITS } from "../config/kaiSprint2P0Contract.js";
import { detectXlsxMacroExternalRelationshipPolicy } from "./xlsxMacroExternalRelationshipDetector.js";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_EOCD_MINIMUM_LENGTH = 22;
const ZIP_MAX_COMMENT_LENGTH = 0xffff;
const ZIP_CHUNK_SIZE = 16 * 1024;

const ARCHIVE_ENTRY_LIMIT_EXCEEDED_RESULT = Object.freeze({
  policy: "block",
  category: "archive_entry_limit_exceeded",
});

const ARCHIVE_EXPANDED_SIZE_LIMIT_EXCEEDED_RESULT = Object.freeze({
  policy: "block",
  category: "archive_expanded_size_limit_exceeded",
});

const ARCHIVE_COMPRESSION_RATIO_LIMIT_EXCEEDED_RESULT = Object.freeze({
  policy: "block",
  category: "archive_compression_ratio_limit_exceeded",
});

class ArchiveLimitExceeded extends Error {
  constructor(kind) {
    super("OOXML archive resource limit exceeded.");
    this.kind = kind;
  }
}

function sanitizedArchiveResourceFailure() {
  return new Error("OOXML archive resource limit inspection failed.");
}

function failArchiveInspection() {
  throw sanitizedArchiveResourceFailure();
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

function parseZipCentralDirectoryEntries(bytes) {
  const eocdOffset = findZipEocdOffset(bytes);
  if (eocdOffset === -1) failArchiveInspection();

  const diskNumber = readUint16LE(bytes, eocdOffset + 4);
  const centralDirectoryDisk = readUint16LE(bytes, eocdOffset + 6);
  const diskEntryCount = readUint16LE(bytes, eocdOffset + 8);
  const totalEntryCount = readUint16LE(bytes, eocdOffset + 10);
  const centralDirectoryLength = readUint32LE(bytes, eocdOffset + 12);
  const centralDirectoryOffset = readUint32LE(bytes, eocdOffset + 16);

  if (diskNumber !== 0 || centralDirectoryDisk !== 0) failArchiveInspection();
  if (diskEntryCount !== totalEntryCount) failArchiveInspection();
  if (centralDirectoryOffset > bytes.byteLength) failArchiveInspection();
  if (centralDirectoryLength > bytes.byteLength - centralDirectoryOffset) failArchiveInspection();
  if (centralDirectoryOffset + centralDirectoryLength !== eocdOffset) failArchiveInspection();

  const entries = [];
  let recordOffset = centralDirectoryOffset;
  let parsedRecordCount = 0;

  while (recordOffset < eocdOffset) {
    if (eocdOffset - recordOffset < 46) failArchiveInspection();
    if (readUint32LE(bytes, recordOffset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) failArchiveInspection();

    const generalPurposeFlag = readUint16LE(bytes, recordOffset + 8);
    const compressionMethod = readUint16LE(bytes, recordOffset + 10);
    const compressedSize = readUint32LE(bytes, recordOffset + 20);
    const uncompressedSize = readUint32LE(bytes, recordOffset + 24);
    const fileNameLength = readUint16LE(bytes, recordOffset + 28);
    const extraFieldLength = readUint16LE(bytes, recordOffset + 30);
    const fileCommentLength = readUint16LE(bytes, recordOffset + 32);
    const localHeaderOffset = readUint32LE(bytes, recordOffset + 42);
    const recordLength = 46 + fileNameLength + extraFieldLength + fileCommentLength;

    if (recordLength > eocdOffset - recordOffset) failArchiveInspection();
    parsedRecordCount += 1;
    if (parsedRecordCount > KAI_SPRINT2_P0_ARCHIVE_LIMITS.maxEntries) {
      throw new ArchiveLimitExceeded("entry");
    }
    if (localHeaderOffset > bytes.byteLength - 4) failArchiveInspection();
    if (generalPurposeFlag & 0x1) failArchiveInspection();
    if (generalPurposeFlag & 0x8) failArchiveInspection();
    if (![0, 8].includes(compressionMethod)) failArchiveInspection();

    entries.push(Object.freeze({
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    }));

    recordOffset += recordLength;
  }

  if (recordOffset !== centralDirectoryOffset + centralDirectoryLength) failArchiveInspection();
  if (parsedRecordCount !== totalEntryCount) failArchiveInspection();

  return Object.freeze(entries);
}

function getLocalEntryDataBounds(bytes, entry) {
  const offset = entry.localHeaderOffset;
  if (offset > bytes.byteLength - 30) failArchiveInspection();
  if (readUint32LE(bytes, offset) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) failArchiveInspection();

  const localGeneralPurposeFlag = readUint16LE(bytes, offset + 6);
  const localCompressionMethod = readUint16LE(bytes, offset + 8);
  const localCompressedSize = readUint32LE(bytes, offset + 18);
  const localUncompressedSize = readUint32LE(bytes, offset + 22);
  const fileNameLength = readUint16LE(bytes, offset + 26);
  const extraFieldLength = readUint16LE(bytes, offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraFieldLength;

  if (localGeneralPurposeFlag & 0x1) failArchiveInspection();
  if (localGeneralPurposeFlag & 0x8) failArchiveInspection();
  if (localCompressionMethod !== entry.compressionMethod) failArchiveInspection();
  if (localCompressedSize !== entry.compressedSize) failArchiveInspection();
  if (localUncompressedSize !== entry.uncompressedSize) failArchiveInspection();
  if (dataStart > bytes.byteLength) failArchiveInspection();
  if (entry.compressedSize > bytes.byteLength - dataStart) failArchiveInspection();

  return Object.freeze({
    start: dataStart,
    end: dataStart + entry.compressedSize,
  });
}

function compressionRatioExceeded(expandedBytes, compressedBytes) {
  if (expandedBytes === 0) return false;
  if (compressedBytes === 0) return true;
  return expandedBytes > compressedBytes * KAI_SPRINT2_P0_ARCHIVE_LIMITS.maxCompressionRatio;
}

function checkExpandedBudget({ totals, entryTotals, emittedBytes }) {
  const maximum = KAI_SPRINT2_P0_ARCHIVE_LIMITS.maxExpandedBytes;
  if (totals.expandedBytes + emittedBytes <= maximum) {
    totals.expandedBytes += emittedBytes;
    entryTotals.expandedBytes += emittedBytes;
    return false;
  }

  const countedBytes = maximum + 1 - totals.expandedBytes;
  totals.expandedBytes = maximum + 1;
  entryTotals.expandedBytes += countedBytes;
  return true;
}

function finishMeasuredEntry(entry, entryTotals, totals) {
  if (entryTotals.expandedBytes !== entry.uncompressedSize) failArchiveInspection();
  if (compressionRatioExceeded(entryTotals.expandedBytes, entryTotals.compressedBytes)) {
    throw new ArchiveLimitExceeded("ratio");
  }
  if (compressionRatioExceeded(totals.expandedBytes, totals.compressedBytes)) {
    throw new ArchiveLimitExceeded("ratio");
  }
}

async function measureStoredEntry({ bytes, bounds, entry, totals }) {
  const entryTotals = {
    expandedBytes: 0,
    compressedBytes: bounds.end - bounds.start,
  };
  totals.compressedBytes += entryTotals.compressedBytes;

  for (let offset = bounds.start; offset < bounds.end; offset += ZIP_CHUNK_SIZE) {
    const emittedBytes = Math.min(ZIP_CHUNK_SIZE, bounds.end - offset);
    if (checkExpandedBudget({ totals, entryTotals, emittedBytes })) {
      throw new ArchiveLimitExceeded("expanded");
    }
  }

  finishMeasuredEntry(entry, entryTotals, totals);
}

async function measureDeflatedEntry({ bytes, bounds, entry, totals }) {
  const inflater = createInflateRaw();
  const entryTotals = {
    expandedBytes: 0,
    compressedBytes: 0,
  };
  let closed = false;
  let streamError = null;
  let limitKind = null;

  const done = new Promise((resolve) => {
    inflater.on("end", resolve);
    inflater.on("close", () => {
      closed = true;
      resolve();
    });
    inflater.on("error", (error) => {
      streamError = error;
      resolve();
    });
  });

  inflater.on("data", (chunk) => {
    if (limitKind) return;
    if (checkExpandedBudget({ totals, entryTotals, emittedBytes: chunk.byteLength })) {
      limitKind = "expanded";
      inflater.destroy();
    }
  });

  for (let offset = bounds.start; offset < bounds.end; offset += ZIP_CHUNK_SIZE) {
    if (limitKind) break;

    const chunkLength = Math.min(ZIP_CHUNK_SIZE, bounds.end - offset);
    const chunk = Buffer.from(bytes.buffer, bytes.byteOffset + offset, chunkLength);
    entryTotals.compressedBytes += chunkLength;
    totals.compressedBytes += chunkLength;

    const accepted = inflater.write(chunk);
    if (!accepted && !limitKind && !closed) {
      await Promise.race([once(inflater, "drain"), done]);
    }
  }

  if (!limitKind) inflater.end();
  await done;

  if (limitKind === "expanded") throw new ArchiveLimitExceeded("expanded");
  if (streamError) failArchiveInspection();
  if (entryTotals.compressedBytes !== entry.compressedSize) failArchiveInspection();

  finishMeasuredEntry(entry, entryTotals, totals);
}

async function measureArchiveResources(bytes, entries) {
  const totals = {
    expandedBytes: 0,
    compressedBytes: 0,
  };

  for (const entry of entries) {
    if (entry.uncompressedSize > 0 && entry.compressedSize === 0) {
      throw new ArchiveLimitExceeded("ratio");
    }

    const bounds = getLocalEntryDataBounds(bytes, entry);
    if (entry.compressionMethod === 0) {
      await measureStoredEntry({ bytes, bounds, entry, totals });
      continue;
    }
    if (entry.compressionMethod === 8) {
      await measureDeflatedEntry({ bytes, bounds, entry, totals });
      continue;
    }

    failArchiveInspection();
  }
}

async function assertPriorXlsxMacroExternalNoBlock(input) {
  const result = await detectXlsxMacroExternalRelationshipPolicy(input);
  if (result !== undefined) return result;
  return undefined;
}

export async function detectOoxmlArchiveResourceLimitPolicy({ extension, declaredMime, bytes } = {}) {
  if (typeof extension !== "string") throw sanitizedArchiveResourceFailure();
  if (typeof declaredMime !== "string") throw sanitizedArchiveResourceFailure();
  if (!(bytes instanceof Uint8Array)) throw sanitizedArchiveResourceFailure();
  if (extension.toLowerCase() !== ".xlsx" || declaredMime !== XLSX_MIME) {
    throw sanitizedArchiveResourceFailure();
  }

  let priorResult;
  try {
    priorResult = await assertPriorXlsxMacroExternalNoBlock({ extension, declaredMime, bytes });
  } catch {
    throw sanitizedArchiveResourceFailure();
  }
  if (priorResult !== undefined) return priorResult;

  try {
    const entries = parseZipCentralDirectoryEntries(bytes);
    await measureArchiveResources(bytes, entries);
  } catch (error) {
    if (error instanceof ArchiveLimitExceeded) {
      if (error.kind === "entry") return ARCHIVE_ENTRY_LIMIT_EXCEEDED_RESULT;
      if (error.kind === "expanded") return ARCHIVE_EXPANDED_SIZE_LIMIT_EXCEEDED_RESULT;
      if (error.kind === "ratio") return ARCHIVE_COMPRESSION_RATIO_LIMIT_EXCEEDED_RESULT;
    }
    throw sanitizedArchiveResourceFailure();
  }

  return undefined;
}

export const __testables = Object.freeze({
  parseZipCentralDirectoryEntries,
  sanitizedArchiveResourceFailure,
});
