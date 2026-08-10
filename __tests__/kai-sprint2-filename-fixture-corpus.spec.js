import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  FILENAME_FIXTURE_AUTHORITY_MAP,
  FILENAME_FIXTURE_CATEGORIES,
  FILENAME_FIXTURE_CORPUS_STATUSES,
  FILENAME_FIXTURE_DECISION_STATUSES,
  FILENAME_FIXTURE_POLICIES,
  FILENAME_FIXTURES,
  getContractGroundedFilenameFixtureExpectations,
} from "./support/kaiSprint2FilenameFixtureCorpus.js";

const fixtureKeys = Object.freeze([
  "fixture_id",
  "control_family",
  "input_kind",
  "input_representation",
  "actual_input",
  "synthetic_provenance",
  "decision_status",
  "expected_policy",
  "expected_category",
  "authority_reference",
  "rationale",
  "contains_client_data",
  "contains_pii",
  "contains_secret",
  "corpus_status",
]);

const authorityKeys = Object.freeze([
  "source_document",
  "section_or_validator_key",
  "requirement_summary",
  "supported_expected_policy",
  "supported_expected_category",
  "authority_status",
]);

const contractGroundedStatuses = new Set(["contract_grounded"]);
const unresolvedStatuses = new Set(["outcome_not_fully_specified"]);
const policyAllowlist = new Set(FILENAME_FIXTURE_POLICIES);
const decisionStatusAllowlist = new Set(FILENAME_FIXTURE_DECISION_STATUSES);
const corpusStatusAllowlist = new Set(FILENAME_FIXTURE_CORPUS_STATUSES);
const categoryAllowlist = new Set(FILENAME_FIXTURE_CATEGORIES);

function codePoints(value) {
  return Array.from(value, (char) => char.codePointAt(0));
}

function declaredCodePoints(inputRepresentation) {
  return Array.from(inputRepresentation.matchAll(/U\+([0-9A-F]{4,6})/g), ([, hex]) => Number.parseInt(hex, 16));
}

function includesSubsequence(values, expected) {
  if (expected.length === 0) return true;
  for (let start = 0; start <= values.length - expected.length; start += 1) {
    if (expected.every((value, offset) => values[start + offset] === value)) return true;
  }
  return false;
}

test("filename fixture authority map is closed, specific, and independent of current detector behavior", () => {
  for (const [authorityId, authority] of Object.entries(FILENAME_FIXTURE_AUTHORITY_MAP)) {
    assert.deepEqual(Object.keys(authority), authorityKeys, authorityId);
    assert.match(authorityId, /^(BACKEND_CONTRACT|EXECPLAN|THREAT_MODEL)\./);
    assert.equal(typeof authority.source_document, "string", authorityId);
    assert.equal(typeof authority.section_or_validator_key, "string", authorityId);
    assert.equal(typeof authority.requirement_summary, "string", authorityId);
    assert.notEqual(authority.source_document.trim(), "", authorityId);
    assert.notEqual(authority.section_or_validator_key.trim(), "", authorityId);
    assert.notEqual(authority.section_or_validator_key, authority.source_document, authorityId);
    assert.match(authority.section_or_validator_key, /(VAL-STO-004|P0-05|T2|safe_filename)/, authorityId);
    assert.ok(categoryAllowlist.has(authority.supported_expected_category), authorityId);
    assert.ok(
      authority.supported_expected_policy === null || policyAllowlist.has(authority.supported_expected_policy),
      authorityId,
    );
    assert.ok(
      contractGroundedStatuses.has(authority.authority_status) || unresolvedStatuses.has(authority.authority_status),
      authorityId,
    );
    assert.doesNotMatch(
      `${authority.source_document} ${authority.section_or_validator_key} ${authority.requirement_summary}`,
      /storagePathPolicy|kaiIntakeService|validateSafeFilename|current detector|runtime behavior/i,
      authorityId,
    );
  }
});

test("filename fixtures are synthetic, ordered, closed-schema corpus-only metadata", () => {
  const fixtureIds = FILENAME_FIXTURES.map((fixture) => fixture.fixture_id);
  assert.deepEqual(fixtureIds, [...fixtureIds].sort());
  assert.equal(new Set(fixtureIds).size, fixtureIds.length);

  for (const fixture of FILENAME_FIXTURES) {
    assert.deepEqual(Object.keys(fixture), fixtureKeys, fixture.fixture_id);
    assert.equal(fixture.control_family, "filename", fixture.fixture_id);
    assert.equal(typeof fixture.input_kind, "string", fixture.fixture_id);
    assert.equal(typeof fixture.input_representation, "string", fixture.fixture_id);
    assert.equal(typeof fixture.actual_input, "string", fixture.fixture_id);
    assert.equal(typeof fixture.synthetic_provenance, "string", fixture.fixture_id);
    assert.equal(typeof fixture.rationale, "string", fixture.fixture_id);
    assert.ok(fixture.synthetic_provenance.includes("synthetic"), fixture.fixture_id);
    assert.doesNotMatch(fixture.synthetic_provenance, /copied|customer|production|database|cloud/i, fixture.fixture_id);
    assert.equal(fixture.contains_client_data, false, fixture.fixture_id);
    assert.equal(fixture.contains_pii, false, fixture.fixture_id);
    assert.equal(fixture.contains_secret, false, fixture.fixture_id);
    assert.equal(fixture.corpus_status, "corpus_only", fixture.fixture_id);
    assert.ok(decisionStatusAllowlist.has(fixture.decision_status), fixture.fixture_id);
    assert.ok(categoryAllowlist.has(fixture.expected_category), fixture.fixture_id);
    assert.ok(corpusStatusAllowlist.has(fixture.corpus_status), fixture.fixture_id);
    assert.ok(Object.hasOwn(FILENAME_FIXTURE_AUTHORITY_MAP, fixture.authority_reference), fixture.fixture_id);
    assert.doesNotMatch(fixture.actual_input, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, fixture.fixture_id);
    assert.doesNotMatch(fixture.actual_input, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, fixture.fixture_id);
    assert.doesNotMatch(fixture.actual_input, /https?:\/\/|gs:\/\/|s3:\/\/|storage\.googleapis\.com/i, fixture.fixture_id);
    assert.doesNotMatch(fixture.actual_input, /secret|token|password|credential/i, fixture.fixture_id);
  }
});

test("contract-grounded policies and categories trace exactly to mapped authority provisions", () => {
  for (const fixture of FILENAME_FIXTURES.filter((item) => item.decision_status === "contract_grounded")) {
    const authority = FILENAME_FIXTURE_AUTHORITY_MAP[fixture.authority_reference];
    assert.equal(authority.authority_status, "contract_grounded", fixture.fixture_id);
    assert.ok(policyAllowlist.has(fixture.expected_policy), fixture.fixture_id);
    assert.equal(fixture.expected_policy, authority.supported_expected_policy, fixture.fixture_id);
    assert.equal(fixture.expected_category, authority.supported_expected_category, fixture.fixture_id);
    assert.notEqual(fixture.expected_category, fixture.fixture_id, fixture.fixture_id);
    assert.ok(fixture.rationale.length > fixture.expected_category.length, fixture.fixture_id);
  }
});

test("unresolved filename candidates have no expected detector policy and are excluded from executable expectations", () => {
  const executableExpectationIds = new Set(
    getContractGroundedFilenameFixtureExpectations().map((fixture) => fixture.fixture_id),
  );

  for (const fixture of FILENAME_FIXTURES.filter((item) => item.decision_status === "owner_decision_required")) {
    const authority = FILENAME_FIXTURE_AUTHORITY_MAP[fixture.authority_reference];
    assert.equal(authority.authority_status, "outcome_not_fully_specified", fixture.fixture_id);
    assert.equal(fixture.expected_policy, null, fixture.fixture_id);
    assert.equal(fixture.expected_category, authority.supported_expected_category, fixture.fixture_id);
    assert.equal(executableExpectationIds.has(fixture.fixture_id), false, fixture.fixture_id);
    assert.match(fixture.expected_category, /_question$/, fixture.fixture_id);
  }

  for (const expectation of getContractGroundedFilenameFixtureExpectations()) {
    assert.ok(policyAllowlist.has(expectation.expected_policy), expectation.fixture_id);
    assert.notEqual(expectation.expected_policy, null, expectation.fixture_id);
  }
});

test("invisible Unicode fixtures contain the exact declared code points", () => {
  for (const fixture of FILENAME_FIXTURES) {
    const declared = declaredCodePoints(fixture.input_representation);
    if (declared.length === 0) continue;
    assert.equal(includesSubsequence(codePoints(fixture.actual_input), declared), true, fixture.fixture_id);
  }
});

test("adverse path, separator, reserved-name, control, and extension fixtures contain the required intrinsic sequence", () => {
  for (const fixture of FILENAME_FIXTURES.filter((item) => item.decision_status === "contract_grounded")) {
    if (fixture.expected_category === "path_traversal") {
      assert.match(fixture.actual_input, /\.\.[/\\]/, fixture.fixture_id);
    }
    if (fixture.expected_category === "path_separator") {
      assert.match(fixture.actual_input, /[/\\]/, fixture.fixture_id);
    }
    if (fixture.expected_category === "control_character") {
      assert.equal(codePoints(fixture.actual_input).some((point) => point <= 0x1F || (point >= 0x80 && point <= 0x9F)), true, fixture.fixture_id);
    }
    if (fixture.expected_category === "bidi_control") {
      assert.equal(codePoints(fixture.actual_input).includes(0x202E), true, fixture.fixture_id);
    }
    if (fixture.expected_category === "reserved_device_name") {
      assert.match(fixture.actual_input, /^(CON|PRN|AUX|NUL|COM1|LPT1)$/, fixture.fixture_id);
    }
    if (fixture.expected_category === "dangerous_extension_mismatch") {
      assert.match(fixture.actual_input, /\.csv\.exe$/, fixture.fixture_id);
    }
    if (fixture.expected_category === "empty_sanitized_filename") {
      assert.equal(fixture.actual_input, "", fixture.fixture_id);
    }
  }
});

test("fixture corpus module loads without network, database, secrets, cloud, production config, or detector imports", () => {
  const corpusSource = readFileSync("__tests__/support/kaiSprint2FilenameFixtureCorpus.js", "utf8");
  const testSource = readFileSync("__tests__/kai-sprint2-filename-fixture-corpus.spec.js", "utf8");

  assert.doesNotMatch(corpusSource, /process\.env|DATABASE_URL|fetch\(|from\s+["']node:http|from\s+["']node:https|from\s+["']pg|postgres:\/\//i);
  assert.equal(corpusSource.includes("validate" + "SafeFilename"), false);
  assert.equal(corpusSource.includes("storage" + "PathPolicy"), false);
  assert.equal(corpusSource.includes("kai" + "IntakeService"), false);
  assert.equal(corpusSource.includes("storage" + "Validators"), false);
  assert.equal(testSource.includes("console" + "."), false);
  assert.equal(testSource.includes("diagnostic" + "("), false);
});
