import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { recordEvidenceReviewDecision, recordClaimReviewDecision, __humanReviewServiceContract } from "../Backend/kai/services/kaiHumanReviewService.js";
import {
  validateCompleteEvidenceReviewRequest,
  validateCompleteClaimReviewRequest,
} from "../Backend/kai/validators/kaiSprint2RequestSchemas.js";
import { __testables as intakeRouteTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";
import {
  createPostgresHumanReviewRepository,
  __humanReviewRepositoryTestables,
} from "../Backend/kai/dictionary/postgresHumanReviewRepository.js";

const {
  evidenceReviewCompletionIdentifiers,
  claimReviewCompletionIdentifiers,
  validateEvidenceReviewCompletionRequestOrSend,
  validateClaimReviewCompletionRequestOrSend,
} = intakeRouteTestables;

const ORG = "00000000-0000-4000-8000-000000000001";
const EVIDENCE = "00000000-0000-4000-8000-000000000002";
const CLAIM = "00000000-0000-4000-8000-000000000003";
const QUEUE = "00000000-0000-4000-8000-000000000004";
const NOW = "2026-08-06T10:00:00.000Z";

const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });
const reviewerActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
});

function stubMetadataOnlyAudit() {
  return { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } };
}

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("P2-12 allowed roles are gk_reviewer and gk_admin only - never gk_operator, client, or a generic system actor", () => {
  assert.deepEqual([...__humanReviewServiceContract.RECORD_EVIDENCE_REVIEW_DECISION_ALLOWED_ROLES].sort(), ["gk_admin", "gk_reviewer"]);
  assert.deepEqual([...__humanReviewServiceContract.RECORD_CLAIM_REVIEW_DECISION_ALLOWED_ROLES].sort(), ["gk_admin", "gk_reviewer"]);
});

test("P2-12 recordEvidenceReviewDecision rejects a non-human actor before any repository call", async () => {
  const result = await recordEvidenceReviewDecision(
    {
      organizationId: ORG,
      evidenceItemId: EVIDENCE,
      reviewQueueItemId: QUEUE,
      expectedUpdatedAt: NOW,
      decision: "supported",
      actorContext: { actorType: "ai", actorUserId: "x" },
      now: NOW,
    },
    { env: enabledEnv, humanReviewRepository: { async recordEvidenceReviewDecision() { throw new Error("must not be called"); } }, metadataOnlyAudit: stubMetadataOnlyAudit() },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("P2-12 recordEvidenceReviewDecision reports missing actor context as unauthorized instead of opaque validation_blocker", async () => {
  const result = await recordEvidenceReviewDecision(
    {
      organizationId: ORG,
      evidenceItemId: EVIDENCE,
      reviewQueueItemId: QUEUE,
      expectedUpdatedAt: NOW,
      decision: "supported",
      actorContext: undefined,
      now: NOW,
    },
    { env: enabledEnv, humanReviewRepository: { async recordEvidenceReviewDecision() { throw new Error("must not be called"); } }, metadataOnlyAudit: stubMetadataOnlyAudit() },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "unauthorized");
  assert.equal(result.error.status, 401);
  assert.equal(result.blockers?.[0]?.blocking_reason, "missing_actor_context");
});

test("P2-12 recordEvidenceReviewDecision rejects a wrong role (gk_operator) before any repository call", async () => {
  const result = await recordEvidenceReviewDecision(
    {
      organizationId: ORG,
      evidenceItemId: EVIDENCE,
      reviewQueueItemId: QUEUE,
      expectedUpdatedAt: NOW,
      decision: "supported",
      actorContext: {
        actorType: "human",
        actorUserId: "op",
        organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_operator" }],
      },
      now: NOW,
    },
    { env: enabledEnv, humanReviewRepository: { async recordEvidenceReviewDecision() { throw new Error("must not be called"); } }, metadataOnlyAudit: stubMetadataOnlyAudit() },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("P2-12 recordClaimReviewDecision reports missing actor context as unauthorized instead of opaque validation_blocker", async () => {
  const result = await recordClaimReviewDecision(
    {
      organizationId: ORG,
      claimId: CLAIM,
      reviewQueueItemId: QUEUE,
      expectedUpdatedAt: NOW,
      decision: "approved",
      approvedAudiences: ["internal"],
      actorContext: null,
      now: NOW,
    },
    { env: enabledEnv, humanReviewRepository: { async recordClaimReviewDecision() { throw new Error("must not be called"); } }, metadataOnlyAudit: stubMetadataOnlyAudit() },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "unauthorized");
  assert.equal(result.error.status, 401);
  assert.equal(result.blockers?.[0]?.blocking_reason, "missing_actor_context");
});

test("P2-12 recordClaimReviewDecision rejects a non-human actor before any repository call", async () => {
  const result = await recordClaimReviewDecision(
    {
      organizationId: ORG,
      claimId: CLAIM,
      reviewQueueItemId: QUEUE,
      expectedUpdatedAt: NOW,
      decision: "approved",
      approvedAudiences: ["internal"],
      actorContext: { actorType: "ai", actorUserId: "x" },
      now: NOW,
    },
    { env: enabledEnv, humanReviewRepository: { async recordClaimReviewDecision() { throw new Error("must not be called"); } }, metadataOnlyAudit: stubMetadataOnlyAudit() },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("P2-12 recordClaimReviewDecision rejects a wrong role (gk_operator) before any repository call", async () => {
  const result = await recordClaimReviewDecision(
    {
      organizationId: ORG,
      claimId: CLAIM,
      reviewQueueItemId: QUEUE,
      expectedUpdatedAt: NOW,
      decision: "approved",
      approvedAudiences: ["internal"],
      actorContext: {
        actorType: "human",
        actorUserId: "op",
        organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_operator" }],
      },
      now: NOW,
    },
    { env: enabledEnv, humanReviewRepository: { async recordClaimReviewDecision() { throw new Error("must not be called"); } }, metadataOnlyAudit: stubMetadataOnlyAudit() },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("P2-12 recordEvidenceReviewDecision allows a global gk_reviewer whose active org-scoped membership role is gk_operator (production regression: VAL-AUT-004 must not fire when the global capability role is present)", async () => {
  const calls = [];
  const result = await recordEvidenceReviewDecision(
    {
      organizationId: ORG,
      evidenceItemId: EVIDENCE,
      reviewQueueItemId: QUEUE,
      expectedUpdatedAt: NOW,
      decision: "supported",
      actorContext: {
        actorType: "human",
        actorUserId: "90000000-0000-4000-8000-000000000099",
        kaiRoles: ["gk_admin", "gk_operator", "gk_reviewer"],
        organizationMemberships: [
          { organization_id: ORG, membership_status: "active", role_name: "gk_operator" },
          { organization_id: ORG, membership_status: "active", role_name: "client_admin" },
        ],
      },
      now: NOW,
    },
    {
      env: enabledEnv,
      humanReviewRepository: {
        async recordEvidenceReviewDecision(input) {
          calls.push(input);
          return { ok: true, data: { evidence_item_id: EVIDENCE, review_queue_item_id: QUEUE, queue_status: "resolved", review_status: "resolved", evidence_review_status: "reviewed", support_strength: "reviewed_supported", decision_id: "d1", decision_outcome: "supported", replayed: false }, error: null };
        },
      },
      metadataOnlyAudit: stubMetadataOnlyAudit(),
    },
  );
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.ok(["gk_reviewer", "gk_admin"].includes(calls[0].actorRole));
});

test("P2-12 recordClaimReviewDecision allows the same global gk_reviewer/gk_operator-membership actor shape", async () => {
  const calls = [];
  const result = await recordClaimReviewDecision(
    {
      organizationId: ORG,
      claimId: CLAIM,
      reviewQueueItemId: QUEUE,
      expectedUpdatedAt: NOW,
      decision: "approved",
      approvedAudiences: ["internal"],
      actorContext: {
        actorType: "human",
        actorUserId: "90000000-0000-4000-8000-000000000099",
        kaiRoles: ["gk_admin", "gk_operator", "gk_reviewer"],
        organizationMemberships: [
          { organization_id: ORG, membership_status: "active", role_name: "gk_operator" },
          { organization_id: ORG, membership_status: "active", role_name: "client_admin" },
        ],
      },
      now: NOW,
    },
    {
      env: enabledEnv,
      humanReviewRepository: {
        async recordClaimReviewDecision(input) {
          calls.push(input);
          return { ok: true, data: { claim_id: CLAIM, review_queue_item_id: QUEUE, queue_status: "resolved", review_status: "resolved", claim_review_status: "reviewed", claim_strength: "reviewed_supported", decision_id: "d2", decision_outcome: "approved", approved_audiences: ["internal"], replayed: false }, error: null };
        },
      },
      metadataOnlyAudit: stubMetadataOnlyAudit(),
    },
  );
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
});

test("P2-12 recordEvidenceReviewDecision still denies a global gk_reviewer/gk_admin actor with no active membership in the target organization (combineGlobalRoles never bypasses tenant isolation)", async () => {
  const OTHER_ORG = "00000000-0000-4000-8000-000000000005";
  const result = await recordEvidenceReviewDecision(
    {
      organizationId: ORG,
      evidenceItemId: EVIDENCE,
      reviewQueueItemId: QUEUE,
      expectedUpdatedAt: NOW,
      decision: "supported",
      actorContext: {
        actorType: "human",
        actorUserId: "cross-tenant",
        kaiRoles: ["gk_admin", "gk_reviewer"],
        organizationMemberships: [{ organization_id: OTHER_ORG, membership_status: "active", role_name: "gk_reviewer" }],
      },
      now: NOW,
    },
    { env: enabledEnv, humanReviewRepository: { async recordEvidenceReviewDecision() { throw new Error("must not be called"); } }, metadataOnlyAudit: stubMetadataOnlyAudit() },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("P2-12 KAI_SPRINT2_ENABLED=false yields feature_disabled with zero repository calls for both transitions", async () => {
  const evidenceResult = await recordEvidenceReviewDecision(
    { organizationId: ORG, evidenceItemId: EVIDENCE, reviewQueueItemId: QUEUE, expectedUpdatedAt: NOW, decision: "supported", actorContext: reviewerActor, now: NOW },
    { env: { KAI_SPRINT2_ENABLED: "false" }, humanReviewRepository: { async recordEvidenceReviewDecision() { throw new Error("must not be called"); } } },
  );
  assert.equal(evidenceResult.ok, false);
  assert.equal(evidenceResult.error.code, "feature_disabled");

  const claimResult = await recordClaimReviewDecision(
    { organizationId: ORG, claimId: CLAIM, reviewQueueItemId: QUEUE, expectedUpdatedAt: NOW, decision: "approved", approvedAudiences: ["internal"], actorContext: reviewerActor, now: NOW },
    { env: { KAI_SPRINT2_ENABLED: "false" }, humanReviewRepository: { async recordClaimReviewDecision() { throw new Error("must not be called"); } } },
  );
  assert.equal(claimResult.ok, false);
  assert.equal(claimResult.error.code, "feature_disabled");
});

test("P2-12 recordEvidenceReviewDecision rejects an outcome outside the evidence-review vocabulary", async () => {
  const result = await recordEvidenceReviewDecision(
    { organizationId: ORG, evidenceItemId: EVIDENCE, reviewQueueItemId: QUEUE, expectedUpdatedAt: NOW, decision: "approved", actorContext: reviewerActor, now: NOW },
    { env: enabledEnv, humanReviewRepository: { async recordEvidenceReviewDecision() { throw new Error("must not be called"); } }, metadataOnlyAudit: stubMetadataOnlyAudit() },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
});

test("P2-12 recordEvidenceReviewDecision requires non-empty limitation_notes iff decision is supported_with_limitation", async () => {
  const missing = await recordEvidenceReviewDecision(
    { organizationId: ORG, evidenceItemId: EVIDENCE, reviewQueueItemId: QUEUE, expectedUpdatedAt: NOW, decision: "supported_with_limitation", actorContext: reviewerActor, now: NOW },
    { env: enabledEnv, humanReviewRepository: { async recordEvidenceReviewDecision() { throw new Error("must not be called"); } }, metadataOnlyAudit: stubMetadataOnlyAudit() },
  );
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "validation_blocker");

  const unexpected = await recordEvidenceReviewDecision(
    { organizationId: ORG, evidenceItemId: EVIDENCE, reviewQueueItemId: QUEUE, expectedUpdatedAt: NOW, decision: "supported", limitationNotes: ["should not be here"], actorContext: reviewerActor, now: NOW },
    { env: enabledEnv, humanReviewRepository: { async recordEvidenceReviewDecision() { throw new Error("must not be called"); } }, metadataOnlyAudit: stubMetadataOnlyAudit() },
  );
  assert.equal(unexpected.ok, false);
  assert.equal(unexpected.error.code, "validation_blocker");
});

test("P2-12 recordClaimReviewDecision governance ceiling: requesting funder/public in approvedAudiences is delegated to the repository, which fails closed atomically, and the service normalizes the internal governance_ceiling_exceeded reason to the public validation_blocker/422 contract", async () => {
  const result = await recordClaimReviewDecision(
    { organizationId: ORG, claimId: CLAIM, reviewQueueItemId: QUEUE, expectedUpdatedAt: NOW, decision: "approved", approvedAudiences: ["internal", "funder"], actorContext: reviewerActor, now: NOW },
    {
      env: enabledEnv,
      humanReviewRepository: {
        async recordClaimReviewDecision(input) {
          assert.deepEqual(input.approvedAudiences, ["internal", "funder"]);
          return { ok: false, data: null, error: { code: "governance_ceiling_exceeded", status: 422 } };
        },
      },
      metadataOnlyAudit: stubMetadataOnlyAudit(),
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(result.error.status, 422);
  assert.notEqual(result.error.code, "governance_ceiling_exceeded");
  assert.notEqual(result.error.code, "system_error");
  assert.notEqual(result.error.status, 500);
});

test("P2-12 recordClaimReviewDecision governance-ceiling normalization crosses the public HTTP boundary as validation_blocker/422, never system_error/500", async () => {
  const serviceResult = { ok: false, data: null, error: { code: "governance_ceiling_exceeded", status: 422 } };
  const publicResult = await recordClaimReviewDecision(
    { organizationId: ORG, claimId: CLAIM, reviewQueueItemId: QUEUE, expectedUpdatedAt: NOW, decision: "approved", approvedAudiences: ["internal", "public"], actorContext: reviewerActor, now: NOW },
    {
      env: enabledEnv,
      humanReviewRepository: {
        async recordClaimReviewDecision() {
          return serviceResult;
        },
      },
      metadataOnlyAudit: stubMetadataOnlyAudit(),
    },
  );

  const res = fakeRes();
  intakeRouteTestables.sendServiceResult(res, publicResult);
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error.code, "validation_blocker");
  assert.equal(res.body.error.status, 422);
  assert.notEqual(res.statusCode, 500);
  assert.notEqual(res.body.error.code, "system_error");
});

test("P2-12 sendServiceResult unknown-error fail-safe is unchanged: a genuinely unknown internal code still maps to system_error/500", async () => {
  const res = fakeRes();
  intakeRouteTestables.sendServiceResult(res, { ok: false, data: null, error: { code: "some_unrecognized_internal_code", status: 422 } });
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error.code, "system_error");
});

test("P2-12 adjacent structured service errors (not_found, conflict_current_state_changed) are unaffected by the governance-ceiling normalization", async () => {
  const notFound = await recordClaimReviewDecision(
    { organizationId: ORG, claimId: CLAIM, reviewQueueItemId: QUEUE, expectedUpdatedAt: NOW, decision: "approved", approvedAudiences: ["internal"], actorContext: reviewerActor, now: NOW },
    {
      env: enabledEnv,
      humanReviewRepository: {
        async recordClaimReviewDecision() {
          return { ok: false, data: null, error: { code: "not_found", status: 404 } };
        },
      },
      metadataOnlyAudit: stubMetadataOnlyAudit(),
    },
  );
  assert.equal(notFound.error.code, "not_found");
  assert.equal(notFound.error.status, 404);

  const conflict = await recordClaimReviewDecision(
    { organizationId: ORG, claimId: CLAIM, reviewQueueItemId: QUEUE, expectedUpdatedAt: NOW, decision: "approved", approvedAudiences: ["internal"], actorContext: reviewerActor, now: NOW },
    {
      env: enabledEnv,
      humanReviewRepository: {
        async recordClaimReviewDecision() {
          return { ok: false, data: null, error: { code: "conflict_current_state_changed", status: 409 } };
        },
      },
      metadataOnlyAudit: stubMetadataOnlyAudit(),
    },
  );
  assert.equal(conflict.error.code, "conflict_current_state_changed");
  assert.equal(conflict.error.status, 409);
});

test("P2-12 recordEvidenceReviewDecision delegates to the injected repository exactly once with the derived actor/tenant identity and decision", async () => {
  const calls = [];
  const result = await recordEvidenceReviewDecision(
    { organizationId: ORG, evidenceItemId: EVIDENCE, reviewQueueItemId: QUEUE, expectedUpdatedAt: NOW, decision: "supported", actorContext: reviewerActor, now: NOW },
    {
      env: enabledEnv,
      humanReviewRepository: {
        async recordEvidenceReviewDecision(input) {
          calls.push(input);
          return { ok: true, data: { evidence_item_id: EVIDENCE, review_queue_item_id: QUEUE, queue_status: "resolved", review_status: "resolved", evidence_review_status: "reviewed", support_strength: "reviewed_supported", decision_id: "d1", decision_outcome: "supported", replayed: false }, error: null };
        },
      },
      metadataOnlyAudit: stubMetadataOnlyAudit(),
    },
  );
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].actorUserId, reviewerActor.actorUserId);
  assert.equal(calls[0].organizationId, ORG);
  assert.equal(calls[0].decisionOutcome, "supported");
});

test("P2-12 request-body validators require decision and reject unknown fields", () => {
  const ok = validateCompleteEvidenceReviewRequest({ expected_updated_at: NOW, decision: "supported" });
  assert.equal(ok.ok, true);
  const missingDecision = validateCompleteEvidenceReviewRequest({ expected_updated_at: NOW });
  assert.equal(missingDecision.ok, false);
  const unknown = validateCompleteEvidenceReviewRequest({ expected_updated_at: NOW, decision: "supported", extra_field: true });
  assert.equal(unknown.ok, false);
  const missing = validateCompleteClaimReviewRequest({});
  assert.equal(missing.ok, false);
  const badTimestamp = validateCompleteClaimReviewRequest({ expected_updated_at: "not-a-timestamp", decision: "approved", approved_audiences: ["internal"] });
  assert.equal(badTimestamp.ok, false);
});

test("P2-12 evidence-review validator requires limitation_notes iff supported_with_limitation", () => {
  const okWithNotes = validateCompleteEvidenceReviewRequest({
    expected_updated_at: NOW, decision: "supported_with_limitation", limitation_notes: ["one caveat"],
  });
  assert.equal(okWithNotes.ok, true);
  const missingNotes = validateCompleteEvidenceReviewRequest({ expected_updated_at: NOW, decision: "supported_with_limitation" });
  assert.equal(missingNotes.ok, false);
  const unexpectedNotes = validateCompleteEvidenceReviewRequest({ expected_updated_at: NOW, decision: "supported", limitation_notes: ["nope"] });
  assert.equal(unexpectedNotes.ok, false);
  const emptyNotes = validateCompleteEvidenceReviewRequest({ expected_updated_at: NOW, decision: "supported_with_limitation", limitation_notes: [] });
  assert.equal(emptyNotes.ok, false);
  const blankNote = validateCompleteEvidenceReviewRequest({ expected_updated_at: NOW, decision: "supported_with_limitation", limitation_notes: ["   "] });
  assert.equal(blankNote.ok, false);
});

test("P2-12 claim-review validator requires approved_audiences iff approved/approved_with_limitation, forbidden otherwise, and rejects funder/public presence at the schema layer as a valid-shape-but-governance-checked value", () => {
  const okInternal = validateCompleteClaimReviewRequest({ expected_updated_at: NOW, decision: "approved", approved_audiences: ["internal"] });
  assert.equal(okInternal.ok, true);
  const missingAudiences = validateCompleteClaimReviewRequest({ expected_updated_at: NOW, decision: "approved" });
  assert.equal(missingAudiences.ok, false);
  const unexpectedAudiences = validateCompleteClaimReviewRequest({ expected_updated_at: NOW, decision: "rejected", approved_audiences: ["internal"] });
  assert.equal(unexpectedAudiences.ok, false);
  const duplicateAudiences = validateCompleteClaimReviewRequest({ expected_updated_at: NOW, decision: "approved", approved_audiences: ["internal", "internal"] });
  assert.equal(duplicateAudiences.ok, false);
  const badAudienceValue = validateCompleteClaimReviewRequest({ expected_updated_at: NOW, decision: "approved", approved_audiences: ["nonsense"] });
  assert.equal(badAudienceValue.ok, false);
  // funder/public are valid SHAPE (schema-layer accepts them, since they are
  // legitimate vocabulary members) - the governance ceiling that rejects them
  // given today's schema is enforced downstream, atomically, in the
  // repository - not at this shape-validation layer.
  const shapeValidFunder = validateCompleteClaimReviewRequest({ expected_updated_at: NOW, decision: "approved", approved_audiences: ["internal", "funder"] });
  assert.equal(shapeValidFunder.ok, true);
});

test("P2-12 route identifier helpers require canonical lowercase UUIDs for every path segment", () => {
  assert.deepEqual(
    evidenceReviewCompletionIdentifiers({ params: { organizationId: ORG, evidenceItemId: EVIDENCE, reviewQueueItemId: QUEUE } }),
    { organizationId: ORG, evidenceItemId: EVIDENCE, reviewQueueItemId: QUEUE },
  );
  assert.equal(evidenceReviewCompletionIdentifiers({ params: { organizationId: "not-a-uuid", evidenceItemId: EVIDENCE, reviewQueueItemId: QUEUE } }), null);
  assert.equal(claimReviewCompletionIdentifiers({ params: { organizationId: ORG, claimId: "not-a-uuid", reviewQueueItemId: QUEUE } }), null);
});

test("P2-12 route request validators reject an unsupported media type and unknown body fields", () => {
  const jsonReq = { headers: { "content-type": "application/json" }, params: { organizationId: ORG, evidenceItemId: EVIDENCE, reviewQueueItemId: QUEUE }, body: { expected_updated_at: NOW, decision: "supported" } };
  let sent = null;
  const res = { status(code) { sent = { code }; return { json(body) { sent.body = body; } }; } };
  const ok = validateEvidenceReviewCompletionRequestOrSend(jsonReq, res);
  assert.deepEqual(ok, { organizationId: ORG, evidenceItemId: EVIDENCE, reviewQueueItemId: QUEUE });
  assert.equal(sent, null);

  const badBodyReq = { headers: { "content-type": "application/json" }, params: { organizationId: ORG, claimId: CLAIM, reviewQueueItemId: QUEUE }, body: { expected_updated_at: NOW, decision: "approve_internal" } };
  const rejected = validateClaimReviewCompletionRequestOrSend(badBodyReq, res);
  assert.equal(rejected, null);
  assert.equal(sent.code, 422);
});

function repositoryInput() {
  return {
    organizationId: ORG,
    evidenceItemId: EVIDENCE,
    reviewQueueItemId: QUEUE,
    expectedUpdatedAt: NOW,
    decisionOutcome: "supported",
    limitationNotes: null,
    actorUserId: reviewerActor.actorUserId,
    actorRole: "gk_reviewer",
    now: NOW,
    metadataOnlyAudit: stubMetadataOnlyAudit(),
  };
}

test("P2-12 repository shapeError: a rejected required audit maps to validation_blocker/422 and logs a distinguishable classification", async () => {
  const originalConsoleError = console.error;
  const logged = [];
  console.error = (line) => logged.push(line);
  try {
    const repo = createPostgresHumanReviewRepository({
      runInTransaction: async () => {
        throw new __humanReviewRepositoryTestables.RequiredAuditRejectedError();
      },
    });
    const result = await repo.recordEvidenceReviewDecision(repositoryInput());
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");
    assert.equal(result.error.status, 422);
    const parsed = logged.map((line) => JSON.parse(line));
    assert.ok(parsed.some((entry) => entry.event === "KAI_P2_12_HUMAN_REVIEW_VALIDATION_BLOCKER_CLASSIFICATION" && entry.reason === "required_audit_rejected"));
  } finally {
    console.error = originalConsoleError;
  }
});

test("P2-12 repository shapeError: a PostgreSQL 23514 CHECK violation maps to validation_blocker/422 and logs its own distinguishable classification (never confused with a rejected audit)", async () => {
  const originalConsoleError = console.error;
  const logged = [];
  console.error = (line) => logged.push(line);
  try {
    const repo = createPostgresHumanReviewRepository({
      runInTransaction: async () => {
        const error = new Error("check constraint violated");
        error.code = "23514";
        error.constraint = "upload_lifecycle_audit_gate_a_operation_check";
        throw error;
      },
    });
    const result = await repo.recordEvidenceReviewDecision(repositoryInput());
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");
    assert.equal(result.error.status, 422);
    const parsed = logged.map((line) => JSON.parse(line));
    assert.ok(parsed.some((entry) => entry.event === "KAI_P2_12_HUMAN_REVIEW_VALIDATION_BLOCKER_CLASSIFICATION" && entry.reason === "check_constraint_violation" && entry.pg_constraint === "upload_lifecycle_audit_gate_a_operation_check"));
  } finally {
    console.error = originalConsoleError;
  }
});

test("P2-12 repository shapeError: a PostgreSQL 22P02 invalid-input-syntax error maps to validation_blocker/422 and logs its own distinguishable classification", async () => {
  const originalConsoleError = console.error;
  const logged = [];
  console.error = (line) => logged.push(line);
  try {
    const repo = createPostgresHumanReviewRepository({
      runInTransaction: async () => {
        const error = new Error("invalid input syntax");
        error.code = "22P02";
        throw error;
      },
    });
    const result = await repo.recordEvidenceReviewDecision(repositoryInput());
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");
    assert.equal(result.error.status, 422);
    const parsed = logged.map((line) => JSON.parse(line));
    assert.ok(parsed.some((entry) => entry.event === "KAI_P2_12_HUMAN_REVIEW_VALIDATION_BLOCKER_CLASSIFICATION" && entry.reason === "invalid_input_syntax"));
  } finally {
    console.error = originalConsoleError;
  }
});

test("P2-12 route source contains no SQL, imports no repository or database module, and never references req.user", () => {
  const source = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const slice = source.slice(
    source.indexOf("let evidenceReviewServicePromise"),
    source.indexOf("let coverageReviewDecisionServicePromise"),
  );
  assert.match(slice, /recordEvidenceReviewDecision/);
  assert.match(slice, /recordClaimReviewDecision/);
  assert.doesNotMatch(slice, /from\s+["'][^"']*(?:db|repository|postgres|kaiDb|kaiQueries|kaiReadModels)[^"']*["']/i);
  assert.doesNotMatch(slice, /\b(?:SELECT|INSERT|UPDATE|DELETE)\b|\bpool\b|\bkaiDb\b|\brepository\b/i);
  assert.doesNotMatch(slice, /req\.user/);
  assert.doesNotMatch(slice, /p3-|kaiGeneratedContentDraft|eligibleClaimsForAudience|kaiAssistantClaimTraceabilityTool/i);
});

test("P2-10 coverage-review-decision routes (internal-acceptance and funder-acceptance) contain no SQL, import no repository or database module, and never reference req.user", () => {
  const source = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const slice = source.slice(
    source.indexOf("let coverageReviewDecisionServicePromise"),
    source.indexOf("let clientFollowupCompletionServicePromise"),
  );
  assert.match(slice, /internal-acceptance/);
  assert.match(slice, /funder-acceptance/);
  assert.match(slice, /acceptInternalCoverageLimitation/);
  assert.match(slice, /acceptFunderCoverageLimitation/);
  assert.doesNotMatch(slice, /from\s+["'][^"']*(?:db|repository|postgres|kaiDb|kaiQueries|kaiReadModels)[^"']*["']/i);
  assert.doesNotMatch(slice, /\b(?:SELECT|INSERT|UPDATE|DELETE)\b|\bpool\b|\bkaiDb\b|\brepository\b/i);
  assert.doesNotMatch(slice, /req\.user/);
});

test("P2-11 client-followup routes contain no SQL, import no repository or database module, and never reference req.user", () => {
  const source = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const slice = source.slice(
    source.indexOf("let clientFollowupCompletionServicePromise"),
    source.indexOf("let requirementAssessmentServicePromise"),
  );
  assert.match(slice, /completeClientFollowup/);
  assert.match(slice, /listClientFollowupWorkflows/);
  assert.doesNotMatch(slice, /from\s+["'][^"']*(?:db|repository|postgres|kaiDb|kaiQueries|kaiReadModels)[^"']*["']/i);
  assert.doesNotMatch(slice, /\b(?:SELECT|INSERT|UPDATE|DELETE)\b|\bpool\b|\bkaiDb\b|\brepository\b/i);
  assert.doesNotMatch(slice, /req\.user/);
});

test("requirement-assessment and review-queue routes (through end of file) contain no SQL, no direct repository/database-module import or access, and never reference req.user", () => {
  const source = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const slice = source.slice(
    source.indexOf("let requirementAssessmentServicePromise"),
    source.indexOf("export default router;"),
  );
  assert.match(slice, /assessOrganizationRequirement/);
  assert.match(slice, /getOrganizationRequirementAssessment/);
  assert.match(slice, /listOrganizationRequirementsReadiness/);
  assert.match(slice, /listOrganizationReviewQueue/);
  // This slice's doc comments legitimately use the plain English word
  // "repository" (e.g. "this repository supports", "service/repository") to
  // describe the underlying data-repository concept, not a code import - so,
  // unlike the sibling slices above, this check targets actual import
  // statements and direct data-access calls rather than banning the bare word.
  assert.doesNotMatch(slice, /from\s+["'][^"']*(?:db|repository|postgres|kaiDb|kaiQueries|kaiReadModels)[^"']*["']/i);
  assert.doesNotMatch(slice, /require\(\s*["'][^"']*(?:db|repository|postgres|kaiDb|kaiQueries|kaiReadModels)[^"']*["']\s*\)/i);
  assert.doesNotMatch(slice, /\b(?:SELECT|INSERT|UPDATE|DELETE)\b|\bpool\b|\bkaiDb\b|\bpg\.query\b|\bclient\.query\b|\bdb\.query\b/i);
  assert.doesNotMatch(slice, /req\.user/);
});
