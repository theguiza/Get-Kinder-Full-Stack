// PHASE 14 SEMANTIC AUTHORITY + DORMANT AUTHORITY CONTRACT CLOSURE
//
// Proves the owner-accepted semantics against the REAL, unmodified
// kaiFinalExportEligibilityGateService.js and humanAuthorityDecisionContract.js:
//
//   applicable readiness/review/governance gates + effective
//   export_authority_granted  ->  final eligibility
//
// NOT a stack of funder_ready + public_ready + client_reviewed +
// export_authority_granted as separate mandatory human approvals. The
// dormant `client_reviewed`/`funder_ready`/`public_ready` decision types
// are never consulted by this gate for any requested audience.

import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateFinalExportEligibility,
  __finalExportEligibilityGateServiceContract,
} from "../Backend/kai/services/kaiFinalExportEligibilityGateService.js";
import {
  HUMAN_AUTHORITY_DECISION_TYPES,
  HUMAN_AUTHORITY_DECISION_ROLE_BY_TYPE,
  HUMAN_AUTHORITY_DECISION_AUDIENCE_BY_TYPE,
} from "../Backend/kai/dictionary/humanAuthorityDecisionContract.js";
import { recordHumanFinalReleaseAuthorityDecision } from "../Backend/kai/services/kaiHumanAuthorityDecisionService.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const DRAFT = "00000000-0000-4000-8000-000000000301";
const CANDIDATE = "00000000-0000-4000-8000-000000000401";
const QUEUE = "00000000-0000-4000-8000-000000000303";

const enabledEnv = Object.freeze({
  KAI_SPRINT2_ENABLED: "true",
  KAI_GENERATION_ENABLED: "true",
  KAI_PUBLIC_EXPORT_ENABLED: "true",
});

const adminActorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  source: "public.userdata",
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "gk_admin" },
  ],
});

function input(overrides = {}) {
  return {
    organizationId: ORG,
    exportCandidateId: CANDIDATE,
    exportReviewQueueItemId: QUEUE,
    actorContext: adminActorContext,
    ...overrides,
  };
}

function candidateRow(overrides = {}) {
  return {
    export_candidate_id: CANDIDATE,
    organization_id: ORG,
    generated_content_draft_id: DRAFT,
    requested_audience: "internal",
    ...overrides,
  };
}

function packet(overrides = {}) {
  return {
    generatedContentDraftId: DRAFT,
    requestedExportAudience: "internal",
    draftStatus: "draft",
    generatedContentReviewQueueStatus: "resolved",
    generatedContentReviewStatus: "resolved",
    exportReviewQueueStatus: "resolved",
    exportReviewStatus: "resolved",
    currentUseEligible: true,
    ...overrides,
  };
}

function dependencies({ audience = "internal", effective = true, overrides = {} } = {}) {
  const effectivenessCalls = [];
  return {
    deps: {
      env: enabledEnv,
      runInTransaction: async (callback) => callback({ async query() { return { rows: [] }; } }),
      loadCandidate: async () => candidateRow({ requested_audience: audience }),
      evaluatePacket: async () => ({
        ok: true,
        data: packet({ requestedExportAudience: audience }),
        error: null,
      }),
      evaluator: async () => ({ ok: true, data: {}, error: null }),
      humanAuthorityDecisionRepository: {
        evaluateEffectiveness: async (effectivenessInput) => {
          effectivenessCalls.push(effectivenessInput);
          return {
            ok: true,
            data: {
              effective,
              reason: effective ? null : "no_decision",
              headDecisionId: effective ? "decision-1" : null,
            },
            error: null,
          };
        },
      },
      ...overrides,
    },
    effectivenessCalls,
  };
}

for (const audience of ["internal", "funder", "public"]) {
  test(`absence of client_reviewed/funder_ready/public_ready does not by itself block ${audience} final export - only export_authority_granted is queried`, async () => {
    const { deps, effectivenessCalls } = dependencies({ audience, effective: true });
    const result = await evaluateFinalExportEligibility(input(), deps);

    assert.equal(result.ok, true);
    assert.equal(result.data.finalExportEligible, true);
    assert.equal(result.data.effectiveHumanExportAuthority, true);

    // Exactly one effectiveness lookup was ever performed, and it was
    // scoped to export_authority_granted - no second lookup for
    // client_reviewed/funder_ready/public_ready occurred for any audience.
    assert.equal(effectivenessCalls.length, 1);
    assert.equal(effectivenessCalls[0].decisionType, "export_authority_granted");
    assert.equal(
      __finalExportEligibilityGateServiceContract.FINAL_RELEASE_AUTHORITY_DECISION_TYPE,
      "export_authority_granted",
    );
  });

  test(`revoked/absent export_authority_granted blocks ${audience} final export regardless of client_reviewed/funder_ready/public_ready state`, async () => {
    const { deps } = dependencies({ audience, effective: false });
    const result = await evaluateFinalExportEligibility(input(), deps);

    assert.equal(result.ok, true);
    assert.equal(result.data.finalExportEligible, false);
    assert.equal(result.data.effectiveHumanExportAuthority, false);
    assert.equal(result.data.validatorResult.severity, "blocker");
    assert.ok(
      result.data.validatorResult.evidence.failed_gates.includes(
        "affirmative_human_export_authority_absent",
      ),
    );
  });
}

test("other governed gates remain fail-closed even with effective export_authority_granted (review unresolved)", async () => {
  const { deps } = dependencies({
    audience: "internal",
    effective: true,
    overrides: {
      evaluatePacket: async () => ({
        ok: true,
        data: packet({ exportReviewQueueStatus: "in_progress", exportReviewStatus: "needs_gk_review" }),
        error: null,
      }),
    },
  });
  const result = await evaluateFinalExportEligibility(input(), deps);
  assert.equal(result.data.finalExportEligible, false);
  assert.ok(result.data.validatorResult.evidence.failed_gates.includes("generated_content_review_unresolved"));
});

test("other governed gates remain fail-closed even with effective export_authority_granted (current-use ineligible)", async () => {
  const { deps } = dependencies({
    audience: "internal",
    effective: true,
    overrides: {
      evaluatePacket: async () => ({
        ok: true,
        data: packet({ currentUseEligible: false }),
        error: null,
      }),
    },
  });
  const result = await evaluateFinalExportEligibility(input(), deps);
  assert.equal(result.data.finalExportEligible, false);
  assert.ok(result.data.validatorResult.evidence.failed_gates.includes("current_use_ineligible"));
});

test("a non-gk_admin actor cannot evaluate final export eligibility", async () => {
  const { deps } = dependencies({ audience: "internal", effective: true });
  const nonAdminActor = Object.freeze({
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000002",
    organizationMemberships: [
      { organization_id: ORG, membership_status: "active", role_name: "client_admin" },
    ],
  });
  const result = await evaluateFinalExportEligibility(input({ actorContext: nonAdminActor }), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("an assistant/system actor cannot grant or revoke final-release authority", async () => {
  const repository = { recordDecision: async () => { throw new Error("must not be called"); } };
  for (const decisionAction of ["grant", "revoke"]) {
    const result = await recordHumanFinalReleaseAuthorityDecision({
      organizationId: ORG,
      exportCandidateId: CANDIDATE,
      requestedAudience: "internal",
      decisionAction,
      actorContext: { actorType: "system", actorUserId: "assistant-1" },
      now: new Date().toISOString(),
    }, {
      env: enabledEnv,
      humanAuthorityDecisionRepository: repository,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "authorization_denied");
  }
});

test("an assistant/system actor cannot grant or revoke final-release authority via a cross-tenant human role either", async () => {
  const repository = { recordDecision: async () => { throw new Error("must not be called"); } };
  const wrongOrgActor = Object.freeze({
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000001",
    organizationMemberships: [
      { organization_id: OTHER_ORG, membership_status: "active", role_name: "gk_admin" },
    ],
  });
  const result = await recordHumanFinalReleaseAuthorityDecision({
    organizationId: ORG,
    exportCandidateId: CANDIDATE,
    requestedAudience: "internal",
    decisionAction: "grant",
    actorContext: wrongOrgActor,
    now: new Date().toISOString(),
  }, {
    env: enabledEnv,
    humanAuthorityDecisionRepository: repository,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("dormant P3-17 vocabulary shape is unchanged: exactly the four documented decision types, and only export_authority_granted is gk_admin-final-release-relevant here", () => {
  assert.deepEqual(
    [...HUMAN_AUTHORITY_DECISION_TYPES],
    ["client_reviewed", "funder_ready", "public_ready", "export_authority_granted"],
  );
  assert.equal(HUMAN_AUTHORITY_DECISION_ROLE_BY_TYPE.client_reviewed, "client_reviewer");
  assert.equal(HUMAN_AUTHORITY_DECISION_ROLE_BY_TYPE.export_authority_granted, "gk_admin");
  assert.deepEqual(HUMAN_AUTHORITY_DECISION_AUDIENCE_BY_TYPE, { funder_ready: "funder", public_ready: "public" });
});

test("the final-export eligibility gate's own contract never names client_reviewed/funder_ready/public_ready as a required decision type", () => {
  assert.equal(
    __finalExportEligibilityGateServiceContract.FINAL_RELEASE_AUTHORITY_DECISION_TYPE,
    "export_authority_granted",
  );
  assert.equal(Object.hasOwn(__finalExportEligibilityGateServiceContract, "client_reviewed"), false);
  assert.equal(Object.hasOwn(__finalExportEligibilityGateServiceContract, "funder_ready"), false);
  assert.equal(Object.hasOwn(__finalExportEligibilityGateServiceContract, "public_ready"), false);
});
