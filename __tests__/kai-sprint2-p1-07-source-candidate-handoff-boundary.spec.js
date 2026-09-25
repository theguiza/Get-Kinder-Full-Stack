import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { submitSensitivityProfileDecision } from "../Backend/kai/services/kaiReviewCockpitService.js";
import { createSourceCandidateStub } from "../Backend/kai/services/kaiSourceCandidateService.js";
import { createProductionMetadataOnlyAuditForSourceCandidate } from "../Backend/kai/services/kaiMetadataOnlyAuditComposition.js";

/**
 * KAI P1-07 handoff boundary: the Review Cockpit's human sensitivity-decision seam
 * reaches the existing P1-07 createSourceCandidateStub only after a committed
 * terminal 'reviewed' decision, as the same authenticated human actor, and never
 * reaches P1-08 promotion. Every collaborator is an injected double; no database.
 */

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const PROFILE = "80000000-0000-4000-8000-000000000001";
const SENSITIVITY_QUEUE_ITEM = "70000000-0000-4000-8000-000000000001";
const DECISION = "60000000-0000-4000-8000-000000000001";
const CANDIDATE = "50000000-0000-4000-8000-000000000001";
const CANDIDATE_QUEUE_ITEM = "70000000-0000-4000-8000-000000000002";
const REVIEWER = "90000000-0000-4000-8000-000000000001";
const UPDATED_AT = "2026-09-25T10:00:00.000Z";
const NOW = "2026-09-25T10:05:00.000Z";
const ENV = { KAI_SPRINT2_ENABLED: "true" };

const reviewerActor = Object.freeze({
  actorType: "human",
  actorUserId: REVIEWER,
  kaiRoles: ["gk_reviewer"],
  organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
});

const REVIEWED_SNAPSHOT = Object.freeze({
  reviewed_personal_data_status: "present",
  reviewed_minor_data_status: "absent",
  reviewed_health_housing_justice_immigration_status: "absent",
  reviewed_indigenous_governance_status: "unknown",
  reviewed_staff_notes_status: "absent",
  reviewed_story_testimonial_status: "absent",
  reviewed_small_cell_risk_status: "unknown",
  reviewed_financial_records_status: "absent",
  reviewed_consent_basis_status: "unknown",
  reviewed_allowed_use_status: "unknown",
  reviewed_llm_processing_allowed: false,
  reviewed_product_learning_allowed: false,
  reviewed_public_use_allowed: false,
  reviewed_funder_use_allowed: false,
});

function decisionRow(outcome) {
  const reviewed = outcome === "reviewed";
  const row = {
    decision_id: DECISION,
    organization_id: ORG,
    intake_sensitivity_profile_id: PROFILE,
    review_queue_item_id: SENSITIVITY_QUEUE_ITEM,
    decision_outcome: outcome,
    decided_by: REVIEWER,
    decided_by_role: "gk_reviewer",
    created_by_type: "human",
    supersedes_decision_id: null,
    created_at: NOW,
  };
  for (const [field, value] of Object.entries(REVIEWED_SNAPSHOT)) row[field] = reviewed ? value : null;
  return row;
}

function sensitivityQueueRow(queueStatus) {
  return {
    review_queue_item_id: SENSITIVITY_QUEUE_ITEM,
    organization_id: ORG,
    queue_type: "sensitivity_review",
    target_object_type: "intake_sensitivity_profile",
    target_object_id: PROFILE,
    queue_status: queueStatus,
    review_status: queueStatus === "resolved" ? "resolved" : "needs_gk_review",
    updated_at: NOW,
  };
}

function recordDecisionDouble(outcome, { replayed = false } = {}) {
  const calls = [];
  return {
    calls,
    async recordSensitivityAllowedUseDecision(input) {
      calls.push(input);
      return {
        ok: true,
        data: {
          decision: decisionRow(outcome),
          reviewQueueItem: sensitivityQueueRow(outcome === "reviewed" ? "resolved" : "open"),
          replayed,
        },
        error: null,
      };
    },
  };
}

function candidateResult({ replayed = false, organizationId = ORG, profileId = PROFILE } = {}) {
  return {
    ok: true,
    data: {
      sourceCandidate: {
        intake_source_candidate_id: CANDIDATE,
        organization_id: organizationId,
        intake_sensitivity_profile_id: profileId,
        candidate_status: "needs_gk_review",
      },
      reviewQueueItem: {
        review_queue_item_id: CANDIDATE_QUEUE_ITEM,
        organization_id: organizationId,
        queue_type: "source_candidate_review",
        target_object_type: "intake_source_candidate",
        target_object_id: CANDIDATE,
        queue_status: "open",
      },
      replayed,
    },
    error: null,
  };
}

function candidateStubDouble(result = candidateResult()) {
  const calls = [];
  return {
    calls,
    async createSourceCandidateStub(input, injected) {
      calls.push({ input, injected });
      return typeof result === "function" ? result() : result;
    },
  };
}

function promotionTripwire() {
  const calls = [];
  return {
    calls,
    async createSourcePromotionDecision(input) {
      calls.push(input);
      return { ok: true, data: {}, error: null };
    },
  };
}

function decisionRequest(decision, overrides = {}) {
  return {
    organizationId: ORG,
    intakeSensitivityProfileId: PROFILE,
    actorContext: reviewerActor,
    payload: {
      expected_updated_at: UPDATED_AT,
      review_queue_item_id: SENSITIVITY_QUEUE_ITEM,
      decision,
      ...(decision === "reviewed" ? { reviewed_snapshot: { ...REVIEWED_SNAPSHOT } } : {}),
    },
    ...overrides,
  };
}

function baseDependencies(decisionDouble, candidateDouble, promotion = promotionTripwire()) {
  return {
    env: ENV,
    now: () => Date.parse(NOW),
    metadataOnlyAudit: { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) },
    sourceCandidateMetadataOnlyAudit: { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) },
    recordSensitivityAllowedUseDecision: decisionDouble.recordSensitivityAllowedUseDecision,
    createSourceCandidateStub: candidateDouble.createSourceCandidateStub,
    createSourcePromotionDecision: promotion.createSourcePromotionDecision,
  };
}

test("A/B: a committed 'reviewed' decision invokes createSourceCandidateStub exactly once, as the same human actor, and reports exactly one candidate and one source_candidate_review item", async () => {
  const decisionDouble = recordDecisionDouble("reviewed");
  const candidateDouble = candidateStubDouble();
  const result = await submitSensitivityProfileDecision(
    decisionRequest("reviewed"),
    baseDependencies(decisionDouble, candidateDouble),
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.current_decision.decision_outcome, "reviewed");
  assert.equal(decisionDouble.calls.length, 1);
  assert.equal(candidateDouble.calls.length, 1);

  const { input, injected } = candidateDouble.calls[0];
  // Exactly the P1-07 service's own input allowlist - no lineage, status, queue,
  // or role field is ever supplied by this seam.
  assert.deepEqual(Object.keys(input).sort(), ["actorContext", "intakeSensitivityProfileId", "now", "organizationId"]);
  assert.equal(input.organizationId, ORG);
  assert.equal(input.intakeSensitivityProfileId, PROFILE);
  assert.equal(input.actorContext, reviewerActor, "the same authenticated human actor object is forwarded");
  assert.equal(input.now, NOW);
  assert.equal(injected.env, ENV);
  assert.equal(typeof injected.metadataOnlyAudit.prepareMetadataOnlyAudit, "function");

  assert.deepEqual(result.data.source_candidate_handoff, {
    status: "created",
    intake_source_candidate_id: CANDIDATE,
    candidate_status: "needs_gk_review",
    review_queue_item_id: CANDIDATE_QUEUE_ITEM,
    queue_status: "open",
    error_code: null,
  });
});

test("C: a replayed 'reviewed' decision re-attempts the idempotent handoff and reports the replayed candidate", async () => {
  const decisionDouble = recordDecisionDouble("reviewed", { replayed: true });
  const candidateDouble = candidateStubDouble(candidateResult({ replayed: true }));
  const result = await submitSensitivityProfileDecision(
    decisionRequest("reviewed"),
    baseDependencies(decisionDouble, candidateDouble),
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.replayed, true);
  assert.equal(candidateDouble.calls.length, 1);
  assert.equal(result.data.source_candidate_handoff.status, "replayed");
  assert.equal(result.data.source_candidate_handoff.intake_source_candidate_id, CANDIDATE);
});

test("'needs_more_information' never reaches P1-07", async () => {
  const decisionDouble = recordDecisionDouble("needs_more_information");
  const candidateDouble = candidateStubDouble();
  const result = await submitSensitivityProfileDecision(
    decisionRequest("needs_more_information"),
    baseDependencies(decisionDouble, candidateDouble),
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(candidateDouble.calls.length, 0);
  assert.equal(result.data.source_candidate_handoff.status, "not_applicable");
  assert.equal(result.data.source_candidate_handoff.intake_source_candidate_id, null);
});

test("a failed or conflicting decision never reaches P1-07", async () => {
  const candidateDouble = candidateStubDouble();
  for (const code of ["conflict_current_state_changed", "validation_blocker", "authorization_denied"]) {
    const result = await submitSensitivityProfileDecision(
      decisionRequest("reviewed"),
      {
        ...baseDependencies(recordDecisionDouble("reviewed"), candidateDouble),
        async recordSensitivityAllowedUseDecision() {
          return { ok: false, data: null, error: { code } };
        },
      },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, code);
  }
  assert.equal(candidateDouble.calls.length, 0);
});

test("D: a non-human actor is refused by the cockpit before any decision or P1-07 call", async () => {
  for (const actorType of ["system", "ai", "assistant", "import", "code"]) {
    const decisionDouble = recordDecisionDouble("reviewed");
    const candidateDouble = candidateStubDouble();
    const result = await submitSensitivityProfileDecision(
      decisionRequest("reviewed", { actorContext: { ...reviewerActor, actorType } }),
      baseDependencies(decisionDouble, candidateDouble),
    );
    assert.equal(result.ok, false, actorType);
    assert.equal(result.error.code, "authorization_denied", actorType);
    assert.equal(decisionDouble.calls.length, 0, actorType);
    assert.equal(candidateDouble.calls.length, 0, actorType);
  }
});

test("D: the unchanged P1-07 service still refuses system/AI actors and non-members before any repository call", async () => {
  const repositoryCalls = [];
  const sourceCandidateRepository = {
    async createSourceCandidateStub(input) {
      repositoryCalls.push(input);
      return candidateResult();
    },
  };
  const metadataOnlyAudit = { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) };

  for (const actorContext of [
    { actorType: "system", actorUserId: null },
    { ...reviewerActor, actorType: "system" },
    { ...reviewerActor, actorType: "ai" },
    {
      ...reviewerActor,
      organizationMemberships: [{ organization_id: OTHER_ORG, membership_status: "active", role_name: "gk_reviewer" }],
    },
    {
      ...reviewerActor,
      kaiRoles: ["client_admin"],
      organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_admin" }],
    },
  ]) {
    const result = await createSourceCandidateStub(
      { organizationId: ORG, intakeSensitivityProfileId: PROFILE, actorContext, now: NOW },
      { env: ENV, sourceCandidateRepository, metadataOnlyAudit },
    );
    assert.equal(result.ok, false, JSON.stringify(actorContext));
  }
  assert.equal(repositoryCalls.length, 0);

  const disabled = await createSourceCandidateStub(
    { organizationId: ORG, intakeSensitivityProfileId: PROFILE, actorContext: reviewerActor, now: NOW },
    { env: { KAI_SPRINT2_ENABLED: "false" }, sourceCandidateRepository, metadataOnlyAudit },
  );
  assert.equal(disabled.ok, false);
  assert.equal(disabled.error.code, "feature_disabled");
  assert.equal(repositoryCalls.length, 0);
});

test("E: a P1-07 refusal (e.g. VAL-KAI-P1-07-001 predicate failure) leaves the committed decision intact and reports not_created with no candidate", async () => {
  for (const code of ["validation_blocker", "not_found", "conflict_current_state_changed", "authorization_denied"]) {
    const candidateDouble = candidateStubDouble({ ok: false, data: null, error: { code, status: 422 } });
    const result = await submitSensitivityProfileDecision(
      decisionRequest("reviewed"),
      baseDependencies(recordDecisionDouble("reviewed"), candidateDouble),
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.current_decision.decision_outcome, "reviewed");
    assert.deepEqual(result.data.source_candidate_handoff, {
      status: "not_created",
      intake_source_candidate_id: null,
      candidate_status: null,
      review_queue_item_id: null,
      queue_status: null,
      error_code: code,
    });
  }
});

test("a thrown, malformed, or cross-tenant P1-07 result is reported as not_created/system_error and never echoed", async () => {
  const cases = [
    () => { throw new Error("connection refused 10.0.0.1"); },
    () => ({ ok: true, data: null, error: null }),
    () => candidateResult({ organizationId: OTHER_ORG }),
    () => candidateResult({ profileId: "80000000-0000-4000-8000-000000000099" }),
    () => {
      const result = candidateResult();
      result.data.reviewQueueItem.queue_type = "sensitivity_review";
      return result;
    },
    () => ({ ok: false, error: { code: "Not A Token; DROP" } }),
  ];
  for (const produce of cases) {
    const result = await submitSensitivityProfileDecision(
      decisionRequest("reviewed"),
      baseDependencies(recordDecisionDouble("reviewed"), candidateStubDouble(produce)),
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.source_candidate_handoff.status, "not_created");
    assert.equal(result.data.source_candidate_handoff.error_code, "system_error");
    assert.equal(result.data.source_candidate_handoff.intake_source_candidate_id, null);
  }
});

test("F: the sensitivity decision and its P1-07 handoff never invoke P1-08 promotion", async () => {
  const promotion = promotionTripwire();
  const result = await submitSensitivityProfileDecision(
    decisionRequest("reviewed"),
    baseDependencies(recordDecisionDouble("reviewed"), candidateStubDouble(), promotion),
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(promotion.calls.length, 0);

  const source = readFileSync(new URL("../Backend/kai/services/kaiReviewCockpitService.js", import.meta.url), "utf8");
  const decisionBody = source.match(/export async function submitSensitivityProfileDecision\([\s\S]*?\n}\n/)?.[0];
  const handoffBody = source.match(/async function ensureSourceCandidateAfterReviewedDecision\([\s\S]*?\n}\n/)?.[0];
  assert.ok(decisionBody);
  assert.ok(handoffBody);
  for (const body of [decisionBody, handoffBody]) {
    assert.doesNotMatch(body, /deps\.createSourcePromotionDecision|createSourcePromotionDecision\(|await decide\(|submitSourceCandidateDecision\(/);
  }
  // P1-07 is resolved exactly once in the module, inside the handoff only, and the
  // handoff is invoked only from the sensitivity-decision seam.
  assert.equal((source.match(/deps\.createSourceCandidateStub \|\| createSourceCandidateStub/g) || []).length, 1);
  assert.match(handoffBody, /deps\.createSourceCandidateStub \|\| createSourceCandidateStub/);
  assert.equal((source.match(/await ensureSourceCandidateAfterReviewedDecision\(/g) || []).length, 1);
  assert.match(decisionBody, /await ensureSourceCandidateAfterReviewedDecision\(/);
});

test("G: the P1 worker still stops at P1-05 and cannot reach P1-06 or P1-07", () => {
  const workerSource = readFileSync(new URL("../Backend/kai/parsing/p1WorkerRuntime.js", import.meta.url), "utf8");
  const cronSource = readFileSync(new URL("../Backend/kai/parsing/p1WorkerCron.js", import.meta.url), "utf8");
  for (const source of [workerSource, cronSource]) {
    assert.doesNotMatch(
      source,
      /kaiSourceCandidateService|createSourceCandidateStub|kaiReviewCockpitService|submitSensitivityProfileDecision|kaiReviewQueueService"|ensureSensitivityReviewQueueItem\(|kaiSourcePromotionService|createSourcePromotionDecision/,
    );
  }
  assert.match(workerSource, /KAI_P1_WORKER_SYNTHETIC_ACTOR_CONTEXT = Object\.freeze\(\{\n\s+actorType: "system",/);
});

test("production P1-07 audit adapter publishes only the bound identity and refuses any other payload shape", async () => {
  const published = [];
  const adapter = createProductionMetadataOnlyAuditForSourceCandidate({
    organizationId: ORG,
    intakeSensitivityProfileId: PROFILE,
    actorContext: reviewerActor,
    now: NOW,
    insertAuditEvent: async (metadata, db) => {
      published.push({ metadata, db });
      return { ok: true };
    },
  });

  const validPayload = {
    attempted_operation: "intake_source_candidate_persisted",
    object_type: "intake_source_candidate",
    validator_key: "VAL-KAI-P1-07-001",
    candidate_status: "needs_gk_review",
    queue_status: "open",
  };
  for (const payload of [
    null,
    { ...validPayload, object_type: "review_queue_item" },
    { ...validPayload, attempted_operation: "source_promotion_decided" },
    { ...validPayload, candidate_status: "" },
    { ...validPayload, queue_status: undefined },
  ]) {
    assert.equal(adapter.prepareMetadataOnlyAudit({ payload }).ok, false);
  }

  const prepared = adapter.prepareMetadataOnlyAudit({ payload: validPayload });
  assert.equal(prepared.ok, true);
  await prepared.publish();
  assert.equal(published.length, 1);
  const { metadata } = published[0];
  assert.equal(metadata.organization_id, ORG);
  assert.equal(metadata.object_id, PROFILE);
  assert.equal(metadata.operation, "intake_source_candidate_persisted");
  assert.equal(metadata.actor_type, "human");
  assert.equal(metadata.actor_user_id, REVIEWER);
  assert.equal(metadata.metadata_only, true);
  assert.equal(metadata.contains_raw_file_content, false);
  assert.equal(metadata.contains_client_pii, false);

  const rejecting = createProductionMetadataOnlyAuditForSourceCandidate({
    organizationId: ORG,
    intakeSensitivityProfileId: PROFILE,
    actorContext: reviewerActor,
    now: NOW,
    insertAuditEvent: async () => ({ ok: false }),
  });
  await assert.rejects(() => rejecting.prepareMetadataOnlyAudit({ payload: validPayload }).publish());
  assert.throws(() => createProductionMetadataOnlyAuditForSourceCandidate({ intakeSensitivityProfileId: PROFILE }));
  assert.throws(() => createProductionMetadataOnlyAuditForSourceCandidate({ organizationId: ORG }));
});
