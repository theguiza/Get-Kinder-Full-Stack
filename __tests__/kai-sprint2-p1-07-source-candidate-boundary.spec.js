import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createSourceCandidateStub } from "../Backend/kai/services/kaiSourceCandidateService.js";
import {
  createPostgresSourceCandidateRepository,
  __sourceCandidateRepositoryContract,
  __sourceCandidateRepositoryTestables,
} from "../Backend/kai/dictionary/postgresSourceCandidateRepository.js";

const SERVICE_PATH = "Backend/kai/services/kaiSourceCandidateService.js";
const REPOSITORY_PATH = "Backend/kai/dictionary/postgresSourceCandidateRepository.js";
const QUERIES_PATH = "Backend/kai/db/kaiIntakeQueries.js";

const repositorySource = readFileSync(new URL(`../${REPOSITORY_PATH}`, import.meta.url), "utf8");
const serviceSource = readFileSync(new URL(`../${SERVICE_PATH}`, import.meta.url), "utf8");
const queriesSource = readFileSync(new URL(`../${QUERIES_PATH}`, import.meta.url), "utf8");

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const PROFILE = "80000000-0000-4000-8000-000000000001";
const NOW = "2026-08-04T10:00:00.000Z";

function humanActor(overrides = {}) {
  return {
    actorType: "human",
    actorUserId: "user-1",
    organizationMemberships: [
      { organization_id: ORG, membership_status: "active", role_name: "gk_operator" },
    ],
    ...overrides,
  };
}

function createRepositoryProbe(result) {
  const calls = [];
  return {
    calls,
    sourceCandidateRepository: {
      async createSourceCandidateStub(input) {
        calls.push(input);
        return result;
      },
    },
  };
}

const enabled = { KAI_SPRINT2_ENABLED: "true" };
const successResult = {
  ok: true,
  data: {
    sourceCandidate: { intake_source_candidate_id: "c-1" },
    reviewQueueItem: { review_queue_item_id: "q-1" },
    replayed: false,
  },
  error: null,
};

test("P1-07 service: disabled KAI_SPRINT2_ENABLED returns feature_disabled with zero repository calls", async () => {
  for (const env of [{}, { KAI_SPRINT2_ENABLED: "false" }, { KAI_SPRINT2_ENABLED: "0" }]) {
    const probe = createRepositoryProbe(successResult);
    const result = await createSourceCandidateStub(
      { organizationId: ORG, intakeSensitivityProfileId: PROFILE, actorContext: humanActor(), now: NOW },
      { env, sourceCandidateRepository: probe.sourceCandidateRepository },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "feature_disabled");
    assert.equal(probe.calls.length, 0);
  }
});

test("P1-07 service: rejects input shapes outside the accepted allowlist without calling the repository", async () => {
  const invalidInputs = [
    null,
    {},
    { organizationId: ORG, intakeSensitivityProfileId: PROFILE, actorContext: humanActor() },
    { organizationId: ORG, intakeSensitivityProfileId: PROFILE, actorContext: humanActor(), now: NOW, proposedSourceType: "donation_platform" },
    { organizationId: ORG, intakeSensitivityProfileId: PROFILE, actorContext: humanActor(), now: NOW, candidateStatus: "approved" },
    { organizationId: ORG, intakeSensitivityProfileId: PROFILE, actorContext: humanActor(), now: NOW, intakeFileId: "f-1" },
    { organizationId: ORG, intakeSensitivityProfileId: PROFILE, actorContext: humanActor(), now: NOW, fileProfileId: "p-1" },
    { organizationId: ORG, intakeSensitivityProfileId: PROFILE, actorContext: humanActor(), now: NOW, dataDictionaryId: "d-1" },
    { organizationId: ORG, intakeSensitivityProfileId: PROFILE, actorContext: humanActor(), now: NOW, profileCanonicalSha256: "a".repeat(64) },
    { organizationId: "", intakeSensitivityProfileId: PROFILE, actorContext: humanActor(), now: NOW },
    { organizationId: ORG, intakeSensitivityProfileId: PROFILE, actorContext: humanActor(), now: "not-a-normalized-timestamp" },
  ];
  for (const input of invalidInputs) {
    const probe = createRepositoryProbe(successResult);
    const result = await createSourceCandidateStub(input, { env: enabled, sourceCandidateRepository: probe.sourceCandidateRepository });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker", JSON.stringify(input));
    assert.equal(probe.calls.length, 0);
  }
});

test("P1-07 service (AUTH-KAI-003): rejects every non-human actor type outright, with zero repository calls", async () => {
  for (const actorType of ["ai", "system", "import", "code", "generic_service"]) {
    const probe = createRepositoryProbe(successResult);
    const result = await createSourceCandidateStub(
      { organizationId: ORG, intakeSensitivityProfileId: PROFILE, actorContext: humanActor({ actorType }), now: NOW },
      { env: enabled, sourceCandidateRepository: probe.sourceCandidateRepository },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "authorization_denied");
    assert.equal(probe.calls.length, 0);
  }
});

test("P1-07 service (VAL-TEN-001): rejects a human actor with no active, correctly-roled membership in the requested organization", async () => {
  const scenarios = [
    humanActor({ organizationMemberships: [] }),
    humanActor({ organizationMemberships: [{ organization_id: OTHER_ORG, membership_status: "active", role_name: "gk_operator" }] }),
    humanActor({ organizationMemberships: [{ organization_id: ORG, membership_status: "revoked", role_name: "gk_operator" }] }),
    humanActor({ organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "read_only_role" }] }),
  ];
  for (const actorContext of scenarios) {
    const probe = createRepositoryProbe(successResult);
    const result = await createSourceCandidateStub(
      { organizationId: ORG, intakeSensitivityProfileId: PROFILE, actorContext, now: NOW },
      { env: enabled, sourceCandidateRepository: probe.sourceCandidateRepository },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "tenant_boundary_violation");
    assert.equal(probe.calls.length, 0);
  }
});

test("P1-07 service: accepts gk_admin, gk_operator, and gk_reviewer, and forwards only the identity/actor/now to the repository", async () => {
  for (const role of ["gk_admin", "gk_operator", "gk_reviewer"]) {
    const probe = createRepositoryProbe(successResult);
    const result = await createSourceCandidateStub(
      {
        organizationId: ORG,
        intakeSensitivityProfileId: PROFILE,
        actorContext: humanActor({ organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: role }] }),
        now: NOW,
      },
      { env: enabled, sourceCandidateRepository: probe.sourceCandidateRepository },
    );
    assert.equal(result.ok, true);
    assert.equal(probe.calls.length, 1);
    assert.deepEqual(probe.calls[0].identity, { organizationId: ORG, intakeSensitivityProfileId: PROFILE });
    assert.equal(probe.calls[0].actorUserId, "user-1");
    assert.equal(probe.calls[0].now, NOW);
  }
});

test("P1-07 service: createSourceCandidateStub itself contains no SQL and does not import a database pool directly", () => {
  const body = serviceSource.match(/export async function createSourceCandidateStub\([\s\S]*/)?.[0];
  assert.ok(body, "expected to find the createSourceCandidateStub function body");
  assert.doesNotMatch(body, /\bimport\s+pool\b/);
  assert.doesNotMatch(body, /\bSELECT\b|\bINSERT INTO\b|\bUPDATE\b|\bDELETE FROM\b/i);
});

test("P1-07 repository: both the candidate insert and the review-item insert use ON CONFLICT ... DO NOTHING RETURNING, and review-item row locking reuses the shared FOR UPDATE query", () => {
  assert.match(queriesSource, /getScopedSourceCandidateReviewQueueItemByIdentity[\s\S]*?FOR UPDATE/);
  assert.match(
    repositorySource,
    /INSERT INTO kai\.intake_source_candidates[\s\S]*?ON CONFLICT \(organization_id, intake_sensitivity_profile_id\)[\s\S]*?DO NOTHING[\s\S]*?RETURNING/,
  );
  assert.match(
    repositorySource,
    /INSERT INTO kai\.review_queue_items[\s\S]*?ON CONFLICT \(organization_id, queue_type, target_object_type, target_object_id\)[\s\S]*?WHERE queue_type = 'source_candidate_review'[\s\S]*?DO NOTHING[\s\S]*?RETURNING/,
  );
});

test("P1-07 repository never lets the caller override any server-pinned or server-derived field", () => {
  assert.equal(__sourceCandidateRepositoryContract.SOURCE_CANDIDATE_PROPOSED_SOURCE_TYPE, "unknown");
  assert.equal(__sourceCandidateRepositoryContract.SOURCE_CANDIDATE_STATUS, "needs_gk_review");
  assert.equal(__sourceCandidateRepositoryContract.SOURCE_CANDIDATE_REVIEW_QUEUE_TYPE, "source_candidate_review");
  assert.equal(__sourceCandidateRepositoryContract.SOURCE_CANDIDATE_REVIEW_TARGET_OBJECT_TYPE, "intake_source_candidate");
  assert.equal(__sourceCandidateRepositoryContract.SOURCE_CANDIDATE_REVIEW_QUEUE_STATUS, "open");
  assert.deepEqual(__sourceCandidateRepositoryContract.SOURCE_CANDIDATE_REVIEW_QUEUE_METADATA, { p0_stub: true });
  assert.match(__sourceCandidateRepositoryContract.SOURCE_CANDIDATE_REVIEW_REQUIRED_ACTION, /review is required/i);
  assert.match(__sourceCandidateRepositoryContract.SOURCE_CANDIDATE_REVIEW_REQUIRED_ACTION, /not authorized/i);
  assert.match(__sourceCandidateRepositoryContract.SOURCE_CANDIDATE_REVIEW_REQUIRED_ACTION, /no source or source_version/i);
});

function fakeTxFor({ profileRow, existingCandidateRow = null, existingQueueRow = null }) {
  return {
    async query(sql) {
      if (sql.includes("FROM kai.intake_sensitivity_profiles")) return { rows: profileRow ? [profileRow] : [] };
      if (sql.includes("FROM kai.intake_files")) return { rows: [{ upload_state: "confirmed" }] };
      if (sql.includes("FROM kai.intake_source_candidates") && sql.includes("FOR UPDATE")) {
        return { rows: existingCandidateRow ? [existingCandidateRow] : [] };
      }
      if (sql.includes("FROM kai.review_queue_items") && sql.includes("FOR UPDATE")) {
        return { rows: existingQueueRow ? [existingQueueRow] : [] };
      }
      if (sql.includes("INSERT INTO kai.upload_lifecycle_audit")) return { rows: [] };
      throw new Error(`unexpected query in fake transaction: ${sql}`);
    },
  };
}

const predicateSatisfyingProfileRow = {
  organization_id: ORG,
  intake_sensitivity_profile_id: PROFILE,
  intake_file_id: "20000000-0000-4000-8000-000000000001",
  file_profile_id: "50000000-0000-4000-8000-000000000001",
  data_dictionary_id: "60000000-0000-4000-8000-000000000001",
  profile_canonical_sha256: "a".repeat(64),
  human_review_required: true,
  public_use_allowed: false,
  funder_use_allowed: false,
  llm_processing_allowed: false,
  product_learning_allowed: false,
  retention_posture: "restricted_pending_review",
};

test("P1-07 repository: not_found when the identity has no committed P1-05 sensitivity profile row (tenant isolation on the profile read)", async () => {
  const repository = createPostgresSourceCandidateRepository({
    runInTransaction: (callback) => callback(fakeTxFor({ profileRow: null })),
  });
  const result = await repository.createSourceCandidateStub({
    identity: { organizationId: ORG, intakeSensitivityProfileId: PROFILE },
    actorUserId: "user-1",
    now: NOW,
    metadataOnlyAudit: { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
});

test("P1-07 repository (VAL-KAI-P1-07-001): validation_blocker when the fail-closed predicate does not hold", async () => {
  for (const overrides of [
    { human_review_required: false },
    { public_use_allowed: true },
    { funder_use_allowed: true },
    { llm_processing_allowed: true },
    { product_learning_allowed: true },
    { retention_posture: "purge_scheduled" },
  ]) {
    const repository = createPostgresSourceCandidateRepository({
      runInTransaction: (callback) => callback(fakeTxFor({ profileRow: { ...predicateSatisfyingProfileRow, ...overrides } })),
    });
    const result = await repository.createSourceCandidateStub({
      identity: { organizationId: ORG, intakeSensitivityProfileId: PROFILE },
      actorUserId: "user-1",
      now: NOW,
      metadataOnlyAudit: { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) },
    });
    assert.equal(result.ok, false, JSON.stringify(overrides));
    assert.equal(result.error.code, "validation_blocker");
  }
});

test("P1-07 repository: identical full replay (candidate and review item both already exist) returns the existing rows with zero audit calls", async () => {
  const existingCandidateRow = {
    intake_source_candidate_id: "c-existing",
    organization_id: ORG,
    intake_file_id: predicateSatisfyingProfileRow.intake_file_id,
    file_profile_id: predicateSatisfyingProfileRow.file_profile_id,
    data_dictionary_id: predicateSatisfyingProfileRow.data_dictionary_id,
    intake_sensitivity_profile_id: PROFILE,
    profile_canonical_sha256: predicateSatisfyingProfileRow.profile_canonical_sha256,
    proposed_source_type: "unknown",
    candidate_status: "needs_gk_review",
    created_at: NOW,
  };
  const existingQueueRow = {
    review_queue_item_id: "q-existing",
    organization_id: ORG,
    queue_type: "source_candidate_review",
    target_object_type: "intake_source_candidate",
    target_object_id: "c-existing",
    queue_status: "open",
    queue_metadata: { p0_stub: true },
  };
  let publishCalls = 0;
  const repository = createPostgresSourceCandidateRepository({
    runInTransaction: (callback) => callback(fakeTxFor({ profileRow: predicateSatisfyingProfileRow, existingCandidateRow, existingQueueRow })),
  });
  const result = await repository.createSourceCandidateStub({
    identity: { organizationId: ORG, intakeSensitivityProfileId: PROFILE },
    actorUserId: "user-1",
    now: NOW,
    metadataOnlyAudit: {
      prepareMetadataOnlyAudit: () => {
        publishCalls += 1;
        return { ok: true, publish: async () => {} };
      },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.replayed, true);
  assert.equal(result.data.sourceCandidate.intake_source_candidate_id, "c-existing");
  assert.equal(result.data.reviewQueueItem.review_queue_item_id, "q-existing");
  assert.equal(publishCalls, 0);
});

test("P1-07 repository: a partial replay (candidate exists, review item does not) creates only the missing review item and still writes no candidate audit", async () => {
  const existingCandidateRow = {
    intake_source_candidate_id: "c-existing",
    organization_id: ORG,
    intake_file_id: predicateSatisfyingProfileRow.intake_file_id,
    file_profile_id: predicateSatisfyingProfileRow.file_profile_id,
    data_dictionary_id: predicateSatisfyingProfileRow.data_dictionary_id,
    intake_sensitivity_profile_id: PROFILE,
    profile_canonical_sha256: predicateSatisfyingProfileRow.profile_canonical_sha256,
    proposed_source_type: "unknown",
    candidate_status: "needs_gk_review",
    created_at: NOW,
  };
  let publishCalls = 0;
  let queueInsertReached = false;
  const tx = {
    async query(sql, params) {
      if (sql.includes("FROM kai.intake_sensitivity_profiles")) return { rows: [predicateSatisfyingProfileRow] };
      if (sql.includes("FROM kai.intake_files")) return { rows: [{ upload_state: "confirmed" }] };
      if (sql.includes("FROM kai.intake_source_candidates") && sql.includes("FOR UPDATE")) return { rows: [existingCandidateRow] };
      if (sql.includes("FROM kai.review_queue_items") && sql.includes("FOR UPDATE")) return { rows: [] };
      if (sql.includes("INSERT INTO kai.review_queue_items")) {
        queueInsertReached = true;
        return {
          rows: [
            {
              review_queue_item_id: "q-new",
              organization_id: params[0],
              queue_type: "source_candidate_review",
              queue_status: "open",
              target_object_type: "intake_source_candidate",
              target_object_id: "c-existing",
              queue_metadata: { p0_stub: true },
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO kai.upload_lifecycle_audit")) throw new Error("no audit should be written on a partial replay");
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const repository = createPostgresSourceCandidateRepository({
    runInTransaction: (callback) => callback(tx),
    metadataOnlyAudit: {
      prepareMetadataOnlyAudit: () => {
        publishCalls += 1;
        return { ok: true, publish: async () => {} };
      },
    },
  });
  const result = await repository.createSourceCandidateStub({
    identity: { organizationId: ORG, intakeSensitivityProfileId: PROFILE },
    actorUserId: "user-1",
    now: NOW,
    metadataOnlyAudit: {
      prepareMetadataOnlyAudit: () => {
        publishCalls += 1;
        return { ok: true, publish: async () => {} };
      },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.replayed, true);
  assert.equal(queueInsertReached, true);
  assert.equal(result.data.reviewQueueItem.review_queue_item_id, "q-new");
  assert.equal(publishCalls, 0);
});

test("P1-07 own-boolean-data-property audit predicate rejects a getter-backed ok, a non-plain prepared result, and a missing publish", () => {
  const { prepareRequiredAudit, RequiredAuditRejectedError } = __sourceCandidateRepositoryTestables;
  const candidateRecord = { intake_sensitivity_profile_id: PROFILE, profile_canonical_sha256: "a".repeat(64), proposed_source_type: "unknown", candidate_status: "needs_gk_review" };
  const queueRecord = { queue_type: "source_candidate_review", target_object_type: "intake_source_candidate", target_object_id: "c-1", queue_status: "open" };

  const getterBacked = {
    prepareMetadataOnlyAudit() {
      return Object.defineProperty({}, "ok", { get() { return true; }, enumerable: true });
    },
  };
  assert.throws(() => prepareRequiredAudit(getterBacked, candidateRecord, queueRecord), RequiredAuditRejectedError);

  const arrayShaped = {
    prepareMetadataOnlyAudit() {
      return Object.assign([], { ok: true, publish() {} });
    },
  };
  assert.throws(() => prepareRequiredAudit(arrayShaped, candidateRecord, queueRecord), RequiredAuditRejectedError);

  const missingPublish = {
    prepareMetadataOnlyAudit() {
      return { ok: true };
    },
  };
  assert.throws(() => prepareRequiredAudit(missingPublish, candidateRecord, queueRecord), RequiredAuditRejectedError);

  const accepted = {
    prepareMetadataOnlyAudit() {
      return { ok: true, publish: async () => {} };
    },
  };
  assert.equal(typeof prepareRequiredAudit(accepted, candidateRecord, queueRecord).publish, "function");
});

test("P1-07 repository rolls back the candidate and review-item inserts when the required audit prepare is rejected, a publish throws synchronously, or the publish promise rejects", async () => {
  const rejectionModes = [
    { prepareMetadataOnlyAudit: () => ({ ok: false }) },
    { prepareMetadataOnlyAudit: () => ({ ok: true, publish: () => { throw new Error("synchronous publish failure"); } }) },
    { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => { throw new Error("rejected publish promise"); } }) },
  ];
  for (const metadataOnlyAudit of rejectionModes) {
    let candidateInsertReached = false;
    let queueInsertReached = false;
    const tx = {
      async query(sql, params) {
        if (sql.includes("FROM kai.intake_sensitivity_profiles")) return { rows: [predicateSatisfyingProfileRow] };
        if (sql.includes("FROM kai.intake_files")) return { rows: [{ upload_state: "confirmed" }] };
        if (sql.includes("FROM kai.intake_source_candidates") && sql.includes("FOR UPDATE")) return { rows: [] };
        if (sql.includes("FROM kai.review_queue_items") && sql.includes("FOR UPDATE")) return { rows: [] };
        if (sql.includes("INSERT INTO kai.intake_source_candidates")) {
          candidateInsertReached = true;
          return {
            rows: [
              {
                intake_source_candidate_id: "c-new",
                organization_id: params[0],
                intake_file_id: params[1],
                file_profile_id: params[2],
                data_dictionary_id: params[3],
                intake_sensitivity_profile_id: params[4],
                profile_canonical_sha256: params[5],
                proposed_source_type: "unknown",
                candidate_status: "needs_gk_review",
                created_at: NOW,
              },
            ],
          };
        }
        if (sql.includes("INSERT INTO kai.review_queue_items")) {
          queueInsertReached = true;
          return {
            rows: [
              {
                review_queue_item_id: "q-new",
                organization_id: ORG,
                queue_type: "source_candidate_review",
                queue_status: "open",
                target_object_type: "intake_source_candidate",
                target_object_id: "c-new",
                queue_metadata: { p0_stub: true },
              },
            ],
          };
        }
        if (sql.includes("INSERT INTO kai.upload_lifecycle_audit")) {
          throw new Error("audit insert should not be reached when the prepare itself is rejected");
        }
        throw new Error(`unexpected query: ${sql}`);
      },
    };
    const repository = createPostgresSourceCandidateRepository({ runInTransaction: (callback) => callback(tx) });
    const result = await repository.createSourceCandidateStub({
      identity: { organizationId: ORG, intakeSensitivityProfileId: PROFILE },
      actorUserId: "user-1",
      now: NOW,
      metadataOnlyAudit,
    });
    assert.equal(candidateInsertReached, true, "the candidate insert must be attempted before the audit-prepare/publish failure surfaces");
    assert.equal(queueInsertReached, true, "the review-item insert must be attempted before the audit-prepare/publish failure surfaces");
    assert.equal(result.ok, false);
  }
});

test("P1-07 repository resolves concurrent identical creation via ON CONFLICT ... DO NOTHING RETURNING plus an authoritative re-read, not a raised 23505 catch or an in-process lock", () => {
  assert.doesNotMatch(repositorySource, /\bcatch\s*\(\s*insertError\s*\)/);
  assert.doesNotMatch(repositorySource, /"23505"/);
  assert.match(repositorySource, /if \(!insertedCandidateRow\) \{/);
  assert.match(repositorySource, /if \(!insertedQueueRow\) \{/);
  assert.doesNotMatch(repositorySource, /\b(?:inFlight|pendingLocks?|mutex|semaphore|advisory_lock|pg_advisory|savepoint)\b/i);
});

test("P1-07 audit metadata builder emits exactly the eleven allowlisted keys with no raw content", () => {
  assert.match(repositorySource, /metadata_only: true/);
  assert.match(repositorySource, /contract: SOURCE_CANDIDATE_AUDIT_CONTRACT/);
  assert.match(repositorySource, /intake_sensitivity_profile_id: candidateRecord\.intake_sensitivity_profile_id/);
  assert.match(repositorySource, /profile_canonical_sha256: candidateRecord\.profile_canonical_sha256/);
  assert.match(repositorySource, /proposed_source_type: candidateRecord\.proposed_source_type/);
  assert.match(repositorySource, /candidate_status: candidateRecord\.candidate_status/);
  assert.match(repositorySource, /queue_type: queueRecord\.queue_type/);
  assert.match(repositorySource, /target_object_type: queueRecord\.target_object_type/);
  assert.match(repositorySource, /target_object_id: queueRecord\.target_object_id/);
  assert.match(repositorySource, /queue_status: queueRecord\.queue_status/);
  assert.match(repositorySource, /validator_key: SOURCE_CANDIDATE_VALIDATOR_KEY/);
  assert.doesNotMatch(repositorySource, /raw_content|sample_values|filename/i);
});

test("P1-07 audit contract discloses its validator_key as a P1-07 implementation decision, not an owner-quoted key", () => {
  assert.equal(__sourceCandidateRepositoryContract.SOURCE_CANDIDATE_VALIDATOR_KEY, "VAL-KAI-P1-07-001");
  assert.match(repositorySource, /not quoted from, and is not claimed to be\s+\* mandated by, any owner-authorized governing source/);
});

test("P1-07 introduces no source, source_version, evidence, claim, promotion, approval, or eligibility logic (function calls, not disclaiming comments)", () => {
  for (const source of [repositorySource, serviceSource]) {
    assert.doesNotMatch(source, /\b(?:promote|approve|reject|escalate)[A-Z]?\w*\(/i);
    assert.doesNotMatch(source, /\bCREATE\s+(?:SOURCE_VERSION|EVIDENCE|CLAIM)\b/i);
    assert.doesNotMatch(source, /INSERT INTO kai\.(?:sources|source_versions|evidence|claims)\b/i);
  }
});
