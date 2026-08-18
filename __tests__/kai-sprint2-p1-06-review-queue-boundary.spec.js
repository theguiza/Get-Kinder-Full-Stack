import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createSensitivityReviewQueueItem } from "../Backend/kai/services/kaiReviewQueueService.js";
import {
  createPostgresReviewQueueRepository,
  __reviewQueueRepositoryContract,
  __reviewQueueRepositoryTestables,
} from "../Backend/kai/dictionary/postgresReviewQueueRepository.js";

const SERVICE_PATH = "Backend/kai/services/kaiReviewQueueService.js";
const REPOSITORY_PATH = "Backend/kai/dictionary/postgresReviewQueueRepository.js";
const QUERIES_PATH = "Backend/kai/db/kaiIntakeQueries.js";

const repositorySource = readFileSync(new URL(`../${REPOSITORY_PATH}`, import.meta.url), "utf8");
const serviceSource = readFileSync(new URL(`../${SERVICE_PATH}`, import.meta.url), "utf8");
const queriesSource = readFileSync(new URL(`../${QUERIES_PATH}`, import.meta.url), "utf8");

// kaiReviewQueueService.js is a pre-existing shared file (createReviewQueueItem,
// updateReviewQueueStatus already import withTransaction/kaiDb.js and depend on
// kaiIntakeQueries.js for their own SQL): the P1-05-style "whole file contains no
// SQL/no pool import" purity check does not apply to the whole shared file, only to
// the new P1-06 function this package adds.
const createSensitivityReviewQueueItemBody = serviceSource.match(
  /export async function createSensitivityReviewQueueItem\([\s\S]*/,
)?.[0];

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
    reviewQueueRepository: {
      async createSensitivityReviewQueueItem(input) {
        calls.push(input);
        return result;
      },
    },
  };
}

const enabled = { KAI_SPRINT2_ENABLED: "true" };
const successResult = {
  ok: true,
  data: { reviewQueueItem: { review_queue_item_id: "q-1" }, replayed: false },
  error: null,
};

test("P1-06 service: disabled KAI_SPRINT2_ENABLED returns feature_disabled with zero repository calls", async () => {
  for (const env of [{}, { KAI_SPRINT2_ENABLED: "false" }, { KAI_SPRINT2_ENABLED: "0" }]) {
    const probe = createRepositoryProbe(successResult);
    const result = await createSensitivityReviewQueueItem(
      { organizationId: ORG, intakeSensitivityProfileId: PROFILE, actorContext: humanActor(), now: NOW },
      { env, reviewQueueRepository: probe.reviewQueueRepository },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "feature_disabled");
    assert.equal(probe.calls.length, 0);
  }
});

test("P1-06 service: rejects input shapes outside the accepted allowlist without calling the repository", async () => {
  const invalidInputs = [
    null,
    {},
    { organizationId: ORG, intakeSensitivityProfileId: PROFILE, actorContext: humanActor() },
    { organizationId: ORG, intakeSensitivityProfileId: PROFILE, actorContext: humanActor(), now: NOW, queueType: "sensitivity_review" },
    { organizationId: ORG, intakeSensitivityProfileId: PROFILE, actorContext: humanActor(), now: NOW, queueStatus: "resolved" },
    { organizationId: ORG, intakeSensitivityProfileId: PROFILE, actorContext: humanActor(), now: NOW, priority: "urgent" },
    { organizationId: ORG, intakeSensitivityProfileId: PROFILE, actorContext: humanActor(), now: NOW, summary: "caller summary" },
    { organizationId: ORG, intakeSensitivityProfileId: PROFILE, actorContext: humanActor(), now: NOW, requiredAction: "caller action" },
    { organizationId: ORG, intakeSensitivityProfileId: PROFILE, actorContext: humanActor(), now: NOW, assignedTo: "someone" },
    { organizationId: ORG, intakeSensitivityProfileId: PROFILE, actorContext: humanActor(), now: NOW, dueAt: NOW },
    { organizationId: ORG, intakeSensitivityProfileId: PROFILE, actorContext: humanActor(), now: NOW, targetObjectType: "intake_file" },
    { organizationId: "", intakeSensitivityProfileId: PROFILE, actorContext: humanActor(), now: NOW },
    { organizationId: ORG, intakeSensitivityProfileId: PROFILE, actorContext: humanActor(), now: "not-a-normalized-timestamp" },
  ];
  for (const input of invalidInputs) {
    const probe = createRepositoryProbe(successResult);
    const result = await createSensitivityReviewQueueItem(input, { env: enabled, reviewQueueRepository: probe.reviewQueueRepository });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker", JSON.stringify(input));
    assert.equal(probe.calls.length, 0);
  }
});

test("P1-06 service (AUTH-KAI-003): rejects every non-human actor type outright, with zero repository calls", async () => {
  for (const actorType of ["ai", "system", "import", "code", "generic_service"]) {
    const probe = createRepositoryProbe(successResult);
    const result = await createSensitivityReviewQueueItem(
      { organizationId: ORG, intakeSensitivityProfileId: PROFILE, actorContext: humanActor({ actorType }), now: NOW },
      { env: enabled, reviewQueueRepository: probe.reviewQueueRepository },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "authorization_denied");
    assert.equal(probe.calls.length, 0);
  }
});

test("P1-06 service (VAL-TEN-001): rejects a human actor with no active, correctly-roled membership in the requested organization", async () => {
  const scenarios = [
    humanActor({ organizationMemberships: [] }),
    humanActor({ organizationMemberships: [{ organization_id: OTHER_ORG, membership_status: "active", role_name: "gk_operator" }] }),
    humanActor({ organizationMemberships: [{ organization_id: ORG, membership_status: "revoked", role_name: "gk_operator" }] }),
    humanActor({ organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "read_only_role" }] }),
  ];
  for (const actorContext of scenarios) {
    const probe = createRepositoryProbe(successResult);
    const result = await createSensitivityReviewQueueItem(
      { organizationId: ORG, intakeSensitivityProfileId: PROFILE, actorContext, now: NOW },
      { env: enabled, reviewQueueRepository: probe.reviewQueueRepository },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "tenant_boundary_violation");
    assert.equal(probe.calls.length, 0);
  }
});

test("P1-06 service: accepts gk_admin, gk_operator, and gk_reviewer, and forwards only the identity/actor/now to the repository", async () => {
  for (const role of ["gk_admin", "gk_operator", "gk_reviewer"]) {
    const probe = createRepositoryProbe(successResult);
    const result = await createSensitivityReviewQueueItem(
      {
        organizationId: ORG,
        intakeSensitivityProfileId: PROFILE,
        actorContext: humanActor({ organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: role }] }),
        now: NOW,
      },
      { env: enabled, reviewQueueRepository: probe.reviewQueueRepository },
    );
    assert.equal(result.ok, true);
    assert.equal(probe.calls.length, 1);
    assert.deepEqual(probe.calls[0].identity, { organizationId: ORG, intakeSensitivityProfileId: PROFILE });
    assert.equal(probe.calls[0].actorUserId, "user-1");
    assert.equal(probe.calls[0].now, NOW);
  }
});

test("P1-06 service: createSensitivityReviewQueueItem itself contains no SQL and does not import a database pool directly", () => {
  assert.ok(createSensitivityReviewQueueItemBody, "expected to find the createSensitivityReviewQueueItem function body");
  assert.doesNotMatch(createSensitivityReviewQueueItemBody, /\bimport\s+pool\b/);
  assert.doesNotMatch(createSensitivityReviewQueueItemBody, /\bSELECT\b|\bINSERT INTO\b|\bUPDATE\b|\bDELETE FROM\b/i);
});

test("P1-06 repository: row locking for the sensitivity_review identity happens FOR UPDATE (shared query module), and the insert uses ON CONFLICT ... RETURNING against the existing partial unique index (kept local to the P1-06 repository)", () => {
  assert.match(queriesSource, /getScopedSensitivityReviewQueueItemByIdentity[\s\S]*?FOR UPDATE/);
  assert.doesNotMatch(queriesSource, /ON\s+CONFLICT/i);
  assert.match(
    repositorySource,
    /INSERT INTO kai\.review_queue_items[\s\S]*?ON CONFLICT \(organization_id, queue_type, target_object_type, target_object_id\)[\s\S]*?WHERE queue_type = 'sensitivity_review'[\s\S]*?DO NOTHING[\s\S]*?RETURNING/,
  );
  assert.match(repositorySource, /insertSensitivityReviewQueueItemIfAbsent\(/);
  assert.doesNotMatch(repositorySource, /anthropic|openai/i);
});

test("P1-06 repository never lets the caller override any server-pinned or server-derived field", () => {
  assert.equal(__reviewQueueRepositoryContract.SENSITIVITY_REVIEW_QUEUE_TYPE, "sensitivity_review");
  assert.equal(__reviewQueueRepositoryContract.SENSITIVITY_REVIEW_TARGET_OBJECT_TYPE, "intake_sensitivity_profile");
  assert.equal(__reviewQueueRepositoryContract.SENSITIVITY_REVIEW_PRIORITY, "medium");
  assert.equal(__reviewQueueRepositoryContract.SENSITIVITY_REVIEW_QUEUE_STATUS, "open");
  assert.equal(__reviewQueueRepositoryContract.SENSITIVITY_REVIEW_SUMMARY, "Review intake sensitivity and allowed-use profile.");
  assert.equal(
    __reviewQueueRepositoryContract.SENSITIVITY_REVIEW_REQUIRED_ACTION,
    "Review classifications, consent basis, allowed-use restrictions, and governance requirements before source-candidate work.",
  );
  assert.equal(__reviewQueueRepositoryContract.SENSITIVITY_REVIEW_AUDIT_CONTRACT, "p1_sensitivity_review_queue_item_v1");
  assert.equal(__reviewQueueRepositoryContract.SENSITIVITY_REVIEW_AUDIT_OPERATION, "sensitivity_review_queue_item_created");
});

function fakeTxFor({ profileRow, existingRow = null }) {
  return {
    async query(sql) {
      if (sql.includes("FROM kai.intake_sensitivity_profiles")) return { rows: profileRow ? [profileRow] : [] };
      if (sql.includes("FROM kai.review_queue_items") && sql.includes("FOR UPDATE")) {
        return { rows: existingRow ? [existingRow] : [] };
      }
      if (sql.includes("FROM kai.intake_files")) return { rows: [{ upload_state: "confirmed" }] };
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

test("P1-06 repository: not_found when the identity has no committed P1-05 sensitivity profile row (tenant isolation on the profile read)", async () => {
  const repository = createPostgresReviewQueueRepository({
    runInTransaction: (callback) => callback(fakeTxFor({ profileRow: null })),
  });
  const result = await repository.createSensitivityReviewQueueItem({
    identity: { organizationId: ORG, intakeSensitivityProfileId: PROFILE },
    actorUserId: "user-1",
    now: NOW,
    metadataOnlyAudit: { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
});

test("P1-06 repository (VAL-FUP-001-P0): validation_blocker when the predicate does not hold", async () => {
  for (const overrides of [
    { human_review_required: false },
    { public_use_allowed: true },
    { funder_use_allowed: true },
    { llm_processing_allowed: true },
    { product_learning_allowed: true },
    { retention_posture: "purge_scheduled" },
  ]) {
    const repository = createPostgresReviewQueueRepository({
      runInTransaction: (callback) => callback(fakeTxFor({ profileRow: { ...predicateSatisfyingProfileRow, ...overrides } })),
    });
    const result = await repository.createSensitivityReviewQueueItem({
      identity: { organizationId: ORG, intakeSensitivityProfileId: PROFILE },
      actorUserId: "user-1",
      now: NOW,
      metadataOnlyAudit: { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) },
    });
    assert.equal(result.ok, false, JSON.stringify(overrides));
    assert.equal(result.error.code, "validation_blocker");
  }
});

test("P1-06 repository: identical replay returns the existing row with zero audit calls", async () => {
  const existingRow = {
    review_queue_item_id: "q-existing",
    organization_id: ORG,
    queue_type: "sensitivity_review",
    target_object_type: "intake_sensitivity_profile",
    target_object_id: PROFILE,
    priority: "medium",
    queue_status: "open",
    assigned_to: null,
    due_at: null,
    summary: "Review intake sensitivity and allowed-use profile.",
    required_action: "x",
    created_at: NOW,
    updated_at: NOW,
  };
  let publishCalls = 0;
  const repository = createPostgresReviewQueueRepository({
    runInTransaction: (callback) => callback(fakeTxFor({ profileRow: predicateSatisfyingProfileRow, existingRow })),
  });
  const result = await repository.createSensitivityReviewQueueItem({
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
  assert.equal(result.data.reviewQueueItem.review_queue_item_id, "q-existing");
  assert.equal(publishCalls, 0);
});

test("P1-06 own-boolean-data-property audit predicate rejects a getter-backed ok, a non-plain prepared result, and a missing publish", () => {
  const { prepareRequiredAudit, RequiredAuditRejectedError } = __reviewQueueRepositoryTestables;
  const record = { queue_status: "open" };

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
  assert.equal(typeof prepareRequiredAudit(accepted, record).publish, "function");
});

test("P1-06 repository rolls back the insert when the required audit prepare is rejected, a publish throws synchronously, or the publish promise rejects", async () => {
  const rejectionModes = [
    { prepareMetadataOnlyAudit: () => ({ ok: false }) },
    { prepareMetadataOnlyAudit: () => ({ ok: true, publish: () => { throw new Error("synchronous publish failure"); } }) },
    { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => { throw new Error("rejected publish promise"); } }) },
  ];
  for (const metadataOnlyAudit of rejectionModes) {
    let insertReached = false;
    const tx = {
      async query(sql, params) {
        if (sql.includes("FROM kai.intake_sensitivity_profiles")) return { rows: [predicateSatisfyingProfileRow] };
        if (sql.includes("FROM kai.review_queue_items") && sql.includes("FOR UPDATE")) return { rows: [] };
        if (sql.includes("FROM kai.intake_files")) return { rows: [{ upload_state: "confirmed" }] };
        if (sql.includes("INSERT INTO kai.review_queue_items")) {
          insertReached = true;
          return {
            rows: [
              {
                review_queue_item_id: "q-new",
                organization_id: params[0],
                queue_type: "sensitivity_review",
                queue_status: "open",
                target_object_type: "intake_sensitivity_profile",
                target_object_id: PROFILE,
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
    const repository = createPostgresReviewQueueRepository({ runInTransaction: (callback) => callback(tx) });
    const result = await repository.createSensitivityReviewQueueItem({
      identity: { organizationId: ORG, intakeSensitivityProfileId: PROFILE },
      actorUserId: "user-1",
      now: NOW,
      metadataOnlyAudit,
    });
    assert.equal(insertReached, true, "the insert must be attempted before the audit-prepare/publish failure surfaces");
    assert.equal(result.ok, false);
  }
});

test("P1-06 repository resolves concurrent identical creation via ON CONFLICT ... DO NOTHING RETURNING plus an authoritative re-read, not a raised 23505 catch or an in-process lock", () => {
  assert.doesNotMatch(repositorySource, /\bcatch\s*\(\s*insertError\s*\)/);
  assert.doesNotMatch(repositorySource, /"23505"/);
  assert.match(repositorySource, /if \(!insertedRow\) \{/);
  assert.doesNotMatch(repositorySource, /\b(?:inFlight|pendingLocks?|mutex|semaphore|advisory_lock|pg_advisory|savepoint)\b/i);
});

test("P1-06 audit metadata builder emits exactly the seven allowlisted keys with no raw content", () => {
  assert.match(repositorySource, /metadata_only: true/);
  assert.match(repositorySource, /contract: SENSITIVITY_REVIEW_AUDIT_CONTRACT/);
  assert.match(repositorySource, /queue_type: record\.queue_type/);
  assert.match(repositorySource, /target_object_type: record\.target_object_type/);
  assert.match(repositorySource, /target_object_id: record\.target_object_id/);
  assert.match(repositorySource, /queue_status: record\.queue_status/);
  assert.match(repositorySource, /validator_key: SENSITIVITY_REVIEW_AUDIT_VALIDATOR_KEY/);
  assert.doesNotMatch(repositorySource, /summary: record\.summary/);
  assert.doesNotMatch(repositorySource, /required_action: record\.required_action/);
});

test("P1-06 audit contract uses the owner-authorized validator_key", () => {
  assert.equal(__reviewQueueRepositoryContract.SENSITIVITY_REVIEW_AUDIT_VALIDATOR_KEY, "VAL-FUP-001-P0");
});

test("P1-06 introduces no status transition, resolution, approval, escalation, or promotion logic, and does not modify updateReviewQueueStatus", () => {
  assert.doesNotMatch(repositorySource, /\b(?:resolve|approve|escalate|cancel|reopen|promote)[A-Z]?\w*\(/i);
  const updateReviewQueueStatusBody = serviceSource.match(
    /export async function updateReviewQueueStatus\([\s\S]*?\n}\n/,
  )?.[0];
  assert.ok(updateReviewQueueStatusBody, "expected the existing updateReviewQueueStatus export to still be present");
  assert.doesNotMatch(updateReviewQueueStatusBody, /createSensitivityReviewQueueItem/);
});
