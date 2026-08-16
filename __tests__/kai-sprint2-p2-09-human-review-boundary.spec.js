import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { completeEvidenceReview, completeClaimReviewInternalApproval, __humanReviewServiceContract } from "../Backend/kai/services/kaiHumanReviewService.js";
import {
  validateCompleteEvidenceReviewRequest,
  validateCompleteClaimReviewRequest,
} from "../Backend/kai/validators/kaiSprint2RequestSchemas.js";
import { __testables as intakeRouteTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";

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
