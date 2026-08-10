import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  EXTENSION_MIME_MATRIX_ALLOWED_PAIRINGS,
} from "./support/kaiSprint2ExtensionMimeMatrixFixtureCorpus.js";
import {
  RESIDUAL_UNKNOWN_BINARY_AUTHORITY,
  RESIDUAL_UNKNOWN_BINARY_AUTHORITY_MAP,
  RESIDUAL_UNKNOWN_BINARY_FIXTURE_CATEGORIES,
  RESIDUAL_UNKNOWN_BINARY_FIXTURE_CORPUS_STATUSES,
  RESIDUAL_UNKNOWN_BINARY_FIXTURE_POLICIES,
  RESIDUAL_UNKNOWN_BINARY_FIXTURES,
  RESIDUAL_UNKNOWN_BINARY_METADATA_AUTHORITY,
  getResidualUnknownBinaryFixtureExpectations,
} from "./support/kaiSprint2ResidualUnknownBinaryFixtureCorpus.js";

const contractText = readFileSync(
  "Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md",
  "utf8",
);

const expectedFixtureId = "UNKNOWNBIN-P0-05F-2D3-001-BLOCK-PDF-APPLICATION-PDF-0001";
const PDF_HEADER = Object.freeze([0x25, 0x50, 0x44, 0x46, 0x2D]);
const PDF_INCOMPLETE_PREFIX = Object.freeze([0x25, 0x50, 0x44, 0x46]);
const ZIP_LOCAL_FILE_HEADER = Object.freeze([0x50, 0x4B, 0x03, 0x04]);
const RECOGNIZED_DISALLOWED_SIGNATURES = Object.freeze([
  Object.freeze({ family: "DOS/PE MZ", bytes: Object.freeze([0x4D, 0x5A]) }),
  Object.freeze({ family: "ELF", bytes: Object.freeze([0x7F, 0x45, 0x4C, 0x46]) }),
  Object.freeze({ family: "gzip", bytes: Object.freeze([0x1F, 0x8B]) }),
  Object.freeze({ family: "7z", bytes: Object.freeze([0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C]) }),
  Object.freeze({ family: "RAR 4", bytes: Object.freeze([0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x00]) }),
  Object.freeze({ family: "RAR 5", bytes: Object.freeze([0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x01, 0x00]) }),
]);

const fixtureKeys = Object.freeze([
  "fixture_id",
  "description",
  "extension",
  "normalized_extension",
  "declared_mime",
  "normalized_declared_mime",
  "bytes",
  "byte_length",
  "bytes_hex",
  "byte_offset",
  "byte_source_kind",
  "expected_policy",
  "expected_category",
  "scope_note",
  "authority",
  "metadata_pairing_authority",
  "synthetic_provenance",
  "corpus_status",
  "fixture_family",
  "complete_pdf_identity_claim",
  "incomplete_pdf_signalling_claim",
  "readable_zip_or_xlsx_claim",
  "recognized_disallowed_signature_claim",
  "other_permitted_identity_claim",
  "malware_scanning_claim",
  "parser_safety_claim",
  "archive_validity_claim",
  "upload_acceptance_claim",
  "source_eligibility_claim",
  "usable_document_claim",
  "production_detector_claim",
  "production_detector_answer_key",
]);

const authorityKeys = Object.freeze([
  "source_document",
  "section_or_decision_key",
  "requirement_summary",
  "supported_expected_policy",
  "supported_expected_category",
  "supported_scope_note",
  "authority_status",
]);

function markerBytesEqual(bytes, offset, marker) {
  if (offset < 0 || offset + marker.length > bytes.byteLength) return false;
  return marker.every((byte, index) => bytes[offset + index] === byte);
}

function hexFromBytes(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).toUpperCase().padStart(2, "0")).join(" ");
}

function p0PairIsAllowed(extension, declaredMime) {
  return EXTENSION_MIME_MATRIX_ALLOWED_PAIRINGS.some(
    (pairing) => pairing.normalized_extension === extension && pairing.normalized_declared_mime === declaredMime,
  );
}

function containsProhibitedTextControl(bytes) {
  return Array.from(bytes).some((byte) => {
    if (byte === 0x09 || byte === 0x0A) return false;
    return byte < 0x20 || byte === 0x7F || (byte >= 0x80 && byte <= 0x9F);
  });
}

test("P0-05F.2d3 authority resolves to the committed owner decision", () => {
  assert.match(contractText, /OWNER_DECISION\.P0_05F\.RESIDUAL_UNKNOWN_BINARY_FIXTURE_V1/);
  assert.match(contractText, /bytes: 00 01/);
  assert.match(contractText, /byte_offset: zero/);
  assert.match(contractText, /extension: \.pdf/);
  assert.match(contractText, /declared_mime: application\/pdf/);
  assert.match(contractText, /expected_policy: block/);
  assert.match(contractText, /expected_category: unknown_binary/);
  assert.match(contractText, /expected_scope: unknown_binary_block_only/);
  assert.match(contractText, /none of these higher-priority outcomes/);

  for (const [authorityId, authority] of Object.entries(RESIDUAL_UNKNOWN_BINARY_AUTHORITY_MAP)) {
    assert.deepEqual(Object.keys(authority), authorityKeys, authorityId);
    assert.match(authorityId, /^OWNER_DECISION\.P0_05F\./, authorityId);
    assert.equal(authority.source_document, "Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md", authorityId);
    assert.match(authority.section_or_decision_key, /P0[-_]05F/, authorityId);
    assert.notEqual(authority.requirement_summary.trim(), "", authorityId);
    assert.ok(RESIDUAL_UNKNOWN_BINARY_FIXTURE_POLICIES.includes(authority.supported_expected_policy), authorityId);
    assert.ok(RESIDUAL_UNKNOWN_BINARY_FIXTURE_CATEGORIES.includes(authority.supported_expected_category), authorityId);
    assert.equal(authority.supported_scope_note, "unknown_binary_block_only", authorityId);
    assert.equal(authority.authority_status, "contract_grounded", authorityId);
  }
});

test("P0-05F.2d3 corpus is exactly one unique closed-schema fixture", () => {
  assert.equal(RESIDUAL_UNKNOWN_BINARY_FIXTURES.length, 1);
  assert.deepEqual(RESIDUAL_UNKNOWN_BINARY_FIXTURES.map((fixture) => fixture.fixture_id), [expectedFixtureId]);
  assert.equal(new Set(RESIDUAL_UNKNOWN_BINARY_FIXTURES.map((fixture) => fixture.fixture_id)).size, 1);
  assert.deepEqual(
    getResidualUnknownBinaryFixtureExpectations().map((fixture) => fixture.fixture_id),
    [expectedFixtureId],
  );

  const [fixture] = RESIDUAL_UNKNOWN_BINARY_FIXTURES;
  assert.deepEqual(Object.keys(fixture), fixtureKeys);
  assert.equal(fixture.extension, ".pdf");
  assert.equal(fixture.normalized_extension, ".pdf");
  assert.equal(fixture.declared_mime, "application/pdf");
  assert.equal(fixture.normalized_declared_mime, "application/pdf");
  assert.equal(fixture.byte_offset, 0);
  assert.equal(fixture.byte_length, fixture.bytes.byteLength);
  assert.equal(fixture.byte_source_kind, "contract_committed_residual_unknown_binary_fixture_bytes_only");
  assert.equal(fixture.expected_policy, "block");
  assert.equal(fixture.expected_category, "unknown_binary");
  assert.equal(fixture.scope_note, "unknown_binary_block_only");
  assert.equal(fixture.authority, RESIDUAL_UNKNOWN_BINARY_AUTHORITY);
  assert.equal(fixture.metadata_pairing_authority, RESIDUAL_UNKNOWN_BINARY_METADATA_AUTHORITY);
  assert.equal(fixture.corpus_status, "corpus_only");
  assert.ok(RESIDUAL_UNKNOWN_BINARY_FIXTURE_CORPUS_STATUSES.includes(fixture.corpus_status));
  assert.ok(fixture.synthetic_provenance.includes("synthetic inert"));
  assert.doesNotMatch(fixture.synthetic_provenance, /customer|database|cloud|credential|real client/i);
  assert.equal(fixture.fixture_family, "residual_unknown_binary");
  assert.equal(fixture.complete_pdf_identity_claim, false);
  assert.equal(fixture.incomplete_pdf_signalling_claim, false);
  assert.equal(fixture.readable_zip_or_xlsx_claim, false);
  assert.equal(fixture.recognized_disallowed_signature_claim, false);
  assert.equal(fixture.other_permitted_identity_claim, false);
  assert.equal(fixture.malware_scanning_claim, false);
  assert.equal(fixture.parser_safety_claim, false);
  assert.equal(fixture.archive_validity_claim, false);
  assert.equal(fixture.upload_acceptance_claim, false);
  assert.equal(fixture.source_eligibility_claim, false);
  assert.equal(fixture.usable_document_claim, false);
  assert.equal(fixture.production_detector_claim, false);
  assert.equal(fixture.production_detector_answer_key, false);
});

test("fixture bytes are exactly the committed two bytes at offset zero", () => {
  const [fixture] = RESIDUAL_UNKNOWN_BINARY_FIXTURES;

  assert.ok(fixture.bytes instanceof Uint8Array);
  assert.equal(fixture.bytes.byteLength, 2);
  assert.deepEqual(Array.from(fixture.bytes), [0x00, 0x01]);
  assert.equal(fixture.bytes[0], 0x00);
  assert.equal(fixture.bytes[1], 0x01);
  assert.equal(fixture.bytes_hex, "00 01");
  assert.equal(hexFromBytes(fixture.bytes), "00 01");
});

test(".pdf plus application/pdf is independently permitted by the committed matrix", () => {
  const [fixture] = RESIDUAL_UNKNOWN_BINARY_FIXTURES;

  assert.equal(p0PairIsAllowed(fixture.normalized_extension, fixture.normalized_declared_mime), true);
  assert.ok(
    EXTENSION_MIME_MATRIX_ALLOWED_PAIRINGS.some(
      (pairing) => pairing.normalized_extension === ".pdf" && pairing.normalized_declared_mime === "application/pdf",
    ),
  );
  assert.equal(fixture.metadata_pairing_authority, RESIDUAL_UNKNOWN_BINARY_METADATA_AUTHORITY);
});

test("fixture bytes establish no higher-priority PDF, ZIP, disallowed-signature, or permitted identity", () => {
  const [fixture] = RESIDUAL_UNKNOWN_BINARY_FIXTURES;

  assert.equal(markerBytesEqual(fixture.bytes, 0, PDF_HEADER), false, "not complete PDF header %PDF-");
  assert.equal(markerBytesEqual(fixture.bytes, 0, PDF_INCOMPLETE_PREFIX), false, "not incomplete PDF prefix %PDF");
  assert.equal(markerBytesEqual(fixture.bytes, 0, ZIP_LOCAL_FILE_HEADER), false, "not ZIP/XLSX local file header");

  const matchedDisallowedFamilies = RECOGNIZED_DISALLOWED_SIGNATURES
    .filter((signature) => markerBytesEqual(fixture.bytes, 0, signature.bytes))
    .map((signature) => signature.family);
  assert.deepEqual(matchedDisallowedFamilies, []);

  assert.equal(containsProhibitedTextControl(fixture.bytes), true, "not permitted text-family identity");
  assert.equal(markerBytesEqual(fixture.bytes, 0, PDF_HEADER), false, "not another complete permitted PDF identity");
  assert.equal(markerBytesEqual(fixture.bytes, 0, ZIP_LOCAL_FILE_HEADER), false, "not another complete permitted XLSX identity");
});

test("expected residual unknown-binary outcome is explicit and authority-grounded", () => {
  const [fixture] = RESIDUAL_UNKNOWN_BINARY_FIXTURES;
  const authority = RESIDUAL_UNKNOWN_BINARY_AUTHORITY_MAP[fixture.authority];

  assert.equal(fixture.expected_policy, "block");
  assert.equal(fixture.expected_category, "unknown_binary");
  assert.equal(fixture.scope_note, "unknown_binary_block_only");
  assert.equal(authority.supported_expected_policy, fixture.expected_policy);
  assert.equal(authority.supported_expected_category, fixture.expected_category);
  assert.equal(authority.supported_scope_note, fixture.scope_note);
});
