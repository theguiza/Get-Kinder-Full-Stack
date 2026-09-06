import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateFinalExportEligibility,
  __finalExportEligibilityGateServiceContract,
  __finalExportEligibilityGateServiceTestables,
} from "../Backend/kai/services/kaiFinalExportEligibilityGateService.js";

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

const actorContext = Object.freeze({
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
    actorContext,
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

function dependencies(overrides = {}) {
  const calls = { loadCandidate: 0, evaluatePacket: 0, evaluateEffectiveness: 0 };
  return {
    deps: {
      env: enabledEnv,
      runInTransaction: async (callback) => callback({ async query() { return { rows: [] }; } }),
      loadCandidate: async () => {
        calls.loadCandidate += 1;
        return candidateRow();
      },
      evaluatePacket: async () => {
        calls.evaluatePacket += 1;
        return { ok: true, data: packet(), error: null };
      },
      evaluator: async () => ({ ok: true, data: {}, error: null }),
      humanAuthorityDecisionRepository: {
        evaluateEffectiveness: async () => {
          calls.evaluateEffectiveness += 1;
          return { ok: true, data: { effective: false, reason: "no_decision", headDecisionId: null }, error: null };
        },
      },
      ...overrides,
    },
    calls,
  };
}

test("client-supplied finalGate/affirmativeHumanExportAuthority are rejected before authorization", () => {
  assert.equal(
    __finalExportEligibilityGateServiceTestables.isEvaluateFinalExportEligibilityInput(
      input({ finalGate: true }),
    ),
    false,
  );
  assert.equal(
    __finalExportEligibilityGateServiceTestables.isEvaluateFinalExportEligibilityInput(
      input({ affirmativeHumanExportAuthority: true }),
    ),
    false,
  );
});

test("FINAL A: no effective P3-17 authority -> BLOCKED", async () => {
  const { deps } = dependencies();
  const result = await evaluateFinalExportEligibility(input(), deps);
  assert.equal(result.ok, true);
  assert.equal(result.data.finalExportEligible, false);
  assert.equal(result.data.effectiveHumanExportAuthority, false);
  assert.equal(result.data.validatorResult.severity, "blocker");
  assert.ok(result.data.validatorResult.evidence.failed_gates.includes("affirmative_human_export_authority_absent"));
});

test("FINAL E: effective P3-17 authority and all other governed gates satisfied, source draft still 'draft' -> PASS", async () => {
  const { deps } = dependencies({
    humanAuthorityDecisionRepository: {
      evaluateEffectiveness: async () => ({
        ok: true,
        data: { effective: true, reason: null, headDecisionId: "decision-1" },
        error: null,
      }),
    },
  });
  const result = await evaluateFinalExportEligibility(input(), deps);
  assert.equal(result.ok, true);
  assert.equal(result.data.finalExportEligible, true);
  assert.equal(result.data.effectiveHumanExportAuthority, true);
  assert.equal(result.data.validatorResult.severity, "pass");
});

test("FINAL B: effective authority present but review still unresolved stays BLOCKED (validator gates not duplicated/bypassed)", async () => {
  const { deps } = dependencies({
    evaluatePacket: async () => ({ ok: true, data: packet({ exportReviewQueueStatus: "in_progress", exportReviewStatus: "needs_gk_review" }), error: null }),
    humanAuthorityDecisionRepository: {
      evaluateEffectiveness: async () => ({ ok: true, data: { effective: true, reason: null, headDecisionId: "decision-1" }, error: null }),
    },
  });
  const result = await evaluateFinalExportEligibility(input(), deps);
  assert.equal(result.data.finalExportEligible, false);
  assert.ok(result.data.validatorResult.evidence.failed_gates.includes("generated_content_review_unresolved"));
});

test("FINAL C: effective authority present but current-use ineligible stays BLOCKED", async () => {
  const { deps } = dependencies({
    evaluatePacket: async () => ({ ok: true, data: packet({ currentUseEligible: false }), error: null }),
    humanAuthorityDecisionRepository: {
      evaluateEffectiveness: async () => ({ ok: true, data: { effective: true, reason: null, headDecisionId: "decision-1" }, error: null }),
    },
  });
  const result = await evaluateFinalExportEligibility(input(), deps);
  assert.equal(result.data.finalExportEligible, false);
  assert.ok(result.data.validatorResult.evidence.failed_gates.includes("current_use_ineligible"));
});

test("export candidate not found -> not_found", async () => {
  const { deps } = dependencies({ loadCandidate: async () => null });
  const result = await evaluateFinalExportEligibility(input(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
});

test("export review packet conflict -> conflict_current_state_changed", async () => {
  const { deps } = dependencies({
    evaluatePacket: async () => ({ ok: false, data: null, error: { code: "conflict_current_state_changed" } }),
  });
  const result = await evaluateFinalExportEligibility(input(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
});

test("candidate audience diverges from export-review packet audience -> conflict_current_state_changed", async () => {
  const { deps } = dependencies({
    loadCandidate: async () => candidateRow({ requested_audience: "funder" }),
  });
  const result = await evaluateFinalExportEligibility(input(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
});

test("non gk_admin actor is denied before any evaluator runs", async () => {
  const { deps, calls } = dependencies();
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
  assert.equal(calls.loadCandidate, 0);
  assert.equal(calls.evaluateEffectiveness, 0);
});

test("feature disabled short-circuits", async () => {
  const { deps } = dependencies({ env: { ...enabledEnv, KAI_PUBLIC_EXPORT_ENABLED: "false" } });
  const result = await evaluateFinalExportEligibility(input(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "feature_disabled");
});

test("wrong-tenant actor is denied", async () => {
  const { deps } = dependencies();
  const wrongOrgActor = Object.freeze({
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000001",
    organizationMemberships: [
      { organization_id: OTHER_ORG, membership_status: "active", role_name: "gk_admin" },
    ],
  });
  const result = await evaluateFinalExportEligibility(input({ actorContext: wrongOrgActor }), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("decision type passed to effectiveness evaluator matches P3-17's export_authority_granted contract", () => {
  assert.equal(
    __finalExportEligibilityGateServiceContract.FINAL_RELEASE_AUTHORITY_DECISION_TYPE,
    "export_authority_granted",
  );
});
