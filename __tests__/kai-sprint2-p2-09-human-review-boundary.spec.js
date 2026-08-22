import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { completeEvidenceReview, completeClaimReviewInternalApproval, __humanReviewServiceContract } from "../Backend/kai/services/kaiHumanReviewService.js";
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

test("P2-09 allowed roles are gk_reviewer and gk_admin only - never gk_operator, client, or a generic system actor", () => {
  assert.deepEqual([...__humanReviewServiceContract.COMPLETE_EVIDENCE_REVIEW_ALLOWED_ROLES].sort(), ["gk_admin", "gk_reviewer"]);
  assert.deepEqual([...__humanReviewServiceContract.COMPLETE_CLAIM_REVIEW_ALLOWED_ROLES].sort(), ["gk_admin", "gk_reviewer"]);
});

test("P2-09 completeEvidenceReview rejects a non-human actor before any repository call", async () => {
  const result = await completeEvidenceReview(
    {
      organizationId: ORG,
      evidenceItemId: EVIDENCE,
      reviewQueueItemId: QUEUE,
      expectedUpdatedAt: NOW,
      actorContext: { actorType: "ai", actorUserId: "x" },
      now: NOW,
    },
    { env: enabledEnv, humanReviewRepository: { async completeEvidenceReview() { throw new Error("must not be called"); } }, metadataOnlyAudit: stubMetadataOnlyAudit() },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("P2-09 completeEvidenceReview reports missing actor context as unauthorized instead of opaque validation_blocker", async () => {
  const result = await completeEvidenceReview(
    {
      organizationId: ORG,
      evidenceItemId: EVIDENCE,
      reviewQueueItemId: QUEUE,
      expectedUpdatedAt: NOW,
      actorContext: undefined,
      now: NOW,
    },
    { env: enabledEnv, humanReviewRepository: { async completeEvidenceReview() { throw new Error("must not be called"); } }, metadataOnlyAudit: stubMetadataOnlyAudit() },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "unauthorized");
  assert.equal(result.error.status, 401);
  assert.equal(result.blockers?.[0]?.blocking_reason, "missing_actor_context");
});

test("P2-09 completeEvidenceReview rejects a wrong role (gk_operator) before any repository call", async () => {
  const result = await completeEvidenceReview(
    {
      organizationId: ORG,
      evidenceItemId: EVIDENCE,
      reviewQueueItemId: QUEUE,
      expectedUpdatedAt: NOW,
      actorContext: {
        actorType: "human",
        actorUserId: "op",
        organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_operator" }],
      },
      now: NOW,
    },
    { env: enabledEnv, humanReviewRepository: { async completeEvidenceReview() { throw new Error("must not be called"); } }, metadataOnlyAudit: stubMetadataOnlyAudit() },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("P2-09 completeClaimReviewInternalApproval reports missing actor context as unauthorized instead of opaque validation_blocker", async () => {
  const result = await completeClaimReviewInternalApproval(
    {
      organizationId: ORG,
      claimId: CLAIM,
      reviewQueueItemId: QUEUE,
      expectedUpdatedAt: NOW,
      actorContext: null,
      now: NOW,
    },
    { env: enabledEnv, humanReviewRepository: { async completeClaimReviewInternalApproval() { throw new Error("must not be called"); } }, metadataOnlyAudit: stubMetadataOnlyAudit() },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "unauthorized");
  assert.equal(result.error.status, 401);
  assert.equal(result.blockers?.[0]?.blocking_reason, "missing_actor_context");
});

test("P2-09 completeClaimReviewInternalApproval rejects a wrong role (gk_operator) before any repository call", async () => {
  const result = await completeClaimReviewInternalApproval(
    {
      organizationId: ORG,
      claimId: CLAIM,
      reviewQueueItemId: QUEUE,
      expectedUpdatedAt: NOW,
      actorContext: {
        actorType: "human",
        actorUserId: "op",
        organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_operator" }],
      },
      now: NOW,
    },
    { env: enabledEnv, humanReviewRepository: { async completeClaimReviewInternalApproval() { throw new Error("must not be called"); } }, metadataOnlyAudit: stubMetadataOnlyAudit() },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("P2-09 completeEvidenceReview allows a global gk_reviewer whose active org-scoped membership role is gk_operator (production regression: VAL-AUT-004 must not fire when the global capability role is present)", async () => {
  const calls = [];
  const result = await completeEvidenceReview(
    {
      organizationId: ORG,
      evidenceItemId: EVIDENCE,
      reviewQueueItemId: QUEUE,
      expectedUpdatedAt: NOW,
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
        async completeEvidenceReview(input) {
          calls.push(input);
          return { ok: true, data: { evidence_item_id: EVIDENCE, review_queue_item_id: QUEUE, queue_status: "resolved", review_status: "resolved", support_strength: "reviewed_supported", replayed: false }, error: null };
        },
      },
      metadataOnlyAudit: stubMetadataOnlyAudit(),
    },
  );
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
});

test("P2-09 completeClaimReviewInternalApproval allows the same global gk_reviewer/gk_operator-membership actor shape", async () => {
  const calls = [];
  const result = await completeClaimReviewInternalApproval(
    {
      organizationId: ORG,
      claimId: CLAIM,
      reviewQueueItemId: QUEUE,
      expectedUpdatedAt: NOW,
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
        async completeClaimReviewInternalApproval(input) {
          calls.push(input);
          return { ok: true, data: { claim_id: CLAIM, review_queue_item_id: QUEUE, queue_status: "resolved", review_status: "resolved", claim_strength: "reviewed_supported", replayed: false }, error: null };
        },
      },
      metadataOnlyAudit: stubMetadataOnlyAudit(),
    },
  );
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
});

test("P2-09 completeEvidenceReview still denies a global gk_reviewer/gk_admin actor with no active membership in the target organization (combineGlobalRoles never bypasses tenant isolation)", async () => {
  const OTHER_ORG = "00000000-0000-4000-8000-000000000005";
  const result = await completeEvidenceReview(
    {
      organizationId: ORG,
      evidenceItemId: EVIDENCE,
      reviewQueueItemId: QUEUE,
      expectedUpdatedAt: NOW,
      actorContext: {
        actorType: "human",
        actorUserId: "cross-tenant",
        kaiRoles: ["gk_admin", "gk_reviewer"],
        organizationMemberships: [{ organization_id: OTHER_ORG, membership_status: "active", role_name: "gk_reviewer" }],
      },
      now: NOW,
    },
    { env: enabledEnv, humanReviewRepository: { async completeEvidenceReview() { throw new Error("must not be called"); } }, metadataOnlyAudit: stubMetadataOnlyAudit() },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("P2-09 completeEvidenceReview denies an actor whose only kaiRoles come from actorContext but hold no allowed role and no allowed org-scoped membership role (still gk_operator only, no escalation via an empty/forged kaiRoles field)", async () => {
  const result = await completeEvidenceReview(
    {
      organizationId: ORG,
      evidenceItemId: EVIDENCE,
      reviewQueueItemId: QUEUE,
      expectedUpdatedAt: NOW,
      actorContext: {
        actorType: "human",
        actorUserId: "op-only",
        kaiRoles: ["gk_operator"],
        organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_operator" }],
      },
      now: NOW,
    },
    { env: enabledEnv, humanReviewRepository: { async completeEvidenceReview() { throw new Error("must not be called"); } }, metadataOnlyAudit: stubMetadataOnlyAudit() },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("P2-09 KAI_SPRINT2_ENABLED=false yields feature_disabled with zero repository calls for both transitions", async () => {
  const evidenceResult = await completeEvidenceReview(
    { organizationId: ORG, evidenceItemId: EVIDENCE, reviewQueueItemId: QUEUE, expectedUpdatedAt: NOW, actorContext: reviewerActor, now: NOW },
    { env: { KAI_SPRINT2_ENABLED: "false" }, humanReviewRepository: { async completeEvidenceReview() { throw new Error("must not be called"); } } },
  );
  assert.equal(evidenceResult.ok, false);
  assert.equal(evidenceResult.error.code, "feature_disabled");

  const claimResult = await completeClaimReviewInternalApproval(
    { organizationId: ORG, claimId: CLAIM, reviewQueueItemId: QUEUE, expectedUpdatedAt: NOW, actorContext: reviewerActor, now: NOW },
    { env: { KAI_SPRINT2_ENABLED: "false" }, humanReviewRepository: { async completeClaimReviewInternalApproval() { throw new Error("must not be called"); } } },
  );
  assert.equal(claimResult.ok, false);
  assert.equal(claimResult.error.code, "feature_disabled");
});

test("P2-09 completeEvidenceReview delegates to the injected repository exactly once with the derived actor/tenant identity", async () => {
  const calls = [];
  const result = await completeEvidenceReview(
    { organizationId: ORG, evidenceItemId: EVIDENCE, reviewQueueItemId: QUEUE, expectedUpdatedAt: NOW, actorContext: reviewerActor, now: NOW },
    {
      env: enabledEnv,
      humanReviewRepository: {
        async completeEvidenceReview(input) {
          calls.push(input);
          return { ok: true, data: { evidence_item_id: EVIDENCE, review_queue_item_id: QUEUE, queue_status: "resolved", review_status: "resolved", support_strength: "reviewed_supported", replayed: false }, error: null };
        },
      },
      metadataOnlyAudit: stubMetadataOnlyAudit(),
    },
  );
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].actorUserId, reviewerActor.actorUserId);
  assert.equal(calls[0].organizationId, ORG);
});

test("P2-09 request-body validators accept only expected_updated_at and reject unknown fields", () => {
  const ok = validateCompleteEvidenceReviewRequest({ expected_updated_at: NOW });
  assert.equal(ok.ok, true);
  const unknown = validateCompleteEvidenceReviewRequest({ expected_updated_at: NOW, decision: "supported" });
  assert.equal(unknown.ok, false);
  const missing = validateCompleteClaimReviewRequest({});
  assert.equal(missing.ok, false);
  const badTimestamp = validateCompleteClaimReviewRequest({ expected_updated_at: "not-a-timestamp" });
  assert.equal(badTimestamp.ok, false);
});

test("P2-09 route identifier helpers require canonical lowercase UUIDs for every path segment", () => {
  assert.deepEqual(
    evidenceReviewCompletionIdentifiers({ params: { organizationId: ORG, evidenceItemId: EVIDENCE, reviewQueueItemId: QUEUE } }),
    { organizationId: ORG, evidenceItemId: EVIDENCE, reviewQueueItemId: QUEUE },
  );
  assert.equal(evidenceReviewCompletionIdentifiers({ params: { organizationId: "not-a-uuid", evidenceItemId: EVIDENCE, reviewQueueItemId: QUEUE } }), null);
  assert.equal(claimReviewCompletionIdentifiers({ params: { organizationId: ORG, claimId: "not-a-uuid", reviewQueueItemId: QUEUE } }), null);
});

test("P2-09 route request validators reject an unsupported media type and unknown body fields", () => {
  const jsonReq = { headers: { "content-type": "application/json" }, params: { organizationId: ORG, evidenceItemId: EVIDENCE, reviewQueueItemId: QUEUE }, body: { expected_updated_at: NOW } };
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
    actorUserId: reviewerActor.actorUserId,
    now: NOW,
    metadataOnlyAudit: stubMetadataOnlyAudit(),
  };
}

test("P2-09 repository shapeError: a rejected required audit maps to validation_blocker/422 and logs a distinguishable classification", async () => {
  const originalConsoleError = console.error;
  const logged = [];
  console.error = (line) => logged.push(line);
  try {
    const repo = createPostgresHumanReviewRepository({
      runInTransaction: async () => {
        throw new __humanReviewRepositoryTestables.RequiredAuditRejectedError();
      },
    });
    const result = await repo.completeEvidenceReview(repositoryInput());
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");
    assert.equal(result.error.status, 422);
    const parsed = logged.map((line) => JSON.parse(line));
    assert.ok(parsed.some((entry) => entry.event === "KAI_P2_09_HUMAN_REVIEW_VALIDATION_BLOCKER_CLASSIFICATION" && entry.reason === "required_audit_rejected"));
  } finally {
    console.error = originalConsoleError;
  }
});

test("P2-09 repository shapeError: a PostgreSQL 23514 CHECK violation maps to validation_blocker/422 and logs its own distinguishable classification (never confused with a rejected audit)", async () => {
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
    const result = await repo.completeEvidenceReview(repositoryInput());
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");
    assert.equal(result.error.status, 422);
    const parsed = logged.map((line) => JSON.parse(line));
    assert.ok(parsed.some((entry) => entry.event === "KAI_P2_09_HUMAN_REVIEW_VALIDATION_BLOCKER_CLASSIFICATION" && entry.reason === "check_constraint_violation" && entry.pg_constraint === "upload_lifecycle_audit_gate_a_operation_check"));
  } finally {
    console.error = originalConsoleError;
  }
});

test("P2-09 repository shapeError: a PostgreSQL 22P02 invalid-input-syntax error maps to validation_blocker/422 and logs its own distinguishable classification", async () => {
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
    const result = await repo.completeEvidenceReview(repositoryInput());
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");
    assert.equal(result.error.status, 422);
    const parsed = logged.map((line) => JSON.parse(line));
    assert.ok(parsed.some((entry) => entry.event === "KAI_P2_09_HUMAN_REVIEW_VALIDATION_BLOCKER_CLASSIFICATION" && entry.reason === "invalid_input_syntax"));
  } finally {
    console.error = originalConsoleError;
  }
});

test("P2-09 route source contains no SQL, imports no repository or database module, and never references req.user", () => {
  const source = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const slice = source.slice(
    source.indexOf("let evidenceReviewServicePromise"),
    source.indexOf("export default router;"),
  );
  assert.match(slice, /completeEvidenceReview/);
  assert.match(slice, /completeClaimReviewInternalApproval/);
  assert.doesNotMatch(slice, /from\s+["'][^"']*(?:db|repository|postgres|kaiDb|kaiQueries|kaiReadModels)[^"']*["']/i);
  assert.doesNotMatch(slice, /\b(?:SELECT|INSERT|UPDATE|DELETE)\b|\bpool\b|\bkaiDb\b|\brepository\b/i);
  assert.doesNotMatch(slice, /req\.user/);
  assert.doesNotMatch(slice, /p3-|kaiGeneratedContentDraft|eligibleClaimsForAudience|kaiAssistantClaimTraceabilityTool/i);
});
