import { detectTxtMdBytePolicy } from "./txtMdByteDetector.js";

const ASCII_WHITESPACE_BOUNDARY = /^[\t\n\f\r ]+|[\t\n\f\r ]+$/g;

const SUPPORTED_EXTENSION_MIME_PAIRINGS = Object.freeze({
  ".csv": Object.freeze(["text/csv", "application/csv"]),
  ".xlsx": Object.freeze([
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ]),
  ".md": Object.freeze(["text/markdown", "text/plain"]),
  ".txt": Object.freeze(["text/plain"]),
  ".pdf": Object.freeze(["application/pdf"]),
});

const SUPPORTED_DECLARED_MIME_VALUES = Object.freeze(new Set([
  "text/csv",
  "application/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/markdown",
  "text/plain",
  "application/pdf",
]));

const TEXT_BYTE_GATE_EXTENSIONS = Object.freeze(new Set([".csv", ".md", ".txt"]));

const DISALLOWED_SIGNATURES = Object.freeze([
  Object.freeze({
    family: "DOS/PE MZ",
    bytes: Object.freeze([0x4D, 0x5A]),
  }),
  Object.freeze({
    family: "ELF",
    bytes: Object.freeze([0x7F, 0x45, 0x4C, 0x46]),
  }),
  Object.freeze({
    family: "gzip",
    bytes: Object.freeze([0x1F, 0x8B]),
  }),
  Object.freeze({
    family: "7z",
    bytes: Object.freeze([0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C]),
  }),
  Object.freeze({
    family: "RAR 4",
    bytes: Object.freeze([0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x00]),
  }),
  Object.freeze({
    family: "RAR 5",
    bytes: Object.freeze([0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x01, 0x00]),
  }),
]);

const PDF_HEADER_BYTES = Object.freeze([0x25, 0x50, 0x44, 0x46, 0x2D]);
const PDF_HEADER_PREFIX_BYTES = Object.freeze([0x25, 0x50, 0x44, 0x46]);
const PDF_EOF_BYTES = Object.freeze([0x25, 0x25, 0x45, 0x4F, 0x46]);
const ZIP_LOCAL_FILE_HEADER_SIGNATURE_BYTES = Object.freeze([0x50, 0x4B, 0x03, 0x04]);
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_EOCD_MINIMUM_LENGTH = 22;
const ZIP_MAX_COMMENT_LENGTH = 0xffff;
const XLSX_REQUIRED_ENTRIES = Object.freeze([
  "[Content_Types].xml",
  "_rels/.rels",
  "xl/workbook.xml",
]);
const XLSX_REQUIRED_ENTRY_BYTES = Object.freeze(
  XLSX_REQUIRED_ENTRIES.map((entryName) => Object.freeze(
    Array.from(entryName, (character) => character.charCodeAt(0)),
  )),
);

function freezeResult({ policy, category, scope, evidence }) {
  return Object.freeze({
    policy,
    category,
    scope,
    evidence: Object.freeze(evidence),
  });
}

function normalizeDeclaredMime(declaredMime) {
  const trimmed = declaredMime.replace(ASCII_WHITESPACE_BOUNDARY, "");
  const parameterStart = trimmed.indexOf(";");

  if (parameterStart === -1) {
    return trimmed.toLowerCase();
  }

  return `${trimmed.slice(0, parameterStart).toLowerCase()}${trimmed.slice(parameterStart)}`;
}

function hasOffsetZeroSignature(bytes, signatureBytes) {
  if (bytes.byteLength < signatureBytes.length) return false;

  for (let index = 0; index < signatureBytes.length; index += 1) {
    if (bytes[index] !== signatureBytes[index]) return false;
  }

  return true;
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

function hasByteSequenceAt(bytes, offset, sequenceBytes) {
  if (offset < 0 || offset + sequenceBytes.length > bytes.byteLength) return false;

  for (let index = 0; index < sequenceBytes.length; index += 1) {
    if (bytes[offset + index] !== sequenceBytes[index]) return false;
  }

  return true;
}

function includesByteSequenceInRange(bytes, start, endExclusive, sequenceBytes) {
  const finalStart = endExclusive - sequenceBytes.length;
  for (let offset = start; offset <= finalStart; offset += 1) {
    if (hasByteSequenceAt(bytes, offset, sequenceBytes)) return true;
  }

  return false;
}

function findByteSequence(bytes, sequenceBytes, start = 0) {
  const finalStart = bytes.byteLength - sequenceBytes.length;
  for (let offset = start; offset <= finalStart; offset += 1) {
    if (hasByteSequenceAt(bytes, offset, sequenceBytes)) return offset;
  }

  return -1;
}

function recognizedDisallowedSignature(bytes) {
  return DISALLOWED_SIGNATURES.find((signature) => hasOffsetZeroSignature(bytes, signature.bytes));
}

function unsupportedSignal({ normalizedExtension, normalizedDeclaredMime }) {
  const extensionSupported = Object.hasOwn(SUPPORTED_EXTENSION_MIME_PAIRINGS, normalizedExtension);
  const declaredMimeSupported = SUPPORTED_DECLARED_MIME_VALUES.has(normalizedDeclaredMime);

  if (!extensionSupported && !declaredMimeSupported) return "extension_and_declared_mime";
  if (!extensionSupported) return "extension";
  if (!declaredMimeSupported) return "declared_mime";
  return null;
}

function metadataPairing(normalizedExtension, normalizedDeclaredMime) {
  return `${normalizedExtension} + ${normalizedDeclaredMime}`;
}

function metadataType(normalizedExtension, normalizedDeclaredMime) {
  if (normalizedExtension === ".pdf" && normalizedDeclaredMime === "application/pdf") return "pdf";
  if (
    normalizedExtension === ".xlsx" &&
    normalizedDeclaredMime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return "xlsx";
  }
  return null;
}

function hasCompletePdfIdentity(bytes) {
  if (!hasByteSequenceAt(bytes, 0, PDF_HEADER_BYTES)) return false;

  const searchStart = Math.max(0, bytes.byteLength - 1024);
  return includesByteSequenceInRange(bytes, searchStart, bytes.byteLength, PDF_EOF_BYTES);
}

function hasIncompletePdfIdentity(bytes) {
  const nonZeroHeaderOffset = findByteSequence(bytes, PDF_HEADER_BYTES, 1);
  if (nonZeroHeaderOffset !== -1) return true;

  if (hasByteSequenceAt(bytes, 0, PDF_HEADER_PREFIX_BYTES)) {
    if (bytes.byteLength < PDF_HEADER_BYTES.length || bytes[4] !== 0x2D) return true;
  }

  if (!hasByteSequenceAt(bytes, 0, PDF_HEADER_BYTES)) return false;

  const eofOffset = findByteSequence(bytes, PDF_EOF_BYTES);
  if (eofOffset === -1) return true;

  const searchStart = Math.max(0, bytes.byteLength - 1024);
  return !includesByteSequenceInRange(bytes, searchStart, bytes.byteLength, PDF_EOF_BYTES);
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

function hasExactByteSequence(bytes, offset, length, sequenceBytes) {
  if (length !== sequenceBytes.length) return false;

  return hasByteSequenceAt(bytes, offset, sequenceBytes);
}

function hasTruncatedZipLocalFileHeaderSignature(bytes) {
  if (bytes.byteLength === 0 || bytes.byteLength >= ZIP_LOCAL_FILE_HEADER_SIGNATURE_BYTES.length) return false;

  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (bytes[index] !== ZIP_LOCAL_FILE_HEADER_SIGNATURE_BYTES[index]) return false;
  }

  return true;
}

function classifyZipStructure(bytes) {
  if (hasTruncatedZipLocalFileHeaderSignature(bytes)) return "malformed_or_truncated_zip_xlsx";
  if (bytes.byteLength < 4 || readUint32LE(bytes, 0) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) return "no_zip_signal";

  const eocdOffset = findZipEocdOffset(bytes);
  if (eocdOffset === -1) return "malformed_or_truncated_zip_xlsx";

  const diskNumber = readUint16LE(bytes, eocdOffset + 4);
  const centralDirectoryDisk = readUint16LE(bytes, eocdOffset + 6);
  const diskEntryCount = readUint16LE(bytes, eocdOffset + 8);
  const totalEntryCount = readUint16LE(bytes, eocdOffset + 10);
  const centralDirectoryLength = readUint32LE(bytes, eocdOffset + 12);
  const centralDirectoryOffset = readUint32LE(bytes, eocdOffset + 16);

  if (diskNumber !== 0 || centralDirectoryDisk !== 0) return "malformed_or_truncated_zip_xlsx";
  if (diskEntryCount !== totalEntryCount) return "malformed_or_truncated_zip_xlsx";
  if (centralDirectoryOffset > bytes.byteLength) return "malformed_or_truncated_zip_xlsx";
  if (centralDirectoryLength > bytes.byteLength - centralDirectoryOffset) return "malformed_or_truncated_zip_xlsx";
  if (centralDirectoryOffset + centralDirectoryLength !== eocdOffset) return "malformed_or_truncated_zip_xlsx";

  const requiredEntriesPresent = new Array(XLSX_REQUIRED_ENTRY_BYTES.length).fill(false);
  let recordOffset = centralDirectoryOffset;
  let parsedRecordCount = 0;

  while (recordOffset < eocdOffset) {
    if (eocdOffset - recordOffset < 46) return "malformed_or_truncated_zip_xlsx";
    if (readUint32LE(bytes, recordOffset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      return "malformed_or_truncated_zip_xlsx";
    }

    const fileNameLength = readUint16LE(bytes, recordOffset + 28);
    const extraFieldLength = readUint16LE(bytes, recordOffset + 30);
    const fileCommentLength = readUint16LE(bytes, recordOffset + 32);
    const localHeaderOffset = readUint32LE(bytes, recordOffset + 42);
    const fileNameOffset = recordOffset + 46;
    const recordLength = 46 + fileNameLength + extraFieldLength + fileCommentLength;

    if (recordLength > eocdOffset - recordOffset) return "malformed_or_truncated_zip_xlsx";
    if (localHeaderOffset > bytes.byteLength - 4) return "malformed_or_truncated_zip_xlsx";
    if (readUint32LE(bytes, localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
      return "malformed_or_truncated_zip_xlsx";
    }

    for (let requiredIndex = 0; requiredIndex < XLSX_REQUIRED_ENTRY_BYTES.length; requiredIndex += 1) {
      if (hasExactByteSequence(bytes, fileNameOffset, fileNameLength, XLSX_REQUIRED_ENTRY_BYTES[requiredIndex])) {
        requiredEntriesPresent[requiredIndex] = true;
      }
    }

    recordOffset += recordLength;
    parsedRecordCount += 1;
  }

  if (recordOffset !== centralDirectoryOffset + centralDirectoryLength) return "malformed_or_truncated_zip_xlsx";
  if (parsedRecordCount !== totalEntryCount) return "malformed_or_truncated_zip_xlsx";

  if (requiredEntriesPresent.every(Boolean)) return "complete_xlsx_shallow_identity";
  return "readable_non_xlsx_zip";
}

function detectCompletePermittedTypes({ pdfClassification, zipClassification }) {
  const detectedPermittedTypes = [];

  if (pdfClassification === "complete_pdf_shallow_identity") detectedPermittedTypes.push("pdf");
  if (zipClassification === "complete_xlsx_shallow_identity") detectedPermittedTypes.push("xlsx");

  return Object.freeze(detectedPermittedTypes);
}

function textByteGateResult({ normalizedExtension, normalizedDeclaredMime, bytes }) {
  const textGateResult = detectTxtMdBytePolicy(bytes);
  const text_gate_category = textGateResult.expected_category;
  const text_gate_scope = textGateResult.expected_policy === "allow"
    ? "encoding_gate_pass_only"
    : "encoding_binary_gate_block_only";

  if (textGateResult.expected_policy === "allow") {
    return freezeResult({
      policy: "allow",
      category: "type_agreement_pass",
      scope: "type_agreement_pass_only",
      evidence: {
        normalized_extension: normalizedExtension,
        normalized_declared_mime: normalizedDeclaredMime,
        text_gate_category,
        text_gate_scope,
        evaluation_step: 7,
      },
    });
  }

  return freezeResult({
    policy: "block",
    category: text_gate_category,
    scope: "encoding_binary_gate_block_only",
    evidence: {
      normalized_extension: normalizedExtension,
      normalized_declared_mime: normalizedDeclaredMime,
      text_gate_category,
      text_gate_scope,
      evaluation_step: 7,
    },
  });
}

export function detectP0FileTypeAgreement({ extension, declaredMime, bytes } = {}) {
  if (typeof extension !== "string") {
    throw new TypeError("detectP0FileTypeAgreement requires extension as a string.");
  }

  if (typeof declaredMime !== "string") {
    throw new TypeError("detectP0FileTypeAgreement requires declaredMime as a string.");
  }

  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("detectP0FileTypeAgreement requires bytes as a Uint8Array.");
  }

  const normalizedExtension = extension.toLowerCase();
  const normalizedDeclaredMime = normalizeDeclaredMime(declaredMime);

  const disallowedSignature = recognizedDisallowedSignature(bytes);
  if (disallowedSignature) {
    return freezeResult({
      policy: "block",
      category: "disallowed_binary_signature",
      scope: "type_agreement_block_only",
      evidence: {
        evaluation_step: 1,
        recognized_signature_family: disallowedSignature.family,
        recognized_signature_offset: 0,
      },
    });
  }

  const unsupported = unsupportedSignal({
    normalizedExtension,
    normalizedDeclaredMime,
  });

  if (unsupported) {
    return freezeResult({
      policy: "block",
      category: "unsupported_file_type",
      scope: "unsupported_metadata_block_only",
      evidence: {
        evaluation_step: 2,
        normalized_extension: normalizedExtension,
        normalized_declared_mime: normalizedDeclaredMime,
        unsupported_signal: unsupported,
      },
    });
  }

  const allowedDeclaredMimes = SUPPORTED_EXTENSION_MIME_PAIRINGS[normalizedExtension];
  if (!allowedDeclaredMimes.includes(normalizedDeclaredMime)) {
    return freezeResult({
      policy: "block",
      category: "declared_type_mismatch",
      scope: "type_agreement_block_only",
      evidence: {
        evaluation_step: 3,
        normalized_extension: normalizedExtension,
        normalized_declared_mime: normalizedDeclaredMime,
        metadata_pairing: metadataPairing(normalizedExtension, normalizedDeclaredMime),
      },
    });
  }

  const pdfClassification = hasCompletePdfIdentity(bytes)
    ? "complete_pdf_shallow_identity"
    : "no_pdf_signal";
  const zipClassification = classifyZipStructure(bytes);
  const detectedPermittedTypes = detectCompletePermittedTypes({
    pdfClassification,
    zipClassification,
  });
  const detectedPermittedType = detectedPermittedTypes.length === 1
    ? detectedPermittedTypes[0]
    : null;
  const declaredMetadataType = metadataType(normalizedExtension, normalizedDeclaredMime);

  if (detectedPermittedType && detectedPermittedType !== declaredMetadataType) {
    return freezeResult({
      policy: "block",
      category: "declared_type_mismatch",
      scope: "detected_permitted_type_contradiction_only",
      evidence: {
        normalized_extension: normalizedExtension,
        normalized_declared_mime: normalizedDeclaredMime,
        metadata_pairing: metadataPairing(normalizedExtension, normalizedDeclaredMime),
        detected_permitted_type: detectedPermittedType,
        evaluation_step: 4,
      },
    });
  }

  if (detectedPermittedType === "pdf" && declaredMetadataType === "pdf") {
    return freezeResult({
      policy: "allow",
      category: "type_agreement_pass",
      scope: "type_agreement_pass_only",
      evidence: {
        normalized_extension: normalizedExtension,
        normalized_declared_mime: normalizedDeclaredMime,
        pdf_classification: "complete_pdf_shallow_identity",
        evaluation_step: 4,
      },
    });
  }

  if (detectedPermittedType === "xlsx" && declaredMetadataType === "xlsx") {
    return freezeResult({
      policy: "allow",
      category: "type_agreement_pass",
      scope: "type_agreement_pass_only",
      evidence: {
        normalized_extension: normalizedExtension,
        normalized_declared_mime: normalizedDeclaredMime,
        zip_classification: "complete_xlsx_shallow_identity",
        evaluation_step: 4,
      },
    });
  }

  if (zipClassification === "readable_non_xlsx_zip") {
    return freezeResult({
      policy: "block",
      category: "standalone_archive_or_non_xlsx",
      scope: "standalone_archive_or_non_xlsx_block_only",
      evidence: {
        normalized_extension: normalizedExtension,
        normalized_declared_mime: normalizedDeclaredMime,
        zip_classification: "readable_non_xlsx_zip",
        evaluation_step: 5,
      },
    });
  }

  if (zipClassification === "malformed_or_truncated_zip_xlsx") {
    return freezeResult({
      policy: "block",
      category: "truncated_or_malformed_type",
      scope: "truncated_or_malformed_type_block_only",
      evidence: {
        normalized_extension: normalizedExtension,
        normalized_declared_mime: normalizedDeclaredMime,
        zip_classification: "malformed_or_truncated_zip_xlsx",
        evaluation_step: 5,
      },
    });
  }

  if (
    normalizedExtension === ".pdf" &&
    normalizedDeclaredMime === "application/pdf" &&
    hasIncompletePdfIdentity(bytes)
  ) {
    return freezeResult({
      policy: "block",
      category: "truncated_or_malformed_type",
      scope: "pdf_shallow_identity_block_only",
      evidence: {
        normalized_extension: normalizedExtension,
        normalized_declared_mime: normalizedDeclaredMime,
        pdf_classification: "incomplete_pdf_shallow_identity",
        evaluation_step: 6,
      },
    });
  }

  if (TEXT_BYTE_GATE_EXTENSIONS.has(normalizedExtension)) {
    return textByteGateResult({
      normalizedExtension,
      normalizedDeclaredMime,
      bytes,
    });
  }

  if (detectedPermittedTypes.length > 1) {
    return freezeResult({
      policy: "block",
      category: "ambiguous_file_type",
      scope: "ambiguous_file_type_block_only",
      evidence: {
        normalized_extension: normalizedExtension,
        normalized_declared_mime: normalizedDeclaredMime,
        evaluation_step: 8,
      },
    });
  }

  return freezeResult({
    policy: "block",
    category: "unknown_binary",
    scope: "unknown_binary_block_only",
    evidence: {
      normalized_extension: normalizedExtension,
      normalized_declared_mime: normalizedDeclaredMime,
      evaluation_step: 9,
    },
  });
}
