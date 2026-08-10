import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  TXT_MD_BYTE_FIXTURE_AUTHORITY_MAP,
  TXT_MD_BYTE_FIXTURE_CATEGORIES,
  TXT_MD_BYTE_FIXTURE_CORPUS_STATUSES,
  TXT_MD_BYTE_FIXTURE_POLICIES,
  TXT_MD_BYTE_FIXTURES,
  bytesFromHex,
  getTxtMdByteFixtureExpectations,
} from "./support/kaiSprint2TxtMdByteFixtureCorpus.js";

const utf8FatalDecoder = new TextDecoder("utf-8", { fatal: true });
const utf8NonfatalDecoder = new TextDecoder("utf-8");

const fixtureKeys = Object.freeze([
  "fixture_id",
  "description",
  "applies_to",
  "bytes_hex",
  "byte_length",
  "declared_utf8_valid",
  "expected_policy",
  "expected_category",
  "authority",
  "scope_note",
  "utf8_validity_basis",
  "byte_case_family",
  "synthetic_provenance",
  "corpus_status",
  "usable_document_claim",
  "source_eligibility_claim",
  "production_detector_claim",
]);

const authorityKeys = Object.freeze([
  "source_document",
  "section_or_decision_key",
  "requirement_summary",
  "supported_expected_policy",
  "supported_expected_category",
  "authority_status",
]);

const requiredFixtureIds = Object.freeze([
  "TXTMD-P0-05D-001-ALLOW-ASCII",
  "TXTMD-P0-05D-002-ALLOW-MULTIBYTE",
  "TXTMD-P0-05D-003-ALLOW-LF",
  "TXTMD-P0-05D-004-ALLOW-CRLF",
  "TXTMD-P0-05D-005-ALLOW-TAB",
  "TXTMD-P0-05D-006-ALLOW-EMPTY",
  "TXTMD-P0-05D-007-ALLOW-INSTRUCTION-LIKE-TEXT",
  "TXTMD-P0-05D-008-ALLOW-LEADING-UTF8-BOM-TEXT",
  "TXTMD-P0-05D-009-ALLOW-LEADING-UTF8-BOM-ONLY",
  "TXTMD-P0-05D-010-ALLOW-NONLEADING-UFEFF",
  "TXTMD-P0-05D-011-ALLOW-TWO-INITIAL-EFBBBF",
  "TXTMD-P0-05D-012-BLOCK-ISOLATED-CONTINUATION",
  "TXTMD-P0-05D-013-BLOCK-TRUNCATED-MULTIBYTE",
  "TXTMD-P0-05D-014-BLOCK-INVALID-LEADING-BYTE",
  "TXTMD-P0-05D-015-BLOCK-OVERLONG",
  "TXTMD-P0-05D-016-BLOCK-SURROGATE-ENCODED",
  "TXTMD-P0-05D-017-BLOCK-UTF16-LE-BOM",
  "TXTMD-P0-05D-018-BLOCK-UTF16-BE-BOM",
  "TXTMD-P0-05D-019-BLOCK-UTF32-LE-BOM",
  "TXTMD-P0-05D-020-BLOCK-UTF32-BE-BOM",
  "TXTMD-P0-05D-021-BLOCK-NUL",
  "TXTMD-P0-05D-022-BLOCK-PROHIBITED-C0-US",
  "TXTMD-P0-05D-023-BLOCK-DEL",
  "TXTMD-P0-05D-024-BLOCK-C1-NEL",
  "TXTMD-P0-05D-025-BLOCK-LONE-CR-BEGIN",
  "TXTMD-P0-05D-026-BLOCK-LONE-CR-MIDDLE",
  "TXTMD-P0-05D-027-BLOCK-LONE-CR-END",
]);

const requiredRawInvalidFixtureIds = Object.freeze([
  "TXTMD-P0-05D-012-BLOCK-ISOLATED-CONTINUATION",
  "TXTMD-P0-05D-013-BLOCK-TRUNCATED-MULTIBYTE",
  "TXTMD-P0-05D-014-BLOCK-INVALID-LEADING-BYTE",
  "TXTMD-P0-05D-015-BLOCK-OVERLONG",
  "TXTMD-P0-05D-016-BLOCK-SURROGATE-ENCODED",
]);

const policyAllowlist = new Set(TXT_MD_BYTE_FIXTURE_POLICIES);
const categoryAllowlist = new Set(TXT_MD_BYTE_FIXTURE_CATEGORIES);
const corpusStatusAllowlist = new Set(TXT_MD_BYTE_FIXTURE_CORPUS_STATUSES);
const expectedByteFamilies = new Set([
  "strict_utf8_basic",
  "permitted_control_boundary",
  "empty_content",
  "instruction_like_inert_data",
  "leading_utf8_bom",
  "nonleading_ufeff",
  "two_initial_efbbbf",
  "invalid_utf8_isolated_continuation",
  "invalid_utf8_truncated_sequence",
  "invalid_utf8_invalid_leading_byte",
  "invalid_utf8_overlong",
  "invalid_utf8_surrogate_encoded",
  "unsupported_bom_utf16_le",
  "unsupported_bom_utf16_be",
  "unsupported_bom_utf32_le",
  "unsupported_bom_utf32_be",
  "prohibited_control_nul",
  "prohibited_control_c0",
  "prohibited_control_del",
  "prohibited_control_c1",
  "lone_cr_begin",
  "lone_cr_middle",
  "lone_cr_end",
]);

function fixtureById(fixtureId) {
  const fixture = TXT_MD_BYTE_FIXTURES.find((item) => item.fixture_id === fixtureId);
  assert.ok(fixture, fixtureId);
  return fixture;
}

function codePoints(value) {
  return Array.from(value, (char) => char.codePointAt(0));
}

function fatalDecode(bytes) {
  return utf8FatalDecoder.decode(bytes);
}

test("TXT/MD byte fixture authority map is closed, grounded, and not current-runtime authority", () => {
  for (const [authorityId, authority] of Object.entries(TXT_MD_BYTE_FIXTURE_AUTHORITY_MAP)) {
    assert.deepEqual(Object.keys(authority), authorityKeys, authorityId);
    assert.match(authorityId, /^OWNER_DECISION\.P0_05C\./, authorityId);
    assert.equal(authority.source_document, "Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md", authorityId);
    assert.match(authority.section_or_decision_key, /P0-05C/, authorityId);
    assert.notEqual(authority.requirement_summary.trim(), "", authorityId);
    assert.ok(policyAllowlist.has(authority.supported_expected_policy), authorityId);
    assert.ok(categoryAllowlist.has(authority.supported_expected_category), authorityId);
    assert.equal(authority.authority_status, "contract_grounded", authorityId);
    assert.doesNotMatch(
      `${authority.section_or_decision_key} ${authority.requirement_summary}`,
      /current detector|runtime behavior|upload transport|parser|profiler|profile eligibility/i,
      authorityId,
    );
  }
});

test("TXT/MD byte fixtures are synthetic, ordered, unique, complete, and closed-schema", () => {
  const fixtureIds = TXT_MD_BYTE_FIXTURES.map((fixture) => fixture.fixture_id);
  assert.deepEqual(fixtureIds, requiredFixtureIds);
  assert.deepEqual(fixtureIds, [...fixtureIds].sort());
  assert.equal(new Set(fixtureIds).size, fixtureIds.length);

  const byteCaseKeys = TXT_MD_BYTE_FIXTURES.map((fixture) => `${fixture.applies_to.join(",")}:${fixture.bytes_hex}`);
  assert.equal(new Set(byteCaseKeys).size, byteCaseKeys.length);

  for (const fixture of TXT_MD_BYTE_FIXTURES) {
    assert.deepEqual(Object.keys(fixture), fixtureKeys, fixture.fixture_id);
    assert.deepEqual(fixture.applies_to, ["txt", "md"], fixture.fixture_id);
    assert.equal(typeof fixture.description, "string", fixture.fixture_id);
    assert.notEqual(fixture.description.trim(), "", fixture.fixture_id);
    assert.equal(typeof fixture.declared_utf8_valid, "boolean", fixture.fixture_id);
    assert.ok(policyAllowlist.has(fixture.expected_policy), fixture.fixture_id);
    assert.ok(categoryAllowlist.has(fixture.expected_category), fixture.fixture_id);
    assert.ok(Object.hasOwn(TXT_MD_BYTE_FIXTURE_AUTHORITY_MAP, fixture.authority), fixture.fixture_id);
    assert.equal(typeof fixture.scope_note, "string", fixture.fixture_id);
    assert.notEqual(fixture.scope_note.trim(), "", fixture.fixture_id);
    assert.match(fixture.utf8_validity_basis, /^fatal_decoder_must_(succeed|throw)$/, fixture.fixture_id);
    assert.ok(expectedByteFamilies.has(fixture.byte_case_family), fixture.fixture_id);
    assert.ok(fixture.synthetic_provenance.includes("synthetic"), fixture.fixture_id);
    assert.doesNotMatch(fixture.synthetic_provenance, /copied|customer|database|cloud/i, fixture.fixture_id);
    assert.ok(corpusStatusAllowlist.has(fixture.corpus_status), fixture.fixture_id);
    assert.equal(fixture.corpus_status, "corpus_only", fixture.fixture_id);
    assert.equal(fixture.usable_document_claim, false, fixture.fixture_id);
    assert.equal(fixture.source_eligibility_claim, false, fixture.fixture_id);
    assert.equal(fixture.production_detector_claim, false, fixture.fixture_id);
  }
});

test("hexadecimal byte representations are valid, deterministic, and length-accounted", () => {
  for (const fixture of TXT_MD_BYTE_FIXTURES) {
    assert.match(fixture.bytes_hex, /^$|^[0-9A-F]{2}( [0-9A-F]{2})*$/, fixture.fixture_id);
    const bytes = bytesFromHex(fixture.bytes_hex);
    const expectedLength = fixture.bytes_hex === "" ? 0 : fixture.bytes_hex.split(" ").length;
    assert.equal(bytes.byteLength, expectedLength, fixture.fixture_id);
    assert.equal(fixture.byte_length, expectedLength, fixture.fixture_id);
    assert.deepEqual(Array.from(bytes).map((byte) => byte.toString(16).toUpperCase().padStart(2, "0")).join(" "), fixture.bytes_hex, fixture.fixture_id);
  }
});

test("expected results trace exactly to committed P0-05C and P0-05C.1 authority", () => {
  for (const fixture of TXT_MD_BYTE_FIXTURES) {
    const authority = TXT_MD_BYTE_FIXTURE_AUTHORITY_MAP[fixture.authority];
    assert.equal(authority.authority_status, "contract_grounded", fixture.fixture_id);
    assert.equal(fixture.expected_policy, authority.supported_expected_policy, fixture.fixture_id);
    assert.equal(fixture.expected_category, authority.supported_expected_category, fixture.fixture_id);
    assert.notEqual(fixture.expected_policy, null, fixture.fixture_id);
    assert.notEqual(fixture.expected_category, null, fixture.fixture_id);
  }

  assert.deepEqual(
    getTxtMdByteFixtureExpectations().map((fixture) => fixture.fixture_id),
    requiredFixtureIds,
  );
});

test("fatal UTF-8 decoder proves every declared-valid and declared-invalid fixture independently", () => {
  const invalidResults = [];

  for (const fixture of TXT_MD_BYTE_FIXTURES) {
    const bytes = bytesFromHex(fixture.bytes_hex);
    if (fixture.declared_utf8_valid) {
      assert.doesNotThrow(() => fatalDecode(bytes), fixture.fixture_id);
      assert.equal(fixture.utf8_validity_basis, "fatal_decoder_must_succeed", fixture.fixture_id);
    } else {
      assert.throws(() => fatalDecode(bytes), TypeError, fixture.fixture_id);
      assert.equal(fixture.utf8_validity_basis, "fatal_decoder_must_throw", fixture.fixture_id);
      invalidResults.push(`${fixture.fixture_id}:fatal_decoder_threw`);
    }

    assert.equal(typeof utf8NonfatalDecoder.decode(bytes), "string", fixture.fixture_id);
  }

  for (const fixtureId of requiredRawInvalidFixtureIds) {
    assert.ok(invalidResults.includes(`${fixtureId}:fatal_decoder_threw`), fixtureId);
  }
  assert.ok(invalidResults.includes("TXTMD-P0-05D-015-BLOCK-OVERLONG:fatal_decoder_threw"));
  assert.ok(invalidResults.includes("TXTMD-P0-05D-016-BLOCK-SURROGATE-ENCODED:fatal_decoder_threw"));
});

test("invalid UTF-8 fixtures are raw byte cases with separate fatal-decoder assertions", () => {
  const expectedInvalidBytes = new Map([
    ["TXTMD-P0-05D-012-BLOCK-ISOLATED-CONTINUATION", [0x80]],
    ["TXTMD-P0-05D-013-BLOCK-TRUNCATED-MULTIBYTE", [0xE2, 0x82]],
    ["TXTMD-P0-05D-014-BLOCK-INVALID-LEADING-BYTE", [0xFF]],
    ["TXTMD-P0-05D-015-BLOCK-OVERLONG", [0xC0, 0xAF]],
    ["TXTMD-P0-05D-016-BLOCK-SURROGATE-ENCODED", [0xED, 0xA0, 0x80]],
  ]);

  for (const [fixtureId, expectedBytes] of expectedInvalidBytes) {
    const fixture = fixtureById(fixtureId);
    const bytes = bytesFromHex(fixture.bytes_hex);
    assert.deepEqual(Array.from(bytes), expectedBytes, fixtureId);
    assert.equal(fixture.declared_utf8_valid, false, fixtureId);
    assert.equal(fixture.expected_policy, "block", fixtureId);
    assert.equal(fixture.expected_category, "invalid_utf8", fixtureId);
    assert.throws(() => fatalDecode(bytes), TypeError, fixtureId);
  }
});

test("permitted and prohibited control-boundary fixtures prove both sides without density heuristics", () => {
  const tabFixture = fixtureById("TXTMD-P0-05D-005-ALLOW-TAB");
  const lfFixture = fixtureById("TXTMD-P0-05D-003-ALLOW-LF");
  const crlfFixture = fixtureById("TXTMD-P0-05D-004-ALLOW-CRLF");
  const c0Fixture = fixtureById("TXTMD-P0-05D-022-BLOCK-PROHIBITED-C0-US");
  const delFixture = fixtureById("TXTMD-P0-05D-023-BLOCK-DEL");
  const c1Fixture = fixtureById("TXTMD-P0-05D-024-BLOCK-C1-NEL");
  const loneCrFixtures = [
    fixtureById("TXTMD-P0-05D-025-BLOCK-LONE-CR-BEGIN"),
    fixtureById("TXTMD-P0-05D-026-BLOCK-LONE-CR-MIDDLE"),
    fixtureById("TXTMD-P0-05D-027-BLOCK-LONE-CR-END"),
  ];

  assert.equal(fatalDecode(bytesFromHex(tabFixture.bytes_hex)).includes("\t"), true, tabFixture.fixture_id);
  assert.equal(tabFixture.expected_policy, "allow", tabFixture.fixture_id);
  assert.equal(tabFixture.expected_category, "encoding_gate_pass", tabFixture.fixture_id);

  assert.equal(fatalDecode(bytesFromHex(lfFixture.bytes_hex)).includes("\n"), true, lfFixture.fixture_id);
  assert.equal(lfFixture.expected_policy, "allow", lfFixture.fixture_id);

  assert.equal(fatalDecode(bytesFromHex(crlfFixture.bytes_hex)).includes("\r\n"), true, crlfFixture.fixture_id);
  assert.equal(crlfFixture.expected_policy, "allow", crlfFixture.fixture_id);

  assert.equal(codePoints(fatalDecode(bytesFromHex(c0Fixture.bytes_hex))).includes(0x001F), true, c0Fixture.fixture_id);
  assert.equal(c0Fixture.expected_policy, "block", c0Fixture.fixture_id);
  assert.equal(c0Fixture.expected_category, "prohibited_control", c0Fixture.fixture_id);

  assert.equal(codePoints(fatalDecode(bytesFromHex(delFixture.bytes_hex))).includes(0x007F), true, delFixture.fixture_id);
  assert.equal(delFixture.expected_policy, "block", delFixture.fixture_id);
  assert.equal(delFixture.expected_category, "prohibited_control", delFixture.fixture_id);

  assert.equal(codePoints(fatalDecode(bytesFromHex(c1Fixture.bytes_hex))).includes(0x0085), true, c1Fixture.fixture_id);
  assert.equal(c1Fixture.expected_policy, "block", c1Fixture.fixture_id);
  assert.equal(c1Fixture.expected_category, "prohibited_control", c1Fixture.fixture_id);

  for (const fixture of loneCrFixtures) {
    assert.equal(fatalDecode(bytesFromHex(fixture.bytes_hex)).includes("\r"), true, fixture.fixture_id);
    assert.equal(fixture.expected_policy, "block", fixture.fixture_id);
    assert.equal(fixture.expected_category, "lone_cr", fixture.fixture_id);
  }
});

test("non-leading U+FEFF and two initial EF BB BF fixtures retain ordinary U+FEFF text", () => {
  const nonleading = fixtureById("TXTMD-P0-05D-010-ALLOW-NONLEADING-UFEFF");
  const nonleadingDecoded = fatalDecode(bytesFromHex(nonleading.bytes_hex));
  const nonleadingCodePoints = codePoints(nonleadingDecoded);
  assert.deepEqual(nonleadingCodePoints, [0x61, 0xFEFF, 0x62], nonleading.fixture_id);
  assert.equal(nonleadingDecoded.includes("\uFEFF"), true, nonleading.fixture_id);
  assert.equal(nonleading.expected_policy, "allow", nonleading.fixture_id);
  assert.equal(nonleading.expected_category, "encoding_gate_pass", nonleading.fixture_id);
  assert.equal(nonleading.scope_note, "encoding_gate_pass_only", nonleading.fixture_id);
  assert.equal(nonleading.authority, "OWNER_DECISION.P0_05C.NONLEADING_UFEFF_ALLOWED_AS_TEXT", nonleading.fixture_id);
  assert.doesNotMatch(nonleading.description, /blocking|block|non-leading BOM|non-leading UTF-8 BOM/i, nonleading.fixture_id);

  const twoInitial = fixtureById("TXTMD-P0-05D-011-ALLOW-TWO-INITIAL-EFBBBF");
  assert.deepEqual(Array.from(bytesFromHex(twoInitial.bytes_hex)).slice(0, 6), [0xEF, 0xBB, 0xBF, 0xEF, 0xBB, 0xBF], twoInitial.fixture_id);
  const twoInitialDecoded = fatalDecode(bytesFromHex(twoInitial.bytes_hex));
  assert.deepEqual(codePoints(twoInitialDecoded), [0xFEFF, 0x62], twoInitial.fixture_id);
  const afterSingleLeadingBomTreatment = twoInitialDecoded;
  assert.deepEqual(codePoints(afterSingleLeadingBomTreatment), [0xFEFF, 0x62], twoInitial.fixture_id);
  assert.equal(twoInitialDecoded.startsWith("\uFEFF"), true, twoInitial.fixture_id);
  assert.equal(twoInitial.expected_policy, "allow", twoInitial.fixture_id);
  assert.equal(twoInitial.expected_category, "encoding_gate_pass", twoInitial.fixture_id);
  assert.equal(twoInitial.scope_note, "encoding_gate_pass_only", twoInitial.fixture_id);
  assert.equal(twoInitial.authority, "OWNER_DECISION.P0_05C.NONLEADING_UFEFF_ALLOWED_AS_TEXT", twoInitial.fixture_id);
});

test("fixture corpus module loads without production detector, upload, parser, database, cloud, dependency, or diagnostic imports", () => {
  const corpusSource = readFileSync("__tests__/support/kaiSprint2TxtMdByteFixtureCorpus.js", "utf8");
  const testSource = readFileSync("__tests__/kai-sprint2-txt-md-byte-fixture-corpus.spec.js", "utf8");

  assert.doesNotMatch(corpusSource, /process\.env|DATABASE_URL|fetch\(|from\s+["']node:http|from\s+["']node:https|from\s+["']pg|postgres:\/\//i);
  assert.equal(corpusSource.includes("validate" + "Txt"), false);
  assert.equal(corpusSource.includes("validate" + "Md"), false);
  assert.equal(corpusSource.includes("upload" + "Handler"), false);
  assert.equal(corpusSource.includes("kai" + "IntakeService"), false);
  assert.equal(corpusSource.includes("storage" + "Provider"), false);
  assert.equal(corpusSource.includes("parser"), false);
  assert.equal(testSource.includes("console" + "."), false);
  assert.equal(testSource.includes("diagnostic" + "("), false);
});
