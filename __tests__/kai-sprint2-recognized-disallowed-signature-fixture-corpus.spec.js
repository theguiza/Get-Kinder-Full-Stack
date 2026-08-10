import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  EXTENSION_MIME_MATRIX_ALLOWED_PAIRINGS,
} from "./support/kaiSprint2ExtensionMimeMatrixFixtureCorpus.js";
import {
  RECOGNIZED_DISALLOWED_SIGNATURE_AUTHORITY,
  RECOGNIZED_DISALLOWED_SIGNATURE_AUTHORITY_MAP,
  RECOGNIZED_DISALLOWED_SIGNATURE_FIXTURE_CATEGORIES,
  RECOGNIZED_DISALLOWED_SIGNATURE_FIXTURE_CORPUS_STATUSES,
  RECOGNIZED_DISALLOWED_SIGNATURE_FIXTURE_POLICIES,
  RECOGNIZED_DISALLOWED_SIGNATURE_FIXTURES,
  RECOGNIZED_DISALLOWED_SIGNATURE_METADATA_AUTHORITY,
  getRecognizedDisallowedSignatureFixtureExpectations,
} from "./support/kaiSprint2RecognizedDisallowedSignatureFixtureCorpus.js";

const contractText = readFileSync(
  "Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md",
  "utf8",
);

const expectedFixtureIds = Object.freeze([
  "DISALLOWEDSIG-P0-05F-2D1-001-BLOCK-DOS-PE-MZ",
  "DISALLOWEDSIG-P0-05F-2D1-002-BLOCK-ELF",
  "DISALLOWEDSIG-P0-05F-2D1-003-BLOCK-GZIP",
  "DISALLOWEDSIG-P0-05F-2D1-004-BLOCK-7Z",
  "DISALLOWEDSIG-P0-05F-2D1-005-BLOCK-RAR4",
  "DISALLOWEDSIG-P0-05F-2D1-006-BLOCK-RAR5",
]);

const expectedContractSignatures = Object.freeze([
  Object.freeze({ family: "DOS/PE MZ", hex: "4D 5A", offset: 0 }),
  Object.freeze({ family: "ELF", hex: "7F 45 4C 46", offset: 0 }),
  Object.freeze({ family: "gzip", hex: "1F 8B", offset: 0 }),
  Object.freeze({ family: "7z", hex: "37 7A BC AF 27 1C", offset: 0 }),
  Object.freeze({ family: "RAR 4", hex: "52 61 72 21 1A 07 00", offset: 0 }),
  Object.freeze({ family: "RAR 5", hex: "52 61 72 21 1A 07 01 00", offset: 0 }),
]);

const fixtureKeys = Object.freeze([
  "fixture_id",
  "description",
  "signature_family",
  "extension",
  "normalized_extension",
  "declared_mime",
  "normalized_declared_mime",
  "bytes",
  "byte_length",
  "signature_hex",
  "signature_offset",
  "byte_source_kind",
  "expected_policy",
  "expected_category",
  "scope_note",
  "authority",
  "metadata_pairing_authority",
  "synthetic_provenance",
  "corpus_status",
  "executable_validation_claim",
  "archive_validity_claim",
  "decompression_claim",
  "parser_safety_claim",
  "malware_scanning_claim",
  "source_eligibility_claim",
  "upload_acceptance_claim",
  "production_detector_claim",
  "production_detector_answer_key",
  "unknown_binary_fixture_claim",
]);

const authorityKeys = Object.freeze([
  "source_document",
  "section_or_decision_key",
  "requirement_summary",
  "supported_expected_policy",
  "supported_expected_category",
  "authority_status",
]);

const unauthorizedFamilies = Object.freeze([
  "ZIP",
  "XLSX",
  "PDF",
  "unknown_binary",
  "ambiguous_file_type",
  "truncated_or_malformed_type",
  "standalone_archive_or_non_xlsx",
  "declared_type_mismatch",
  "unsupported_file_type",
  "application/octet-stream",
]);

function bytesFromHex(hex) {
  return new Uint8Array(hex.split(" ").map((byte) => Number.parseInt(byte, 16)));
}

function hexFromBytes(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).toUpperCase().padStart(2, "0")).join(" ");
}

function markerBytesEqual(bytes, offset, marker) {
  if (offset < 0 || offset + marker.length > bytes.byteLength) return false;
  return marker.every((byte, index) => bytes[offset + index] === byte);
}

function p0PairIsAllowed(extension, declaredMime) {
  return EXTENSION_MIME_MATRIX_ALLOWED_PAIRINGS.some(
    (pairing) => pairing.normalized_extension === extension && pairing.normalized_declared_mime === declaredMime,
  );
}

function fixtureByFamily(family) {
  const fixture = RECOGNIZED_DISALLOWED_SIGNATURE_FIXTURES.find((item) => item.signature_family === family);
  assert.ok(fixture, family);
  return fixture;
}

function contractLineForSignature({ family, hex }) {
  return new RegExp(`- ${family.replace("/", "\\/")}: \`${hex}\` at byte offset zero\\.`);
}

function matchesSignatureAtOffset(fixture, signature) {
  return markerBytesEqual(fixture.bytes, signature.offset, bytesFromHex(signature.hex));
}

test("P0-05F.2d1 authority map resolves to current checked-out contract authority", () => {
  assert.match(contractText, /OWNER_DECISION\.P0_05F\.DISALLOWED_SIGNATURE_BYTES/);
  assert.match(contractText, /recognized MZ, ELF, RAR 4, RAR 5, 7z, or gzip signature matched at byte offset zero/);
  assert.match(contractText, /\.txt\s+text\/plain/);

  for (const [authorityId, authority] of Object.entries(RECOGNIZED_DISALLOWED_SIGNATURE_AUTHORITY_MAP)) {
    assert.deepEqual(Object.keys(authority), authorityKeys, authorityId);
    assert.match(authorityId, /^OWNER_DECISION\.P0_05F\./, authorityId);
    assert.equal(authority.source_document, "Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md", authorityId);
    assert.match(authority.section_or_decision_key, /P0-05F/, authorityId);
    assert.notEqual(authority.requirement_summary.trim(), "", authorityId);
    assert.ok(RECOGNIZED_DISALLOWED_SIGNATURE_FIXTURE_POLICIES.includes(authority.supported_expected_policy), authorityId);
    assert.ok(RECOGNIZED_DISALLOWED_SIGNATURE_FIXTURE_CATEGORIES.includes(authority.supported_expected_category), authorityId);
    assert.equal(authority.authority_status, "contract_grounded", authorityId);
  }

  for (const signature of expectedContractSignatures) {
    assert.match(contractText, contractLineForSignature(signature), signature.family);
  }
});

test("P0-05F.2d1 corpus is exactly six unique closed-schema recognized signature fixtures", () => {
  assert.equal(RECOGNIZED_DISALLOWED_SIGNATURE_FIXTURES.length, 6);
  assert.deepEqual(
    RECOGNIZED_DISALLOWED_SIGNATURE_FIXTURES.map((fixture) => fixture.fixture_id),
    expectedFixtureIds,
  );
  assert.equal(
    new Set(RECOGNIZED_DISALLOWED_SIGNATURE_FIXTURES.map((fixture) => fixture.fixture_id)).size,
    RECOGNIZED_DISALLOWED_SIGNATURE_FIXTURES.length,
  );
  assert.deepEqual(
    getRecognizedDisallowedSignatureFixtureExpectations().map((fixture) => fixture.fixture_id),
    expectedFixtureIds,
  );

  for (const fixture of RECOGNIZED_DISALLOWED_SIGNATURE_FIXTURES) {
    assert.deepEqual(Object.keys(fixture), fixtureKeys, fixture.fixture_id);
    assert.ok(fixture.bytes instanceof Uint8Array, fixture.fixture_id);
    assert.equal(fixture.byte_length, fixture.bytes.byteLength, fixture.fixture_id);
    assert.equal(fixture.byte_length, bytesFromHex(fixture.signature_hex).byteLength, fixture.fixture_id);
    assert.equal(fixture.byte_source_kind, "contract_committed_minimum_signature_bytes_only", fixture.fixture_id);
    assert.equal(fixture.extension, ".txt", fixture.fixture_id);
    assert.equal(fixture.normalized_extension, ".txt", fixture.fixture_id);
    assert.equal(fixture.declared_mime, "text/plain", fixture.fixture_id);
    assert.equal(fixture.normalized_declared_mime, "text/plain", fixture.fixture_id);
    assert.equal(p0PairIsAllowed(fixture.normalized_extension, fixture.normalized_declared_mime), true, fixture.fixture_id);
    assert.equal(fixture.expected_policy, "block", fixture.fixture_id);
    assert.equal(fixture.expected_category, "disallowed_binary_signature", fixture.fixture_id);
    assert.equal(fixture.scope_note, "type_agreement_block_only", fixture.fixture_id);
    assert.equal(fixture.authority, RECOGNIZED_DISALLOWED_SIGNATURE_AUTHORITY, fixture.fixture_id);
    assert.equal(fixture.metadata_pairing_authority, RECOGNIZED_DISALLOWED_SIGNATURE_METADATA_AUTHORITY, fixture.fixture_id);
    assert.equal(fixture.corpus_status, "corpus_only", fixture.fixture_id);
    assert.ok(RECOGNIZED_DISALLOWED_SIGNATURE_FIXTURE_CORPUS_STATUSES.includes(fixture.corpus_status), fixture.fixture_id);
    assert.ok(fixture.synthetic_provenance.includes("synthetic inert"), fixture.fixture_id);
    assert.doesNotMatch(
      fixture.synthetic_provenance,
      /customer|database|cloud|credential|real client/i,
      fixture.fixture_id,
    );
    assert.equal(fixture.executable_validation_claim, false, fixture.fixture_id);
    assert.equal(fixture.archive_validity_claim, false, fixture.fixture_id);
    assert.equal(fixture.decompression_claim, false, fixture.fixture_id);
    assert.equal(fixture.parser_safety_claim, false, fixture.fixture_id);
    assert.equal(fixture.malware_scanning_claim, false, fixture.fixture_id);
    assert.equal(fixture.source_eligibility_claim, false, fixture.fixture_id);
    assert.equal(fixture.upload_acceptance_claim, false, fixture.fixture_id);
    assert.equal(fixture.production_detector_claim, false, fixture.fixture_id);
    assert.equal(fixture.production_detector_answer_key, false, fixture.fixture_id);
    assert.equal(fixture.unknown_binary_fixture_claim, false, fixture.fixture_id);
  }
});

test("each contract-recognized family appears exactly once and unauthorized families do not appear", () => {
  const actualFamilies = RECOGNIZED_DISALLOWED_SIGNATURE_FIXTURES.map((fixture) => fixture.signature_family);
  const expectedFamilies = expectedContractSignatures.map((signature) => signature.family);

  assert.deepEqual(actualFamilies, expectedFamilies);
  for (const family of expectedFamilies) {
    assert.equal(actualFamilies.filter((actual) => actual === family).length, 1, family);
  }

  for (const unauthorizedFamily of unauthorizedFamilies) {
    assert.equal(actualFamilies.includes(unauthorizedFamily), false, unauthorizedFamily);
  }
});

test("fixture bytes equal the committed contract signatures at the committed offsets", () => {
  for (const signature of expectedContractSignatures) {
    const fixture = fixtureByFamily(signature.family);
    const expectedBytes = bytesFromHex(signature.hex);

    assert.equal(fixture.signature_offset, signature.offset, fixture.fixture_id);
    assert.deepEqual(Array.from(fixture.bytes), Array.from(expectedBytes), fixture.fixture_id);
    assert.equal(hexFromBytes(fixture.bytes), signature.hex, fixture.fixture_id);
    assert.equal(matchesSignatureAtOffset(fixture, signature), true, fixture.fixture_id);
    assert.equal(fixture.bytes.byteLength >= expectedBytes.byteLength, true, fixture.fixture_id);
  }
});

test("no fixture establishes another recognized signature at the governing offset", () => {
  for (const fixture of RECOGNIZED_DISALLOWED_SIGNATURE_FIXTURES) {
    const matchingFamilies = expectedContractSignatures
      .filter((signature) => matchesSignatureAtOffset(fixture, signature))
      .map((signature) => signature.family);

    assert.deepEqual(matchingFamilies, [fixture.signature_family], fixture.fixture_id);
  }
});

test("RAR 4 and RAR 5 share only the committed prefix and remain byte-distinct", () => {
  const rar4 = fixtureByFamily("RAR 4");
  const rar5 = fixtureByFamily("RAR 5");
  const sharedPrefix = bytesFromHex("52 61 72 21 1A 07");

  assert.match(contractText, /RAR 4 and RAR 5 share the first six bytes `52 61 72 21 1A 07`/);
  assert.match(contractText, /RAR 4 ends `00` at the seventh byte/);
  assert.match(contractText, /RAR 5 ends `01 00` at the seventh and eighth bytes/);
  assert.equal(markerBytesEqual(rar4.bytes, 0, sharedPrefix), true);
  assert.equal(markerBytesEqual(rar5.bytes, 0, sharedPrefix), true);
  assert.deepEqual(Array.from(rar4.bytes.slice(0, 6)), Array.from(sharedPrefix));
  assert.deepEqual(Array.from(rar5.bytes.slice(0, 6)), Array.from(sharedPrefix));
  assert.equal(rar4.bytes[6], 0x00);
  assert.equal(rar5.bytes[6], 0x01);
  assert.equal(rar5.bytes[7], 0x00);
  assert.notDeepEqual(Array.from(rar4.bytes), Array.from(rar5.bytes));
  assert.equal(matchesSignatureAtOffset(rar5, { family: "RAR 4", hex: "52 61 72 21 1A 07 00", offset: 0 }), false);
});
