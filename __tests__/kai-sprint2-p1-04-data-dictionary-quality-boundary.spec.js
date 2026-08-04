import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createDraftDataDictionary } from "../Backend/kai/services/kaiDataDictionaryService.js";
import {
  __dataDictionaryRepositoryContract,
  __dataDictionaryRepositoryTestables,
} from "../Backend/kai/dictionary/postgresDataDictionaryRepository.js";

const SERVICE_PATH = "Backend/kai/services/kaiDataDictionaryService.js";
const REPOSITORY_PATH = "Backend/kai/dictionary/postgresDataDictionaryRepository.js";
const MIGRATION_PATH = "migrations/kai_sprint2_p1_04_data_dictionary_and_quality.sql";

const serviceSource = readFileSync(new URL(`../${SERVICE_PATH}`, import.meta.url), "utf8");
const repositorySource = readFileSync(new URL(`../${REPOSITORY_PATH}`, import.meta.url), "utf8");
const migrationSource = readFileSync(new URL(`../${MIGRATION_PATH}`, import.meta.url), "utf8");
const kaiBarrelSource = readFileSync(new URL("../Backend/kai/index.js", import.meta.url), "utf8");

const ORG = "00000000-0000-4000-8000-000000000001";
const FILE_PROFILE = "50000000-0000-4000-8000-000000000001";
const NOW = "2026-08-04T10:00:00.000Z";

function createRepositoryProbe(result) {
  const calls = [];
  return {
    calls,
    dataDictionaryRepository: {
      async draftDataDictionary(input) {
        calls.push(input);
        return result;
      },
    },
  };
}

test("P1-04 service: disabled KAI_SPRINT2_ENABLED returns the canonical disabled result with zero repository calls", async () => {
  for (const env of [{}, { KAI_SPRINT2_ENABLED: "false" }, { KAI_SPRINT2_ENABLED: "0" }]) {
    const probe = createRepositoryProbe({ ok: true, data: { dictionary: {} }, error: null });
    const result = await createDraftDataDictionary(
      { organizationId: ORG, fileProfileId: FILE_PROFILE, now: NOW },
      { env, dataDictionaryRepository: probe.dataDictionaryRepository },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "feature_disabled");
    assert.equal(probe.calls.length, 0);
  }
});

test("P1-04 service: rejects input shapes outside the accepted allowlist without calling the repository", async () => {
  const enabled = { KAI_SPRINT2_ENABLED: "true" };
  const invalidInputs = [
    null,
    {},
    { organizationId: ORG, fileProfileId: FILE_PROFILE },
    { organizationId: ORG, fileProfileId: FILE_PROFILE, now: NOW, profile: {} },
    { organizationId: ORG, fileProfileId: FILE_PROFILE, now: NOW, profileCanonicalSha256: "a".repeat(64) },
    { organizationId: ORG, fileProfileId: FILE_PROFILE, now: NOW, intakeFileId: "20000000-0000-4000-8000-000000000001" },
    { organizationId: "", fileProfileId: FILE_PROFILE, now: NOW },
    { organizationId: ORG, fileProfileId: FILE_PROFILE, now: "not-a-normalized-timestamp" },
  ];
  for (const input of invalidInputs) {
    const probe = createRepositoryProbe({ ok: true, data: { dictionary: {} }, error: null });
    const result = await createDraftDataDictionary(input, { env: enabled, dataDictionaryRepository: probe.dataDictionaryRepository });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");
    assert.equal(probe.calls.length, 0);
  }
});

test("P1-04 service: forwards only the organizationId + fileProfileId + now identity to the repository", async () => {
  const enabled = { KAI_SPRINT2_ENABLED: "true" };
  const probe = createRepositoryProbe({ ok: true, data: { dictionary: { data_dictionary_id: "d-1" }, replayed: false }, error: null });
  const result = await createDraftDataDictionary(
    { organizationId: ORG, fileProfileId: FILE_PROFILE, now: NOW },
    { env: enabled, dataDictionaryRepository: probe.dataDictionaryRepository },
  );
  assert.equal(result.ok, true);
  assert.equal(probe.calls.length, 1);
  assert.deepEqual(probe.calls[0].identity, { organizationId: ORG, fileProfileId: FILE_PROFILE });
  assert.equal(probe.calls[0].now, NOW);
});

test("P1-04 service: contains no SQL and imports no database pool", () => {
  assert.doesNotMatch(serviceSource, /\bimport\s+pool\b/);
  assert.doesNotMatch(serviceSource, /\bfrom\s+["']\.\.\/db\/(?:kaiDb|pg)\.js["']/);
  assert.doesNotMatch(serviceSource, /\bSELECT\b|\bINSERT INTO\b|\bUPDATE\b|\bDELETE FROM\b/i);
});

test("P1-04 repository: is the only place SQL and row locking for these tables appear, and never imports storage/parsers/LLM clients", () => {
  assert.match(repositorySource, /\bINSERT INTO kai\.data_dictionaries\b/);
  assert.match(repositorySource, /\bFOR UPDATE\b/);
  assert.doesNotMatch(repositorySource, /anthropic|openai|localProfilingKernel|pdfAssessorWorkerBoundary/i);
  assert.doesNotMatch(repositorySource, /\bfrom\s+["'].*storage.*["']/i);
});

test("P1-04 own-boolean-data-property audit predicate rejects a getter-backed ok and a non-plain prepared result", () => {
  const { prepareRequiredAudit, RequiredAuditRejectedError } = __dataDictionaryRepositoryTestables;
  const record = { dictionary_status: "draft" };

  const getterBacked = {
    prepareMetadataOnlyAudit() {
      return Object.defineProperty({}, "ok", { get() { return true; }, enumerable: true });
    },
  };
  assert.throws(() => prepareRequiredAudit(getterBacked, record), RequiredAuditRejectedError);

  const arrayShaped = {
    prepareMetadataOnlyAudit() {
      return Object.assign([], { ok: true, publish() {} });
    },
  };
  assert.throws(() => prepareRequiredAudit(arrayShaped, record), RequiredAuditRejectedError);

  const missingPublish = {
    prepareMetadataOnlyAudit() {
      return { ok: true };
    },
  };
  assert.throws(() => prepareRequiredAudit(missingPublish, record), RequiredAuditRejectedError);

  const accepted = {
    prepareMetadataOnlyAudit() {
      return { ok: true, publish: async () => {} };
    },
  };
  const prepared = prepareRequiredAudit(accepted, record);
  assert.equal(typeof prepared.publish, "function");
});

test("P1-04 deriveDictionaryFields copies safe committed profile facts and defaults business_meaning/entity_level to unknown", () => {
  const { deriveDictionaryFields } = __dataDictionaryRepositoryTestables;
  const profile = {
    fields: [
      {
        field_key: "field_1",
        meaning: "unknown",
        missing_count: 3,
        present_count: 7,
        primitive_type_hints: { blank: 0, boolean: 0, number: 7, date_like: 0, text_like: 0 },
      },
      {
        field_key: "field_2",
        meaning: "donor_amount",
        missing_count: 0,
        present_count: 10,
        primitive_type_hints: { blank: 0, boolean: 0, number: 5, date_like: 0, text_like: 5 },
      },
      { field_key: "Not Safe!" },
    ],
  };
  const fields = deriveDictionaryFields(profile);
  assert.equal(fields.length, 2);
  assert.equal(fields[0].profileFieldKey, "field_1");
  assert.equal(fields[0].dataType, "number");
  assert.equal(fields[0].businessMeaning, "unknown");
  assert.equal(fields[0].entityLevel, "unknown");
  assert.equal(fields[1].dataType, "mixed");
  assert.equal(fields[1].businessMeaning, "donor_amount");
});

test("P1-04 deriveQualityFindings only emits findings for explicit committed profile-stage facts", () => {
  const { deriveDictionaryFields, deriveQualityFindings } = __dataDictionaryRepositoryTestables;
  const profileWithFacts = {
    counts: { duplicate_row_count: 2, formula_count: 1 },
    fields: [
      { field_key: "field_1", missing_count: 3, present_count: 7, primitive_type_hints: { number: 7 } },
      { field_key: "field_2", missing_count: 0, present_count: 10, primitive_type_hints: { number: 5, text_like: 5 } },
    ],
  };
  const fields = deriveDictionaryFields(profileWithFacts);
  const findings = deriveQualityFindings(profileWithFacts, fields);
  const types = findings.map((finding) => finding.findingType).sort();
  assert.deepEqual(types, ["duplicate_rows", "formula_like_content", "missingness", "type_inconsistency"]);

  const profileWithNoFacts = {
    counts: { duplicate_row_count: 0, formula_count: 0 },
    fields: [{ field_key: "field_1", missing_count: 0, present_count: 10, primitive_type_hints: { number: 10 } }],
  };
  const noFactFields = deriveDictionaryFields(profileWithNoFacts);
  assert.deepEqual(deriveQualityFindings(profileWithNoFacts, noFactFields), []);
});

test("P1-04 contract constants match the exact owner-decided audit vocabulary", () => {
  assert.equal(__dataDictionaryRepositoryContract.DICTIONARY_AUDIT_CONTRACT, "p1_draft_data_dictionary_and_quality_v1");
  assert.equal(__dataDictionaryRepositoryContract.DICTIONARY_AUDIT_VALIDATOR_KEY, "VAL-KAI-P1-04-001");
  assert.equal(__dataDictionaryRepositoryContract.DICTIONARY_AUDIT_OPERATION, "data_dictionary_draft_persisted");
});

test("P1-04 introduces no route, listener, barrel export, or production composition", () => {
  assert.doesNotMatch(kaiBarrelSource, /kaiDataDictionaryService|postgresDataDictionaryRepository/);
  assert.doesNotMatch(migrationSource, /CREATE TRIGGER|CREATE FUNCTION.*(?:listener|scheduler)/i);
});
