import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createSourcePromotionDecision } from "../Backend/kai/services/kaiSourcePromotionService.js";
import {
  createPostgresSourcePromotionRepository,
  __sourcePromotionRepositoryContract,
  __sourcePromotionRepositoryTestables,
} from "../Backend/kai/dictionary/postgresSourcePromotionRepository.js";

const SERVICE_PATH = "Backend/kai/services/kaiSourcePromotionService.js";
const REPOSITORY_PATH = "Backend/kai/dictionary/postgresSourcePromotionRepository.js";

const repositorySource = readFileSync(new URL(`../${REPOSITORY_PATH}`, import.meta.url), "utf8");
const serviceSource = readFileSync(new URL(`../${SERVICE_PATH}`, import.meta.url), "utf8");

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const CANDIDATE = "90000000-0000-4000-8000-000000000001";
const SENSITIVITY = "80000000-0000-4000-8000-000000000001";
const NOW = "2026-08-04T10:00:00.000Z";
const REVIEWED_TYPE = "organization_primary_record";
const REQUIRED_ACTION_NEEDS_MORE_INFORMATION = "Obtain the missing client information before reconsidering source promotion.";

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
    sourcePromotionRepository: {
      async createSourcePromotionDecision(input) {
        calls.push(input);
        return result;
      },
    },
  };
}

const bothEnabled = { KAI_SPRINT2_ENABLED: "true", KAI_SOURCE_PROMOTION_ENABLED: "true" };
const successResult = {
  ok: true,
  data: {
    promotionDecision: { intake_promotion_decision_id: "d-1", decision_status: "promoted" },
    sourceCandidate: { intake_source_candidate_id: CANDIDATE, candidate_status: "promoted" },
    reviewQueueItem: { review_queue_item_id: "q-1", queue_status: "resolved" },
    source: { source_id: "s-1" },
    sourceVersion: { source_version_id: "v-1" },
    replayed: false,
  },
  error: null,
};

test("P1-08 service: either feature flag disabled returns feature_disabled with zero repository calls", async () => {
  for (const env of [
    {},
    { KAI_SPRINT2_ENABLED: "true" },
    { KAI_SOURCE_PROMOTION_ENABLED: "true" },
    { KAI_SPRINT2_ENABLED: "false", KAI_SOURCE_PROMOTION_ENABLED: "true" },
    { KAI_SPRINT2_ENABLED: "true", KAI_SOURCE_PROMOTION_ENABLED: "0" },
  ]) {
    for (const outcome of ["needs_more_information", "rejected", "promoted"]) {
      const probe = createRepositoryProbe(successResult);
      const input = { organizationId: ORG, intakeSourceCandidateId: CANDIDATE, outcome, actorContext: humanActor(), now: NOW };
      if (outcome === "promoted") input.reviewedSourceType = REVIEWED_TYPE;
      const result = await createSourcePromotionDecision(input, { env, sourcePromotionRepository: probe.sourcePromotionRepository });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "feature_disabled");
      assert.equal(probe.calls.length, 0, JSON.stringify({ env, outcome }));
    }
  }
});

test("P1-08 service: rejects input shapes outside the accepted allowlist without calling the repository", async () => {
  const invalidInputs = [
    null,
    {},
    { organizationId: ORG, intakeSourceCandidateId: CANDIDATE, outcome: "promoted", actorContext: humanActor(), now: NOW },
    { organizationId: ORG, intakeSourceCandidateId: CANDIDATE, outcome: "promoted", reviewedSourceType: REVIEWED_TYPE, actorContext: humanActor() },
    { organizationId: ORG, intakeSourceCandidateId: CANDIDATE, outcome: "promoted", reviewedSourceType: REVIEWED_TYPE, actorContext: humanActor(), now: NOW, sourceId: "s-1" },
    { organizationId: ORG, intakeSourceCandidateId: CANDIDATE, outcome: "promoted", reviewedSourceType: REVIEWED_TYPE, actorContext: humanActor(), now: NOW, sourceCode: "a".repeat(64) },
    { organizationId: "", intakeSourceCandidateId: CANDIDATE, outcome: "promoted", reviewedSourceType: REVIEWED_TYPE, actorContext: humanActor(), now: NOW },
    { organizationId: ORG, intakeSourceCandidateId: CANDIDATE, outcome: "promoted", reviewedSourceType: "", actorContext: humanActor(), now: NOW },
    { organizationId: ORG, intakeSourceCandidateId: CANDIDATE, outcome: "promoted", reviewedSourceType: REVIEWED_TYPE, actorContext: humanActor(), now: "not-a-normalized-timestamp" },
    // no outcome at all
    { organizationId: ORG, intakeSourceCandidateId: CANDIDATE, reviewedSourceType: REVIEWED_TYPE, actorContext: humanActor(), now: NOW },
    // unrecognized outcome
    { organizationId: ORG, intakeSourceCandidateId: CANDIDATE, outcome: "decided", actorContext: humanActor(), now: NOW },
    // reviewedSourceType present but outcome is not 'promoted' - rejected as ambiguous input shape, never silently ignored
    { organizationId: ORG, intakeSourceCandidateId: CANDIDATE, outcome: "needs_more_information", reviewedSourceType: REVIEWED_TYPE, actorContext: humanActor(), now: NOW },
    { organizationId: ORG, intakeSourceCandidateId: CANDIDATE, outcome: "rejected", reviewedSourceType: REVIEWED_TYPE, actorContext: humanActor(), now: NOW },
    // outcome === 'promoted' but reviewedSourceType missing
    { organizationId: ORG, intakeSourceCandidateId: CANDIDATE, outcome: "promoted", actorContext: humanActor(), now: NOW },
  ];
  for (const input of invalidInputs) {
    const probe = createRepositoryProbe(successResult);
    const result = await createSourcePromotionDecision(input, { env: bothEnabled, sourcePromotionRepository: probe.sourcePromotionRepository });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker", JSON.stringify(input));
    assert.equal(probe.calls.length, 0);
  }
});

test("P1-08 service: accepts valid needs_more_information and rejected inputs (no reviewedSourceType required or permitted)", async () => {
  for (const outcome of ["needs_more_information", "rejected"]) {
    const probe = createRepositoryProbe(successResult);
    const result = await createSourcePromotionDecision(
      { organizationId: ORG, intakeSourceCandidateId: CANDIDATE, outcome, actorContext: humanActor(), now: NOW },
      { env: bothEnabled, sourcePromotionRepository: probe.sourcePromotionRepository },
    );
    assert.equal(result.ok, true, outcome);
    assert.equal(probe.calls.length, 1);
    assert.equal(probe.calls[0].outcome, outcome);
    assert.equal("reviewedSourceType" in probe.calls[0], false, outcome);
  }
});

test("P1-08 service (AUTH-KAI-003): rejects every non-human actor type outright, with zero repository calls", async () => {
  for (const actorType of ["ai", "system", "import", "code", "generic_service"]) {
    for (const outcome of ["needs_more_information", "rejected", "promoted"]) {
      const probe = createRepositoryProbe(successResult);
      const input = { organizationId: ORG, intakeSourceCandidateId: CANDIDATE, outcome, actorContext: humanActor({ actorType }), now: NOW };
      if (outcome === "promoted") input.reviewedSourceType = REVIEWED_TYPE;
      const result = await createSourcePromotionDecision(input, { env: bothEnabled, sourcePromotionRepository: probe.sourcePromotionRepository });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "authorization_denied");
      assert.equal(probe.calls.length, 0);
    }
  }
});

test("P1-08 service (VAL-TEN-001): rejects a human actor with no active, correctly-roled membership in the requested organization", async () => {
  const scenarios = [
    humanActor({ organizationMemberships: [] }),
    humanActor({ organizationMemberships: [{ organization_id: OTHER_ORG, membership_status: "active", role_name: "gk_operator" }] }),
    humanActor({ organizationMemberships: [{ organization_id: ORG, membership_status: "revoked", role_name: "gk_operator" }] }),
    humanActor({ organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "read_only_role" }] }),
  ];
  for (const actorContext of scenarios) {
    const probe = createRepositoryProbe(successResult);
    const result = await createSourcePromotionDecision(
      { organizationId: ORG, intakeSourceCandidateId: CANDIDATE, outcome: "promoted", reviewedSourceType: REVIEWED_TYPE, actorContext, now: NOW },
      { env: bothEnabled, sourcePromotionRepository: probe.sourcePromotionRepository },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "tenant_boundary_violation");
    assert.equal(probe.calls.length, 0);
  }
});

test("P1-08 service: accepts gk_admin, gk_operator, and gk_reviewer, and forwards only identity/outcome/reviewedSourceType/actor/now to the repository", async () => {
  for (const role of ["gk_admin", "gk_operator", "gk_reviewer"]) {
    const probe = createRepositoryProbe(successResult);
    const result = await createSourcePromotionDecision(
      {
        organizationId: ORG,
        intakeSourceCandidateId: CANDIDATE,
        outcome: "promoted",
        reviewedSourceType: REVIEWED_TYPE,
        actorContext: humanActor({ organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: role }] }),
        now: NOW,
      },
      { env: bothEnabled, sourcePromotionRepository: probe.sourcePromotionRepository },
    );
    assert.equal(result.ok, true);
    assert.equal(probe.calls.length, 1);
    assert.deepEqual(probe.calls[0].identity, { organizationId: ORG, intakeSourceCandidateId: CANDIDATE });
    assert.equal(probe.calls[0].outcome, "promoted");
    assert.equal(probe.calls[0].reviewedSourceType, REVIEWED_TYPE);
    assert.equal(probe.calls[0].actorUserId, "user-1");
    assert.equal(probe.calls[0].now, NOW);
  }
});

test("P1-08 service: createSourcePromotionDecision itself contains no SQL and does not import a database pool directly", () => {
  const body = serviceSource.match(/export async function createSourcePromotionDecision\([\s\S]*/)?.[0];
  assert.ok(body, "expected to find the createSourcePromotionDecision function body");
  assert.doesNotMatch(body, /\bimport\s+pool\b/);
  assert.doesNotMatch(body, /\bSELECT\b|\bINSERT INTO\b|\bUPDATE\b|\bDELETE FROM\b/i);
});

test("P1-08 repository: decision, source, and source_version inserts all use ON CONFLICT ... DO NOTHING RETURNING, and candidate/review/decision transitions use compare-and-set UPDATEs", () => {
  assert.match(
    repositorySource,
    /INSERT INTO kai\.intake_promotion_decisions[\s\S]*?ON CONFLICT \(organization_id, intake_source_candidate_id\)[\s\S]*?DO NOTHING[\s\S]*?RETURNING/,
  );
  assert.match(
    repositorySource,
    /INSERT INTO kai\.sources[\s\S]*?ON CONFLICT \(organization_id, source_code\)[\s\S]*?DO NOTHING[\s\S]*?RETURNING/,
  );
  assert.match(
    repositorySource,
    /INSERT INTO kai\.source_versions[\s\S]*?ON CONFLICT \(organization_id, intake_source_candidate_id\)[\s\S]*?DO NOTHING[\s\S]*?RETURNING/,
  );
  assert.match(repositorySource, /UPDATE kai\.intake_source_candidates[\s\S]*?candidate_status = \$3/);
  assert.match(repositorySource, /UPDATE kai\.review_queue_items[\s\S]*?queue_status = \$3/);
  assert.match(repositorySource, /UPDATE kai\.intake_promotion_decisions[\s\S]*?decision_status = \$3/);
});

test("P1-08 repository never lets the caller override any server-pinned or server-derived field", () => {
  assert.deepEqual(
    [...__sourcePromotionRepositoryContract.ALLOWED_REVIEWED_SOURCE_TYPES].sort(),
    ["organization_primary_record", "organization_secondary_record", "public_record", "third_party_provided_record"],
  );
  assert.deepEqual(
    [...__sourcePromotionRepositoryContract.ALLOWED_DECISION_OUTCOMES].sort(),
    ["needs_more_information", "promoted", "rejected"],
  );
  assert.equal(__sourcePromotionRepositoryContract.CANDIDATE_STATUS_NEEDS_REVIEW, "needs_gk_review");
  assert.equal(__sourcePromotionRepositoryContract.CANDIDATE_STATUS_PROMOTED, "promoted");
  assert.equal(__sourcePromotionRepositoryContract.CANDIDATE_STATUS_REJECTED, "rejected");
  assert.equal(__sourcePromotionRepositoryContract.REVIEW_QUEUE_STATUS_OPEN, "open");
  assert.equal(__sourcePromotionRepositoryContract.REVIEW_QUEUE_STATUS_WAITING_ON_CLIENT, "waiting_on_client");
  assert.equal(__sourcePromotionRepositoryContract.REVIEW_QUEUE_STATUS_RESOLVED, "resolved");
  assert.equal(__sourcePromotionRepositoryContract.DECISION_STATUS_NEEDS_MORE_INFORMATION, "needs_more_information");
  assert.equal(__sourcePromotionRepositoryContract.DECISION_STATUS_REJECTED, "rejected");
  assert.equal(__sourcePromotionRepositoryContract.DECISION_STATUS_PROMOTED, "promoted");
  assert.equal(__sourcePromotionRepositoryContract.REQUIRED_ACTION_NEEDS_MORE_INFORMATION, REQUIRED_ACTION_NEEDS_MORE_INFORMATION);
});

function predicateSatisfyingProfileRow(overrides = {}) {
  return {
    organization_id: ORG,
    intake_sensitivity_profile_id: SENSITIVITY,
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
    ...overrides,
  };
}

function completeCandidateRow(overrides = {}) {
  return {
    intake_source_candidate_id: CANDIDATE,
    organization_id: ORG,
    intake_file_id: "20000000-0000-4000-8000-000000000001",
    file_profile_id: "50000000-0000-4000-8000-000000000001",
    data_dictionary_id: "60000000-0000-4000-8000-000000000001",
    intake_sensitivity_profile_id: SENSITIVITY,
    profile_canonical_sha256: "a".repeat(64),
    candidate_status: "needs_gk_review",
    ...overrides,
  };
}

function openReviewItemRow(overrides = {}) {
  return {
    review_queue_item_id: "q-existing",
    organization_id: ORG,
    queue_type: "source_candidate_review",
    target_object_type: "intake_source_candidate",
    target_object_id: CANDIDATE,
    queue_status: "open",
    ...overrides,
  };
}

function fakeTxFor({
  decisionRow = null,
  candidateRow,
  reviewItemRow,
  profileRow,
  uploadState = "confirmed",
  sourceRow = null,
  sourceVersionRow = null,
} = {}) {
  return {
    async query(sql) {
      if (sql.includes("FROM kai.intake_promotion_decisions") && sql.includes("FOR UPDATE")) {
        return { rows: decisionRow ? [decisionRow] : [] };
      }
      if (sql.includes("FROM kai.intake_source_candidates") && sql.includes("FOR UPDATE")) {
        return { rows: candidateRow ? [candidateRow] : [] };
      }
      if (sql.includes("FROM kai.review_queue_items") && sql.includes("FOR UPDATE")) {
        return { rows: reviewItemRow ? [reviewItemRow] : [] };
      }
      if (sql.includes("FROM kai.intake_sensitivity_profiles")) {
        return { rows: profileRow ? [profileRow] : [] };
      }
      if (sql.includes("FROM kai.intake_files")) {
        return { rows: uploadState ? [{ upload_state: uploadState }] : [] };
      }
      if (sql.includes("FROM kai.sources") && sql.includes("FOR UPDATE")) {
        return { rows: sourceRow ? [sourceRow] : [] };
      }
      if (sql.includes("FROM kai.source_versions") && sql.includes("FOR UPDATE")) {
        return { rows: sourceVersionRow ? [sourceVersionRow] : [] };
      }
      throw new Error(`unexpected query in fake transaction: ${sql}`);
    },
  };
}

const auditAlwaysOk = { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) };

function auditProbe() {
  let publishCalls = 0;
  return {
    get publishCalls() {
      return publishCalls;
    },
    dependency: { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => { publishCalls += 1; } }) },
  };
}

test("P1-08 repository: not_found when the identity has no committed P1-07 candidate row (tenant isolation on the candidate read)", async () => {
  const repository = createPostgresSourcePromotionRepository({
    runInTransaction: (callback) => callback(fakeTxFor({ candidateRow: null })),
  });
  const result = await repository.createSourcePromotionDecision({
    identity: { organizationId: ORG, intakeSourceCandidateId: CANDIDATE },
    outcome: "promoted",
    reviewedSourceType: REVIEWED_TYPE,
    actorUserId: "user-1",
    now: NOW,
    metadataOnlyAudit: auditAlwaysOk,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
});

test("P1-08 repository (VAL-KAI-P1-08-001): a promoted candidate with no matching decision row is an impossible invariant violation and returns system_error, never a silent validation_blocker", async () => {
  const repository = createPostgresSourcePromotionRepository({
    runInTransaction: (callback) => callback(fakeTxFor({ candidateRow: completeCandidateRow({ candidate_status: "promoted" }), decisionRow: null })),
  });
  const result = await repository.createSourcePromotionDecision({
    identity: { organizationId: ORG, intakeSourceCandidateId: CANDIDATE },
    outcome: "promoted",
    reviewedSourceType: REVIEWED_TYPE,
    actorUserId: "user-1",
    now: NOW,
    metadataOnlyAudit: auditAlwaysOk,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
});

test("P1-08 repository (VAL-KAI-P1-08-003): validation_blocker for an unrecognized reviewed_source_type, including exactly 'unknown'", async () => {
  for (const reviewedSourceType of ["unknown", "fabricated_type_from_a_filename"]) {
    const repository = createPostgresSourcePromotionRepository({
      runInTransaction: (callback) => callback(fakeTxFor({ candidateRow: completeCandidateRow(), reviewItemRow: openReviewItemRow() })),
    });
    const result = await repository.createSourcePromotionDecision({
      identity: { organizationId: ORG, intakeSourceCandidateId: CANDIDATE },
      outcome: "promoted",
      reviewedSourceType,
      actorUserId: "user-1",
      now: NOW,
      metadataOnlyAudit: auditAlwaysOk,
    });
    assert.equal(result.ok, false, reviewedSourceType);
    assert.equal(result.error.code, "validation_blocker");
  }
});

test("P1-08 repository: not_found when the matching source_candidate_review item is missing (incomplete pair)", async () => {
  const repository = createPostgresSourcePromotionRepository({
    runInTransaction: (callback) => callback(fakeTxFor({ candidateRow: completeCandidateRow(), reviewItemRow: null })),
  });
  const result = await repository.createSourcePromotionDecision({
    identity: { organizationId: ORG, intakeSourceCandidateId: CANDIDATE },
    outcome: "promoted",
    reviewedSourceType: REVIEWED_TYPE,
    actorUserId: "user-1",
    now: NOW,
    metadataOnlyAudit: auditAlwaysOk,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
});

test("P1-08 repository (VAL-KAI-P1-08-001): validation_blocker when the review item is not open (a resolved review item is not decision authority), for all three outcomes", async () => {
  for (const outcome of ["needs_more_information", "rejected", "promoted"]) {
    const repository = createPostgresSourcePromotionRepository({
      runInTransaction: (callback) => callback(fakeTxFor({ candidateRow: completeCandidateRow(), reviewItemRow: openReviewItemRow({ queue_status: "resolved" }) })),
    });
    const input = {
      identity: { organizationId: ORG, intakeSourceCandidateId: CANDIDATE },
      outcome,
      actorUserId: "user-1",
      now: NOW,
      metadataOnlyAudit: auditAlwaysOk,
    };
    if (outcome === "promoted") input.reviewedSourceType = REVIEWED_TYPE;
    const repository2 = repository;
    const result = await repository2.createSourcePromotionDecision(input);
    assert.equal(result.ok, false, outcome);
    assert.equal(result.error.code, "validation_blocker", outcome);
  }
});

test("P1-08 repository: conflict_current_state_changed when the candidate's own lineage no longer matches the freshly re-read sensitivity profile", async () => {
  const repository = createPostgresSourcePromotionRepository({
    runInTransaction: (callback) => callback(fakeTxFor({
      candidateRow: completeCandidateRow(),
      reviewItemRow: openReviewItemRow(),
      profileRow: predicateSatisfyingProfileRow({ profile_canonical_sha256: "b".repeat(64) }),
    })),
  });
  const result = await repository.createSourcePromotionDecision({
    identity: { organizationId: ORG, intakeSourceCandidateId: CANDIDATE },
    outcome: "promoted",
    reviewedSourceType: REVIEWED_TYPE,
    actorUserId: "user-1",
    now: NOW,
    metadataOnlyAudit: auditAlwaysOk,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
});

test("P1-08 repository (VAL-KAI-P1-08-002): validation_blocker when the reapplied fail-closed permission predicate does not hold", async () => {
  for (const overrides of [
    { human_review_required: false },
    { public_use_allowed: true },
    { funder_use_allowed: true },
    { llm_processing_allowed: true },
    { product_learning_allowed: true },
    { retention_posture: "purge_scheduled" },
  ]) {
    const repository = createPostgresSourcePromotionRepository({
      runInTransaction: (callback) => callback(fakeTxFor({
        candidateRow: completeCandidateRow(),
        reviewItemRow: openReviewItemRow(),
        profileRow: predicateSatisfyingProfileRow(overrides),
      })),
    });
    const result = await repository.createSourcePromotionDecision({
      identity: { organizationId: ORG, intakeSourceCandidateId: CANDIDATE },
      outcome: "promoted",
      reviewedSourceType: REVIEWED_TYPE,
      actorUserId: "user-1",
      now: NOW,
      metadataOnlyAudit: auditAlwaysOk,
    });
    assert.equal(result.ok, false, JSON.stringify(overrides));
    assert.equal(result.error.code, "validation_blocker");
  }
});

test("P1-08 repository: full 'promoted' creation success path inserts the decision, source, and source_version, transitions the candidate and review item, and publishes exactly one audit", async () => {
  const audit = auditProbe();
  const candidateRow = completeCandidateRow();
  const reviewItemRow = openReviewItemRow();
  const profileRow = predicateSatisfyingProfileRow();
  const tx = {
    async query(sql, params) {
      if (sql.includes("FROM kai.intake_promotion_decisions") && sql.includes("FOR UPDATE")) return { rows: [] };
      if (sql.includes("FROM kai.intake_source_candidates") && sql.includes("FOR UPDATE")) return { rows: [candidateRow] };
      if (sql.includes("FROM kai.review_queue_items") && sql.includes("FOR UPDATE")) return { rows: [reviewItemRow] };
      if (sql.includes("FROM kai.intake_sensitivity_profiles")) return { rows: [profileRow] };
      if (sql.includes("FROM kai.intake_files")) return { rows: [{ upload_state: "confirmed" }] };
      if (sql.includes("FROM kai.sources") && sql.includes("FOR UPDATE")) return { rows: [] };
      if (sql.includes("FROM kai.source_versions") && sql.includes("FOR UPDATE")) return { rows: [] };
      if (sql.includes("INSERT INTO kai.sources")) {
        return { rows: [{ source_id: "s-new", organization_id: params[0], source_code: params[1], reviewed_source_type: params[2], created_at: NOW }] };
      }
      if (sql.includes("INSERT INTO kai.source_versions")) {
        return { rows: [{
          source_version_id: "v-new", organization_id: params[0], source_id: params[1], intake_source_candidate_id: params[2],
          intake_sensitivity_profile_id: params[3], profile_canonical_sha256: params[4], is_current: true, created_at: NOW,
        }] };
      }
      if (sql.includes("UPDATE kai.intake_source_candidates")) {
        return { rows: [{ ...candidateRow, candidate_status: "promoted" }] };
      }
      if (sql.includes("UPDATE kai.review_queue_items")) {
        return { rows: [{ ...reviewItemRow, queue_status: "resolved", review_status: "resolved" }] };
      }
      if (sql.includes("INSERT INTO kai.intake_promotion_decisions")) {
        return { rows: [{
          intake_promotion_decision_id: "d-new", organization_id: ORG, intake_source_candidate_id: CANDIDATE,
          review_queue_item_id: reviewItemRow.review_queue_item_id, reviewed_source_type: REVIEWED_TYPE, decision_status: "promoted",
          source_id: "s-new", source_version_id: "v-new", created_at: NOW, decided_at: NOW, promoted_at: NOW,
        }] };
      }
      if (sql.includes("INSERT INTO kai.upload_lifecycle_audit")) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const repository = createPostgresSourcePromotionRepository({ runInTransaction: (callback) => callback(tx) });
  const result = await repository.createSourcePromotionDecision({
    identity: { organizationId: ORG, intakeSourceCandidateId: CANDIDATE },
    outcome: "promoted",
    reviewedSourceType: REVIEWED_TYPE,
    actorUserId: "user-1",
    now: NOW,
    metadataOnlyAudit: audit.dependency,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.replayed, false);
  assert.equal(result.data.promotionDecision.decision_status, "promoted");
  assert.equal(result.data.sourceCandidate.candidate_status, "promoted");
  assert.equal(result.data.reviewQueueItem.queue_status, "resolved");
  assert.equal(result.data.source.source_id, "s-new");
  assert.equal(result.data.sourceVersion.source_version_id, "v-new");
  assert.equal(audit.publishCalls, 1);
});

test("P1-08 repository: full 'needs_more_information' creation sets queue_status = waiting_on_client with the fixed required_action, leaves candidate_status untouched, creates no source/source_version, and publishes exactly one audit", async () => {
  const audit = auditProbe();
  const candidateRow = completeCandidateRow();
  const reviewItemRow = openReviewItemRow();
  const tx = {
    async query(sql, params) {
      if (sql.includes("FROM kai.intake_promotion_decisions") && sql.includes("FOR UPDATE")) return { rows: [] };
      if (sql.includes("FROM kai.intake_source_candidates") && sql.includes("FOR UPDATE")) return { rows: [candidateRow] };
      if (sql.includes("FROM kai.review_queue_items") && sql.includes("FOR UPDATE")) return { rows: [reviewItemRow] };
      if (sql.includes("FROM kai.intake_files")) return { rows: [{ upload_state: "confirmed" }] };
      if (sql.includes("UPDATE kai.review_queue_items")) {
        assert.match(sql, /queue_status = \$3/);
        assert.equal(params[2], "waiting_on_client");
        assert.equal(params[3], REQUIRED_ACTION_NEEDS_MORE_INFORMATION);
        return { rows: [{ ...reviewItemRow, queue_status: "waiting_on_client", required_action: params[3] }] };
      }
      if (sql.includes("INSERT INTO kai.intake_promotion_decisions")) {
        assert.equal(params[3], null); // reviewed_source_type
        assert.equal(params[4], "needs_more_information"); // decision_status
        return { rows: [{
          intake_promotion_decision_id: "d-new", organization_id: ORG, intake_source_candidate_id: CANDIDATE,
          review_queue_item_id: reviewItemRow.review_queue_item_id, reviewed_source_type: null, decision_status: "needs_more_information",
          source_id: null, source_version_id: null, created_at: NOW, decided_at: NOW, promoted_at: null,
        }] };
      }
      if (sql.includes("INSERT INTO kai.upload_lifecycle_audit")) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const repository = createPostgresSourcePromotionRepository({ runInTransaction: (callback) => callback(tx) });
  const result = await repository.createSourcePromotionDecision({
    identity: { organizationId: ORG, intakeSourceCandidateId: CANDIDATE },
    outcome: "needs_more_information",
    actorUserId: "user-1",
    now: NOW,
    metadataOnlyAudit: audit.dependency,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.promotionDecision.decision_status, "needs_more_information");
  assert.equal(result.data.promotionDecision.reviewed_source_type, null);
  assert.equal(result.data.sourceCandidate.candidate_status, "needs_gk_review");
  assert.equal(result.data.reviewQueueItem.queue_status, "waiting_on_client");
  assert.equal(result.data.source, null);
  assert.equal(result.data.sourceVersion, null);
  assert.equal(audit.publishCalls, 1);
});

test("P1-08 repository: full 'rejected' creation sets candidate_status = rejected, queue_status/review_status = resolved, creates no source/source_version, and publishes exactly one audit", async () => {
  const audit = auditProbe();
  const candidateRow = completeCandidateRow();
  const reviewItemRow = openReviewItemRow();
  const tx = {
    async query(sql, params) {
      if (sql.includes("FROM kai.intake_promotion_decisions") && sql.includes("FOR UPDATE")) return { rows: [] };
      if (sql.includes("FROM kai.intake_source_candidates") && sql.includes("FOR UPDATE")) return { rows: [candidateRow] };
      if (sql.includes("FROM kai.review_queue_items") && sql.includes("FOR UPDATE")) return { rows: [reviewItemRow] };
      if (sql.includes("FROM kai.intake_files")) return { rows: [{ upload_state: "confirmed" }] };
      if (sql.includes("UPDATE kai.intake_source_candidates")) {
        assert.equal(params[2], "rejected");
        return { rows: [{ ...candidateRow, candidate_status: "rejected" }] };
      }
      if (sql.includes("UPDATE kai.review_queue_items")) {
        return { rows: [{ ...reviewItemRow, queue_status: "resolved", review_status: "resolved" }] };
      }
      if (sql.includes("INSERT INTO kai.intake_promotion_decisions")) {
        assert.equal(params[3], null);
        assert.equal(params[4], "rejected");
        return { rows: [{
          intake_promotion_decision_id: "d-new", organization_id: ORG, intake_source_candidate_id: CANDIDATE,
          review_queue_item_id: reviewItemRow.review_queue_item_id, reviewed_source_type: null, decision_status: "rejected",
          source_id: null, source_version_id: null, created_at: NOW, decided_at: NOW, promoted_at: null,
        }] };
      }
      if (sql.includes("INSERT INTO kai.upload_lifecycle_audit")) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const repository = createPostgresSourcePromotionRepository({ runInTransaction: (callback) => callback(tx) });
  const result = await repository.createSourcePromotionDecision({
    identity: { organizationId: ORG, intakeSourceCandidateId: CANDIDATE },
    outcome: "rejected",
    actorUserId: "user-1",
    now: NOW,
    metadataOnlyAudit: audit.dependency,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.promotionDecision.decision_status, "rejected");
  assert.equal(result.data.promotionDecision.reviewed_source_type, null);
  assert.equal(result.data.sourceCandidate.candidate_status, "rejected");
  assert.equal(result.data.reviewQueueItem.queue_status, "resolved");
  assert.equal(result.data.source, null);
  assert.equal(result.data.sourceVersion, null);
  assert.equal(audit.publishCalls, 1);
});

function needsMoreInformationDecisionRow(overrides = {}) {
  return {
    intake_promotion_decision_id: "d-existing", organization_id: ORG, intake_source_candidate_id: CANDIDATE,
    review_queue_item_id: "q-existing", reviewed_source_type: null, decision_status: "needs_more_information",
    source_id: null, source_version_id: null, created_at: NOW, decided_at: NOW, promoted_at: null,
    ...overrides,
  };
}

test("P1-08 repository: needs_more_information -> rejected follow-up transitions the decision/candidate/review item and creates no source/source_version", async () => {
  const audit = auditProbe();
  const decisionRow = needsMoreInformationDecisionRow();
  const candidateRow = completeCandidateRow();
  const waitingReviewItemRow = openReviewItemRow({ queue_status: "waiting_on_client", required_action: REQUIRED_ACTION_NEEDS_MORE_INFORMATION });
  const tx = {
    async query(sql, params) {
      if (sql.includes("FROM kai.intake_promotion_decisions") && sql.includes("FOR UPDATE")) return { rows: [decisionRow] };
      if (sql.includes("FROM kai.intake_source_candidates") && sql.includes("FOR UPDATE")) return { rows: [candidateRow] };
      if (sql.includes("FROM kai.review_queue_items") && sql.includes("FOR UPDATE")) return { rows: [waitingReviewItemRow] };
      if (sql.includes("FROM kai.intake_files")) return { rows: [{ upload_state: "confirmed" }] };
      if (sql.includes("UPDATE kai.intake_source_candidates")) {
        assert.equal(params[2], "rejected");
        return { rows: [{ ...candidateRow, candidate_status: "rejected" }] };
      }
      if (sql.includes("UPDATE kai.review_queue_items")) {
        assert.equal(params[4], "waiting_on_client");
        return { rows: [{ ...waitingReviewItemRow, queue_status: "resolved", review_status: "resolved" }] };
      }
      if (sql.includes("UPDATE kai.intake_promotion_decisions")) {
        assert.equal(params[2], "rejected");
        return { rows: [{ ...decisionRow, decision_status: "rejected" }] };
      }
      if (sql.includes("INSERT INTO kai.upload_lifecycle_audit")) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const repository = createPostgresSourcePromotionRepository({ runInTransaction: (callback) => callback(tx) });
  const result = await repository.createSourcePromotionDecision({
    identity: { organizationId: ORG, intakeSourceCandidateId: CANDIDATE },
    outcome: "rejected",
    actorUserId: "user-1",
    now: NOW,
    metadataOnlyAudit: audit.dependency,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.promotionDecision.decision_status, "rejected");
  assert.equal(result.data.sourceCandidate.candidate_status, "rejected");
  assert.equal(result.data.reviewQueueItem.queue_status, "resolved");
  assert.equal(result.data.source, null);
  assert.equal(result.data.sourceVersion, null);
  assert.equal(audit.publishCalls, 1);
});

test("P1-08 repository: needs_more_information -> promoted follow-up creates the source/source_version and binds the decision row", async () => {
  const audit = auditProbe();
  const decisionRow = needsMoreInformationDecisionRow();
  const candidateRow = completeCandidateRow();
  const waitingReviewItemRow = openReviewItemRow({ queue_status: "waiting_on_client", required_action: REQUIRED_ACTION_NEEDS_MORE_INFORMATION });
  const profileRow = predicateSatisfyingProfileRow();
  const tx = {
    async query(sql, params) {
      if (sql.includes("FROM kai.intake_promotion_decisions") && sql.includes("FOR UPDATE")) return { rows: [decisionRow] };
      if (sql.includes("FROM kai.intake_source_candidates") && sql.includes("FOR UPDATE")) return { rows: [candidateRow] };
      if (sql.includes("FROM kai.review_queue_items") && sql.includes("FOR UPDATE")) return { rows: [waitingReviewItemRow] };
      if (sql.includes("FROM kai.intake_sensitivity_profiles")) return { rows: [profileRow] };
      if (sql.includes("FROM kai.intake_files")) return { rows: [{ upload_state: "confirmed" }] };
      if (sql.includes("FROM kai.sources") && sql.includes("FOR UPDATE")) return { rows: [] };
      if (sql.includes("FROM kai.source_versions") && sql.includes("FOR UPDATE")) return { rows: [] };
      if (sql.includes("INSERT INTO kai.sources")) {
        return { rows: [{ source_id: "s-new", organization_id: params[0], source_code: params[1], reviewed_source_type: params[2], created_at: NOW }] };
      }
      if (sql.includes("INSERT INTO kai.source_versions")) {
        return { rows: [{
          source_version_id: "v-new", organization_id: params[0], source_id: params[1], intake_source_candidate_id: params[2],
          intake_sensitivity_profile_id: params[3], profile_canonical_sha256: params[4], is_current: true, created_at: NOW,
        }] };
      }
      if (sql.includes("UPDATE kai.intake_source_candidates")) {
        assert.equal(params[2], "promoted");
        return { rows: [{ ...candidateRow, candidate_status: "promoted" }] };
      }
      if (sql.includes("UPDATE kai.review_queue_items")) {
        return { rows: [{ ...waitingReviewItemRow, queue_status: "resolved", review_status: "resolved" }] };
      }
      if (sql.includes("UPDATE kai.intake_promotion_decisions")) {
        assert.equal(params[2], "promoted");
        assert.equal(params[3], REVIEWED_TYPE);
        return { rows: [{ ...decisionRow, decision_status: "promoted", reviewed_source_type: REVIEWED_TYPE, source_id: "s-new", source_version_id: "v-new", promoted_at: NOW }] };
      }
      if (sql.includes("INSERT INTO kai.upload_lifecycle_audit")) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const repository = createPostgresSourcePromotionRepository({ runInTransaction: (callback) => callback(tx) });
  const result = await repository.createSourcePromotionDecision({
    identity: { organizationId: ORG, intakeSourceCandidateId: CANDIDATE },
    outcome: "promoted",
    reviewedSourceType: REVIEWED_TYPE,
    actorUserId: "user-1",
    now: NOW,
    metadataOnlyAudit: audit.dependency,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.promotionDecision.decision_status, "promoted");
  assert.equal(result.data.promotionDecision.reviewed_source_type, REVIEWED_TYPE);
  assert.equal(result.data.sourceCandidate.candidate_status, "promoted");
  assert.equal(result.data.reviewQueueItem.queue_status, "resolved");
  assert.equal(result.data.source.source_id, "s-new");
  assert.equal(result.data.sourceVersion.source_version_id, "v-new");
  assert.equal(audit.publishCalls, 1);
});

test("P1-08 repository: identical replay of needs_more_information while still needs_more_information is a zero-write, zero-audit no-op", async () => {
  const audit = auditProbe();
  const decisionRow = needsMoreInformationDecisionRow();
  const candidateRow = completeCandidateRow();
  const waitingReviewItemRow = openReviewItemRow({ queue_status: "waiting_on_client", required_action: REQUIRED_ACTION_NEEDS_MORE_INFORMATION });
  const tx = {
    async query(sql) {
      if (sql.includes("FROM kai.intake_promotion_decisions") && sql.includes("FOR UPDATE")) return { rows: [decisionRow] };
      if (sql.includes("FROM kai.intake_source_candidates") && sql.includes("FOR UPDATE")) return { rows: [candidateRow] };
      if (sql.includes("FROM kai.review_queue_items") && sql.includes("FOR UPDATE")) return { rows: [waitingReviewItemRow] };
      if (sql.includes("INSERT INTO") || sql.includes("UPDATE ")) throw new Error("no write should be attempted on identical replay");
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const repository = createPostgresSourcePromotionRepository({ runInTransaction: (callback) => callback(tx) });
  const result = await repository.createSourcePromotionDecision({
    identity: { organizationId: ORG, intakeSourceCandidateId: CANDIDATE },
    outcome: "needs_more_information",
    actorUserId: "user-1",
    now: NOW,
    metadataOnlyAudit: audit.dependency,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.replayed, true);
  assert.equal(result.data.promotionDecision.decision_status, "needs_more_information");
  assert.equal(audit.publishCalls, 0);
});

test("P1-08 repository: same identity already promoted with the same reviewedSourceType replays with zero mutation and zero audit calls", async () => {
  const audit = auditProbe();
  const decisionRow = {
    intake_promotion_decision_id: "d-existing", organization_id: ORG, intake_source_candidate_id: CANDIDATE,
    review_queue_item_id: "q-existing", reviewed_source_type: REVIEWED_TYPE, decision_status: "promoted",
    source_id: "s-existing", source_version_id: "v-existing", created_at: NOW, decided_at: NOW, promoted_at: NOW,
  };
  const tx = {
    async query(sql) {
      if (sql.includes("FROM kai.intake_promotion_decisions") && sql.includes("FOR UPDATE")) return { rows: [decisionRow] };
      if (sql.includes("FROM kai.intake_source_candidates") && sql.includes("FOR UPDATE")) return { rows: [completeCandidateRow({ candidate_status: "promoted" })] };
      if (sql.includes("FROM kai.review_queue_items") && sql.includes("FOR UPDATE")) return { rows: [openReviewItemRow({ queue_status: "resolved" })] };
      if (sql.includes("FROM kai.sources") && !sql.includes("FOR UPDATE") && sql.includes("source_id = $2")) return { rows: [{ source_id: "s-existing", organization_id: ORG, source_code: "c".repeat(64), reviewed_source_type: REVIEWED_TYPE, created_at: NOW }] };
      if (sql.includes("FROM kai.source_versions") && !sql.includes("FOR UPDATE") && sql.includes("source_version_id = $2")) return { rows: [{ source_version_id: "v-existing", organization_id: ORG, source_id: "s-existing", intake_source_candidate_id: CANDIDATE, intake_sensitivity_profile_id: SENSITIVITY, profile_canonical_sha256: "a".repeat(64), is_current: true, created_at: NOW }] };
      if (sql.includes("INSERT INTO")) throw new Error("no insert should be attempted on full replay");
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const repository = createPostgresSourcePromotionRepository({ runInTransaction: (callback) => callback(tx) });
  const result = await repository.createSourcePromotionDecision({
    identity: { organizationId: ORG, intakeSourceCandidateId: CANDIDATE },
    outcome: "promoted",
    reviewedSourceType: REVIEWED_TYPE,
    actorUserId: "user-1",
    now: NOW,
    metadataOnlyAudit: audit.dependency,
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.replayed, true);
  assert.equal(result.data.promotionDecision.intake_promotion_decision_id, "d-existing");
  assert.equal(audit.publishCalls, 0);
});

test("P1-08 repository: an existing decision bound to a different reviewedSourceType returns conflict_current_state_changed with zero mutation", async () => {
  const decisionRow = {
    intake_promotion_decision_id: "d-existing", organization_id: ORG, intake_source_candidate_id: CANDIDATE,
    review_queue_item_id: "q-existing", reviewed_source_type: "public_record", decision_status: "promoted",
    source_id: "s-existing", source_version_id: "v-existing", created_at: NOW, decided_at: NOW, promoted_at: NOW,
  };
  const repository = createPostgresSourcePromotionRepository({
    runInTransaction: (callback) => callback({
      async query(sql) {
        if (sql.includes("FROM kai.intake_promotion_decisions") && sql.includes("FOR UPDATE")) return { rows: [decisionRow] };
        throw new Error(`unexpected query: ${sql}`);
      },
    }),
  });
  const result = await repository.createSourcePromotionDecision({
    identity: { organizationId: ORG, intakeSourceCandidateId: CANDIDATE },
    outcome: "promoted",
    reviewedSourceType: REVIEWED_TYPE,
    actorUserId: "user-1",
    now: NOW,
    metadataOnlyAudit: auditAlwaysOk,
  });
  assert.equal(result.ok, false);
  assert.equal(result.data, null);
  assert.equal(result.error.code, "conflict_current_state_changed");
});

test("P1-08 repository: prohibited transitions from a terminal decision_status return conflict_current_state_changed with zero mutation", async () => {
  for (const [existingStatus, requestedOutcome] of [
    ["rejected", "promoted"],
    ["promoted", "rejected"],
    ["rejected", "needs_more_information"],
    ["promoted", "needs_more_information"],
  ]) {
    const decisionRow = {
      intake_promotion_decision_id: "d-existing", organization_id: ORG, intake_source_candidate_id: CANDIDATE,
      review_queue_item_id: "q-existing",
      reviewed_source_type: existingStatus === "promoted" ? REVIEWED_TYPE : null,
      decision_status: existingStatus,
      source_id: existingStatus === "promoted" ? "s-existing" : null,
      source_version_id: existingStatus === "promoted" ? "v-existing" : null,
      created_at: NOW, decided_at: NOW,
      promoted_at: existingStatus === "promoted" ? NOW : null,
    };
    const repository = createPostgresSourcePromotionRepository({
      runInTransaction: (callback) => callback({
        async query(sql) {
          if (sql.includes("FROM kai.intake_promotion_decisions") && sql.includes("FOR UPDATE")) return { rows: [decisionRow] };
          throw new Error(`unexpected query: ${sql}`);
        },
      }),
    });
    const input = {
      identity: { organizationId: ORG, intakeSourceCandidateId: CANDIDATE },
      outcome: requestedOutcome,
      actorUserId: "user-1",
      now: NOW,
      metadataOnlyAudit: auditAlwaysOk,
    };
    if (requestedOutcome === "promoted") input.reviewedSourceType = REVIEWED_TYPE;
    const result = await repository.createSourcePromotionDecision(input);
    assert.equal(result.ok, false, `${existingStatus} -> ${requestedOutcome}`);
    assert.equal(result.data, null);
    assert.equal(result.error.code, "conflict_current_state_changed", `${existingStatus} -> ${requestedOutcome}`);
  }
});

test("P1-08 own-boolean-data-property audit predicate rejects a getter-backed ok, a non-plain prepared result, and a missing publish", () => {
  const { prepareRequiredAudit, RequiredAuditRejectedError } = __sourcePromotionRepositoryTestables;
  const context = {
    decisionRecord: { decision_status: "promoted" },
    candidateRecord: { candidate_status: "promoted" },
    reviewQueueRecord: { queue_status: "resolved" },
  };

  const getterBacked = { prepareMetadataOnlyAudit() { return Object.defineProperty({}, "ok", { get() { return true; }, enumerable: true }); } };
  assert.throws(() => prepareRequiredAudit(getterBacked, context), RequiredAuditRejectedError);

  const arrayShaped = { prepareMetadataOnlyAudit() { return Object.assign([], { ok: true, publish() {} }); } };
  assert.throws(() => prepareRequiredAudit(arrayShaped, context), RequiredAuditRejectedError);

  const missingPublish = { prepareMetadataOnlyAudit() { return { ok: true }; } };
  assert.throws(() => prepareRequiredAudit(missingPublish, context), RequiredAuditRejectedError);

  const accepted = { prepareMetadataOnlyAudit() { return { ok: true, publish: async () => {} }; } };
  assert.equal(typeof prepareRequiredAudit(accepted, context).publish, "function");
});

test("P1-08 repository resolves concurrent identical creation/transition via ON CONFLICT ... DO NOTHING RETURNING / compare-and-set UPDATE plus an authoritative re-read, not a raised 23505 catch or an in-process lock", () => {
  assert.doesNotMatch(repositorySource, /\bcatch\s*\(\s*insertError\s*\)/);
  assert.doesNotMatch(repositorySource, /"23505"/);
  assert.match(repositorySource, /if \(!insertedSourceVersionRow\) \{/);
  assert.doesNotMatch(repositorySource, /\b(?:inFlight|pendingLocks?|mutex|semaphore|advisory_lock|pg_advisory|savepoint)\b/i);
});

test("P1-08 audit metadata builder emits exactly the twelve allowlisted keys with no raw content", () => {
  for (const key of [
    "metadata_only: true", "contract: SOURCE_PROMOTION_AUDIT_CONTRACT",
    "intake_source_candidate_id: decisionRecord.intake_source_candidate_id",
    "intake_sensitivity_profile_id: candidateRecord.intake_sensitivity_profile_id",
    "profile_canonical_sha256: candidateRecord.profile_canonical_sha256",
    "reviewed_source_type: decisionRecord.reviewed_source_type",
    "decision_status: decisionRecord.decision_status",
    "candidate_status: candidateRecord.candidate_status",
    "queue_status: reviewQueueRecord.queue_status",
    "source_id: decisionRecord.source_id",
    "source_version_id: decisionRecord.source_version_id",
    "validator_key: SOURCE_PROMOTION_VALIDATOR_KEY",
  ]) {
    assert.ok(repositorySource.includes(key), key);
  }
  assert.doesNotMatch(repositorySource, /raw_content|sample_values/i);
});

test("P1-08 audit contract discloses its validator keys as P1-08 implementation decisions, not owner-quoted keys", () => {
  assert.equal(__sourcePromotionRepositoryContract.SOURCE_PROMOTION_VALIDATOR_KEY, "VAL-KAI-P1-08-001");
  assert.equal(__sourcePromotionRepositoryContract.SOURCE_PROMOTION_PERMISSION_VALIDATOR_KEY, "VAL-KAI-P1-08-002");
  assert.equal(__sourcePromotionRepositoryContract.SOURCE_PROMOTION_TYPE_VALIDATOR_KEY, "VAL-KAI-P1-08-003");
  assert.match(repositorySource, /not\s+\* quoted from, and are not claimed to be mandated by, any owner-authorized/);
});

test("P1-08 introduces no source locator, graph relationship, evidence, claim, assistant-tool, or generation logic", () => {
  for (const source of [repositorySource, serviceSource]) {
    assert.doesNotMatch(source, /\b(?:generateContent|extractEvidence|createClaim|buildGraph|assistantTool)\w*\(/i);
    assert.doesNotMatch(source, /INSERT INTO kai\.(?:evidence|claims|graph_relationships|assistant_tools)\b/i);
  }
});

test("P1-08 computeSourceCode is deterministic and depends only on organizationId, intakeSensitivityProfileId, profileCanonicalSha256, and reviewedSourceType", () => {
  const { computeSourceCode } = __sourcePromotionRepositoryTestables;
  const inputs = { organizationId: ORG, intakeSensitivityProfileId: SENSITIVITY, profileCanonicalSha256: "a".repeat(64), reviewedSourceType: REVIEWED_TYPE };
  const first = computeSourceCode(inputs);
  const second = computeSourceCode({ ...inputs });
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, computeSourceCode({ ...inputs, reviewedSourceType: "public_record" }));
});
