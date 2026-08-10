import test from "node:test";
import assert from "node:assert/strict";

import { detectP0FileTypeAgreement } from "../Backend/kai/validators/p0FileTypeAgreementDetector.js";
import {
  DETECTED_PERMITTED_TYPE_CONTRADICTION_FIXTURES,
} from "./support/kaiSprint2DetectedPermittedTypeContradictionFixtureCorpus.js";
import {
  EXTENSION_MIME_MATRIX_FIXTURES,
} from "./support/kaiSprint2ExtensionMimeMatrixFixtureCorpus.js";
import {
  PDF_SHALLOW_IDENTITY_FIXTURES,
} from "./support/kaiSprint2PdfShallowIdentityFixtureCorpus.js";
import {
  RECOGNIZED_DISALLOWED_SIGNATURE_FIXTURES,
} from "./support/kaiSprint2RecognizedDisallowedSignatureFixtureCorpus.js";
import {
  RESIDUAL_UNKNOWN_BINARY_FIXTURES,
} from "./support/kaiSprint2ResidualUnknownBinaryFixtureCorpus.js";
import {
  TEXT_TYPE_AGREEMENT_FIXTURES,
  bytesFromHex,
} from "./support/kaiSprint2TextTypeAgreementFixtureCorpus.js";
import {
  TXT_MD_BYTE_FIXTURES,
  bytesFromHex as txtMdBytesFromHex,
} from "./support/kaiSprint2TxtMdByteFixtureCorpus.js";
import {
  UNSUPPORTED_EXTENSION_MIME_FIXTURES,
} from "./support/kaiSprint2UnsupportedExtensionMimeFixtureCorpus.js";
import {
  XLSX_ZIP_FIXTURES,
} from "./support/kaiSprint2XlsxZipFixtureCorpus.js";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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

function asciiNameBytes(name) {
  return new Uint8Array(Array.from(name, (character) => character.charCodeAt(0)));
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

function createStoredEntryLocalHeader(nameBytes, localHeaderOffset) {
  const header = new Uint8Array(30 + nameBytes.byteLength);
  writeUint32LE(header, 0, 0x04034b50);
  writeUint16LE(header, 4, 20);
  writeUint16LE(header, 6, 0);
  writeUint16LE(header, 8, 0);
  writeUint16LE(header, 10, 0);
  writeUint16LE(header, 12, 0);
  writeUint32LE(header, 14, 0);
  writeUint32LE(header, 18, 0);
  writeUint32LE(header, 22, 0);
  writeUint16LE(header, 26, nameBytes.byteLength);
  writeUint16LE(header, 28, 0);
  header.set(nameBytes, 30);

  return Object.freeze({ bytes: header, nameBytes, localHeaderOffset });
}

function createStoredEntryCentralDirectoryRecord(localHeader) {
  const record = new Uint8Array(46 + localHeader.nameBytes.byteLength);
  writeUint32LE(record, 0, 0x02014b50);
  writeUint16LE(record, 4, 20);
  writeUint16LE(record, 6, 20);
  writeUint16LE(record, 8, 0);
  writeUint16LE(record, 10, 0);
  writeUint16LE(record, 12, 0);
  writeUint16LE(record, 14, 0);
  writeUint32LE(record, 16, 0);
  writeUint32LE(record, 20, 0);
  writeUint32LE(record, 24, 0);
  writeUint16LE(record, 28, localHeader.nameBytes.byteLength);
  writeUint16LE(record, 30, 0);
  writeUint16LE(record, 32, 0);
  writeUint16LE(record, 34, 0);
  writeUint16LE(record, 36, 0);
  writeUint32LE(record, 38, 0);
  writeUint32LE(record, 42, localHeader.localHeaderOffset);
  record.set(localHeader.nameBytes, 46);

  return record;
}

function createEndOfCentralDirectory(entryCount, centralDirectoryLength, centralDirectoryOffset) {
  const record = new Uint8Array(22);
  writeUint32LE(record, 0, 0x06054b50);
  writeUint16LE(record, 4, 0);
  writeUint16LE(record, 6, 0);
  writeUint16LE(record, 8, entryCount);
  writeUint16LE(record, 10, entryCount);
  writeUint32LE(record, 12, centralDirectoryLength);
  writeUint32LE(record, 16, centralDirectoryOffset);
  writeUint16LE(record, 20, 0);

  return record;
}

function createRawNameStoredZip(entryNameBytes) {
  const localHeaders = [];
  const localBytes = [];
  let localHeaderOffset = 0;

  for (const nameBytes of entryNameBytes) {
    const localHeader = createStoredEntryLocalHeader(nameBytes, localHeaderOffset);
    localHeaders.push(localHeader);
    localBytes.push(localHeader.bytes);
    localHeaderOffset += localHeader.bytes.byteLength;
  }

  const centralDirectoryOffset = localHeaderOffset;
  const centralDirectoryBytes = localHeaders.map((localHeader) =>
    createStoredEntryCentralDirectoryRecord(localHeader));
  const centralDirectoryLength = centralDirectoryBytes.reduce((sum, record) => sum + record.byteLength, 0);
  const eocd = createEndOfCentralDirectory(
    entryNameBytes.length,
    centralDirectoryLength,
    centralDirectoryOffset,
  );

  return concatBytes([...localBytes, ...centralDirectoryBytes, eocd]);
}

const stepThreeMismatchFixtures = Object.freeze([
  ...EXTENSION_MIME_MATRIX_FIXTURES.filter(
    (fixture) => fixture.expected_category === "declared_type_mismatch",
  ),
  ...TEXT_TYPE_AGREEMENT_FIXTURES
    .filter((fixture) => fixture.expected_category === "declared_type_mismatch")
    .map((fixture) => Object.freeze({
      ...fixture,
      bytes: bytesFromHex(fixture.bytes_hex),
    })),
]);

const completePdfFixture = PDF_SHALLOW_IDENTITY_FIXTURES.find(
  (fixture) => fixture.fixture_id === "PDFIDENT-P0-05F-001-ALLOW-MINIMUM-PDF",
);
const incompletePdfFixtures = PDF_SHALLOW_IDENTITY_FIXTURES.filter(
  (fixture) => fixture.expected_category === "truncated_or_malformed_type",
);
const completeXlsxFixture = XLSX_ZIP_FIXTURES.find(
  (fixture) => fixture.fixture_id === "XLSXZIP-P0-05F-001-ALLOW-MINIMUM-XLSX",
);
const readableNonXlsxZipFixtures = XLSX_ZIP_FIXTURES.filter(
  (fixture) => fixture.expected_category === "standalone_archive_or_non_xlsx",
);
const malformedOrTruncatedZipFixtures = XLSX_ZIP_FIXTURES.filter(
  (fixture) => fixture.expected_category === "truncated_or_malformed_type",
);
const unrelatedNonAsciiEntryNameBytes = new Uint8Array([
  0x75, 0x6e, 0x72, 0x65, 0x6c, 0x61, 0x74, 0x65, 0x64, 0x2f, 0x80, 0x2e, 0x62, 0x69, 0x6e,
]);
const textMetadataPdfContradictionFixture = DETECTED_PERMITTED_TYPE_CONTRADICTION_FIXTURES.find(
  (fixture) => fixture.detected_type === "pdf",
);
const textMetadataXlsxContradictionFixture = DETECTED_PERMITTED_TYPE_CONTRADICTION_FIXTURES.find(
  (fixture) => fixture.detected_type === "xlsx",
);
const txtMdAllowAsciiFixture = TXT_MD_BYTE_FIXTURES.find(
  (fixture) => fixture.fixture_id === "TXTMD-P0-05D-001-ALLOW-ASCII",
);
const txtMdIsolatedContinuationFixture = TXT_MD_BYTE_FIXTURES.find(
  (fixture) => fixture.fixture_id === "TXTMD-P0-05D-012-BLOCK-ISOLATED-CONTINUATION",
);

function callDetector(fixture) {
  return detectP0FileTypeAgreement({
    extension: fixture.extension === null ? "" : fixture.extension,
    declaredMime: fixture.declared_mime,
    bytes: fixture.bytes,
  });
}

function assertFrozenResult(result, fixtureId) {
  assert.equal(Object.isFrozen(result), true, fixtureId);
  assert.equal(Object.isFrozen(result.evidence), true, fixtureId);
  assert.deepEqual(Object.keys(result), ["policy", "category", "scope", "evidence"], fixtureId);
  assert.equal(JSON.stringify(result).includes("not_implemented"), false, fixtureId);
  assert.equal(JSON.stringify(result).includes("steps_8_through_9_not_implemented"), false, fixtureId);
}

function assertBytesUnchanged(bytes, before, fixtureId) {
  assert.deepEqual(Array.from(bytes), before, fixtureId);
}

function assertUnsupportedEvidence(result, fixture) {
  assert.deepEqual(
    Object.keys(result.evidence),
    [
      "evaluation_step",
      "normalized_extension",
      "normalized_declared_mime",
      "unsupported_signal",
    ],
    fixture.fixture_id,
  );
  assert.equal(result.evidence.evaluation_step, 2, fixture.fixture_id);
  assert.equal(result.evidence.normalized_extension, fixture.normalized_extension ?? "", fixture.fixture_id);
  assert.equal(result.evidence.normalized_declared_mime, fixture.normalized_declared_mime, fixture.fixture_id);
  assert.equal(result.evidence.unsupported_signal, fixture.unsupported_signal, fixture.fixture_id);
}

function assertMismatchEvidence(result, fixture) {
  assert.deepEqual(
    Object.keys(result.evidence),
    [
      "evaluation_step",
      "normalized_extension",
      "normalized_declared_mime",
      "metadata_pairing",
    ],
    fixture.fixture_id,
  );
  assert.equal(result.evidence.evaluation_step, 3, fixture.fixture_id);
  assert.equal(result.evidence.normalized_extension, fixture.normalized_extension, fixture.fixture_id);
  assert.equal(result.evidence.normalized_declared_mime, fixture.normalized_declared_mime, fixture.fixture_id);
  assert.equal(
    result.evidence.metadata_pairing,
    `${fixture.normalized_extension} + ${fixture.normalized_declared_mime}`,
    fixture.fixture_id,
  );
}

function assertDisallowedSignatureEvidence(result, fixture) {
  assert.deepEqual(
    Object.keys(result.evidence),
    [
      "evaluation_step",
      "recognized_signature_family",
      "recognized_signature_offset",
    ],
    fixture.fixture_id,
  );
  assert.equal(result.evidence.evaluation_step, 1, fixture.fixture_id);
  assert.equal(result.evidence.recognized_signature_family, fixture.signature_family, fixture.fixture_id);
  assert.equal(result.evidence.recognized_signature_offset, fixture.signature_offset, fixture.fixture_id);
}

function assertPdfPassResult(result, fixtureId) {
  assertFrozenResult(result, fixtureId);
  assert.equal(result.policy, "allow", fixtureId);
  assert.equal(result.category, "type_agreement_pass", fixtureId);
  assert.equal(result.scope, "type_agreement_pass_only", fixtureId);
  assert.deepEqual(Object.keys(result.evidence), [
    "normalized_extension",
    "normalized_declared_mime",
    "pdf_classification",
    "evaluation_step",
  ], fixtureId);
  assert.equal(result.evidence.normalized_extension, ".pdf", fixtureId);
  assert.equal(result.evidence.normalized_declared_mime, "application/pdf", fixtureId);
  assert.equal(result.evidence.pdf_classification, "complete_pdf_shallow_identity", fixtureId);
  assert.equal(result.evidence.evaluation_step, 4, fixtureId);
}

function assertXlsxPassResult(result, fixtureId) {
  assertFrozenResult(result, fixtureId);
  assert.equal(result.policy, "allow", fixtureId);
  assert.equal(result.category, "type_agreement_pass", fixtureId);
  assert.equal(result.scope, "type_agreement_pass_only", fixtureId);
  assert.deepEqual(Object.keys(result.evidence), [
    "normalized_extension",
    "normalized_declared_mime",
    "zip_classification",
    "evaluation_step",
  ], fixtureId);
  assert.equal(result.evidence.normalized_extension, ".xlsx", fixtureId);
  assert.equal(result.evidence.normalized_declared_mime, XLSX_MIME, fixtureId);
  assert.equal(result.evidence.zip_classification, "complete_xlsx_shallow_identity", fixtureId);
  assert.equal(result.evidence.evaluation_step, 4, fixtureId);
}

function assertDetectedContradictionResult(result, expected, fixtureId) {
  assertFrozenResult(result, fixtureId);
  assert.equal(result.policy, "block", fixtureId);
  assert.equal(result.category, "declared_type_mismatch", fixtureId);
  assert.equal(result.scope, "detected_permitted_type_contradiction_only", fixtureId);
  assert.deepEqual(Object.keys(result.evidence), [
    "normalized_extension",
    "normalized_declared_mime",
    "metadata_pairing",
    "detected_permitted_type",
    "evaluation_step",
  ], fixtureId);
  assert.equal(result.evidence.normalized_extension, expected.normalized_extension, fixtureId);
  assert.equal(result.evidence.normalized_declared_mime, expected.normalized_declared_mime, fixtureId);
  assert.equal(
    result.evidence.metadata_pairing,
    `${expected.normalized_extension} + ${expected.normalized_declared_mime}`,
    fixtureId,
  );
  assert.equal(result.evidence.detected_permitted_type, expected.detected_type, fixtureId);
  assert.ok(["pdf", "xlsx"].includes(result.evidence.detected_permitted_type), fixtureId);
  assert.equal(result.evidence.evaluation_step, 4, fixtureId);
}

function assertReadableNonXlsxZipBlockResult(result, fixture, fixtureId = fixture.fixture_id) {
  assertFrozenResult(result, fixtureId);
  assert.equal(result.policy, "block", fixtureId);
  assert.equal(result.category, "standalone_archive_or_non_xlsx", fixtureId);
  assert.equal(result.scope, "standalone_archive_or_non_xlsx_block_only", fixtureId);
  assert.deepEqual(Object.keys(result.evidence), [
    "normalized_extension",
    "normalized_declared_mime",
    "zip_classification",
    "evaluation_step",
  ], fixtureId);
  assert.equal(result.evidence.normalized_extension, fixture.normalized_extension ?? fixture.extension, fixtureId);
  assert.equal(
    result.evidence.normalized_declared_mime,
    fixture.normalized_declared_mime ?? fixture.declared_mime,
    fixtureId,
  );
  assert.equal(result.evidence.zip_classification, "readable_non_xlsx_zip", fixtureId);
  assert.equal(result.evidence.evaluation_step, 5, fixtureId);
}

function assertMalformedOrTruncatedZipBlockResult(result, fixture, fixtureId = fixture.fixture_id) {
  assertFrozenResult(result, fixtureId);
  assert.equal(result.policy, "block", fixtureId);
  assert.equal(result.category, "truncated_or_malformed_type", fixtureId);
  assert.equal(result.scope, "truncated_or_malformed_type_block_only", fixtureId);
  assert.deepEqual(Object.keys(result.evidence), [
    "normalized_extension",
    "normalized_declared_mime",
    "zip_classification",
    "evaluation_step",
  ], fixtureId);
  assert.equal(result.evidence.normalized_extension, fixture.normalized_extension ?? fixture.extension, fixtureId);
  assert.equal(
    result.evidence.normalized_declared_mime,
    fixture.normalized_declared_mime ?? fixture.declared_mime,
    fixtureId,
  );
  assert.equal(result.evidence.zip_classification, "malformed_or_truncated_zip_xlsx", fixtureId);
  assert.equal(result.evidence.evaluation_step, 5, fixtureId);
}

function assertIncompletePdfBlockResult(result, fixture, fixtureId = fixture.fixture_id) {
  assertFrozenResult(result, fixtureId);
  assert.equal(result.policy, "block", fixtureId);
  assert.equal(result.category, "truncated_or_malformed_type", fixtureId);
  assert.equal(result.scope, "pdf_shallow_identity_block_only", fixtureId);
  assert.deepEqual(Object.keys(result.evidence), [
    "normalized_extension",
    "normalized_declared_mime",
    "pdf_classification",
    "evaluation_step",
  ], fixtureId);
  assert.equal(result.evidence.normalized_extension, fixture.normalized_extension ?? fixture.extension, fixtureId);
  assert.equal(
    result.evidence.normalized_declared_mime,
    fixture.normalized_declared_mime ?? fixture.declared_mime,
    fixtureId,
  );
  assert.equal(result.evidence.pdf_classification, "incomplete_pdf_shallow_identity", fixtureId);
  assert.equal(result.evidence.evaluation_step, 6, fixtureId);
}

function assertStepSevenTextGateResult(result, expected, fixtureId) {
  assertFrozenResult(result, fixtureId);
  assert.equal(result.policy, expected.policy, fixtureId);
  assert.equal(result.category, expected.category, fixtureId);
  assert.equal(result.scope, expected.scope, fixtureId);
  assert.deepEqual(Object.keys(result.evidence), [
    "normalized_extension",
    "normalized_declared_mime",
    "text_gate_category",
    "text_gate_scope",
    "evaluation_step",
  ], fixtureId);
  assert.equal(result.evidence.normalized_extension, expected.normalized_extension, fixtureId);
  assert.equal(result.evidence.normalized_declared_mime, expected.normalized_declared_mime, fixtureId);
  assert.equal(result.evidence.text_gate_category, expected.text_gate_category, fixtureId);
  assert.equal(result.evidence.text_gate_scope, expected.text_gate_scope, fixtureId);
  assert.equal(result.evidence.evaluation_step, 7, fixtureId);
}

function assertUnknownBinaryResult(result, expected, fixtureId) {
  assertFrozenResult(result, fixtureId);
  assert.equal(result.policy, "block", fixtureId);
  assert.equal(result.category, "unknown_binary", fixtureId);
  assert.equal(result.scope, "unknown_binary_block_only", fixtureId);
  assert.deepEqual(Object.keys(result.evidence), [
    "normalized_extension",
    "normalized_declared_mime",
    "evaluation_step",
  ], fixtureId);
  assert.deepEqual(result.evidence, {
    normalized_extension: expected.normalized_extension,
    normalized_declared_mime: expected.normalized_declared_mime,
    evaluation_step: 9,
  }, fixtureId);
}

const fullBoundaryCorpora = Object.freeze([
  Object.freeze({
    corpus_id: "detected_permitted_type_contradiction",
    fixtures: DETECTED_PERMITTED_TYPE_CONTRADICTION_FIXTURES,
    adapter: adaptDetectedPermittedTypeContradictionFixture,
  }),
  Object.freeze({
    corpus_id: "extension_mime_matrix",
    fixtures: EXTENSION_MIME_MATRIX_FIXTURES,
    adapter: adaptExtensionMimeMatrixFixture,
  }),
  Object.freeze({
    corpus_id: "pdf_shallow_identity",
    fixtures: PDF_SHALLOW_IDENTITY_FIXTURES,
    adapter: adaptPdfShallowIdentityFixture,
  }),
  Object.freeze({
    corpus_id: "recognized_disallowed_signature",
    fixtures: RECOGNIZED_DISALLOWED_SIGNATURE_FIXTURES,
    adapter: adaptRecognizedDisallowedSignatureFixture,
  }),
  Object.freeze({
    corpus_id: "residual_unknown_binary",
    fixtures: RESIDUAL_UNKNOWN_BINARY_FIXTURES,
    adapter: adaptResidualUnknownBinaryFixture,
  }),
  Object.freeze({
    corpus_id: "text_type_agreement",
    fixtures: TEXT_TYPE_AGREEMENT_FIXTURES,
    adapter: adaptTextTypeAgreementFixture,
  }),
  Object.freeze({
    corpus_id: "txt_md_byte",
    fixtures: TXT_MD_BYTE_FIXTURES,
    adapter: adaptTxtMdByteFixture,
  }),
  Object.freeze({
    corpus_id: "unsupported_extension_mime",
    fixtures: UNSUPPORTED_EXTENSION_MIME_FIXTURES,
    adapter: adaptUnsupportedExtensionMimeFixture,
  }),
  Object.freeze({
    corpus_id: "xlsx_zip",
    fixtures: XLSX_ZIP_FIXTURES,
    adapter: adaptXlsxZipFixture,
  }),
]);

function inertNonSignallingBytes() {
  return new Uint8Array([0x70, 0x6c, 0x61, 0x69, 0x6e]);
}

function normalizedExtensionFor(fixture) {
  return fixture.normalized_extension ?? fixture.extension ?? "";
}

function normalizedDeclaredMimeFor(fixture) {
  return fixture.normalized_declared_mime ?? fixture.declared_mime.trim().toLowerCase();
}

function metadataPairingFor(expected) {
  return `${expected.normalized_extension} + ${expected.normalized_declared_mime}`;
}

function expectedMismatchEvidence(fixture) {
  const expected = {
    normalized_extension: normalizedExtensionFor(fixture),
    normalized_declared_mime: normalizedDeclaredMimeFor(fixture),
  };

  return Object.freeze({
    keys: Object.freeze([
      "evaluation_step",
      "normalized_extension",
      "normalized_declared_mime",
      "metadata_pairing",
    ]),
    values: Object.freeze({
      evaluation_step: 3,
      normalized_extension: expected.normalized_extension,
      normalized_declared_mime: expected.normalized_declared_mime,
      metadata_pairing: metadataPairingFor(expected),
    }),
  });
}

function expectedDetectedPermittedTypeContradictionEvidence(fixture) {
  const expected = {
    normalized_extension: normalizedExtensionFor(fixture),
    normalized_declared_mime: normalizedDeclaredMimeFor(fixture),
  };

  return Object.freeze({
    keys: Object.freeze([
      "normalized_extension",
      "normalized_declared_mime",
      "metadata_pairing",
      "detected_permitted_type",
      "evaluation_step",
    ]),
    values: Object.freeze({
      normalized_extension: expected.normalized_extension,
      normalized_declared_mime: expected.normalized_declared_mime,
      metadata_pairing: metadataPairingFor(expected),
      detected_permitted_type: fixture.detected_type,
      evaluation_step: 4,
    }),
  });
}

function expectedUnsupportedEvidence(fixture) {
  return Object.freeze({
    keys: Object.freeze([
      "evaluation_step",
      "normalized_extension",
      "normalized_declared_mime",
      "unsupported_signal",
    ]),
    values: Object.freeze({
      evaluation_step: 2,
      normalized_extension: normalizedExtensionFor(fixture),
      normalized_declared_mime: normalizedDeclaredMimeFor(fixture),
      unsupported_signal: fixture.unsupported_signal,
    }),
  });
}

function expectedDisallowedSignatureEvidence(fixture) {
  return Object.freeze({
    keys: Object.freeze([
      "evaluation_step",
      "recognized_signature_family",
      "recognized_signature_offset",
    ]),
    values: Object.freeze({
      evaluation_step: 1,
      recognized_signature_family: fixture.signature_family,
      recognized_signature_offset: fixture.signature_offset,
    }),
  });
}

function expectedPdfPassEvidence(fixture) {
  return Object.freeze({
    keys: Object.freeze([
      "normalized_extension",
      "normalized_declared_mime",
      "pdf_classification",
      "evaluation_step",
    ]),
    values: Object.freeze({
      normalized_extension: normalizedExtensionFor(fixture),
      normalized_declared_mime: normalizedDeclaredMimeFor(fixture),
      pdf_classification: "complete_pdf_shallow_identity",
      evaluation_step: 4,
    }),
  });
}

function expectedXlsxPassEvidence(fixture) {
  return Object.freeze({
    keys: Object.freeze([
      "normalized_extension",
      "normalized_declared_mime",
      "zip_classification",
      "evaluation_step",
    ]),
    values: Object.freeze({
      normalized_extension: normalizedExtensionFor(fixture),
      normalized_declared_mime: normalizedDeclaredMimeFor(fixture),
      zip_classification: "complete_xlsx_shallow_identity",
      evaluation_step: 4,
    }),
  });
}

function expectedReadableNonXlsxZipEvidence(fixture) {
  return Object.freeze({
    keys: Object.freeze([
      "normalized_extension",
      "normalized_declared_mime",
      "zip_classification",
      "evaluation_step",
    ]),
    values: Object.freeze({
      normalized_extension: normalizedExtensionFor(fixture),
      normalized_declared_mime: normalizedDeclaredMimeFor(fixture),
      zip_classification: "readable_non_xlsx_zip",
      evaluation_step: 5,
    }),
  });
}

function expectedMalformedOrTruncatedZipEvidence(fixture) {
  return Object.freeze({
    keys: Object.freeze([
      "normalized_extension",
      "normalized_declared_mime",
      "zip_classification",
      "evaluation_step",
    ]),
    values: Object.freeze({
      normalized_extension: normalizedExtensionFor(fixture),
      normalized_declared_mime: normalizedDeclaredMimeFor(fixture),
      zip_classification: "malformed_or_truncated_zip_xlsx",
      evaluation_step: 5,
    }),
  });
}

function expectedIncompletePdfEvidence(fixture) {
  return Object.freeze({
    keys: Object.freeze([
      "normalized_extension",
      "normalized_declared_mime",
      "pdf_classification",
      "evaluation_step",
    ]),
    values: Object.freeze({
      normalized_extension: normalizedExtensionFor(fixture),
      normalized_declared_mime: normalizedDeclaredMimeFor(fixture),
      pdf_classification: "incomplete_pdf_shallow_identity",
      evaluation_step: 6,
    }),
  });
}

function expectedTextGateEvidence(fixture, category, textGateCategory, textGateScope) {
  return Object.freeze({
    keys: Object.freeze([
      "normalized_extension",
      "normalized_declared_mime",
      "text_gate_category",
      "text_gate_scope",
      "evaluation_step",
    ]),
    values: Object.freeze({
      normalized_extension: normalizedExtensionFor(fixture),
      normalized_declared_mime: normalizedDeclaredMimeFor(fixture),
      text_gate_category: textGateCategory ?? category,
      text_gate_scope: textGateScope,
      evaluation_step: 7,
    }),
  });
}

function expectedUnknownBinaryEvidence(fixture) {
  return Object.freeze({
    keys: Object.freeze([
      "normalized_extension",
      "normalized_declared_mime",
      "evaluation_step",
    ]),
    values: Object.freeze({
      normalized_extension: normalizedExtensionFor(fixture),
      normalized_declared_mime: normalizedDeclaredMimeFor(fixture),
      evaluation_step: 9,
    }),
  });
}

function adaptedFixture({
  corpusId,
  fixture,
  bytes,
  expectedPolicy = fixture.expected_policy,
  expectedCategory = fixture.expected_category,
  expectedScope = fixture.scope_note,
  expectedEvidence,
}) {
  return Object.freeze({
    corpus_id: corpusId,
    fixture_id: fixture.fixture_id,
    input: Object.freeze({
      extension: fixture.extension === null ? "" : fixture.extension,
      declaredMime: fixture.declared_mime,
      bytes,
    }),
    expected_policy: expectedPolicy,
    expected_category: expectedCategory,
    expected_scope: expectedScope,
    expected_evidence: expectedEvidence,
  });
}

function adaptDetectedPermittedTypeContradictionFixture(fixture, corpusId) {
  return adaptedFixture({
    corpusId,
    fixture,
    bytes: fixture.bytes,
    expectedEvidence: expectedDetectedPermittedTypeContradictionEvidence(fixture),
  });
}

function adaptExtensionMimeMatrixFixture(fixture, corpusId) {
  const isPositivePdf = fixture.expected_policy === "allow" && fixture.normalized_extension === ".pdf";
  const isPositiveXlsx = fixture.expected_policy === "allow" && fixture.normalized_extension === ".xlsx";
  const bytes = fixture.expected_policy === "block" ? inertNonSignallingBytes() : fixture.bytes;
  const expectedEvidence = isPositivePdf
    ? expectedPdfPassEvidence(fixture)
    : isPositiveXlsx
      ? expectedXlsxPassEvidence(fixture)
      : expectedMismatchEvidence(fixture);

  return adaptedFixture({
    corpusId,
    fixture,
    bytes,
    expectedEvidence,
  });
}

function adaptPdfShallowIdentityFixture(fixture, corpusId) {
  return adaptedFixture({
    corpusId,
    fixture,
    bytes: fixture.bytes,
    expectedEvidence: fixture.expected_policy === "allow"
      ? expectedPdfPassEvidence(fixture)
      : expectedIncompletePdfEvidence(fixture),
  });
}

function adaptRecognizedDisallowedSignatureFixture(fixture, corpusId) {
  return adaptedFixture({
    corpusId,
    fixture,
    bytes: fixture.bytes,
    expectedEvidence: expectedDisallowedSignatureEvidence(fixture),
  });
}

function adaptResidualUnknownBinaryFixture(fixture, corpusId) {
  return adaptedFixture({
    corpusId,
    fixture,
    bytes: fixture.bytes,
    expectedEvidence: expectedUnknownBinaryEvidence(fixture),
  });
}

function adaptTextTypeAgreementFixture(fixture, corpusId) {
  const expectedEvidence = fixture.expected_policy === "allow"
    ? expectedTextGateEvidence(fixture, "type_agreement_pass", "encoding_gate_pass", "encoding_gate_pass_only")
    : expectedMismatchEvidence(fixture);

  return adaptedFixture({
    corpusId,
    fixture,
    bytes: bytesFromHex(fixture.bytes_hex),
    expectedEvidence,
  });
}

function adaptTxtMdByteFixture(fixture, corpusId) {
  const textFixture = {
    ...fixture,
    extension: ".txt",
    declared_mime: "text/plain",
    normalized_extension: ".txt",
    normalized_declared_mime: "text/plain",
  };
  const expectedPolicy = fixture.expected_policy === "allow" ? "allow" : "block";
  const expectedCategory = fixture.expected_policy === "allow" ? "type_agreement_pass" : fixture.expected_category;
  const expectedScope = fixture.expected_policy === "allow"
    ? "type_agreement_pass_only"
    : "encoding_binary_gate_block_only";
  const expectedEvidence = fixture.expected_policy === "allow"
    ? expectedTextGateEvidence(textFixture, expectedCategory, "encoding_gate_pass", "encoding_gate_pass_only")
    : expectedTextGateEvidence(textFixture, expectedCategory, fixture.expected_category, "encoding_binary_gate_block_only");

  return adaptedFixture({
    corpusId,
    fixture: textFixture,
    bytes: txtMdBytesFromHex(fixture.bytes_hex),
    expectedPolicy,
    expectedCategory,
    expectedScope,
    expectedEvidence,
  });
}

function adaptUnsupportedExtensionMimeFixture(fixture, corpusId) {
  return adaptedFixture({
    corpusId,
    fixture,
    bytes: fixture.bytes ?? inertNonSignallingBytes(),
    expectedEvidence: expectedUnsupportedEvidence(fixture),
  });
}

function adaptXlsxZipFixture(fixture, corpusId) {
  const expectedEvidence = fixture.expected_policy === "allow"
    ? expectedXlsxPassEvidence(fixture)
    : fixture.expected_category === "standalone_archive_or_non_xlsx"
      ? expectedReadableNonXlsxZipEvidence(fixture)
      : expectedMalformedOrTruncatedZipEvidence(fixture);
  const expectedScope = fixture.expected_policy === "allow"
    ? "type_agreement_pass_only"
    : fixture.expected_category === "standalone_archive_or_non_xlsx"
      ? "standalone_archive_or_non_xlsx_block_only"
      : "truncated_or_malformed_type_block_only";

  return adaptedFixture({
    corpusId,
    fixture,
    bytes: fixture.bytes,
    expectedScope,
    expectedEvidence,
  });
}

function duplicateFixtureIds(fixtureIds) {
  const seen = new Set();
  const duplicates = new Set();

  for (const fixtureId of fixtureIds) {
    if (seen.has(fixtureId)) {
      duplicates.add(fixtureId);
    }
    seen.add(fixtureId);
  }

  return [...duplicates].sort();
}

function assertAcceptanceEvidence(result, expected, fixtureId) {
  assert.deepEqual(Object.keys(result.evidence), expected.keys, fixtureId);
  assert.deepEqual(result.evidence, expected.values, fixtureId);
}

test("P0-05F.4 full nine-corpus 101-fixture detector acceptance boundary", () => {
  assert.equal(fullBoundaryCorpora.length, 9);

  const adaptedFixtures = fullBoundaryCorpora.flatMap((corpus) =>
    corpus.fixtures.map((fixture) => corpus.adapter(fixture, corpus.corpus_id)));
  const fixtureIds = adaptedFixtures.map((fixture) => fixture.fixture_id);
  const duplicates = duplicateFixtureIds(fixtureIds);
  const ambiguousFixtures = adaptedFixtures.filter(
    (fixture) => fixture.expected_category === "ambiguous_file_type",
  );
  let detectorInvocationCount = 0;

  assert.equal(adaptedFixtures.length, 101);
  assert.equal(new Set(fixtureIds).size, 101);
  assert.deepEqual(duplicates, []);
  assert.equal(ambiguousFixtures.length, 0);

  for (const fixture of adaptedFixtures) {
    const before = Array.from(fixture.input.bytes);
    detectorInvocationCount += 1;
    const result = detectP0FileTypeAgreement(fixture.input);

    assertFrozenResult(result, fixture.fixture_id);
    assert.equal(result.policy, fixture.expected_policy, fixture.fixture_id);
    assert.equal(result.category, fixture.expected_category, fixture.fixture_id);
    assert.equal(result.scope, fixture.expected_scope, fixture.fixture_id);
    assertAcceptanceEvidence(result, fixture.expected_evidence, fixture.fixture_id);
    assertBytesUnchanged(fixture.input.bytes, before, fixture.fixture_id);
  }

  assert.equal(detectorInvocationCount, 101);
  assert.deepEqual({
    corpus_count: fullBoundaryCorpora.length,
    fixture_count: adaptedFixtures.length,
    detector_invocation_count: detectorInvocationCount,
    unique_fixture_id_count: new Set(fixtureIds).size,
    duplicate_fixture_ids: duplicates,
    ambiguous_fixture_count: ambiguousFixtures.length,
  }, {
    corpus_count: 9,
    fixture_count: 101,
    detector_invocation_count: 101,
    unique_fixture_id_count: 101,
    duplicate_fixture_ids: [],
    ambiguous_fixture_count: 0,
  });
});

test("P0-05F.4 step 1 blocks recognized disallowed signatures at offset zero", () => {
  assert.equal(RECOGNIZED_DISALLOWED_SIGNATURE_FIXTURES.length, 6);

  for (const fixture of RECOGNIZED_DISALLOWED_SIGNATURE_FIXTURES) {
    const result = callDetector(fixture);

    assertFrozenResult(result, fixture.fixture_id);
    assert.equal(result.policy, fixture.expected_policy, fixture.fixture_id);
    assert.equal(result.category, fixture.expected_category, fixture.fixture_id);
    assert.equal(result.scope, fixture.scope_note, fixture.fixture_id);
    assertDisallowedSignatureEvidence(result, fixture);
  }
});

test("P0-05F.4 step 2 blocks unsupported extension or declared MIME metadata", () => {
  assert.equal(UNSUPPORTED_EXTENSION_MIME_FIXTURES.length, 18);

  for (const fixture of UNSUPPORTED_EXTENSION_MIME_FIXTURES) {
    const result = callDetector(fixture);

    assertFrozenResult(result, fixture.fixture_id);
    assert.equal(result.policy, fixture.expected_policy, fixture.fixture_id);
    assert.equal(result.category, fixture.expected_category, fixture.fixture_id);
    assert.equal(result.scope, fixture.scope_note, fixture.fixture_id);
    assertUnsupportedEvidence(result, fixture);
  }
});

test("P0-05F.4 step 3 blocks supported extension and MIME disagreement", () => {
  assert.equal(stepThreeMismatchFixtures.length, 23);

  for (const fixture of stepThreeMismatchFixtures) {
    const result = callDetector(fixture);

    assertFrozenResult(result, fixture.fixture_id);
    assert.equal(result.policy, fixture.expected_policy, fixture.fixture_id);
    assert.equal(result.category, fixture.expected_category, fixture.fixture_id);
    assert.equal(result.scope, fixture.scope_note, fixture.fixture_id);
    assertMismatchEvidence(result, fixture);
  }
});

test("P0-05F.4 step 1 precedence applies before unsupported metadata", () => {
  const result = detectP0FileTypeAgreement({
    extension: ".exe",
    declaredMime: "application/octet-stream",
    bytes: new Uint8Array([0x4D, 0x5A]),
  });

  assert.equal(result.policy, "block");
  assert.equal(result.category, "disallowed_binary_signature");
  assert.equal(result.scope, "type_agreement_block_only");
  assert.deepEqual(Object.keys(result.evidence), [
    "evaluation_step",
    "recognized_signature_family",
    "recognized_signature_offset",
  ]);
});

test("P0-05F.4 step 4 allows complete PDF shallow identity", () => {
  const before = Array.from(completePdfFixture.bytes);
  const result = callDetector(completePdfFixture);

  assertPdfPassResult(result, completePdfFixture.fixture_id);
  assertBytesUnchanged(completePdfFixture.bytes, before, completePdfFixture.fixture_id);
});

test("P0-05F.4 step 4 allows complete XLSX shallow identity", () => {
  const before = Array.from(completeXlsxFixture.bytes);
  const result = callDetector(completeXlsxFixture);

  assertXlsxPassResult(result, completeXlsxFixture.fixture_id);
  assertBytesUnchanged(completeXlsxFixture.bytes, before, completeXlsxFixture.fixture_id);
});

test("P0-05F.4 steps 4 and 5 classify all committed XLSX/ZIP fixtures", () => {
  assert.equal(XLSX_ZIP_FIXTURES.length, 12);
  assert.equal(readableNonXlsxZipFixtures.length, 7);
  assert.equal(malformedOrTruncatedZipFixtures.length, 4);

  for (const fixture of XLSX_ZIP_FIXTURES) {
    const before = Array.from(fixture.bytes);
    const result = callDetector(fixture);

    if (fixture.fixture_id === "XLSXZIP-P0-05F-001-ALLOW-MINIMUM-XLSX") {
      assertXlsxPassResult(result, fixture.fixture_id);
    } else if (fixture.expected_category === "standalone_archive_or_non_xlsx") {
      assertReadableNonXlsxZipBlockResult(result, fixture);
    } else {
      assertMalformedOrTruncatedZipBlockResult(result, fixture);
    }

    assertBytesUnchanged(fixture.bytes, before, fixture.fixture_id);
  }
});

test("P0-05F.4 step 5 blocks readable ZIP before text-byte handling", () => {
  const fixture = XLSX_ZIP_FIXTURES.find(
    (item) => item.fixture_id === "XLSXZIP-P0-05F-007-BLOCK-ARBITRARY-ZIP-NON-XLSX-METADATA",
  );
  const result = callDetector(fixture);

  assertReadableNonXlsxZipBlockResult(result, fixture);
  assert.equal(result.evidence.normalized_extension, ".txt");
  assert.equal(result.evidence.normalized_declared_mime, "text/plain");
  assert.notEqual(result.category, "declared_type_mismatch");
  assert.notEqual(result.category, "disallowed_binary_signature");
  assert.notEqual(result.category, "truncated_or_malformed_type");
  assert.notEqual(result.category, "unknown_binary");
});

test("P0-05F.4 steps 4 and 6 classify all committed PDF shallow-identity fixtures", () => {
  assert.equal(PDF_SHALLOW_IDENTITY_FIXTURES.length, 5);
  assert.equal(incompletePdfFixtures.length, 4);

  for (const fixture of PDF_SHALLOW_IDENTITY_FIXTURES) {
    const before = Array.from(fixture.bytes);
    const result = callDetector(fixture);

    if (fixture.fixture_id === "PDFIDENT-P0-05F-001-ALLOW-MINIMUM-PDF") {
      assertPdfPassResult(result, fixture.fixture_id);
    } else {
      assertIncompletePdfBlockResult(result, fixture);
    }

    assertBytesUnchanged(fixture.bytes, before, fixture.fixture_id);
  }
});

test("P0-05F.4 step 4 allows complete XLSX with an unrelated non-ASCII ZIP entry name", () => {
  const fixtureId = "P0-05F.4-XLSX-NON-ASCII-EXTRA-PASS";
  const bytes = createRawNameStoredZip([
    asciiNameBytes("[Content_Types].xml"),
    asciiNameBytes("_rels/.rels"),
    asciiNameBytes("xl/workbook.xml"),
    unrelatedNonAsciiEntryNameBytes,
  ]);
  const before = Array.from(bytes);
  const result = detectP0FileTypeAgreement({
    extension: ".xlsx",
    declaredMime: XLSX_MIME,
    bytes,
  });

  assertXlsxPassResult(result, fixtureId);
  assertBytesUnchanged(bytes, before, fixtureId);
});

test("P0-05F.4 step 5 blocks missing XLSX required entry with an unrelated non-ASCII ZIP entry name", () => {
  const fixtureId = "P0-05F.4-MISSING-WORKBOOK-NON-ASCII-EXTRA-BLOCK";
  const bytes = createRawNameStoredZip([
    asciiNameBytes("[Content_Types].xml"),
    asciiNameBytes("_rels/.rels"),
    unrelatedNonAsciiEntryNameBytes,
  ]);
  const before = Array.from(bytes);
  const result = detectP0FileTypeAgreement({
    extension: ".xlsx",
    declaredMime: XLSX_MIME,
    bytes,
  });

  assert.notEqual(result.category, "type_agreement_pass", fixtureId);
  assertReadableNonXlsxZipBlockResult(result, {
    extension: ".xlsx",
    declared_mime: XLSX_MIME,
  }, fixtureId);
  assertBytesUnchanged(bytes, before, fixtureId);
});

test("P0-05F.4 step 4 blocks complete PDF identity under text metadata", () => {
  const before = Array.from(textMetadataPdfContradictionFixture.bytes);
  const result = callDetector(textMetadataPdfContradictionFixture);

  assertDetectedContradictionResult(result, textMetadataPdfContradictionFixture, textMetadataPdfContradictionFixture.fixture_id);
  assertBytesUnchanged(textMetadataPdfContradictionFixture.bytes, before, textMetadataPdfContradictionFixture.fixture_id);
});

test("P0-05F.4 step 4 blocks complete XLSX identity under text metadata", () => {
  const before = Array.from(textMetadataXlsxContradictionFixture.bytes);
  const result = callDetector(textMetadataXlsxContradictionFixture);

  assertDetectedContradictionResult(
    result,
    textMetadataXlsxContradictionFixture,
    textMetadataXlsxContradictionFixture.fixture_id,
  );
  assertBytesUnchanged(textMetadataXlsxContradictionFixture.bytes, before, textMetadataXlsxContradictionFixture.fixture_id);
});

test("P0-05F.4 step 4 blocks complete XLSX identity under PDF metadata", () => {
  const fixtureId = "P0-05F.4-PDF-METADATA-XLSX-BYTES";
  const before = Array.from(completeXlsxFixture.bytes);
  const result = detectP0FileTypeAgreement({
    extension: ".pdf",
    declaredMime: "application/pdf",
    bytes: completeXlsxFixture.bytes,
  });

  assertDetectedContradictionResult(result, {
    normalized_extension: ".pdf",
    normalized_declared_mime: "application/pdf",
    detected_type: "xlsx",
  }, fixtureId);
  assertBytesUnchanged(completeXlsxFixture.bytes, before, fixtureId);
});

test("P0-05F.4 step 4 blocks complete PDF identity under XLSX metadata", () => {
  const fixtureId = "P0-05F.4-XLSX-METADATA-PDF-BYTES";
  const before = Array.from(completePdfFixture.bytes);
  const result = detectP0FileTypeAgreement({
    extension: ".xlsx",
    declaredMime: XLSX_MIME,
    bytes: completePdfFixture.bytes,
  });

  assertDetectedContradictionResult(result, {
    normalized_extension: ".xlsx",
    normalized_declared_mime: XLSX_MIME,
    detected_type: "pdf",
  }, fixtureId);
  assertBytesUnchanged(completePdfFixture.bytes, before, fixtureId);
});

test("P0-05F.4 step 5 malformed ZIP signalling precedes incomplete PDF signalling", () => {
  const fixtureId = "P0-05F.4-MALFORMED-ZIP-BEFORE-INCOMPLETE-PDF";
  const bytes = new Uint8Array([
    0x50, 0x4B, 0x03, 0x04,
    0x20, 0x20, 0x20,
    0x25, 0x50, 0x44, 0x46, 0x2D,
  ]);
  const before = Array.from(bytes);
  const result = detectP0FileTypeAgreement({
    extension: ".pdf",
    declaredMime: "application/pdf",
    bytes,
  });

  assertMalformedOrTruncatedZipBlockResult(result, {
    extension: ".pdf",
    declared_mime: "application/pdf",
  }, fixtureId);
  assert.notEqual(result.scope, "pdf_shallow_identity_block_only", fixtureId);
  assertBytesUnchanged(bytes, before, fixtureId);
});

test("P0-05F.4 step 7 wraps all txt/md byte helper fixtures for text/plain .txt", () => {
  assert.equal(TXT_MD_BYTE_FIXTURES.length, 27);
  assert.equal(new Set(TXT_MD_BYTE_FIXTURES.map((fixture) => fixture.fixture_id)).size, 27);

  for (const fixture of TXT_MD_BYTE_FIXTURES) {
    const bytes = txtMdBytesFromHex(fixture.bytes_hex);
    const before = Array.from(bytes);
    const result = detectP0FileTypeAgreement({
      extension: ".txt",
      declaredMime: "text/plain",
      bytes,
    });

    if (fixture.expected_policy === "allow") {
      assertStepSevenTextGateResult(result, {
        policy: "allow",
        category: "type_agreement_pass",
        scope: "type_agreement_pass_only",
        normalized_extension: ".txt",
        normalized_declared_mime: "text/plain",
        text_gate_category: "encoding_gate_pass",
        text_gate_scope: "encoding_gate_pass_only",
      }, fixture.fixture_id);
    } else {
      assertStepSevenTextGateResult(result, {
        policy: "block",
        category: fixture.expected_category,
        scope: "encoding_binary_gate_block_only",
        normalized_extension: ".txt",
        normalized_declared_mime: "text/plain",
        text_gate_category: fixture.expected_category,
        text_gate_scope: "encoding_binary_gate_block_only",
      }, fixture.fixture_id);
    }

    assertBytesUnchanged(bytes, before, fixture.fixture_id);
  }
});

test("P0-05F.4 step 7 allows the five permitted text metadata pairings", () => {
  const bytes = txtMdBytesFromHex(txtMdAllowAsciiFixture.bytes_hex);

  for (const [extension, declaredMime] of [
    [".csv", "text/csv"],
    [".csv", "application/csv"],
    [".md", "text/markdown"],
    [".md", "text/plain"],
    [".txt", "text/plain"],
  ]) {
    const fixtureId = `P0-05F.4-STEP-7-ALLOW-${extension}-${declaredMime}`;
    const inputBytes = new Uint8Array(bytes);
    const before = Array.from(inputBytes);
    const result = detectP0FileTypeAgreement({
      extension,
      declaredMime,
      bytes: inputBytes,
    });

    assertStepSevenTextGateResult(result, {
      policy: "allow",
      category: "type_agreement_pass",
      scope: "type_agreement_pass_only",
      normalized_extension: extension,
      normalized_declared_mime: declaredMime,
      text_gate_category: "encoding_gate_pass",
      text_gate_scope: "encoding_gate_pass_only",
    }, fixtureId);
    assertBytesUnchanged(inputBytes, before, fixtureId);
  }
});

test("P0-05F.4 step 7 blocks invalid UTF-8 for csv at the boundary", () => {
  assert.equal(txtMdIsolatedContinuationFixture.bytes_hex, "80");
  const bytes = txtMdBytesFromHex(txtMdIsolatedContinuationFixture.bytes_hex);
  const before = Array.from(bytes);
  const result = detectP0FileTypeAgreement({
    extension: ".csv",
    declaredMime: "text/csv",
    bytes,
  });

  assertStepSevenTextGateResult(result, {
    policy: "block",
    category: "invalid_utf8",
    scope: "encoding_binary_gate_block_only",
    normalized_extension: ".csv",
    normalized_declared_mime: "text/csv",
    text_gate_category: "invalid_utf8",
    text_gate_scope: "encoding_binary_gate_block_only",
  }, txtMdIsolatedContinuationFixture.fixture_id);
  assertBytesUnchanged(bytes, before, txtMdIsolatedContinuationFixture.fixture_id);
});

test("P0-05F.4 step 7 runs before residual handling for text NUL bytes", () => {
  const fixtureId = "P0-05F.4-STEP-7-TEXT-0001-PRECEDENCE";
  const bytes = new Uint8Array([0x00, 0x01]);
  const before = Array.from(bytes);
  const result = detectP0FileTypeAgreement({
    extension: ".txt",
    declaredMime: "text/plain",
    bytes,
  });

  assertStepSevenTextGateResult(result, {
    policy: "block",
    category: "nul_rejection",
    scope: "encoding_binary_gate_block_only",
    normalized_extension: ".txt",
    normalized_declared_mime: "text/plain",
    text_gate_category: "nul_rejection",
    text_gate_scope: "encoding_binary_gate_block_only",
  }, fixtureId);
  assertBytesUnchanged(bytes, before, fixtureId);
  assert.equal(JSON.stringify(result).includes("not_implemented"), false, fixtureId);
  assert.equal(JSON.stringify(result).includes("steps_8_through_9_not_implemented"), false, fixtureId);
});

test("P0-05F.4 step 9 blocks the single residual unknown binary fixture", () => {
  const fixture = Object.freeze({
    fixture_id: "UNKNOWNBIN-P0-05F-2D3-001-BLOCK-PDF-APPLICATION-PDF-0001",
    extension: ".pdf",
    declared_mime: "application/pdf",
    normalized_extension: ".pdf",
    normalized_declared_mime: "application/pdf",
    bytes: new Uint8Array([0x00, 0x01]),
  });
  const before = Array.from(fixture.bytes);
  const result = callDetector(fixture);

  assertUnknownBinaryResult(result, fixture, fixture.fixture_id);
  assertBytesUnchanged(fixture.bytes, before, fixture.fixture_id);
});

test("P0-05F.4 detector enforces input types", () => {
  const validBytes = new Uint8Array();

  assert.throws(
    () => detectP0FileTypeAgreement({ declaredMime: "text/plain", bytes: validBytes }),
    TypeError,
  );
  assert.throws(
    () => detectP0FileTypeAgreement({ extension: null, declaredMime: "text/plain", bytes: validBytes }),
    TypeError,
  );
  assert.throws(
    () => detectP0FileTypeAgreement({ extension: ".txt", bytes: validBytes }),
    TypeError,
  );
  assert.throws(
    () => detectP0FileTypeAgreement({ extension: ".txt", declaredMime: 12, bytes: validBytes }),
    TypeError,
  );
  assert.throws(
    () => detectP0FileTypeAgreement({ extension: ".txt", declaredMime: "text/plain", bytes: [] }),
    TypeError,
  );
});

test("P0-05F.4 detector does not mutate bytes", () => {
  const bytes = new Uint8Array([0x50, 0x6C, 0x61, 0x69, 0x6E]);
  const before = Array.from(bytes);

  detectP0FileTypeAgreement({
    extension: ".txt",
    declaredMime: "text/plain",
    bytes,
  });

  assert.deepEqual(Array.from(bytes), before);
});
