import test from "node:test";
import assert from "node:assert/strict";

import {
  EXTENSION_MIME_MATRIX_BYTE_SOURCES,
  EXTENSION_MIME_MATRIX_FIXTURES,
} from "./support/kaiSprint2ExtensionMimeMatrixFixtureCorpus.js";
import {
  PDF_SHALLOW_IDENTITY_AUTHORITY_MAP,
  PDF_SHALLOW_IDENTITY_CROSS_TYPE_CONTRADICTION_DEFERRAL,
  PDF_SHALLOW_IDENTITY_EXACT_EXPORT_PROPERTY_USED,
  PDF_SHALLOW_IDENTITY_FIXTURE_CATEGORIES,
  PDF_SHALLOW_IDENTITY_FIXTURE_CORPUS_STATUSES,
  PDF_SHALLOW_IDENTITY_FIXTURE_POLICIES,
  PDF_SHALLOW_IDENTITY_FIXTURES,
  PDF_SHALLOW_IDENTITY_IMPORTED_POSITIVE_BYTES,
  PDF_SHALLOW_IDENTITY_SOURCE_IDENTIFIER,
  PDF_SHALLOW_IDENTITY_SOURCE_MODULE,
  getPdfShallowIdentityFixtureExpectations,
} from "./support/kaiSprint2PdfShallowIdentityFixtureCorpus.js";

const PDF_HEADER = Object.freeze([0x25, 0x50, 0x44, 0x46, 0x2D]);
const PDF_TRUNCATED_PREFIX = Object.freeze([0x25, 0x50, 0x44, 0x46]);
const PDF_EOF = Object.freeze([0x25, 0x25, 0x45, 0x4F, 0x46]);
const APPENDED_BYTE = 0x41;

const expectedFixtureIds = Object.freeze([
  "PDFIDENT-P0-05F-001-ALLOW-MINIMUM-PDF",
  "PDFIDENT-P0-05F-002-BLOCK-LEADING-BYTE-BEFORE-HEADER",
  "PDFIDENT-P0-05F-003-BLOCK-TRUNCATED-PDF-PREFIX",
  "PDFIDENT-P0-05F-004-BLOCK-MISSING-EOF",
  "PDFIDENT-P0-05F-005-BLOCK-EOF-OUTSIDE-FINAL-1024",
]);

const wrongMimeFixtureIdsByDeclaredMime = Object.freeze({
  "text/csv": "EXTMIME-P0-05F-019-BLOCK-PDF-TEXT-CSV-MISMATCH",
  "application/csv": "EXTMIME-P0-05F-020-BLOCK-PDF-APPLICATION-CSV-MISMATCH",
  "text/markdown": "EXTMIME-P0-05F-021-BLOCK-PDF-TEXT-MARKDOWN-MISMATCH",
  "text/plain": "EXTMIME-P0-05F-022-BLOCK-PDF-TEXT-PLAIN-MISMATCH",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    "EXTMIME-P0-05F-023-BLOCK-PDF-XLSX-MIME-MISMATCH",
});

const fixtureKeys = Object.freeze([
  "fixture_id",
  "description",
  "extension",
  "normalized_extension",
  "declared_mime",
  "normalized_declared_mime",
  "bytes",
  "byte_length",
  "positive_pdf_source_module",
  "positive_pdf_source_identifier",
  "exact_export_property_used",
  "byte_source_kind",
  "derived_from_source_identifier",
  "expected_policy",
  "expected_category",
  "scope_note",
  "authority",
  "fixture_family",
  "derivation",
  "pdf_identity_conditions",
  "violated_identity_condition",
  "violates_exactly_one_identity_condition",
  "synthetic_provenance",
  "corpus_status",
  "usable_document_claim",
  "complete_pdf_validity_claim",
  "semantic_pdf_claim",
  "machine_readable_text_layer_claim",
  "encryption_or_password_claim",
  "active_content_claim",
  "embedded_file_claim",
  "source_eligibility_claim",
  "upload_acceptance_claim",
  "complete_file_policy_pass_claim",
  "production_detector_claim",
  "production_detector_answer_key",
  "runtime_mime_behavior_claim",
  "dependency_added_claim",
]);

const conditionKeys = Object.freeze([
  "extension_is_pdf",
  "declared_mime_is_application_pdf",
  "header_pdf_marker_at_offset_zero",
  "eof_marker_present",
  "eof_marker_within_final_1024_bytes",
]);

function markerBytesEqual(bytes, offset, marker) {
  if (offset < 0 || offset + marker.length > bytes.byteLength) return false;
  return marker.every((byte, index) => bytes[offset + index] === byte);
}

function findAllMarkerOffsets(bytes, marker) {
  const offsets = [];
  for (let offset = 0; offset <= bytes.byteLength - marker.length; offset += 1) {
    if (markerBytesEqual(bytes, offset, marker)) offsets.push(offset);
  }
  return offsets;
}

function fixtureById(fixtureId) {
  const fixture = PDF_SHALLOW_IDENTITY_FIXTURES.find((item) => item.fixture_id === fixtureId);
  assert.ok(fixture, fixtureId);
  return fixture;
}

function pdfProof(fixture) {
  const headerOffsets = findAllMarkerOffsets(fixture.bytes, PDF_HEADER);
  const eofOffsets = findAllMarkerOffsets(fixture.bytes, PDF_EOF);
  return {
    fixture_id: fixture.fixture_id,
    byte_length: fixture.bytes.byteLength,
    first_pdf_header_offset: headerOffsets.length > 0 ? headerOffsets[0] : -1,
    all_pdf_header_offsets: headerOffsets,
    all_eof_offsets: eofOffsets,
    eof_distances_to_end: eofOffsets.map((offset) => fixture.bytes.byteLength - offset),
    eof_offsets_within_final_1024: eofOffsets.filter((offset) => fixture.bytes.byteLength - offset <= 1024),
  };
}

function assertCommonFixtureIntegrity(fixture) {
  assert.deepEqual(Object.keys(fixture), fixtureKeys, fixture.fixture_id);
  assert.equal(fixture.extension, ".pdf", fixture.fixture_id);
  assert.equal(fixture.normalized_extension, ".pdf", fixture.fixture_id);
  assert.equal(fixture.declared_mime, "application/pdf", fixture.fixture_id);
  assert.equal(fixture.normalized_declared_mime, "application/pdf", fixture.fixture_id);
  assert.equal(fixture.byte_length, fixture.bytes.byteLength, fixture.fixture_id);
  assert.equal(fixture.positive_pdf_source_module, PDF_SHALLOW_IDENTITY_SOURCE_MODULE, fixture.fixture_id);
  assert.equal(fixture.positive_pdf_source_identifier, PDF_SHALLOW_IDENTITY_SOURCE_IDENTIFIER, fixture.fixture_id);
  assert.equal(fixture.exact_export_property_used, PDF_SHALLOW_IDENTITY_EXACT_EXPORT_PROPERTY_USED, fixture.fixture_id);
  assert.equal(fixture.derived_from_source_identifier, PDF_SHALLOW_IDENTITY_SOURCE_IDENTIFIER, fixture.fixture_id);
  assert.ok(PDF_SHALLOW_IDENTITY_FIXTURE_POLICIES.includes(fixture.expected_policy), fixture.fixture_id);
  assert.ok(PDF_SHALLOW_IDENTITY_FIXTURE_CATEGORIES.includes(fixture.expected_category), fixture.fixture_id);
  assert.ok(PDF_SHALLOW_IDENTITY_FIXTURE_CORPUS_STATUSES.includes(fixture.corpus_status), fixture.fixture_id);
  assert.equal(fixture.authority, "OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1", fixture.fixture_id);
  assert.ok(Object.hasOwn(PDF_SHALLOW_IDENTITY_AUTHORITY_MAP, fixture.authority), fixture.fixture_id);
  assert.deepEqual(Object.keys(fixture.pdf_identity_conditions), conditionKeys, fixture.fixture_id);
  assert.ok(fixture.synthetic_provenance.includes("synthetic"), fixture.fixture_id);
  assert.ok(fixture.synthetic_provenance.includes("P0-05F.2b2a PDF source"), fixture.fixture_id);
  assert.equal(fixture.corpus_status, "corpus_only", fixture.fixture_id);
  assert.equal(fixture.usable_document_claim, false, fixture.fixture_id);
  assert.equal(fixture.complete_pdf_validity_claim, false, fixture.fixture_id);
  assert.equal(fixture.semantic_pdf_claim, false, fixture.fixture_id);
  assert.equal(fixture.machine_readable_text_layer_claim, false, fixture.fixture_id);
  assert.equal(fixture.encryption_or_password_claim, false, fixture.fixture_id);
  assert.equal(fixture.active_content_claim, false, fixture.fixture_id);
  assert.equal(fixture.embedded_file_claim, false, fixture.fixture_id);
  assert.equal(fixture.source_eligibility_claim, false, fixture.fixture_id);
  assert.equal(fixture.upload_acceptance_claim, false, fixture.fixture_id);
  assert.equal(fixture.complete_file_policy_pass_claim, false, fixture.fixture_id);
  assert.equal(fixture.production_detector_claim, false, fixture.fixture_id);
  assert.equal(fixture.production_detector_answer_key, false, fixture.fixture_id);
  assert.equal(fixture.runtime_mime_behavior_claim, false, fixture.fixture_id);
  assert.equal(fixture.dependency_added_claim, false, fixture.fixture_id);
}

test("P0-05F.2c PDF shallow-identity corpus is exactly five unique closed-schema fixtures", () => {
  assert.deepEqual(PDF_SHALLOW_IDENTITY_FIXTURES.map((fixture) => fixture.fixture_id), expectedFixtureIds);
  assert.equal(new Set(PDF_SHALLOW_IDENTITY_FIXTURES.map((fixture) => fixture.fixture_id)).size, 5);

  for (const fixture of PDF_SHALLOW_IDENTITY_FIXTURES) {
    assertCommonFixtureIntegrity(fixture);
  }

  assert.deepEqual(
    getPdfShallowIdentityFixtureExpectations().map((fixture) => fixture.fixture_id),
    expectedFixtureIds,
  );
});

test("P0-05F.2b2a positive PDF bytes are imported directly and reused by object identity", () => {
  const sourceBytes = EXTENSION_MIME_MATRIX_BYTE_SOURCES[".pdf"].bytes;
  const positive = fixtureById("PDFIDENT-P0-05F-001-ALLOW-MINIMUM-PDF");

  assert.equal(PDF_SHALLOW_IDENTITY_SOURCE_MODULE, "__tests__/support/kaiSprint2ExtensionMimeMatrixFixtureCorpus.js");
  assert.equal(PDF_SHALLOW_IDENTITY_SOURCE_IDENTIFIER, "EXTMIME-P0-05F-BYTES-PDF-POSITIVE");
  assert.equal(PDF_SHALLOW_IDENTITY_EXACT_EXPORT_PROPERTY_USED, 'EXTENSION_MIME_MATRIX_BYTE_SOURCES[".pdf"].bytes');
  assert.equal(PDF_SHALLOW_IDENTITY_IMPORTED_POSITIVE_BYTES, sourceBytes);
  assert.equal(positive.bytes, sourceBytes);
  assert.equal(positive.bytes, PDF_SHALLOW_IDENTITY_IMPORTED_POSITIVE_BYTES);
  assert.equal(positive.byte_source_kind, "imported_p0_05f_2b2a_positive_pdf_bytes");
  assert.equal(positive.derivation, "imports and reuses the exact P0-05F.2b2a positive PDF Uint8Array object");
});

test("positive minimum PDF has offset-zero header and EOF within the final 1024 bytes", () => {
  const fixture = fixtureById("PDFIDENT-P0-05F-001-ALLOW-MINIMUM-PDF");
  const proof = pdfProof(fixture);

  assert.equal(fixture.expected_policy, "allow");
  assert.equal(fixture.expected_category, "type_agreement_pass");
  assert.equal(fixture.scope_note, "type_agreement_pass_only");
  assert.equal(proof.first_pdf_header_offset, 0);
  assert.deepEqual(proof.all_pdf_header_offsets, [0]);
  assert.ok(proof.all_eof_offsets.length >= 1);
  assert.deepEqual(proof.eof_offsets_within_final_1024, proof.all_eof_offsets);
  assert.equal(fixture.pdf_identity_conditions.header_pdf_marker_at_offset_zero, true);
  assert.equal(fixture.pdf_identity_conditions.eof_marker_present, true);
  assert.equal(fixture.pdf_identity_conditions.eof_marker_within_final_1024_bytes, true);
  assert.equal(fixture.violated_identity_condition, null);
  assert.equal(fixture.violates_exactly_one_identity_condition, false);
});

test("leading-byte PDF keeps EOF placement and violates only offset-zero header identity", () => {
  const fixture = fixtureById("PDFIDENT-P0-05F-002-BLOCK-LEADING-BYTE-BEFORE-HEADER");
  const proof = pdfProof(fixture);
  const sourceProof = pdfProof(fixtureById("PDFIDENT-P0-05F-001-ALLOW-MINIMUM-PDF"));

  assert.equal(fixture.bytes[0], 0x58);
  assert.equal(fixture.bytes.byteLength, PDF_SHALLOW_IDENTITY_IMPORTED_POSITIVE_BYTES.byteLength + 1);
  assert.equal(proof.first_pdf_header_offset, 1);
  assert.deepEqual(proof.all_pdf_header_offsets, [1]);
  assert.deepEqual(proof.all_eof_offsets, sourceProof.all_eof_offsets.map((offset) => offset + 1));
  assert.ok(proof.eof_offsets_within_final_1024.length >= 1);
  assert.deepEqual(fixture.pdf_identity_conditions, {
    extension_is_pdf: true,
    declared_mime_is_application_pdf: true,
    header_pdf_marker_at_offset_zero: false,
    eof_marker_present: true,
    eof_marker_within_final_1024_bytes: true,
  });
  assert.equal(fixture.expected_policy, "block");
  assert.equal(fixture.expected_category, "truncated_or_malformed_type");
  assert.equal(fixture.violated_identity_condition, "offset_zero_header");
  assert.equal(fixture.violates_exactly_one_identity_condition, true);
});

test("truncated-prefix PDF keeps EOF placement and violates only complete offset-zero header identity", () => {
  const fixture = fixtureById("PDFIDENT-P0-05F-003-BLOCK-TRUNCATED-PDF-PREFIX");
  const proof = pdfProof(fixture);

  assert.deepEqual(Array.from(fixture.bytes.slice(0, 4)), PDF_TRUNCATED_PREFIX);
  assert.equal(markerBytesEqual(fixture.bytes, 0, PDF_HEADER), false);
  assert.deepEqual(proof.all_pdf_header_offsets, []);
  assert.ok(proof.all_eof_offsets.length >= 1);
  assert.ok(proof.eof_offsets_within_final_1024.length >= 1);
  assert.deepEqual(fixture.pdf_identity_conditions, {
    extension_is_pdf: true,
    declared_mime_is_application_pdf: true,
    header_pdf_marker_at_offset_zero: false,
    eof_marker_present: true,
    eof_marker_within_final_1024_bytes: true,
  });
  assert.equal(fixture.expected_policy, "block");
  assert.equal(fixture.expected_category, "truncated_or_malformed_type");
  assert.equal(fixture.violated_identity_condition, "offset_zero_header");
  assert.equal(fixture.violates_exactly_one_identity_condition, true);
});

test("missing-EOF PDF keeps offset-zero header and violates only required EOF presence", () => {
  const fixture = fixtureById("PDFIDENT-P0-05F-004-BLOCK-MISSING-EOF");
  const proof = pdfProof(fixture);
  const sourceProof = pdfProof(fixtureById("PDFIDENT-P0-05F-001-ALLOW-MINIMUM-PDF"));
  const source = PDF_SHALLOW_IDENTITY_IMPORTED_POSITIVE_BYTES;
  const differingOffsets = [];

  for (let offset = 0; offset < source.byteLength; offset += 1) {
    if (source[offset] !== fixture.bytes[offset]) differingOffsets.push(offset);
  }

  assert.equal(fixture.bytes.byteLength, source.byteLength);
  assert.deepEqual(differingOffsets, [sourceProof.all_eof_offsets[0] + PDF_EOF.length - 1]);
  assert.equal(markerBytesEqual(fixture.bytes, 0, PDF_HEADER), true);
  assert.deepEqual(proof.all_pdf_header_offsets, [0]);
  assert.deepEqual(proof.all_eof_offsets, []);
  assert.deepEqual(fixture.pdf_identity_conditions, {
    extension_is_pdf: true,
    declared_mime_is_application_pdf: true,
    header_pdf_marker_at_offset_zero: true,
    eof_marker_present: false,
    eof_marker_within_final_1024_bytes: true,
  });
  assert.equal(fixture.expected_policy, "block");
  assert.equal(fixture.expected_category, "truncated_or_malformed_type");
  assert.equal(fixture.violated_identity_condition, "eof_presence");
  assert.equal(fixture.violates_exactly_one_identity_condition, true);
});

test("EOF-outside-window PDF keeps header and original EOF but violates only final-1024 placement", () => {
  const fixture = fixtureById("PDFIDENT-P0-05F-005-BLOCK-EOF-OUTSIDE-FINAL-1024");
  const proof = pdfProof(fixture);
  const sourceProof = pdfProof(fixtureById("PDFIDENT-P0-05F-001-ALLOW-MINIMUM-PDF"));
  const appendedBytes = fixture.bytes.slice(PDF_SHALLOW_IDENTITY_IMPORTED_POSITIVE_BYTES.byteLength);

  assert.equal(markerBytesEqual(fixture.bytes, 0, PDF_HEADER), true);
  assert.deepEqual(proof.all_pdf_header_offsets, [0]);
  assert.deepEqual(proof.all_eof_offsets, sourceProof.all_eof_offsets);
  assert.equal(proof.all_eof_offsets.length, 1);
  assert.deepEqual(proof.eof_offsets_within_final_1024, []);
  assert.equal(proof.eof_distances_to_end[0] > 1024, true);
  assert.equal(appendedBytes.byteLength, 1024);
  assert.equal(appendedBytes.every((byte) => byte === APPENDED_BYTE), true);
  assert.deepEqual(findAllMarkerOffsets(appendedBytes, PDF_HEADER), []);
  assert.deepEqual(findAllMarkerOffsets(appendedBytes, PDF_EOF), []);
  assert.deepEqual(fixture.pdf_identity_conditions, {
    extension_is_pdf: true,
    declared_mime_is_application_pdf: true,
    header_pdf_marker_at_offset_zero: true,
    eof_marker_present: true,
    eof_marker_within_final_1024_bytes: false,
  });
  assert.equal(fixture.expected_policy, "block");
  assert.equal(fixture.expected_category, "truncated_or_malformed_type");
  assert.equal(fixture.violated_identity_condition, "eof_final_1024_window");
  assert.equal(fixture.violates_exactly_one_identity_condition, true);
});

test("all structural report fields are computed by direct raw-byte marker offsets", () => {
  const rows = PDF_SHALLOW_IDENTITY_FIXTURES.map((fixture) => ({
    fixture_id: fixture.fixture_id,
    extension: fixture.extension,
    declared_mime: fixture.declared_mime,
    byte_length: fixture.byte_length,
    first_pdf_header_offset: pdfProof(fixture).first_pdf_header_offset,
    eof_offsets: pdfProof(fixture).all_eof_offsets,
    eof_distances_to_end: pdfProof(fixture).eof_distances_to_end,
    expected_policy: fixture.expected_policy,
    expected_category: fixture.expected_category,
    scope_note: fixture.scope_note,
  }));

  assert.deepEqual(rows.map((row) => row.fixture_id), expectedFixtureIds);
  assert.deepEqual(rows, [
    {
      fixture_id: "PDFIDENT-P0-05F-001-ALLOW-MINIMUM-PDF",
      extension: ".pdf",
      declared_mime: "application/pdf",
      byte_length: 48,
      first_pdf_header_offset: 0,
      eof_offsets: [42],
      eof_distances_to_end: [6],
      expected_policy: "allow",
      expected_category: "type_agreement_pass",
      scope_note: "type_agreement_pass_only",
    },
    {
      fixture_id: "PDFIDENT-P0-05F-002-BLOCK-LEADING-BYTE-BEFORE-HEADER",
      extension: ".pdf",
      declared_mime: "application/pdf",
      byte_length: 49,
      first_pdf_header_offset: 1,
      eof_offsets: [43],
      eof_distances_to_end: [6],
      expected_policy: "block",
      expected_category: "truncated_or_malformed_type",
      scope_note: "pdf_shallow_identity_block_only",
    },
    {
      fixture_id: "PDFIDENT-P0-05F-003-BLOCK-TRUNCATED-PDF-PREFIX",
      extension: ".pdf",
      declared_mime: "application/pdf",
      byte_length: 47,
      first_pdf_header_offset: -1,
      eof_offsets: [41],
      eof_distances_to_end: [6],
      expected_policy: "block",
      expected_category: "truncated_or_malformed_type",
      scope_note: "pdf_shallow_identity_block_only",
    },
    {
      fixture_id: "PDFIDENT-P0-05F-004-BLOCK-MISSING-EOF",
      extension: ".pdf",
      declared_mime: "application/pdf",
      byte_length: 48,
      first_pdf_header_offset: 0,
      eof_offsets: [],
      eof_distances_to_end: [],
      expected_policy: "block",
      expected_category: "truncated_or_malformed_type",
      scope_note: "pdf_shallow_identity_block_only",
    },
    {
      fixture_id: "PDFIDENT-P0-05F-005-BLOCK-EOF-OUTSIDE-FINAL-1024",
      extension: ".pdf",
      declared_mime: "application/pdf",
      byte_length: 1072,
      first_pdf_header_offset: 0,
      eof_offsets: [42],
      eof_distances_to_end: [1030],
      expected_policy: "block",
      expected_category: "truncated_or_malformed_type",
      scope_note: "pdf_shallow_identity_block_only",
    },
  ]);
});

test("existing P0-05F.2b2a PDF wrong-MIME coverage remains existing declared_type_mismatch coverage", () => {
  for (const [declaredMime, fixtureId] of Object.entries(wrongMimeFixtureIdsByDeclaredMime)) {
    const fixture = EXTENSION_MIME_MATRIX_FIXTURES.find((item) => item.fixture_id === fixtureId);
    assert.ok(fixture, fixtureId);
    assert.equal(fixture.extension, ".pdf", fixtureId);
    assert.equal(fixture.normalized_extension, ".pdf", fixtureId);
    assert.equal(fixture.declared_mime, declaredMime, fixtureId);
    assert.equal(fixture.expected_policy, "block", fixtureId);
    assert.equal(fixture.expected_category, "declared_type_mismatch", fixtureId);
    assert.equal(fixture.bytes, EXTENSION_MIME_MATRIX_BYTE_SOURCES[".pdf"].bytes, fixtureId);
  }
});

test("cross-type positive-PDF-bytes spoof fixture remains deferred without inferred category", () => {
  assert.equal(PDF_SHALLOW_IDENTITY_CROSS_TYPE_CONTRADICTION_DEFERRAL.fixture_added, false);
  assert.equal(PDF_SHALLOW_IDENTITY_CROSS_TYPE_CONTRADICTION_DEFERRAL.category_inferred, false);
  assert.match(
    PDF_SHALLOW_IDENTITY_CROSS_TYPE_CONTRADICTION_DEFERRAL.status,
    /deferred_to_separate_general_cross_type_owner_decision_before_P0_05F_2d/,
  );
});
