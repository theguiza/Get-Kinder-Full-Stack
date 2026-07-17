import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  TEXT_TYPE_AGREEMENT_ALLOWED_PAIRINGS,
  TEXT_TYPE_AGREEMENT_AUTHORITY_MAP,
  TEXT_TYPE_AGREEMENT_FIXTURE_CATEGORIES,
  TEXT_TYPE_AGREEMENT_FIXTURE_CORPUS_STATUSES,
  TEXT_TYPE_AGREEMENT_FIXTURE_POLICIES,
  TEXT_TYPE_AGREEMENT_FIXTURES,
  bytesFromHex,
  getTextTypeAgreementFixtureExpectations,
  normalizeTextTypeFixtureDeclaredMime,
  normalizeTextTypeFixtureExtension,
} from "./support/kaiSprint2TextTypeAgreementFixtureCorpus.js";

const utf8FatalDecoder = new TextDecoder("utf-8", { fatal: true });

const fixtureKeys = Object.freeze([
  "fixture_id",
  "description",
  "extension",
  "normalized_extension",
  "declared_mime",
  "normalized_declared_mime",
  "bytes_hex",
  "byte_length",
  "expected_policy",
  "expected_category",
  "scope_note",
  "authority",
  "text_byte_authority",
  "fixture_family",
  "normalization_case",
  "synthetic_provenance",
  "corpus_status",
  "usable_document_claim",
  "source_eligibility_claim",
  "production_detector_claim",
  "semantic_content_inspected",
  "production_detector_answer_key",
]);

const authorityKeys = Object.freeze([
  "source_document",
  "section_or_decision_key",
  "requirement_summary",
  "authority_status",
]);

const expectedFixtureIds = Object.freeze([
  "TEXTTYPE-P0-05F-001-ALLOW-CSV-TEXT-CSV-UPPERCASE-EMPTY",
  "TEXTTYPE-P0-05F-002-ALLOW-CSV-APPLICATION-CSV-INSTRUCTION",
  "TEXTTYPE-P0-05F-003-ALLOW-MD-TEXT-MARKDOWN-EMPTY",
  "TEXTTYPE-P0-05F-004-ALLOW-MD-TEXT-PLAIN-HTML-SCRIPT-LOOKING",
  "TEXTTYPE-P0-05F-005-ALLOW-TXT-TEXT-PLAIN-EMPTY",
  "TEXTTYPE-P0-05F-006-BLOCK-TXT-TEXT-MARKDOWN-MISMATCH",
]);

const policyAllowlist = new Set(TEXT_TYPE_AGREEMENT_FIXTURE_POLICIES);
const categoryAllowlist = new Set(TEXT_TYPE_AGREEMENT_FIXTURE_CATEGORIES);
const corpusStatusAllowlist = new Set(TEXT_TYPE_AGREEMENT_FIXTURE_CORPUS_STATUSES);

function fixtureById(fixtureId) {
  const fixture = TEXT_TYPE_AGREEMENT_FIXTURES.find((item) => item.fixture_id === fixtureId);
  assert.ok(fixture, fixtureId);
  return fixture;
}

function fatalDecode(fixture) {
  return utf8FatalDecoder.decode(bytesFromHex(fixture.bytes_hex));
}

function codePoints(value) {
  return Array.from(value, (char) => char.codePointAt(0));
}

function assertCommittedTextControlBoundary(decoded, fixtureId) {
  const points = codePoints(decoded);
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    assert.notEqual(point, 0x00, fixtureId);
    assert.notEqual(point, 0x7F, fixtureId);
    assert.equal(point >= 0x80 && point <= 0x9F, false, fixtureId);

    if (point === 0x0D) {
      assert.equal(points[index + 1], 0x0A, fixtureId);
      continue;
    }

    if (point < 0x20) {
      assert.ok(point === 0x09 || point === 0x0A, fixtureId);
    }
  }
}

test("text-family type-agreement authority map is closed, grounded, and not runtime authority", () => {
  for (const [authorityId, authority] of Object.entries(TEXT_TYPE_AGREEMENT_AUTHORITY_MAP)) {
    assert.deepEqual(Object.keys(authority), authorityKeys, authorityId);
    assert.match(authorityId, /^OWNER_DECISION\.P0_05[CF]\./, authorityId);
    assert.equal(authority.source_document, "Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md", authorityId);
    assert.match(authority.section_or_decision_key, /P0-05[CF]/, authorityId);
    assert.notEqual(authority.requirement_summary.trim(), "", authorityId);
    assert.equal(authority.authority_status, "contract_grounded", authorityId);
    assert.doesNotMatch(
      `${authority.section_or_decision_key} ${authority.requirement_summary}`,
      /current detector|runtime behavior|upload transport|parser|profiler|profile eligibility|production detector/i,
      authorityId,
    );
  }
});

test("text-family type-agreement fixtures are synthetic, unique, complete, and closed-schema", () => {
  const fixtureIds = TEXT_TYPE_AGREEMENT_FIXTURES.map((fixture) => fixture.fixture_id);
  assert.deepEqual(fixtureIds, expectedFixtureIds);
  assert.deepEqual(fixtureIds, [...fixtureIds].sort());
  assert.equal(new Set(fixtureIds).size, fixtureIds.length);

  for (const fixture of TEXT_TYPE_AGREEMENT_FIXTURES) {
    assert.deepEqual(Object.keys(fixture), fixtureKeys, fixture.fixture_id);
    assert.ok(policyAllowlist.has(fixture.expected_policy), fixture.fixture_id);
    assert.ok(categoryAllowlist.has(fixture.expected_category), fixture.fixture_id);
    assert.ok(corpusStatusAllowlist.has(fixture.corpus_status), fixture.fixture_id);
    assert.ok(Object.hasOwn(TEXT_TYPE_AGREEMENT_AUTHORITY_MAP, fixture.authority), fixture.fixture_id);
    assert.ok(Object.hasOwn(TEXT_TYPE_AGREEMENT_AUTHORITY_MAP, fixture.text_byte_authority), fixture.fixture_id);
    assert.ok(fixture.synthetic_provenance.includes("synthetic"), fixture.fixture_id);
    assert.doesNotMatch(fixture.synthetic_provenance, /copied|customer|database|cloud|credential|real documents/i, fixture.fixture_id);
    assert.equal(fixture.corpus_status, "corpus_only", fixture.fixture_id);
    assert.equal(fixture.usable_document_claim, false, fixture.fixture_id);
    assert.equal(fixture.source_eligibility_claim, false, fixture.fixture_id);
    assert.equal(fixture.production_detector_claim, false, fixture.fixture_id);
    assert.equal(fixture.semantic_content_inspected, false, fixture.fixture_id);
    assert.equal(fixture.production_detector_answer_key, false, fixture.fixture_id);
    assert.equal(fixture.scope_note, fixture.expected_policy === "allow" ? "type_agreement_pass_only" : "type_agreement_block_only", fixture.fixture_id);
  }

  assert.deepEqual(
    getTextTypeAgreementFixtureExpectations().map((fixture) => fixture.fixture_id),
    expectedFixtureIds,
  );
});

test("five permitted CSV/Markdown/TXT pairings appear exactly once as positive fixtures", () => {
  const expectedPairings = TEXT_TYPE_AGREEMENT_ALLOWED_PAIRINGS.map(
    (pairing) => `${pairing.normalized_extension}:${pairing.normalized_declared_mime}`,
  );
  const positivePairings = TEXT_TYPE_AGREEMENT_FIXTURES
    .filter((fixture) => fixture.expected_policy === "allow")
    .map((fixture) => `${fixture.normalized_extension}:${fixture.normalized_declared_mime}`);

  assert.deepEqual(positivePairings, expectedPairings);
  assert.equal(new Set(positivePairings).size, 5);

  for (const fixture of TEXT_TYPE_AGREEMENT_FIXTURES.filter((item) => item.expected_policy === "allow")) {
    assert.equal(fixture.expected_category, "type_agreement_pass", fixture.fixture_id);
    assert.equal(fixture.scope_note, "type_agreement_pass_only", fixture.fixture_id);
  }
});

test("extension and declared-MIME normalization match the committed P0-05F contract", () => {
  const uppercaseExtension = fixtureById("TEXTTYPE-P0-05F-001-ALLOW-CSV-TEXT-CSV-UPPERCASE-EMPTY");
  assert.equal(uppercaseExtension.extension, ".CSV");
  assert.equal(normalizeTextTypeFixtureExtension(uppercaseExtension.extension), ".csv");
  assert.equal(uppercaseExtension.normalized_extension, ".csv");

  const mixedMime = fixtureById("TEXTTYPE-P0-05F-002-ALLOW-CSV-APPLICATION-CSV-INSTRUCTION");
  assert.equal(mixedMime.declared_mime, "Application/CSV");
  assert.equal(normalizeTextTypeFixtureDeclaredMime(mixedMime.declared_mime), "application/csv");
  assert.equal(mixedMime.normalized_declared_mime, "application/csv");

  const whitespaceMime = fixtureById("TEXTTYPE-P0-05F-004-ALLOW-MD-TEXT-PLAIN-HTML-SCRIPT-LOOKING");
  assert.match(whitespaceMime.declared_mime, /^[\t\r\n ]/);
  assert.match(whitespaceMime.declared_mime, /[\t\r\n ]$/);
  assert.equal(normalizeTextTypeFixtureDeclaredMime(whitespaceMime.declared_mime), "text/plain");
  assert.equal(whitespaceMime.normalized_declared_mime, "text/plain");

  for (const fixture of TEXT_TYPE_AGREEMENT_FIXTURES) {
    assert.equal(normalizeTextTypeFixtureExtension(fixture.extension), fixture.normalized_extension, fixture.fixture_id);
    assert.equal(normalizeTextTypeFixtureDeclaredMime(fixture.declared_mime), fixture.normalized_declared_mime, fixture.fixture_id);
  }
});

test("positive bytes pass fatal UTF-8 and the committed text control boundary", () => {
  for (const fixture of TEXT_TYPE_AGREEMENT_FIXTURES.filter((item) => item.expected_policy === "allow")) {
    assert.match(fixture.bytes_hex, /^$|^[0-9A-F]{2}( [0-9A-F]{2})*$/, fixture.fixture_id);
    const bytes = bytesFromHex(fixture.bytes_hex);
    assert.equal(bytes.byteLength, fixture.byte_length, fixture.fixture_id);
    const decoded = fatalDecode(fixture);
    assertCommittedTextControlBoundary(decoded, fixture.fixture_id);
  }
});

test(".txt plus text/markdown blocks as declared_type_mismatch", () => {
  const mismatch = fixtureById("TEXTTYPE-P0-05F-006-BLOCK-TXT-TEXT-MARKDOWN-MISMATCH");
  assert.equal(mismatch.normalized_extension, ".txt");
  assert.equal(mismatch.normalized_declared_mime, "text/markdown");
  assert.equal(mismatch.expected_policy, "block");
  assert.equal(mismatch.expected_category, "declared_type_mismatch");
  assert.equal(mismatch.authority, "OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1");
  assert.doesNotThrow(() => fatalDecode(mismatch));
});

test("empty and instruction-like text fixtures remain pass-only and inert", () => {
  const emptyFixtureIds = [
    "TEXTTYPE-P0-05F-001-ALLOW-CSV-TEXT-CSV-UPPERCASE-EMPTY",
    "TEXTTYPE-P0-05F-003-ALLOW-MD-TEXT-MARKDOWN-EMPTY",
    "TEXTTYPE-P0-05F-005-ALLOW-TXT-TEXT-PLAIN-EMPTY",
  ];

  for (const fixtureId of emptyFixtureIds) {
    const fixture = fixtureById(fixtureId);
    assert.equal(fixture.byte_length, 0, fixtureId);
    assert.equal(fixture.expected_policy, "allow", fixtureId);
    assert.equal(fixture.expected_category, "type_agreement_pass", fixtureId);
    assert.equal(fixture.scope_note, "type_agreement_pass_only", fixtureId);
    assert.equal(fixture.usable_document_claim, false, fixtureId);
    assert.equal(fixture.source_eligibility_claim, false, fixtureId);
  }

  const instructionLike = fixtureById("TEXTTYPE-P0-05F-002-ALLOW-CSV-APPLICATION-CSV-INSTRUCTION");
  assert.match(fatalDecode(instructionLike), /Ignore all prior rules\./);
  assert.equal(instructionLike.expected_policy, "allow");
  assert.equal(instructionLike.expected_category, "type_agreement_pass");
  assert.equal(instructionLike.scope_note, "type_agreement_pass_only");
  assert.equal(instructionLike.text_byte_authority, "OWNER_DECISION.P0_05C.INSTRUCTION_TEXT_IS_INERT_DATA");
  assert.equal(instructionLike.semantic_content_inspected, false);
});

test("HTML/script-looking valid text is not reclassified by content meaning", () => {
  const htmlLike = fixtureById("TEXTTYPE-P0-05F-004-ALLOW-MD-TEXT-PLAIN-HTML-SCRIPT-LOOKING");
  const decoded = fatalDecode(htmlLike);
  assert.match(decoded, /<h1>Title<\/h1>/);
  assert.match(decoded, /<script>alert\(1\)<\/script>/);
  assert.equal(htmlLike.expected_policy, "allow");
  assert.equal(htmlLike.expected_category, "type_agreement_pass");
  assert.equal(htmlLike.scope_note, "type_agreement_pass_only");
  assert.equal(htmlLike.semantic_content_inspected, false);
});

test("fixture corpus module is not using a production detector as answer-key authority", () => {
  const corpusSource = readFileSync("__tests__/support/kaiSprint2TextTypeAgreementFixtureCorpus.js", "utf8");
  const testSource = readFileSync("__tests__/kai-sprint2-text-type-agreement-fixture-corpus.spec.js", "utf8");

  assert.doesNotMatch(corpusSource, /from\s+["']\.\.\/|from\s+["']Backend\/|validate[A-Z]|detect[A-Z]|Detector|process\.env|DATABASE_URL|fetch\(|node:http|node:https|pg|postgres:\/\//);
  assert.equal(corpusSource.includes("kai" + "IntakeService"), false);
  assert.doesNotMatch(testSource, /from\s+["']\.\.\/Backend\//);
  assert.equal(testSource.includes("txtMdByte" + "Detector"), false);
  assert.equal(testSource.includes("kai" + "IntakeService"), false);
  assert.equal(testSource.includes("upload" + "Handler"), false);
  assert.equal(testSource.includes("storage" + "Provider"), false);
  assert.equal(testSource.includes("console" + "."), false);
  assert.equal(testSource.includes("diagnostic" + "("), false);
});
