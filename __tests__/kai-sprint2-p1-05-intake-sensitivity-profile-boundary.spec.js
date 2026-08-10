import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { persistIntakeSensitivityProfile } from "../Backend/kai/services/kaiIntakeSensitivityProfileService.js";
import {
  createPostgresIntakeSensitivityProfileRepository,
  __intakeSensitivityProfileRepositoryContract,
  __intakeSensitivityProfileRepositoryTestables,
} from "../Backend/kai/dictionary/postgresIntakeSensitivityProfileRepository.js";

const SERVICE_PATH = "Backend/kai/services/kaiIntakeSensitivityProfileService.js";
const REPOSITORY_PATH = "Backend/kai/dictionary/postgresIntakeSensitivityProfileRepository.js";
const MIGRATION_PATH = "migrations/kai_sprint2_p1_05_intake_sensitivity_profile.sql";

const serviceSource = readFileSync(new URL(`../${SERVICE_PATH}`, import.meta.url), "utf8");
const repositorySource = readFileSync(new URL(`../${REPOSITORY_PATH}`, import.meta.url), "utf8");
const migrationSource = readFileSync(new URL(`../${MIGRATION_PATH}`, import.meta.url), "utf8");
const kaiBarrelSource = readFileSync(new URL("../Backend/kai/index.js", import.meta.url), "utf8");

const ORG = "00000000-0000-4000-8000-000000000001";
const FILE_PROFILE = "50000000-0000-4000-8000-000000000001";
const DICTIONARY = "60000000-0000-4000-8000-000000000001";
const NOW = "2026-08-04T10:00:00.000Z";

function createRepositoryProbe(result) {
  const calls = [];
  return {
    calls,
    intakeSensitivityProfileRepository: {
      async persistIntakeSensitivityProfile(input) {
        calls.push(input);
        return result;
      },
    },
  };
}

test("P1-05 service: disabled KAI_SPRINT2_ENABLED returns the canonical disabled result with zero repository calls", async () => {
  for (const env of [{}, { KAI_SPRINT2_ENABLED: "false" }, { KAI_SPRINT2_ENABLED: "0" }]) {
    const probe = createRepositoryProbe({ ok: true, data: { sensitivityProfile: {} }, error: null });
    const result = await persistIntakeSensitivityProfile(
      { organizationId: ORG, fileProfileId: FILE_PROFILE, dataDictionaryId: DICTIONARY, now: NOW },
      { env, intakeSensitivityProfileRepository: probe.intakeSensitivityProfileRepository },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "feature_disabled");
    assert.equal(probe.calls.length, 0);
  }
});

test("P1-05 service: rejects input shapes outside the accepted allowlist without calling the repository", async () => {
  const enabled = { KAI_SPRINT2_ENABLED: "true" };
  const invalidInputs = [
    null,
    {},
    { organizationId: ORG, fileProfileId: FILE_PROFILE, dataDictionaryId: DICTIONARY },
    { organizationId: ORG, fileProfileId: FILE_PROFILE, dataDictionaryId: DICTIONARY, now: NOW, profile: {} },
    { organizationId: ORG, fileProfileId: FILE_PROFILE, dataDictionaryId: DICTIONARY, now: NOW, profileCanonicalSha256: "a".repeat(64) },
    { organizationId: ORG, fileProfileId: FILE_PROFILE, dataDictionaryId: DICTIONARY, now: NOW, intakeFileId: "20000000-0000-4000-8000-000000000001" },
    { organizationId: ORG, fileProfileId: FILE_PROFILE, dataDictionaryId: DICTIONARY, now: NOW, piiStatus: "present" },
    { organizationId: ORG, fileProfileId: FILE_PROFILE, dataDictionaryId: DICTIONARY, now: NOW, humanReviewRequired: false },
    { organizationId: "", fileProfileId: FILE_PROFILE, dataDictionaryId: DICTIONARY, now: NOW },
    { organizationId: ORG, fileProfileId: FILE_PROFILE, dataDictionaryId: DICTIONARY, now: "not-a-normalized-timestamp" },
  ];
  for (const input of invalidInputs) {
    const probe = createRepositoryProbe({ ok: true, data: { sensitivityProfile: {} }, error: null });
    const result = await persistIntakeSensitivityProfile(input, { env: enabled, intakeSensitivityProfileRepository: probe.intakeSensitivityProfileRepository });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");
    assert.equal(probe.calls.length, 0);
  }
});

test("P1-05 service: forwards only the organizationId + fileProfileId + dataDictionaryId + now identity to the repository", async () => {
  const enabled = { KAI_SPRINT2_ENABLED: "true" };
  const probe = createRepositoryProbe({
    ok: true,
    data: { sensitivityProfile: { intake_sensitivity_profile_id: "s-1" }, replayed: false },
    error: null,
  });
  const result = await persistIntakeSensitivityProfile(
    { organizationId: ORG, fileProfileId: FILE_PROFILE, dataDictionaryId: DICTIONARY, now: NOW },
    { env: enabled, intakeSensitivityProfileRepository: probe.intakeSensitivityProfileRepository },
  );
  assert.equal(result.ok, true);
  assert.equal(probe.calls.length, 1);
  assert.deepEqual(probe.calls[0].identity, { organizationId: ORG, fileProfileId: FILE_PROFILE, dataDictionaryId: DICTIONARY });
  assert.equal(probe.calls[0].now, NOW);
});

test("P1-05 service: contains no SQL and imports no database pool", () => {
  assert.doesNotMatch(serviceSource, /\bimport\s+pool\b/);
  assert.doesNotMatch(serviceSource, /\bfrom\s+["']\.\.\/db\/(?:kaiDb|pg)\.js["']/);
  assert.doesNotMatch(serviceSource, /\bSELECT\b|\bINSERT INTO\b|\bUPDATE\b|\bDELETE FROM\b/i);
});

test("P1-05 repository: is the only place SQL and row locking for this table appear, and never imports storage/parsers/LLM clients", () => {
  assert.match(repositorySource, /\bINSERT INTO kai\.intake_sensitivity_profiles\b/);
  assert.match(repositorySource, /\bFOR UPDATE\b/);
  assert.doesNotMatch(repositorySource, /anthropic|openai|localProfilingKernel|pdfAssessorWorkerBoundary/i);
  assert.doesNotMatch(repositorySource, /\bfrom\s+["'].*storage.*["']/i);
});

test("P1-05 own-boolean-data-property audit predicate rejects a getter-backed ok and a non-plain prepared result", () => {
  const { prepareRequiredAudit, RequiredAuditRejectedError } = __intakeSensitivityProfileRepositoryTestables;
  const record = { human_review_required: true };

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

test("P1-05 repository resolves concurrent identical creation with PostgreSQL conflict handling, not an in-process lock", () => {
  assert.match(
    repositorySource,
    /ON CONFLICT \(organization_id, file_profile_id, data_dictionary_id\) DO NOTHING\s+RETURNING/,
  );
  assert.doesNotMatch(repositorySource, /\b(?:inFlight|pendingLocks?|mutex|semaphore|advisory_lock|pg_advisory)\b/i);
});

test("P1-05 contract constants match the exact owner-decided audit vocabulary", () => {
  assert.equal(__intakeSensitivityProfileRepositoryContract.SENSITIVITY_AUDIT_CONTRACT, "p1_intake_sensitivity_and_allowed_use_v1");
  assert.equal(__intakeSensitivityProfileRepositoryContract.SENSITIVITY_AUDIT_VALIDATOR_KEY, "VAL-KAI-P1-05-001");
  assert.equal(__intakeSensitivityProfileRepositoryContract.SENSITIVITY_AUDIT_OPERATION, "intake_sensitivity_profile_persisted");
});

test("P1-05 repository never reads kai.intake_file_profiles.profile: no classification producer contract is recognized", () => {
  assert.doesNotMatch(repositorySource, /\bderiveSensitivityFacts\b/);
  assert.doesNotMatch(repositorySource, /\bsensitivity_committed_facts\b/);
  assert.doesNotMatch(repositorySource, /profileRow\.profile\b/);
  // readScopedProfile selects only the tenant-scoped lineage facts required for P1-05.
  assert.doesNotMatch(repositorySource, /SELECT[\s\S]*?\bprofile\b[\s\S]*?FROM kai\.intake_file_profiles/);
  assert.match(
    repositorySource,
    /SELECT organization_id::text AS organization_id,\s*intake_file_id::text AS intake_file_id,\s*file_profile_id::text AS file_profile_id,\s*profile_canonical_sha256\s*FROM kai\.intake_file_profiles/,
  );
});

test("P1-05 repository testables no longer expose a profile-JSON classification derivation function", () => {
  assert.equal(__intakeSensitivityProfileRepositoryTestables.deriveSensitivityFacts, undefined);
});

test("P1-05 repository persists every classification status as the pinned literal 'unknown' via column defaults, not a computed value", () => {
  assert.doesNotMatch(repositorySource, /facts\.\w+/);
  assert.match(
    repositorySource,
    /INSERT INTO kai\.intake_sensitivity_profiles \(\s*organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256,\s*created_at\s*\)/,
  );
});

test("P1-05 dimension vocabulary array is enumeration-only metadata, not a producer contract", () => {
  for (const dimension of __intakeSensitivityProfileRepositoryContract.PRESENT_ABSENT_DIMENSIONS) {
    assert.equal(typeof dimension, "string");
  }
  for (const dimension of __intakeSensitivityProfileRepositoryContract.ALLOWED_NOT_ALLOWED_DIMENSIONS) {
    assert.equal(typeof dimension, "string");
  }
  assert.doesNotMatch(repositorySource, /personal_data:|committedFacts\[/);
});

test("P1-05 migration pins every dimension default to unknown and every restriction to its fail-closed value", () => {
  assert.match(migrationSource, /pii_status text NOT NULL DEFAULT 'unknown'/);
  assert.match(migrationSource, /financial_records_status text NOT NULL DEFAULT 'unknown'/);
  assert.match(migrationSource, /indigenous_governance_status text NOT NULL DEFAULT 'unknown'/);
  assert.match(migrationSource, /small_cell_risk_status text NOT NULL DEFAULT 'unknown'/);
  assert.match(migrationSource, /llm_processing_allowed boolean NOT NULL DEFAULT false/);
  assert.match(migrationSource, /product_learning_allowed boolean NOT NULL DEFAULT false/);
  assert.match(migrationSource, /public_use_allowed boolean NOT NULL DEFAULT false/);
  assert.match(migrationSource, /funder_use_allowed boolean NOT NULL DEFAULT false/);
  assert.match(migrationSource, /human_review_required boolean NOT NULL DEFAULT true/);
  assert.match(migrationSource, /retention_posture text NOT NULL DEFAULT 'restricted_pending_review'/);
});

test("P1-05 introduces no route, listener, barrel export, or production composition", () => {
  assert.doesNotMatch(kaiBarrelSource, /kaiIntakeSensitivityProfileService|postgresIntakeSensitivityProfileRepository/);
  assert.doesNotMatch(migrationSource, /CREATE TRIGGER|CREATE FUNCTION.*(?:listener|scheduler)/i);
});

test("P1-05 repository returns conflict_current_state_changed when the already-persisted row's bound hash differs from the freshly re-read committed hash", async () => {
  // The FK-immutable profile-hash design (kai.intake_file_profiles.file_profile_id is
  // its primary key, and profile_canonical_sha256 is only ever bound at insert time)
  // makes this branch unreachable through the real committed schema, exactly like
  // P1-04's own analogous defensive branch. It is exercised here directly against the
  // repository's transaction control flow with a fake transaction context, bypassing
  // real PostgreSQL, to prove the comparison itself is correct.
  const profileRow = {
    organization_id: ORG,
    intake_file_id: "20000000-0000-4000-8000-000000000001",
    file_profile_id: FILE_PROFILE,
    profile: {},
    profile_canonical_sha256: "a".repeat(64),
  };
  const dictionaryRow = {
    data_dictionary_id: DICTIONARY,
    organization_id: ORG,
    intake_file_id: profileRow.intake_file_id,
    file_profile_id: FILE_PROFILE,
  };
  const existingRow = {
    profile_canonical_sha256: "b".repeat(64),
  };
  const fakeTx = {
    async query(sql) {
      if (sql.includes("FROM kai.intake_file_profiles")) return { rows: [profileRow] };
      if (sql.includes("FROM kai.data_dictionaries")) return { rows: [dictionaryRow] };
      if (sql.includes("FROM kai.intake_sensitivity_profiles") && sql.includes("FOR UPDATE")) return { rows: [existingRow] };
      throw new Error(`unexpected query in fake transaction: ${sql}`);
    },
  };
  const repository = createPostgresIntakeSensitivityProfileRepository({
    runInTransaction: (callback) => callback(fakeTx),
  });

  const result = await repository.persistIntakeSensitivityProfile({
    identity: { organizationId: ORG, fileProfileId: FILE_PROFILE, dataDictionaryId: DICTIONARY },
    now: NOW,
    metadataOnlyAudit: { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
});

test("P1-05 introduces no retention execution, deletion, or job-activation logic in the repository", () => {
  assert.doesNotMatch(repositorySource, /\bDELETE FROM\b/i);
  assert.doesNotMatch(repositorySource, /\b(?:retention_job|purge|schedule_deletion)\b/i);
});
