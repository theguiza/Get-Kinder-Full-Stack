import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createDraftDataDictionary,
  listDataDictionaryEntries,
} from "../Backend/kai/services/kaiDataDictionaryService.js";
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
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const FILE_PROFILE = "50000000-0000-4000-8000-000000000001";
const DATA_DICTIONARY = "60000000-0000-4000-8000-000000000001";
const NOW = "2026-08-04T10:00:00.000Z";
const actorContext = {
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" },
  ],
};

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

test("P1-04 dictionary-entry read service is gated, tenant-scoped, and forwards only the dictionary identity", async () => {
  const calls = [];
  const repository = {
    async listDataDictionaryEntries(input) {
      calls.push(input);
      return {
        ok: true,
        data: {
          data_dictionary_id: DATA_DICTIONARY,
          entries: [
            {
              data_dictionary_field_id: "70000000-0000-4000-8000-000000000001",
              data_dictionary_id: DATA_DICTIONARY,
              profile_field_key: "household_count",
              field_label_safe: "household_count",
              business_meaning: "household count",
              entity_level: "household",
              data_type: "number",
              sensitivity: "unknown",
              allowed_use: "internal",
              quality_notes_safe: "present_count=7",
              mapping_confidence: 0.75,
              review_status: "needs_gk_review",
            },
          ],
        },
        error: null,
      };
    },
  };

  const result = await listDataDictionaryEntries(
    { organizationId: ORG, dataDictionaryId: DATA_DICTIONARY, actorContext },
    { env: { KAI_SPRINT2_ENABLED: "true" }, dataDictionaryRepository: repository },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{
    identity: { organizationId: ORG, dataDictionaryId: DATA_DICTIONARY },
  }]);
  assert.deepEqual(Object.keys(result.data.entries[0]).sort(), [
    "allowed_use",
    "business_meaning",
    "data_dictionary_field_id",
    "data_dictionary_id",
    "data_type",
    "entity_level",
    "field_label_safe",
    "mapping_confidence",
    "profile_field_key",
    "quality_notes_safe",
    "review_status",
    "sensitivity",
  ].sort());
});

test("P1-04 dictionary-entry read service rejects disabled, malformed, non-human, and wrong-role requests before repository access", async () => {
  let calls = 0;
  const repository = {
    async listDataDictionaryEntries() {
      calls += 1;
      throw new Error("must not call");
    },
  };
  const enabled = { KAI_SPRINT2_ENABLED: "true" };

  assert.equal((await listDataDictionaryEntries(
    { organizationId: ORG, dataDictionaryId: DATA_DICTIONARY, actorContext },
    { env: {}, dataDictionaryRepository: repository },
  )).error.code, "feature_disabled");
  assert.equal((await listDataDictionaryEntries(
    { organizationId: ORG, dataDictionaryId: DATA_DICTIONARY, actorContext, raw: true },
    { env: enabled, dataDictionaryRepository: repository },
  )).error.code, "validation_blocker");
  assert.equal((await listDataDictionaryEntries(
    { organizationId: ORG, dataDictionaryId: DATA_DICTIONARY, actorContext: { actorType: "system", actorUserId: "svc" } },
    { env: enabled, dataDictionaryRepository: repository },
  )).error.code, "authorization_denied");
  assert.equal((await listDataDictionaryEntries(
    {
      organizationId: ORG,
      dataDictionaryId: DATA_DICTIONARY,
      actorContext: {
        ...actorContext,
        organizationMemberships: [
          { organization_id: ORG, membership_status: "active", role_name: "client_reviewer" },
        ],
      },
    },
    { env: enabled, dataDictionaryRepository: repository },
  )).error.code, "authorization_denied");
  assert.equal(calls, 0);
});

test("P1-04 dictionary-entry read service blocks cross-tenant reads before repository access", async () => {
  let calls = 0;
  const repository = {
    async listDataDictionaryEntries() {
      calls += 1;
      throw new Error("must not call");
    },
  };

  const result = await listDataDictionaryEntries(
    { organizationId: OTHER_ORG, dataDictionaryId: DATA_DICTIONARY, actorContext },
    { env: { KAI_SPRINT2_ENABLED: "true" }, dataDictionaryRepository: repository },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(calls, 0);
});

test("P1-04 dictionary-entry read service fails closed on unsafe or non-allowlisted repository output", async () => {
  const enabled = { KAI_SPRINT2_ENABLED: "true" };
  const unsafeRows = [
    { data_dictionary_id: DATA_DICTIONARY, entries: [{ raw_value_sample: "Jane Example" }] },
    {
      data_dictionary_id: DATA_DICTIONARY,
      entries: [{
        data_dictionary_field_id: "70000000-0000-4000-8000-000000000001",
        data_dictionary_id: DATA_DICTIONARY,
        profile_field_key: "household_count",
        field_label_safe: "household_count",
        business_meaning: "household count",
        entity_level: "household",
        data_type: "number",
        sensitivity: "unknown",
        allowed_use: "internal",
        quality_notes_safe: "present_count=7",
        mapping_confidence: 1.25,
        review_status: "needs_gk_review",
      }],
    },
  ];

  for (const unsafe of unsafeRows) {
    const repository = {
      async listDataDictionaryEntries() {
        return { ok: true, data: unsafe, error: null };
      },
    };
    const result = await listDataDictionaryEntries(
      { organizationId: ORG, dataDictionaryId: DATA_DICTIONARY, actorContext },
      { env: enabled, dataDictionaryRepository: repository },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "system_error");
    assert.equal("data" in result, false);
  }
});

test("P1-04 repository: is the only place SQL and row locking for these tables appear, and never imports storage/parsers/LLM clients", () => {
  assert.match(repositorySource, /\bINSERT INTO kai\.data_dictionaries\b/);
  assert.match(repositorySource, /\bFROM kai\.data_dictionary_fields\b/);
  assert.match(repositorySource, /SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(repositorySource, /\bFOR UPDATE\b/);
  assert.doesNotMatch(repositorySource, /anthropic|openai|localProfilingKernel|pdfAssessorWorkerBoundary/i);
  assert.doesNotMatch(repositorySource, /\bfrom\s+["'].*storage.*["']/i);
});

test("P1-04 own-boolean-data-property audit predicate rejects a getter-backed ok and a non-plain prepared result", () => {
  const { prepareRequiredAudit, RequiredAuditRejectedError } = __dataDictionaryRepositoryTestables;
  const record = { dictionary_status: "draft" };
  const fakeTx = { query: async () => ({ rows: [], rowCount: 0 }) };

  const getterBacked = {
    prepareMetadataOnlyAudit() {
      return Object.defineProperty({}, "ok", { get() { return true; }, enumerable: true });
    },
  };
  assert.throws(() => prepareRequiredAudit(getterBacked, fakeTx, record), RequiredAuditRejectedError);

  const arrayShaped = {
    prepareMetadataOnlyAudit() {
      return Object.assign([], { ok: true, publish() {} });
    },
  };
  assert.throws(() => prepareRequiredAudit(arrayShaped, fakeTx, record), RequiredAuditRejectedError);

  const missingPublish = {
    prepareMetadataOnlyAudit() {
      return { ok: true };
    },
  };
  assert.throws(() => prepareRequiredAudit(missingPublish, fakeTx, record), RequiredAuditRejectedError);

  let capturedDb;
  const accepted = {
    prepareMetadataOnlyAudit({ db } = {}) {
      capturedDb = db;
      return { ok: true, publish: async () => {} };
    },
  };
  const prepared = prepareRequiredAudit(accepted, fakeTx, record);
  assert.equal(typeof prepared.publish, "function");
  assert.equal(capturedDb, fakeTx, "the repository's transaction must be forwarded as the audit's db context");
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

test("P1-04 repository resolves concurrent identical creation with PostgreSQL conflict handling, not an in-process lock", () => {
  assert.match(
    repositorySource,
    /ON CONFLICT \(organization_id, file_profile_id\) DO NOTHING\s+RETURNING data_dictionary_id/,
  );
  assert.doesNotMatch(repositorySource, /\b(?:inFlight|pendingLocks?|mutex|semaphore|advisory_lock|pg_advisory)\b/i);
});

test("P1-04 quality notes record only the counts the committed profile states, never a substituted zero", () => {
  const { deriveQualityNotesSafe } = __dataDictionaryRepositoryTestables;

  // both counts absent -> no quality note at all
  assert.equal(deriveQualityNotesSafe({ field_key: "field_1" }), null);

  // present_count only -> only the explicit present count, no fabricated missing count
  const presentOnly = deriveQualityNotesSafe({ field_key: "field_1", present_count: 7 });
  assert.equal(presentOnly, "present_count=7");
  assert.doesNotMatch(presentOnly, /missing_count/);

  // missing_count only -> only the explicit missing count, no fabricated present count
  const missingOnly = deriveQualityNotesSafe({ field_key: "field_1", missing_count: 3 });
  assert.equal(missingOnly, "missing_count=3");
  assert.doesNotMatch(missingOnly, /present_count/);

  // both present -> both explicit counts
  assert.equal(
    deriveQualityNotesSafe({ field_key: "field_1", present_count: 7, missing_count: 3 }),
    "present_count=7, missing_count=3",
  );
});

test("P1-04 missingness findings never invent a denominator when present_count is absent", () => {
  const { deriveDictionaryFields, deriveQualityFindings } = __dataDictionaryRepositoryTestables;

  function findingsFor(entry) {
    const profile = { fields: [entry] };
    return deriveQualityFindings(profile, deriveDictionaryFields(profile));
  }

  // both counts absent -> no missingness finding
  assert.deepEqual(findingsFor({ field_key: "field_1" }), []);

  // present_count only -> no missingness finding, no fabricated missing count
  assert.deepEqual(findingsFor({ field_key: "field_1", present_count: 7 }), []);

  // missing_count > 0 with present_count absent -> missing count reported with no denominator
  const missingOnly = findingsFor({ field_key: "field_1", missing_count: 3 });
  assert.equal(missingOnly.length, 1);
  assert.equal(missingOnly[0].findingType, "missingness");
  assert.equal(missingOnly[0].findingDetailSafe, "field_1 has 3 missing values");
  assert.doesNotMatch(missingOnly[0].findingDetailSafe, /out of/);

  // both counts present -> an exact total may be computed
  const bothPresent = findingsFor({ field_key: "field_1", missing_count: 3, present_count: 7 });
  assert.equal(bothPresent.length, 1);
  assert.equal(bothPresent[0].findingDetailSafe, "field_1 has 3 missing values out of 10");
});

test("P1-04 mapping confidence is copied only from an explicit in-range committed profile value", () => {
  const { deriveMappingConfidence, deriveDictionaryFields } = __dataDictionaryRepositoryTestables;
  const { MAPPING_CONFIDENCE_MIN, MAPPING_CONFIDENCE_MAX } = __dataDictionaryRepositoryContract;

  assert.equal(MAPPING_CONFIDENCE_MIN, 0);
  assert.equal(MAPPING_CONFIDENCE_MAX, 1);

  // explicit valid values are preserved exactly, including both range boundaries
  assert.equal(deriveMappingConfidence({ mapping_confidence: 0 }), 0);
  assert.equal(deriveMappingConfidence({ mapping_confidence: 0.42 }), 0.42);
  assert.equal(deriveMappingConfidence({ mapping_confidence: 1 }), 1);

  // absent, null, or non-numeric confidence becomes NULL, never a default certainty
  for (const entry of [{}, { mapping_confidence: null }, { mapping_confidence: undefined }, { mapping_confidence: "0.9" }, { mapping_confidence: true }]) {
    assert.equal(deriveMappingConfidence(entry), null);
  }

  // out-of-range confidence is rejected, not clamped and not persisted as valid
  for (const value of [-0.01, -1, 1.01, 2, 100]) {
    assert.equal(deriveMappingConfidence({ mapping_confidence: value }), null);
  }

  // non-finite confidence is rejected
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(deriveMappingConfidence({ mapping_confidence: value }), null);
  }

  const derived = deriveDictionaryFields({
    fields: [
      { field_key: "field_1", mapping_confidence: 0.5, primitive_type_hints: { number: 3 } },
      { field_key: "field_2", primitive_type_hints: { number: 3 } },
      { field_key: "field_3", mapping_confidence: 1.5, primitive_type_hints: { number: 3 } },
      { field_key: "field_4", mapping_confidence: Number.NaN, primitive_type_hints: { number: 3 } },
    ],
  });
  assert.deepEqual(derived.map((field) => field.mappingConfidence), [0.5, null, null, null]);
});

test("P1-04 migration keeps mapping_confidence nullable, defaultless, and range-checked", () => {
  assert.match(migrationSource, /^\s*mapping_confidence numeric\(3,2\),$/m);
  assert.doesNotMatch(migrationSource, /mapping_confidence[^,\n]*NOT NULL/);
  assert.doesNotMatch(migrationSource, /mapping_confidence[^,\n]*DEFAULT/);
  assert.match(
    migrationSource,
    /CONSTRAINT data_dictionary_fields_p1_04_mapping_confidence_check\s+CHECK \(\s*mapping_confidence IS NULL\s+OR \(mapping_confidence >= 0 AND mapping_confidence <= 1\)\s*\)/,
  );
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
