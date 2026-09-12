// Board Reporting final eligibility gate: read-only current-state composer.
// Proves exact Board candidate + exact resolved Board review + current BR-04
// grant + freshly recomposed Board packet fingerprint are all required. No
// database access - every dependency is faked.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  evaluateBoardReportingFinalEligibility,
  __boardReportingFinalEligibilityGateServiceContract,
  __boardReportingFinalEligibilityGateServiceTestables,
} from "../Backend/kai/services/kaiBoardReportingFinalEligibilityGateService.js";
import { composeBoardReportingPacketFingerprint } from "../Backend/kai/services/kaiBoardReportingPacketFingerprintService.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const ENGAGEMENT = "04000000-0000-4000-8000-000000000001";
const OTHER_ENGAGEMENT = "04000000-0000-4000-8000-000000000099";
const CANDIDATE_A = "04000000-0000-4000-8000-000000000501";
const CANDIDATE_B = "04000000-0000-4000-8000-000000000502";
const REVIEW_QUEUE_ITEM = "04000000-0000-4000-8000-000000000601";

const actorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "gk_admin" },
  ],
});

function input(overrides = {}) {
  return {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    boardReportingCandidateId: CANDIDATE_A,
    actorContext,
    ...overrides,
  };
}

function renderModel({ variant = "a" } = {}) {
  return {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    packetAudience: "internal",
    supportedContentTypes: ["evidence_summary", "impact_narrative"],
    members: [
      {
        generatedContentDraftId: `00000000-0000-4000-8000-${variant.repeat(12)}`,
        contentType: "evidence_summary",
        requestedAudience: "internal",
        draftStatus: "draft",
        currentUseEligible: true,
        blocks: [
          {
            ordinal: 0,
            citations: [
              {
                claimId: "00000000-0000-4000-8000-000000000701",
                evidenceItemId: "00000000-0000-4000-8000-000000000702",
                sourceId: "00000000-0000-4000-8000-000000000703",
                sourceVersionId: "00000000-0000-4000-8000-000000000704",
                supportStrength: "direct",
                claimReviewStatus: "resolved",
                evidenceReviewStatus: "resolved",
                currentEligible: true,
                blockerCodes: [],
                affectedDimensionKeys: [],
                affectedObjectIds: [],
              },
            ],
          },
        ],
      },
    ],
  };
}

const FINGERPRINT_A = composeBoardReportingPacketFingerprint(renderModel()).fingerprint;
const FINGERPRINT_B = composeBoardReportingPacketFingerprint(renderModel({ variant: "b" })).fingerprint;

function candidate(overrides = {}) {
  return {
    boardReportingCandidateId: CANDIDATE_A,
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    packetAudience: "internal",
    idempotencyKey: "board-final-eligibility",
    fingerprintContractVersion: "kai-sprint2-br-02-board-reporting-candidate-fingerprint-v1",
    canonicalFingerprint: FINGERPRINT_A,
    candidateStatus: "created",
    createdBy: "90000000-0000-4000-8000-000000000001",
    createdByType: "human",
    createdAt: "2026-09-12T10:00:00.000Z",
    members: [
      {
        boardReportingCandidateMemberId: "04000000-0000-4000-8000-000000000801",
        generatedContentDraftId: "00000000-0000-4000-8000-aaaaaaaaaaaa",
        ordinal: 0,
        createdAt: "2026-09-12T10:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

function reviewState({ queueStatus = "resolved", reviewStatus = "resolved", candidateId = CANDIDATE_A } = {}) {
  return {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    boardReportingCandidateId: candidateId,
    reviewQueueItemId: queueStatus ? REVIEW_QUEUE_ITEM : null,
    queueStatus,
    reviewStatus,
    reviewUpdatedAt: queueStatus ? "2026-09-12T11:00:00.000Z" : null,
  };
}

function deps(overrides = {}) {
  const calls = {
    readCandidate: 0,
    readReviewState: 0,
    evaluateEffectiveness: 0,
    composeRenderModel: 0,
    recordDecision: 0,
    createCandidate: 0,
    requestReview: 0,
  };
  const candidateRepository = {
    async readBoardReportingCandidate(readInput) {
      calls.readCandidate += 1;
      if (overrides.readCandidate) return overrides.readCandidate(readInput);
      return { ok: true, data: candidate(), error: null };
    },
    async readBoardReportingCandidateReviewStateById(readInput) {
      calls.readReviewState += 1;
      if (overrides.readReviewState) return overrides.readReviewState(readInput);
      return { ok: true, data: reviewState(), error: null };
    },
    async createBoardReportingCandidate() {
      calls.createCandidate += 1;
      return { ok: false, data: null, error: { code: "should_not_write", status: 500 } };
    },
    async requestBoardReportingCandidateReview() {
      calls.requestReview += 1;
      return { ok: false, data: null, error: { code: "should_not_write", status: 500 } };
    },
  };
  const authorityRepository = {
    async evaluateEffectiveness(effectivenessInput) {
      calls.evaluateEffectiveness += 1;
      if (overrides.evaluateEffectiveness) return overrides.evaluateEffectiveness(effectivenessInput);
      return { ok: true, data: { effective: true, reason: null, headDecisionId: "04000000-0000-4000-8000-000000000901" }, error: null };
    },
    async recordDecision() {
      calls.recordDecision += 1;
      return { ok: false, data: null, error: { code: "should_not_write", status: 500 } };
    },
  };
  const composeRenderModel = async (renderInput) => {
    calls.composeRenderModel += 1;
    if (overrides.composeRenderModel) return overrides.composeRenderModel(renderInput);
    return { ok: true, data: renderModel(), error: null };
  };
  return { candidateRepository, authorityRepository, composeRenderModel, calls };
}

test("input contract rejects client-supplied members, fingerprint, review state, authority state, eligibility, manifest, and delivery identity", () => {
  const { isEvaluateBoardReportingFinalEligibilityInput } = __boardReportingFinalEligibilityGateServiceTestables;
  assert.equal(isEvaluateBoardReportingFinalEligibilityInput(input()), true);
  for (const extraKey of [
    "members",
    "canonicalFingerprint",
    "freshFingerprint",
    "reviewStatus",
    "queueStatus",
    "authorityEffective",
    "finalEligibility",
    "manifestId",
    "deliveryId",
  ]) {
    assert.equal(isEvaluateBoardReportingFinalEligibilityInput({ ...input(), [extraKey]: "x" }), false, extraKey);
  }
});

test("valid candidate + resolved review + authority grant + matching fresh fingerprint -> eligible", async () => {
  const dependencies = deps();
  const result = await evaluateBoardReportingFinalEligibility(input(), dependencies);
  assert.equal(result.ok, true);
  assert.equal(result.data.finalEligibility, true);
  assert.equal(result.data.reviewGate.resolved, true);
  assert.equal(result.data.authorityGate.effective, true);
  assert.equal(result.data.currentnessGate.current, true);
  assert.deepEqual(result.data.failedGates, []);
  assert.equal(result.data.candidateFingerprint, FINGERPRINT_A);
  assert.equal(result.data.freshFingerprint, FINGERPRINT_A);
});

test("no review -> not eligible", async () => {
  const dependencies = deps({
    readReviewState: async () => ({ ok: true, data: reviewState({ queueStatus: null, reviewStatus: null }), error: null }),
  });
  const result = await evaluateBoardReportingFinalEligibility(input(), dependencies);
  assert.equal(result.ok, true);
  assert.equal(result.data.finalEligibility, false);
  assert.ok(result.data.failedGates.includes("board_reporting_candidate_review_unresolved"));
});

test("open review -> not eligible", async () => {
  const dependencies = deps({
    readReviewState: async () => ({ ok: true, data: reviewState({ queueStatus: "open", reviewStatus: "needs_gk_review" }), error: null }),
  });
  const result = await evaluateBoardReportingFinalEligibility(input(), dependencies);
  assert.equal(result.data.reviewGate.resolved, false);
  assert.equal(result.data.finalEligibility, false);
});

test("in-progress review -> not eligible", async () => {
  const dependencies = deps({
    readReviewState: async () => ({ ok: true, data: reviewState({ queueStatus: "in_progress", reviewStatus: "needs_gk_review" }), error: null }),
  });
  const result = await evaluateBoardReportingFinalEligibility(input(), dependencies);
  assert.equal(result.data.reviewGate.resolved, false);
  assert.equal(result.data.finalEligibility, false);
});

test("authority absent -> not eligible", async () => {
  const dependencies = deps({
    evaluateEffectiveness: async () => ({ ok: true, data: { effective: false, reason: "no_decision", headDecisionId: null }, error: null }),
  });
  const result = await evaluateBoardReportingFinalEligibility(input(), dependencies);
  assert.equal(result.ok, true);
  assert.equal(result.data.authorityGate.effective, false);
  assert.equal(result.data.finalEligibility, false);
  assert.ok(result.data.failedGates.includes("human_release_authority_absent"));
});

test("authority head = revoke -> not eligible", async () => {
  const dependencies = deps({
    evaluateEffectiveness: async () => ({ ok: true, data: { effective: false, reason: "head_is_revoke", headDecisionId: "04000000-0000-4000-8000-000000000902" }, error: null }),
  });
  const result = await evaluateBoardReportingFinalEligibility(input(), dependencies);
  assert.equal(result.ok, true);
  assert.equal(result.data.authorityGate.reason, "head_is_revoke");
  assert.equal(result.data.finalEligibility, false);
  assert.ok(result.data.failedGates.includes("human_release_authority_revoked"));
});

test("wrong org -> fail closed", async () => {
  const dependencies = deps({
    readCandidate: async () => ({ ok: false, data: null, error: { code: "not_found", status: 404 } }),
  });
  const result = await evaluateBoardReportingFinalEligibility(input({ organizationId: OTHER_ORG }), dependencies);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
});

test("wrong engagement -> fail closed", async () => {
  const dependencies = deps({
    readCandidate: async () => ({ ok: false, data: null, error: { code: "not_found", status: 404 } }),
  });
  const result = await evaluateBoardReportingFinalEligibility(input({ engagementId: OTHER_ENGAGEMENT }), dependencies);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
});

test("review bound to another candidate -> fail closed", async () => {
  const dependencies = deps({
    readReviewState: async () => ({ ok: false, data: null, error: { code: "conflict_current_state_changed", status: 409 } }),
  });
  const result = await evaluateBoardReportingFinalEligibility(input({ boardReportingCandidateId: CANDIDATE_B }), dependencies);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
});

test("fresh fingerprint differs -> stale / not eligible, without mutating candidate", async () => {
  const dependencies = deps({
    composeRenderModel: async () => ({ ok: true, data: renderModel({ variant: "b" }), error: null }),
  });
  const result = await evaluateBoardReportingFinalEligibility(input(), dependencies);
  assert.equal(result.ok, true);
  assert.equal(result.data.currentnessGate.current, false);
  assert.equal(result.data.currentnessGate.stale, true);
  assert.equal(result.data.finalEligibility, false);
  assert.equal(result.data.candidateFingerprint, FINGERPRINT_A);
  assert.equal(result.data.freshFingerprint, FINGERPRINT_B);
  assert.ok(result.data.failedGates.includes("board_reporting_candidate_stale"));
  assert.equal(dependencies.calls.createCandidate, 0);
});

test("evaluation performs no writes to Board candidate, members, review, authority ledger, manifest, or delivery", async () => {
  const dependencies = deps();
  const result = await evaluateBoardReportingFinalEligibility(input(), dependencies);
  assert.equal(result.ok, true);
  assert.equal(dependencies.calls.createCandidate, 0);
  assert.equal(dependencies.calls.requestReview, 0);
  assert.equal(dependencies.calls.recordDecision, 0);
  const source = readFileSync("Backend/kai/services/kaiBoardReportingFinalEligibilityGateService.js", "utf8");
  assert.doesNotMatch(source, /\.recordDecision\s*\(/);
  assert.doesNotMatch(source, /\.createBoardReportingCandidate\s*\(/);
  assert.doesNotMatch(source, /\.requestBoardReportingCandidateReview\s*\(/);
  assert.doesNotMatch(source, /\.startBoardReportingCandidateReview\s*\(/);
  assert.doesNotMatch(source, /\.completeBoardReportingCandidateReview\s*\(/);
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE)\b/i);
  assert.doesNotMatch(source, /manifest|delivery/i);
});

test("candidate contract invalid -> not eligible with structured blocker", async () => {
  const dependencies = deps({
    readCandidate: async () => ({
      ok: true,
      data: candidate({ fingerprintContractVersion: "wrong-version" }),
      error: null,
    }),
  });
  const result = await evaluateBoardReportingFinalEligibility(input(), dependencies);
  assert.equal(result.ok, true);
  assert.equal(result.data.candidateGate.contractValid, false);
  assert.equal(result.data.finalEligibility, false);
  assert.ok(result.data.failedGates.includes("candidate_contract_invalid"));
});

test("decision type for BR-04 effectiveness is export_authority_granted", async () => {
  assert.equal(
    __boardReportingFinalEligibilityGateServiceContract.FINAL_RELEASE_AUTHORITY_DECISION_TYPE,
    "export_authority_granted",
  );
  let seen = null;
  const dependencies = deps({
    evaluateEffectiveness: async (effectivenessInput) => {
      seen = effectivenessInput;
      return { ok: true, data: { effective: true, reason: null, headDecisionId: "04000000-0000-4000-8000-000000000901" }, error: null };
    },
  });
  await evaluateBoardReportingFinalEligibility(input(), dependencies);
  assert.equal(seen.decisionType, "export_authority_granted");
  assert.equal(seen.boardReportingCandidateId, CANDIDATE_A);
});
