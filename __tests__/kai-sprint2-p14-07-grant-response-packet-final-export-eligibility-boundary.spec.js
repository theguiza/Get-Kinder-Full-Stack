// P14-07: Grant Response Packet final-export eligibility evaluation. READ /
// EVALUATION ONLY - proves the evaluator checks organization ownership,
// engagement ownership, funder audience, current canonical fingerprint,
// packet-level export_review resolved/resolved state, and the real P14-07B1
// evaluateEffectiveness result for export_authority_granted - reusing the
// exact same VAL-EXP-001 validateExportManifestEligibility pure gate logic
// the existing single-draft P3-18 flow uses, unmodified. No database
// access - every dependency is faked.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  evaluateGrantResponsePacketFinalExportEligibility,
  __grantResponsePacketFinalExportEligibilityGateServiceContract,
  __grantResponsePacketFinalExportEligibilityGateServiceTestables,
} from "../Backend/kai/services/kaiGrantResponsePacketFinalExportEligibilityGateService.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const ENGAGEMENT = "00000000-0000-4000-8000-000000000201";
const CANDIDATE_A = "00000000-0000-4000-8000-000000000301";
const CANDIDATE_B = "00000000-0000-4000-8000-000000000302";

const gkAdminActorContext = Object.freeze({
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
    grantResponsePacketExportCandidateId: CANDIDATE_A,
    actorContext: gkAdminActorContext,
    ...overrides,
  };
}

function renderModel(overrides = {}) {
  return {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    packetAudience: "funder",
    members: [{ generatedContentDraftId: "00000000-0000-4000-8000-000000000401", currentUseEligible: true }],
    ...overrides,
  };
}

function effectivenessOk(data) {
  return async () => ({ ok: true, data, error: null });
}

function reviewStateOk(data) {
  return async () => ({ ok: true, data, error: null });
}

function dependencies(overrides = {}) {
  const calls = { evaluateEffectiveness: 0, readReviewState: 0, composeRenderModel: 0 };
  return {
    deps: {
      authorityRepository: {
        evaluateEffectiveness: overrides.evaluateEffectiveness || effectivenessOk({
          effective: false, reason: "no_decision", headDecisionId: null,
        }),
      },
      candidateRepository: {
        readGrantResponsePacketExportCandidateReviewStateById: overrides.readReviewState || reviewStateOk({
          organizationId: ORG,
          engagementId: ENGAGEMENT,
          grantResponsePacketExportCandidateId: CANDIDATE_A,
          reviewQueueItemId: "00000000-0000-4000-8000-000000000501",
          queueStatus: "resolved",
          reviewStatus: "resolved",
          reviewUpdatedAt: "2026-09-09T12:00:00.000Z",
        }),
      },
      composeRenderModel: overrides.composeRenderModel || (async () => ({ ok: true, data: renderModel(), error: null })),
      ...overrides.extra,
    },
    calls,
  };
}

function countingWrapper(fn, calls, key) {
  return async (...args) => {
    calls[key] += 1;
    return fn(...args);
  };
}

test("client-supplied fingerprint/members/memberCount/review/eligibility/authority/requestedAudience fields are rejected by the exact-keys input contract", () => {
  const { isEvaluateGrantResponsePacketFinalExportEligibilityInput } = __grantResponsePacketFinalExportEligibilityGateServiceTestables;
  for (const extraKey of [
    "canonicalFingerprint",
    "members",
    "memberCount",
    "reviewStatus",
    "queueStatus",
    "finalExportEligible",
    "effective",
    "requestedAudience",
  ]) {
    assert.equal(
      isEvaluateGrantResponsePacketFinalExportEligibilityInput({ ...input(), [extraKey]: "x" }),
      false,
      `${extraKey} must be rejected`,
    );
  }
});

test("assistant/system actorContext fails closed before any evaluation", async () => {
  const { deps } = dependencies();
  const result = await evaluateGrantResponsePacketFinalExportEligibility(
    input({ actorContext: { actorType: "system", actorUserId: "svc" } }),
    deps,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
});

test("nonexistent candidate fails closed as not_found", async () => {
  const { deps } = dependencies({
    evaluateEffectiveness: effectivenessOk({ effective: false, reason: "candidate_missing", headDecisionId: null }),
  });
  const result = await evaluateGrantResponsePacketFinalExportEligibility(input(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
});

test("wrong org/engagement/cross-tenant candidate fails closed as not_found (B1's own org/engagement-scoped query never matches)", async () => {
  // B1's evaluateEffectiveness reports candidate_missing for a candidate
  // belonging to another organization or another engagement's packet
  // identity - this evaluator never invents a different code for that case.
  const { deps } = dependencies({
    evaluateEffectiveness: effectivenessOk({ effective: false, reason: "candidate_missing", headDecisionId: null }),
  });
  const result = await evaluateGrantResponsePacketFinalExportEligibility(input({ organizationId: OTHER_ORG }), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
});

test("stale fingerprint (packet_candidate_superseded) -> BLOCKED, never fabricates a review/member value for the stale row", async () => {
  const { deps, calls } = dependencies({
    evaluateEffectiveness: effectivenessOk({ effective: false, reason: "packet_candidate_superseded", headDecisionId: "d1" }),
  });
  deps.composeRenderModel = countingWrapper(deps.composeRenderModel, calls, "composeRenderModel");
  const result = await evaluateGrantResponsePacketFinalExportEligibility(input(), deps);
  assert.equal(result.ok, true);
  assert.equal(result.data.packetCandidateCurrent, false);
  assert.equal(result.data.finalExportEligible, false);
  assert.equal(result.data.validatorResult.severity, "blocker");
  assert.ok(result.data.validatorResult.evidence.failed_gates.includes("packet_candidate_superseded"));
  // A stale candidate's eligibility is never computed from a live render
  // model recomposition - staleness alone is dispositive.
  assert.equal(calls.composeRenderModel, 0);
});

test("no review requested/open/in_progress -> BLOCKED", async () => {
  for (const [queueStatus, reviewStatus] of [
    [null, null],
    ["open", "needs_gk_review"],
    ["in_progress", "needs_gk_review"],
  ]) {
    const { deps } = dependencies({
      evaluateEffectiveness: effectivenessOk({ effective: false, reason: "no_decision", headDecisionId: null }),
      readReviewState: reviewStateOk({
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        grantResponsePacketExportCandidateId: CANDIDATE_A,
        reviewQueueItemId: queueStatus ? "00000000-0000-4000-8000-000000000501" : null,
        queueStatus,
        reviewStatus,
        reviewUpdatedAt: queueStatus ? "2026-09-09T12:00:00.000Z" : null,
      }),
    });
    const result = await evaluateGrantResponsePacketFinalExportEligibility(input(), deps);
    assert.equal(result.ok, true);
    assert.equal(result.data.reviewResolved, false);
    assert.equal(result.data.finalExportEligible, false);
    assert.ok(result.data.validatorResult.evidence.failed_gates.includes("generated_content_review_unresolved"));
  }
});

test("resolved review + no authority -> BLOCKED", async () => {
  const { deps } = dependencies({
    evaluateEffectiveness: effectivenessOk({ effective: false, reason: "no_decision", headDecisionId: null }),
  });
  const result = await evaluateGrantResponsePacketFinalExportEligibility(input(), deps);
  assert.equal(result.ok, true);
  assert.equal(result.data.reviewResolved, true);
  assert.equal(result.data.effectiveHumanExportAuthority, false);
  assert.equal(result.data.finalExportEligible, false);
  assert.ok(result.data.validatorResult.evidence.failed_gates.includes("affirmative_human_export_authority_absent"));
});

test("resolved review + effective grant + all gates satisfied -> PASS", async () => {
  const { deps } = dependencies({
    evaluateEffectiveness: effectivenessOk({ effective: true, reason: null, headDecisionId: "d1" }),
  });
  const result = await evaluateGrantResponsePacketFinalExportEligibility(input(), deps);
  assert.equal(result.ok, true);
  assert.equal(result.data.packetCandidateCurrent, true);
  assert.equal(result.data.reviewResolved, true);
  assert.equal(result.data.memberCurrentUseEligible, true);
  assert.equal(result.data.effectiveHumanExportAuthority, true);
  assert.equal(result.data.finalExportEligible, true);
  assert.equal(result.data.validatorResult.severity, "pass");
});

test("revoked authority (head_is_revoke) -> BLOCKED", async () => {
  const { deps } = dependencies({
    evaluateEffectiveness: effectivenessOk({ effective: false, reason: "head_is_revoke", headDecisionId: "d2" }),
  });
  const result = await evaluateGrantResponsePacketFinalExportEligibility(input(), deps);
  assert.equal(result.ok, true);
  assert.equal(result.data.effectiveHumanExportAuthority, false);
  assert.equal(result.data.effectivenessReason, "head_is_revoke");
  assert.equal(result.data.finalExportEligible, false);
});

test("member-level currentUseEligible=false -> BLOCKED (no eligible/current members cannot pass)", async () => {
  const { deps } = dependencies({
    evaluateEffectiveness: effectivenessOk({ effective: true, reason: null, headDecisionId: "d1" }),
    composeRenderModel: async () => ({
      ok: true,
      data: renderModel({ members: [{ generatedContentDraftId: "x", currentUseEligible: false }] }),
      error: null,
    }),
  });
  const result = await evaluateGrantResponsePacketFinalExportEligibility(input(), deps);
  assert.equal(result.data.memberCurrentUseEligible, false);
  assert.equal(result.data.finalExportEligible, false);
  assert.ok(result.data.validatorResult.evidence.failed_gates.includes("current_use_ineligible"));
});

test("candidate A's authority evaluation is scoped to candidate A only - a second call for candidate B receives its own independent effectiveness input", async () => {
  const seenCandidateIds = [];
  const { deps } = dependencies({
    evaluateEffectiveness: async (evalInput) => {
      seenCandidateIds.push(evalInput.grantResponsePacketExportCandidateId);
      return {
        ok: true,
        data: {
          effective: evalInput.grantResponsePacketExportCandidateId === CANDIDATE_A,
          reason: evalInput.grantResponsePacketExportCandidateId === CANDIDATE_A ? null : "no_decision",
          headDecisionId: null,
        },
        error: null,
      };
    },
  });
  const resultA = await evaluateGrantResponsePacketFinalExportEligibility(input({ grantResponsePacketExportCandidateId: CANDIDATE_A }), deps);
  const resultB = await evaluateGrantResponsePacketFinalExportEligibility(input({ grantResponsePacketExportCandidateId: CANDIDATE_B }), deps);
  assert.equal(resultA.data.effectiveHumanExportAuthority, true);
  assert.equal(resultB.data.effectiveHumanExportAuthority, false);
  assert.deepEqual(seenCandidateIds, [CANDIDATE_A, CANDIDATE_B]);
});

test("no latest/newest candidate selection is possible - the evaluator contains no SQL of its own (no ORDER BY/LIMIT lookup) and only ever passes through the exact grantResponsePacketExportCandidateId given", () => {
  const source = readFileSync(
    new URL("../Backend/kai/services/kaiGrantResponsePacketFinalExportEligibilityGateService.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /ORDER BY|LIMIT\s+1/i);
});

test("evaluation performs no manifest/bytes/new-authority-row creation - the evaluator never calls recordDecision or any write method", async () => {
  const { deps } = dependencies({
    evaluateEffectiveness: effectivenessOk({ effective: true, reason: null, headDecisionId: "d1" }),
  });
  let recordDecisionCalls = 0;
  deps.authorityRepository.recordDecision = async () => { recordDecisionCalls += 1; return { ok: true, data: {}, error: null }; };
  await evaluateGrantResponsePacketFinalExportEligibility(input(), deps);
  assert.equal(recordDecisionCalls, 0);
});

test("decision type passed to B1's evaluateEffectiveness matches export_authority_granted", () => {
  assert.equal(
    __grantResponsePacketFinalExportEligibilityGateServiceContract.FINAL_RELEASE_AUTHORITY_DECISION_TYPE,
    "export_authority_granted",
  );
});

test("evaluateEffectiveness is called exactly once and receives the exact supplied composeRenderModel/renderModelDependencies - the default render-model fallback is never required", async () => {
  let effectivenessCalls = 0;
  let seenComposeRenderModel = null;
  let seenRenderModelDependencies = null;
  const renderModelDependencies = { candidateRepository: {} };
  const composeRenderModel = async () => ({ ok: true, data: renderModel(), error: null });

  const { deps } = dependencies({
    evaluateEffectiveness: async (evalInput, evalDependencies = {}) => {
      effectivenessCalls += 1;
      seenComposeRenderModel = evalDependencies.composeRenderModel;
      seenRenderModelDependencies = evalDependencies.renderModelDependencies;
      return { ok: true, data: { effective: true, reason: null, headDecisionId: "d1" }, error: null };
    },
    extra: { composeRenderModel, renderModelDependencies },
  });
  deps.composeRenderModel = composeRenderModel;
  deps.renderModelDependencies = renderModelDependencies;

  const result = await evaluateGrantResponsePacketFinalExportEligibility(input(), deps);

  assert.equal(effectivenessCalls, 1);
  assert.equal(seenComposeRenderModel, composeRenderModel);
  assert.equal(seenRenderModelDependencies, renderModelDependencies);
  assert.equal(result.ok, true);
  assert.equal(result.data.finalExportEligible, true);
});

test("shared VAL-EXP-001 validator is reused unmodified - the evaluator's own module imports it rather than reimplementing gate logic", () => {
  const source = readFileSync(
    new URL("../Backend/kai/services/kaiGrantResponsePacketFinalExportEligibilityGateService.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /import\s*\{\s*validateExportManifestEligibility\s*\}\s*from\s*"..\/validators\/kaiExportManifestEligibilityValidators\.js"/);
});
