import test from "node:test";
import assert from "node:assert/strict";

import {
  EXTENSION_MIME_MATRIX_BYTE_SOURCES,
} from "./support/kaiSprint2ExtensionMimeMatrixFixtureCorpus.js";
import {
  UNSUPPORTED_DECLARED_MIME_REQUIRED_CASES,
  UNSUPPORTED_EXTENSION_MIME_AUTHORITY_MAP,
  UNSUPPORTED_EXTENSION_MIME_FIXTURE_CATEGORIES,
  UNSUPPORTED_EXTENSION_MIME_FIXTURE_CORPUS_STATUSES,
  UNSUPPORTED_EXTENSION_MIME_FIXTURE_POLICIES,
  UNSUPPORTED_EXTENSION_MIME_FIXTURES,
  UNSUPPORTED_EXTENSION_REQUIRED_CASES,
  UNSUPPORTED_METADATA_BYTE_SOURCES,
  getUnsupportedExtensionMimeFixtureExpectations,
  normalizeUnsupportedMetadataDeclaredMime,
  normalizeUnsupportedMetadataExtension,
} from "./support/kaiSprint2UnsupportedExtensionMimeFixtureCorpus.js";

const utf8FatalDecoder = new TextDecoder("utf-8", { fatal: true });
const asciiDecoder = new TextDecoder("ascii");

const expectedUnsupportedExtensionFixtureIds = Object.freeze([
  "UNSUPMETA-P0-05F-001-BLOCK-JSON-EXTENSION",
  "UNSUPMETA-P0-05F-002-BLOCK-HTML-EXTENSION",
  "UNSUPMETA-P0-05F-003-BLOCK-JS-EXTENSION",
  "UNSUPMETA-P0-05F-004-BLOCK-ZIP-EXTENSION-TEXT-BYTES",
  "UNSUPMETA-P0-05F-005-BLOCK-EXE-EXTENSION-TEXT-BYTES",
  "UNSUPMETA-P0-05F-006-BLOCK-BIN-EXTENSION-TEXT-BYTES",
  "UNSUPMETA-P0-05F-007-BLOCK-EMPTY-EXTENSION",
  "UNSUPMETA-P0-05F-008-BLOCK-MISSING-EXTENSION",
]);

const expectedUnsupportedDeclaredMimeFixtureIds = Object.freeze([
  "UNSUPMETA-P0-05F-009-BLOCK-APPLICATION-JSON-MIME",
  "UNSUPMETA-P0-05F-010-BLOCK-OCTET-STREAM-MIME",
  "UNSUPMETA-P0-05F-011-BLOCK-TEXT-HTML-MIME",
  "UNSUPMETA-P0-05F-012-BLOCK-TEXT-JAVASCRIPT-MIME",
  "UNSUPMETA-P0-05F-013-BLOCK-APPLICATION-JAVASCRIPT-MIME",
  "UNSUPMETA-P0-05F-014-BLOCK-APPLICATION-ZIP-MIME",
  "UNSUPMETA-P0-05F-015-BLOCK-X-ZIP-COMPRESSED-MIME",
  "UNSUPMETA-P0-05F-016-BLOCK-EMPTY-MIME",
  "UNSUPMETA-P0-05F-017-BLOCK-UNKNOWN-UNLISTED-MIME",
  "UNSUPMETA-P0-05F-018-BLOCK-TEXT-PLAIN-PARAMETER-MIME",
]);

const fixtureKeys = Object.freeze([
  "fixture_id",
  "description",
  "fixture_family",
  "unsupported_case",
  "extension",
  "extension_present",
  "normalized_extension",
  "declared_mime",
  "normalized_declared_mime",
  "bytes",
  "byte_length",
  "byte_source_id",
  "byte_source_kind",
  "selected_permitted_type",
  "expected_policy",
  "expected_category",
  "scope_note",
  "authority",
  "unsupported_signal",
  "extension_supported",
  "declared_mime_supported",
  "bytes_valid_for_selected_permitted_type",
  "bytes_valid_for_extension",
  "malformed_fixture_claim",
  "truncated_fixture_claim",
  "invalid_utf8_claim",
  "unknown_binary_claim",
  "recognized_disallowed_signature_claim",
  "pdf_identity_failure_claim",
  "xlsx_identity_failure_claim",
  "runtime_alignment_note",
  "transport_envelope_note",
  "mime_parameter_rejection_note",
  "synthetic_provenance",
  "corpus_status",
  "usable_document_claim",
  "source_eligibility_claim",
  "production_detector_claim",
  "semantic_content_inspected",
  "production_detector_answer_key",
  "production_detector_conformance_claim",
]);

function fixtureById(fixtureId) {
  const fixture = UNSUPPORTED_EXTENSION_MIME_FIXTURES.find((item) => item.fixture_id === fixtureId);
  assert.ok(fixture, fixtureId);
  return fixture;
}

function assertNoRecognizedDisallowedBinarySignature(bytes, fixtureId) {
  const prefix2 = asciiDecoder.decode(bytes.slice(0, 2));
  const prefix4 = Array.from(bytes.slice(0, 4));
  const prefix6 = Array.from(bytes.slice(0, 6));

  assert.notEqual(prefix2, "MZ", fixtureId);
  assert.notDeepEqual(prefix4, [0x7F, 0x45, 0x4C, 0x46], fixtureId);
  assert.notDeepEqual(prefix4, [0x50, 0x4B, 0x03, 0x04], fixtureId);
  assert.notDeepEqual(prefix4, [0x50, 0x4B, 0x05, 0x06], fixtureId);
  assert.notDeepEqual(prefix4, [0x50, 0x4B, 0x07, 0x08], fixtureId);
  assert.notDeepEqual(prefix6, [0x52, 0x61, 0x72, 0x21, 0x1A, 0x07], fixtureId);
  assert.notDeepEqual(prefix6, [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C], fixtureId);
  assert.notDeepEqual(prefix2, "\x1F\x8B", fixtureId);
}

function assertNoPdfOrXlsxIdentitySignal(bytes, fixtureId) {
  assert.notEqual(asciiDecoder.decode(bytes.slice(0, 5)), "%PDF-", fixtureId);
  assert.notDeepEqual(Array.from(bytes.slice(0, 4)), [0x50, 0x4B, 0x03, 0x04], fixtureId);
}

test("P0-05F.2b2b unsupported metadata fixtures are unique, synthetic, closed-schema, and authority-grounded", () => {
  const fixtureIds = UNSUPPORTED_EXTENSION_MIME_FIXTURES.map((fixture) => fixture.fixture_id);
  assert.deepEqual(fixtureIds, [
    ...expectedUnsupportedExtensionFixtureIds,
    ...expectedUnsupportedDeclaredMimeFixtureIds,
  ]);
  assert.equal(new Set(fixtureIds).size, fixtureIds.length);
  assert.equal(fixtureIds.length, 18);

  for (const fixture of UNSUPPORTED_EXTENSION_MIME_FIXTURES) {
    assert.deepEqual(Object.keys(fixture), fixtureKeys, fixture.fixture_id);
    assert.ok(UNSUPPORTED_EXTENSION_MIME_FIXTURE_POLICIES.includes(fixture.expected_policy), fixture.fixture_id);
    assert.ok(UNSUPPORTED_EXTENSION_MIME_FIXTURE_CATEGORIES.includes(fixture.expected_category), fixture.fixture_id);
    assert.ok(UNSUPPORTED_EXTENSION_MIME_FIXTURE_CORPUS_STATUSES.includes(fixture.corpus_status), fixture.fixture_id);
    assert.equal(fixture.authority, "OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1", fixture.fixture_id);
    assert.ok(Object.hasOwn(UNSUPPORTED_EXTENSION_MIME_AUTHORITY_MAP, fixture.authority), fixture.fixture_id);
    assert.ok(fixture.synthetic_provenance.includes("synthetic"), fixture.fixture_id);
    assert.doesNotMatch(fixture.synthetic_provenance, /customer|database|cloud|credential|real documents/i, fixture.fixture_id);
    assert.equal(fixture.corpus_status, "corpus_only", fixture.fixture_id);
    assert.equal(fixture.usable_document_claim, false, fixture.fixture_id);
    assert.equal(fixture.source_eligibility_claim, false, fixture.fixture_id);
    assert.equal(fixture.production_detector_claim, false, fixture.fixture_id);
    assert.equal(fixture.production_detector_conformance_claim, false, fixture.fixture_id);
    assert.equal(fixture.semantic_content_inspected, false, fixture.fixture_id);
    assert.equal(fixture.production_detector_answer_key, false, fixture.fixture_id);
    assert.equal(fixture.expected_policy, "block", fixture.fixture_id);
    assert.equal(fixture.expected_category, "unsupported_file_type", fixture.fixture_id);
    assert.equal(fixture.scope_note, "unsupported_metadata_block_only", fixture.fixture_id);
  }

  assert.deepEqual(
    getUnsupportedExtensionMimeFixtureExpectations().map((fixture) => fixture.fixture_id),
    fixtureIds,
  );
});

test("eight required unsupported-extension cases and ten unsupported-MIME cases are present separately", () => {
  const extensionFixtures = UNSUPPORTED_EXTENSION_MIME_FIXTURES.filter((fixture) => fixture.fixture_family === "unsupported_extension");
  const declaredMimeFixtures = UNSUPPORTED_EXTENSION_MIME_FIXTURES.filter((fixture) => fixture.fixture_family === "unsupported_declared_mime");

  assert.deepEqual(extensionFixtures.map((fixture) => fixture.fixture_id), expectedUnsupportedExtensionFixtureIds);
  assert.deepEqual(declaredMimeFixtures.map((fixture) => fixture.fixture_id), expectedUnsupportedDeclaredMimeFixtureIds);
  assert.deepEqual(extensionFixtures.map((fixture) => fixture.unsupported_case), UNSUPPORTED_EXTENSION_REQUIRED_CASES);
  assert.deepEqual(declaredMimeFixtures.map((fixture) => fixture.unsupported_case), UNSUPPORTED_DECLARED_MIME_REQUIRED_CASES);
  assert.equal(extensionFixtures.length, 8);
  assert.equal(declaredMimeFixtures.length, 10);
});

test("unsupported-extension fixtures isolate extension as the only unsupported metadata signal", () => {
  for (const fixture of UNSUPPORTED_EXTENSION_MIME_FIXTURES.filter((item) => item.fixture_family === "unsupported_extension")) {
    assert.equal(fixture.unsupported_signal, "extension", fixture.fixture_id);
    assert.equal(fixture.extension_supported, false, fixture.fixture_id);
    assert.equal(fixture.declared_mime, "text/plain", fixture.fixture_id);
    assert.equal(fixture.normalized_declared_mime, "text/plain", fixture.fixture_id);
    assert.equal(fixture.declared_mime_supported, true, fixture.fixture_id);
    assert.equal(fixture.bytes_valid_for_selected_permitted_type, true, fixture.fixture_id);
    assert.equal(fixture.bytes_valid_for_extension, null, fixture.fixture_id);
    assert.equal(fixture.selected_permitted_type, ".txt + text/plain", fixture.fixture_id);
    assert.equal(normalizeUnsupportedMetadataExtension(fixture.extension), fixture.normalized_extension, fixture.fixture_id);
  }
});

test("unsupported-MIME fixtures isolate declared MIME as the only unsupported metadata signal", () => {
  for (const fixture of UNSUPPORTED_EXTENSION_MIME_FIXTURES.filter((item) => item.fixture_family === "unsupported_declared_mime")) {
    assert.equal(fixture.unsupported_signal, "declared_mime", fixture.fixture_id);
    assert.equal(fixture.extension, ".txt", fixture.fixture_id);
    assert.equal(fixture.normalized_extension, ".txt", fixture.fixture_id);
    assert.equal(fixture.extension_supported, true, fixture.fixture_id);
    assert.equal(fixture.declared_mime_supported, false, fixture.fixture_id);
    assert.equal(fixture.bytes_valid_for_selected_permitted_type, true, fixture.fixture_id);
    assert.equal(fixture.bytes_valid_for_extension, true, fixture.fixture_id);
    assert.equal(fixture.selected_permitted_type, ".txt + text/plain", fixture.fixture_id);
    assert.equal(normalizeUnsupportedMetadataDeclaredMime(fixture.declared_mime), fixture.normalized_declared_mime, fixture.fixture_id);
  }
});

test("all fixtures use one imported deterministic valid TXT byte source and no binary signature bytes", () => {
  const txtSource = EXTENSION_MIME_MATRIX_BYTE_SOURCES[".txt"];
  assert.equal(UNSUPPORTED_METADATA_BYTE_SOURCES.permitted_txt.bytes, txtSource.bytes);
  assert.equal(UNSUPPORTED_METADATA_BYTE_SOURCES.permitted_txt.source_id, "EXTMIME-P0-05F-BYTES-TXT-VALID");

  for (const fixture of UNSUPPORTED_EXTENSION_MIME_FIXTURES) {
    assert.equal(fixture.bytes, txtSource.bytes, fixture.fixture_id);
    assert.equal(fixture.byte_source_id, txtSource.source_id, fixture.fixture_id);
    assert.equal(fixture.byte_source_kind, txtSource.source_kind, fixture.fixture_id);
    assert.equal(fixture.byte_length, txtSource.bytes.byteLength, fixture.fixture_id);
    assert.doesNotThrow(() => utf8FatalDecoder.decode(fixture.bytes), fixture.fixture_id);
    assertNoRecognizedDisallowedBinarySignature(fixture.bytes, fixture.fixture_id);
    assertNoPdfOrXlsxIdentitySignal(fixture.bytes, fixture.fixture_id);
  }
});

test(".zip, .exe, and .bin extension fixtures use permitted text bytes, not archive, executable, or unknown-binary bytes", () => {
  for (const fixtureId of [
    "UNSUPMETA-P0-05F-004-BLOCK-ZIP-EXTENSION-TEXT-BYTES",
    "UNSUPMETA-P0-05F-005-BLOCK-EXE-EXTENSION-TEXT-BYTES",
    "UNSUPMETA-P0-05F-006-BLOCK-BIN-EXTENSION-TEXT-BYTES",
  ]) {
    const fixture = fixtureById(fixtureId);
    assert.equal(fixture.declared_mime, "text/plain", fixtureId);
    assert.equal(fixture.byte_source_id, "EXTMIME-P0-05F-BYTES-TXT-VALID", fixtureId);
    assert.doesNotThrow(() => utf8FatalDecoder.decode(fixture.bytes), fixtureId);
    assertNoRecognizedDisallowedBinarySignature(fixture.bytes, fixtureId);
    assertNoPdfOrXlsxIdentitySignal(fixture.bytes, fixtureId);
    assert.equal(fixture.unknown_binary_claim, false, fixtureId);
  }
});

test("fixtures are not malformed, truncated, invalid UTF-8, unknown binary, signature, PDF, or XLSX negatives", () => {
  for (const fixture of UNSUPPORTED_EXTENSION_MIME_FIXTURES) {
    assert.equal(fixture.malformed_fixture_claim, false, fixture.fixture_id);
    assert.equal(fixture.truncated_fixture_claim, false, fixture.fixture_id);
    assert.equal(fixture.invalid_utf8_claim, false, fixture.fixture_id);
    assert.equal(fixture.unknown_binary_claim, false, fixture.fixture_id);
    assert.equal(fixture.recognized_disallowed_signature_claim, false, fixture.fixture_id);
    assert.equal(fixture.pdf_identity_failure_claim, false, fixture.fixture_id);
    assert.equal(fixture.xlsx_identity_failure_claim, false, fixture.fixture_id);
  }
});

test("MIME parameters are rejected and not stripped to text/plain", () => {
  const fixture = fixtureById("UNSUPMETA-P0-05F-018-BLOCK-TEXT-PLAIN-PARAMETER-MIME");
  assert.equal(fixture.declared_mime, "text/plain; charset=utf-8");
  assert.equal(fixture.normalized_declared_mime, "text/plain; charset=utf-8");
  assert.notEqual(fixture.normalized_declared_mime, "text/plain");
  assert.equal(fixture.expected_policy, "block");
  assert.equal(fixture.expected_category, "unsupported_file_type");
  assert.match(fixture.mime_parameter_rejection_note, /not normalized or stripped to text\/plain/);
});

test("application/json blocks by policy while the runtime divergence remains explicitly open", () => {
  const fixture = fixtureById("UNSUPMETA-P0-05F-009-BLOCK-APPLICATION-JSON-MIME");
  assert.equal(fixture.declared_mime, "application/json");
  assert.equal(fixture.normalized_declared_mime, "application/json");
  assert.equal(fixture.expected_policy, "block");
  assert.equal(fixture.expected_category, "unsupported_file_type");
  assert.match(fixture.runtime_alignment_note, /policy rejects application\/json/);
  assert.match(fixture.runtime_alignment_note, /current runtime alignment remains unresolved/);
  assert.match(fixture.runtime_alignment_note, /does not prove the runtime allowlist was corrected/);
});

test("application/octet-stream blocks as declared file MIME, separate from possible HTTP transport envelope use", () => {
  const fixture = fixtureById("UNSUPMETA-P0-05F-010-BLOCK-OCTET-STREAM-MIME");
  assert.equal(fixture.declared_mime, "application/octet-stream");
  assert.equal(fixture.normalized_declared_mime, "application/octet-stream");
  assert.equal(fixture.expected_policy, "block");
  assert.equal(fixture.expected_category, "unsupported_file_type");
  assert.match(fixture.transport_envelope_note, /may later be an HTTP transport envelope/);
  assert.match(fixture.transport_envelope_note, /not an accepted declared file MIME/);
});
