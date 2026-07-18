import {
  EXTENSION_MIME_MATRIX_BYTE_SOURCES,
} from "./kaiSprint2ExtensionMimeMatrixFixtureCorpus.js";

export const UNSUPPORTED_EXTENSION_MIME_FIXTURE_POLICIES = Object.freeze(["block"]);

export const UNSUPPORTED_EXTENSION_MIME_FIXTURE_CATEGORIES = Object.freeze([
  "unsupported_file_type",
]);

export const UNSUPPORTED_EXTENSION_MIME_FIXTURE_CORPUS_STATUSES = Object.freeze(["corpus_only"]);

export const UNSUPPORTED_EXTENSION_MIME_AUTHORITY_MAP = Object.freeze({
  "OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1": Object.freeze({
    source_document: "Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md",
    section_or_decision_key: "P0-05F unsupported extension and unsupported declared file-MIME outcomes",
    requirement_summary:
      "Unsupported extension or unsupported declared file MIME blocks as unsupported_file_type. MIME parameters are rejected rather than stripped. application/json remains rejected by policy while current runtime alignment is unresolved.",
    authority_status: "contract_grounded",
  }),
});

export const UNSUPPORTED_EXTENSION_REQUIRED_CASES = Object.freeze([
  ".json",
  ".html",
  ".js",
  ".zip",
  ".exe",
  ".bin",
  "empty_extension",
  "missing_extension",
]);

export const UNSUPPORTED_DECLARED_MIME_REQUIRED_CASES = Object.freeze([
  "application/json",
  "application/octet-stream",
  "text/html",
  "text/javascript",
  "application/javascript",
  "application/zip",
  "application/x-zip-compressed",
  "empty_mime",
  "unknown_unlisted_mime",
  "text/plain; charset=utf-8",
]);

const txtByteSource = EXTENSION_MIME_MATRIX_BYTE_SOURCES[".txt"];

if (!txtByteSource) {
  throw new Error("Missing P0-05F.2b2a TXT byte source for unsupported metadata fixtures.");
}

export const UNSUPPORTED_METADATA_BYTE_SOURCES = Object.freeze({
  permitted_txt: Object.freeze({
    source_id: txtByteSource.source_id,
    source_kind: txtByteSource.source_kind,
    bytes: txtByteSource.bytes,
    valid_for_extension: ".txt",
    valid_for_declared_mime: "text/plain",
  }),
});

function normalizeExtension(extension) {
  if (extension === null) return null;
  return extension.toLowerCase();
}

function normalizeDeclaredMime(declaredMime) {
  return declaredMime.trim().toLowerCase();
}

function fixture({
  fixture_id,
  description,
  fixture_family,
  unsupported_case,
  extension,
  declared_mime,
  unsupported_signal,
  runtime_alignment_note = null,
  transport_envelope_note = null,
  mime_parameter_rejection_note = null,
}) {
  const byteSource = UNSUPPORTED_METADATA_BYTE_SOURCES.permitted_txt;
  const normalized_extension = normalizeExtension(extension);
  const normalized_declared_mime = normalizeDeclaredMime(declared_mime);

  return Object.freeze({
    fixture_id,
    description,
    fixture_family,
    unsupported_case,
    extension,
    extension_present: extension !== null,
    normalized_extension,
    declared_mime,
    normalized_declared_mime,
    bytes: byteSource.bytes,
    byte_length: byteSource.bytes.byteLength,
    byte_source_id: byteSource.source_id,
    byte_source_kind: byteSource.source_kind,
    selected_permitted_type: ".txt + text/plain",
    expected_policy: "block",
    expected_category: "unsupported_file_type",
    scope_note: "unsupported_metadata_block_only",
    authority: "OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1",
    unsupported_signal,
    extension_supported: unsupported_signal === "declared_mime" ? true : false,
    declared_mime_supported: unsupported_signal === "extension" ? true : false,
    bytes_valid_for_selected_permitted_type: true,
    bytes_valid_for_extension: unsupported_signal === "declared_mime" ? true : null,
    malformed_fixture_claim: false,
    truncated_fixture_claim: false,
    invalid_utf8_claim: false,
    unknown_binary_claim: false,
    recognized_disallowed_signature_claim: false,
    pdf_identity_failure_claim: false,
    xlsx_identity_failure_claim: false,
    runtime_alignment_note,
    transport_envelope_note,
    mime_parameter_rejection_note,
    synthetic_provenance:
      "synthetic unsupported metadata fixture row created locally for P0-05F.2b2b; uses the committed P0-05F.2b2a TXT byte source and no repository data, deployed data, external services, secrets, private material, disk files, or document sources",
    corpus_status: "corpus_only",
    usable_document_claim: false,
    source_eligibility_claim: false,
    production_detector_claim: false,
    semantic_content_inspected: false,
    production_detector_answer_key: false,
    production_detector_conformance_claim: false,
  });
}

function unsupportedExtensionFixture({ fixture_id, description, unsupported_case, extension }) {
  return fixture({
    fixture_id,
    description,
    fixture_family: "unsupported_extension",
    unsupported_case,
    extension,
    declared_mime: "text/plain",
    unsupported_signal: "extension",
  });
}

function unsupportedDeclaredMimeFixture({
  fixture_id,
  description,
  unsupported_case,
  declared_mime,
  runtime_alignment_note,
  transport_envelope_note,
  mime_parameter_rejection_note,
}) {
  return fixture({
    fixture_id,
    description,
    fixture_family: "unsupported_declared_mime",
    unsupported_case,
    extension: ".txt",
    declared_mime,
    unsupported_signal: "declared_mime",
    runtime_alignment_note,
    transport_envelope_note,
    mime_parameter_rejection_note,
  });
}

export const UNSUPPORTED_EXTENSION_MIME_FIXTURES = Object.freeze([
  unsupportedExtensionFixture({
    fixture_id: "UNSUPMETA-P0-05F-001-BLOCK-JSON-EXTENSION",
    description: "Unsupported .json terminal extension blocks even with permitted text/plain declaration and valid TXT bytes.",
    unsupported_case: ".json",
    extension: ".json",
  }),
  unsupportedExtensionFixture({
    fixture_id: "UNSUPMETA-P0-05F-002-BLOCK-HTML-EXTENSION",
    description: "Unsupported .html terminal extension blocks even with permitted text/plain declaration and valid TXT bytes.",
    unsupported_case: ".html",
    extension: ".html",
  }),
  unsupportedExtensionFixture({
    fixture_id: "UNSUPMETA-P0-05F-003-BLOCK-JS-EXTENSION",
    description: "Unsupported .js terminal extension blocks even with permitted text/plain declaration and valid TXT bytes.",
    unsupported_case: ".js",
    extension: ".js",
  }),
  unsupportedExtensionFixture({
    fixture_id: "UNSUPMETA-P0-05F-004-BLOCK-ZIP-EXTENSION-TEXT-BYTES",
    description: "Unsupported .zip terminal extension blocks using valid TXT bytes, not ZIP bytes.",
    unsupported_case: ".zip",
    extension: ".zip",
  }),
  unsupportedExtensionFixture({
    fixture_id: "UNSUPMETA-P0-05F-005-BLOCK-EXE-EXTENSION-TEXT-BYTES",
    description: "Unsupported .exe terminal extension blocks using valid TXT bytes, not executable bytes.",
    unsupported_case: ".exe",
    extension: ".exe",
  }),
  unsupportedExtensionFixture({
    fixture_id: "UNSUPMETA-P0-05F-006-BLOCK-BIN-EXTENSION-TEXT-BYTES",
    description: "Unsupported .bin terminal extension blocks using valid TXT bytes, not unknown-binary bytes.",
    unsupported_case: ".bin",
    extension: ".bin",
  }),
  unsupportedExtensionFixture({
    fixture_id: "UNSUPMETA-P0-05F-007-BLOCK-EMPTY-EXTENSION",
    description: "Empty terminal extension blocks even with permitted text/plain declaration and valid TXT bytes.",
    unsupported_case: "empty_extension",
    extension: "",
  }),
  unsupportedExtensionFixture({
    fixture_id: "UNSUPMETA-P0-05F-008-BLOCK-MISSING-EXTENSION",
    description: "Missing terminal extension blocks even with permitted text/plain declaration and valid TXT bytes.",
    unsupported_case: "missing_extension",
    extension: null,
  }),
  unsupportedDeclaredMimeFixture({
    fixture_id: "UNSUPMETA-P0-05F-009-BLOCK-APPLICATION-JSON-MIME",
    description: "Unsupported application/json declared file MIME blocks by policy with permitted .txt extension and valid TXT bytes.",
    unsupported_case: "application/json",
    declared_mime: "application/json",
    runtime_alignment_note:
      "policy rejects application/json; current runtime alignment remains unresolved; this fixture does not prove the runtime allowlist was corrected",
  }),
  unsupportedDeclaredMimeFixture({
    fixture_id: "UNSUPMETA-P0-05F-010-BLOCK-OCTET-STREAM-MIME",
    description: "Unsupported application/octet-stream declared file MIME blocks with permitted .txt extension and valid TXT bytes.",
    unsupported_case: "application/octet-stream",
    declared_mime: "application/octet-stream",
    transport_envelope_note:
      "application/octet-stream may later be an HTTP transport envelope, but it is not an accepted declared file MIME",
  }),
  unsupportedDeclaredMimeFixture({
    fixture_id: "UNSUPMETA-P0-05F-011-BLOCK-TEXT-HTML-MIME",
    description: "Unsupported text/html declared file MIME blocks with permitted .txt extension and valid TXT bytes.",
    unsupported_case: "text/html",
    declared_mime: "text/html",
  }),
  unsupportedDeclaredMimeFixture({
    fixture_id: "UNSUPMETA-P0-05F-012-BLOCK-TEXT-JAVASCRIPT-MIME",
    description: "Unsupported text/javascript declared file MIME blocks with permitted .txt extension and valid TXT bytes.",
    unsupported_case: "text/javascript",
    declared_mime: "text/javascript",
  }),
  unsupportedDeclaredMimeFixture({
    fixture_id: "UNSUPMETA-P0-05F-013-BLOCK-APPLICATION-JAVASCRIPT-MIME",
    description: "Unsupported application/javascript declared file MIME blocks with permitted .txt extension and valid TXT bytes.",
    unsupported_case: "application/javascript",
    declared_mime: "application/javascript",
  }),
  unsupportedDeclaredMimeFixture({
    fixture_id: "UNSUPMETA-P0-05F-014-BLOCK-APPLICATION-ZIP-MIME",
    description: "Unsupported application/zip declared file MIME blocks with permitted .txt extension and valid TXT bytes.",
    unsupported_case: "application/zip",
    declared_mime: "application/zip",
  }),
  unsupportedDeclaredMimeFixture({
    fixture_id: "UNSUPMETA-P0-05F-015-BLOCK-X-ZIP-COMPRESSED-MIME",
    description: "Unsupported application/x-zip-compressed declared file MIME blocks with permitted .txt extension and valid TXT bytes.",
    unsupported_case: "application/x-zip-compressed",
    declared_mime: "application/x-zip-compressed",
  }),
  unsupportedDeclaredMimeFixture({
    fixture_id: "UNSUPMETA-P0-05F-016-BLOCK-EMPTY-MIME",
    description: "Empty declared file MIME blocks with permitted .txt extension and valid TXT bytes.",
    unsupported_case: "empty_mime",
    declared_mime: "",
  }),
  unsupportedDeclaredMimeFixture({
    fixture_id: "UNSUPMETA-P0-05F-017-BLOCK-UNKNOWN-UNLISTED-MIME",
    description: "Unknown unlisted declared file MIME blocks with permitted .txt extension and valid TXT bytes.",
    unsupported_case: "unknown_unlisted_mime",
    declared_mime: "application/x-kai-unlisted",
  }),
  unsupportedDeclaredMimeFixture({
    fixture_id: "UNSUPMETA-P0-05F-018-BLOCK-TEXT-PLAIN-PARAMETER-MIME",
    description: "Parameterized text/plain declared file MIME blocks and is not stripped to text/plain.",
    unsupported_case: "text/plain; charset=utf-8",
    declared_mime: "text/plain; charset=utf-8",
    mime_parameter_rejection_note:
      "MIME parameters are rejected in P0 file metadata and are not normalized or stripped to text/plain",
  }),
]);

export function normalizeUnsupportedMetadataExtension(extension) {
  return normalizeExtension(extension);
}

export function normalizeUnsupportedMetadataDeclaredMime(declaredMime) {
  return normalizeDeclaredMime(declaredMime);
}

export function getUnsupportedExtensionMimeFixtureExpectations() {
  return UNSUPPORTED_EXTENSION_MIME_FIXTURES.map((fixtureItem) => Object.freeze({
    fixture_id: fixtureItem.fixture_id,
    fixture_family: fixtureItem.fixture_family,
    unsupported_case: fixtureItem.unsupported_case,
    normalized_extension: fixtureItem.normalized_extension,
    normalized_declared_mime: fixtureItem.normalized_declared_mime,
    byte_source_id: fixtureItem.byte_source_id,
    expected_policy: fixtureItem.expected_policy,
    expected_category: fixtureItem.expected_category,
    scope_note: fixtureItem.scope_note,
    authority: fixtureItem.authority,
    unsupported_signal: fixtureItem.unsupported_signal,
  }));
}
