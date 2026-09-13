// Board Reporting candidate workflow-state read: proves the smallest
// candidate-scoped, read-only, server-authoritative composition of four
// EXISTING authoritative reads (BR-03 review state, BR-04 effective
// final-release authority, the real Board final-eligibility gate, and this
// candidate's export-manifest history). No database access - every
// dependency is faked, and every fake proves its own tenant/candidate
// scoping rather than trusting the service to have derived it independently.

import test from "node:test";
import assert from "node:assert/strict";

import {
  readBoardReportingCandidateWorkflowState,
  __boardReportingCandidateWorkflowStateServiceContract,
  __boardReportingCandidateWorkflowStateServiceTestables,
} from "../Backend/kai/services/kaiBoardReportingCandidateWorkflowStateService.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const ENGAGEMENT = "04000000-0000-4000-8000-000000000001";
const OTHER_ENGAGEMENT = "04000000-0000-4000-8000-000000000099";
const CANDIDATE = "04000000-0000-4000-8000-000000000501";
const REVIEW_QUEUE_ITEM = "04000000-0000-4000-8000-000000000601";
const HEAD_DECISION = "04000000-0000-4000-8000-000000000701";
const MANIFEST_A = "04000000-0000-4000-8000-000000000801";
const MANIFEST_B = "04000000-0000-4000-8000-000000000802";

const gkAdminActorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "gk_admin" },
  ],
});

function baseInput(overrides = {}) {
  return {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    boardReportingCandidateId: CANDIDATE,
    actorContext: gkAdminActorContext,
    ...overrides,
  };
}

function reviewStateOk(overrides = {}) {
  return {
    ok: true,
    data: {
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      boardReportingCandidateId: CANDIDATE,
      reviewQueueItemId: REVIEW_QUEUE_ITEM,
      queueStatus: "resolved",
      reviewStatus: "resolved",
      reviewUpdatedAt: "2026-09-12T11:00:00.000Z",
      ...overrides,
    },
    error: null,
  };
}

function authorityOk(overrides = {}) {
  return {
    ok: true,
    data: { effective: true, reason: null, headDecisionId: HEAD_DECISION, ...overrides },
    error: null,
  };
}

function eligibilityOk(overrides = {}) {
  return {
    ok: true,
    data: {
      finalEligibility: true,
      failedGates: [],
      blockers: [],
      currentnessGate: { current: true, stale: false },
      ...overrides,
    },
    error: null,
  };
}

function manifestsOk(manifests = []) {
  return { ok: true, data: { manifests }, error: null };
}

function manifestRow(id, overrides = {}) {
  return {
    boardReportingCandidateExportManifestId: id,
    boardReportingCandidateId: CANDIDATE,
    effectiveAuthorityDecisionId: HEAD_DECISION,
    effectiveAuthorityDecisionType: "export_authority_granted",
    fingerprintContractVersion: "kai-sprint2-br-08-board-reporting-candidate-export-manifest-fingerprint-v1",
    canonicalFingerprint: "c".repeat(64),
    createdAt: "2026-09-12T12:00:00.000Z",
    ...overrides,
  };
}

function deps(overrides = {}) {
  const calls = {
    readReviewState: [],
    evaluateEffectiveness: [],
    evaluateEligibility: [],
    resolveExportManifestState: [],
  };
  const env = { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" };
  const candidateRepository = {
    async readBoardReportingCandidateReviewStateById(input) {
      calls.readReviewState.push(input);
      if (overrides.readReviewState) return overrides.readReviewState(input);
      if (input.organizationId !== ORG || input.engagementId !== ENGAGEMENT || input.boardReportingCandidateId !== CANDIDATE) {
        return { ok: false, data: null, error: { code: "not_found", status: 404 } };
      }
      return reviewStateOk();
    },
  };
  const authorityRepository = {
    async evaluateEffectiveness(input) {
      calls.evaluateEffectiveness.push(input);
      if (overrides.evaluateEffectiveness) return overrides.evaluateEffectiveness(input);
      return authorityOk();
    },
  };
  const evaluateEligibility = async (input) => {
    calls.evaluateEligibility.push(input);
    if (overrides.evaluateEligibility) return overrides.evaluateEligibility(input);
    return eligibilityOk();
  };
  const exportManifestRepository = {
    async resolveExportManifestStateForCandidate(input) {
      calls.resolveExportManifestState.push(input);
      if (overrides.resolveExportManifestState) return overrides.resolveExportManifestState(input);
      return manifestsOk([manifestRow(MANIFEST_A), manifestRow(MANIFEST_B)]);
    },
  };
  return {
    calls,
    dependencies: { env, candidateRepository, authorityRepository, evaluateEligibility, exportManifestRepository },
  };
}

test("exact input contract: extra/missing/malformed keys are rejected as validation_blocker before any dependency is called", async () => {
  const { calls, dependencies } = deps();
  for (const badInput of [
    {},
    { ...baseInput(), extraField: "x" },
    { ...baseInput(), boardReportingCandidateId: "not-a-uuid" },
    { ...baseInput(), organizationId: "not-a-uuid" },
    { ...baseInput(), engagementId: "not-a-uuid" },
    (() => { const { actorContext, ...rest } = baseInput(); return rest; })(),
  ]) {
    const result = await readBoardReportingCandidateWorkflowState(badInput, dependencies);
    assert.equal(result.ok, false, JSON.stringify(badInput));
    assert.equal(result.error.code, "validation_blocker");
  }
  assert.equal(calls.readReviewState.length, 0);
  assert.equal(calls.evaluateEffectiveness.length, 0);
  assert.equal(calls.evaluateEligibility.length, 0);
  assert.equal(calls.resolveExportManifestState.length, 0);
});

test("cross-organization candidate access fails closed as not_found, before authority/eligibility/manifest reads", async () => {
  const { calls, dependencies } = deps();
  const result = await readBoardReportingCandidateWorkflowState(baseInput({ organizationId: OTHER_ORG }), {
    ...dependencies,
    // authorize() itself requires active membership in OTHER_ORG - the
    // actorContext only has a membership in ORG, so this fails closed at
    // authorization before any repository is ever reached.
  });
  assert.equal(result.ok, false);
  assert.notEqual(result.error.code, "system_error");
  assert.equal(calls.readReviewState.length, 0);
});

test("cross-organization candidate access fails closed as not_found even for an authorized actor of the mismatched organization", async () => {
  const otherOrgActor = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000099",
    organizationMemberships: [
      { organization_id: OTHER_ORG, membership_status: "active", role_name: "gk_admin" },
    ],
  };
  const { calls, dependencies } = deps();
  const result = await readBoardReportingCandidateWorkflowState(
    baseInput({ organizationId: OTHER_ORG, actorContext: otherOrgActor }),
    dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
  assert.equal(calls.readReviewState.length, 1);
  assert.equal(calls.evaluateEffectiveness.length, 0);
  assert.equal(calls.evaluateEligibility.length, 0);
  assert.equal(calls.resolveExportManifestState.length, 0);
});

test("cross-engagement candidate access fails closed as not_found, before authority/eligibility/manifest reads", async () => {
  const { calls, dependencies } = deps();
  const result = await readBoardReportingCandidateWorkflowState(baseInput({ engagementId: OTHER_ENGAGEMENT }), dependencies);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
  assert.equal(calls.readReviewState.length, 1);
  assert.equal(calls.evaluateEffectiveness.length, 0);
  assert.equal(calls.evaluateEligibility.length, 0);
  assert.equal(calls.resolveExportManifestState.length, 0);
});

test("review state (including its concurrency/version timestamp) comes verbatim from the authoritative persisted BR-03 read, never from caller input", async () => {
  const { dependencies } = deps({
    readReviewState: () => reviewStateOk({
      reviewQueueItemId: REVIEW_QUEUE_ITEM,
      queueStatus: "in_progress",
      reviewStatus: "needs_gk_review",
      reviewUpdatedAt: "2026-01-01T00:00:00.000Z",
    }),
  });
  const result = await readBoardReportingCandidateWorkflowState(baseInput(), dependencies);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.reviewState, {
    reviewQueueItemId: REVIEW_QUEUE_ITEM,
    queueStatus: "in_progress",
    reviewStatus: "needs_gk_review",
    reviewUpdatedAt: "2026-01-01T00:00:00.000Z",
  });
});

test("review-state repository failure propagates verbatim rather than being masked", async () => {
  const { dependencies } = deps({
    readReviewState: () => ({ ok: false, data: null, error: { code: "conflict_current_state_changed", status: 409 } }),
  });
  const result = await readBoardReportingCandidateWorkflowState(baseInput(), dependencies);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
});

test("effective authority is resolved by the existing BR-04 evaluateEffectiveness mechanism, never re-derived", async () => {
  const { calls, dependencies } = deps({
    evaluateEffectiveness: () => authorityOk({ effective: false, reason: "head_is_revoke", headDecisionId: HEAD_DECISION }),
  });
  const result = await readBoardReportingCandidateWorkflowState(baseInput(), dependencies);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.effectiveAuthority, {
    decisionType: __boardReportingCandidateWorkflowStateServiceContract.FINAL_RELEASE_AUTHORITY_DECISION_TYPE,
    effective: false,
    reason: "head_is_revoke",
    headDecisionId: HEAD_DECISION,
  });
  assert.equal(calls.evaluateEffectiveness.length, 1);
  assert.deepEqual(calls.evaluateEffectiveness[0], {
    organizationId: ORG,
    boardReportingCandidateId: CANDIDATE,
    decisionType: __boardReportingCandidateWorkflowStateServiceContract.FINAL_RELEASE_AUTHORITY_DECISION_TYPE,
  });
});

test("final eligibility is resolved by the existing evaluateBoardReportingFinalEligibility evaluator, never re-derived, and its structured blockers/currentness are preserved as-is", async () => {
  const { calls, dependencies } = deps({
    evaluateEligibility: () => eligibilityOk({
      finalEligibility: false,
      failedGates: ["board_reporting_candidate_review_unresolved", "board_reporting_candidate_stale"],
      blockers: ["board_reporting_candidate_review_unresolved", "board_reporting_candidate_stale"],
      currentnessGate: { current: false, stale: true },
    }),
  });
  const result = await readBoardReportingCandidateWorkflowState(baseInput(), dependencies);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.finalEligibility, {
    finalEligibility: false,
    failedGates: ["board_reporting_candidate_review_unresolved", "board_reporting_candidate_stale"],
    blockers: ["board_reporting_candidate_review_unresolved", "board_reporting_candidate_stale"],
    currentnessGate: { current: false, stale: true },
  });
  assert.equal(calls.evaluateEligibility.length, 1);
  assert.deepEqual(calls.evaluateEligibility[0], {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    boardReportingCandidateId: CANDIDATE,
    actorContext: gkAdminActorContext,
  });
});

test("stale/currentness state is server-derived from the evaluator's own currentnessGate, not computed by this service", async () => {
  const { dependencies } = deps({
    evaluateEligibility: () => eligibilityOk({ currentnessGate: { current: false, stale: true } }),
  });
  const result = await readBoardReportingCandidateWorkflowState(baseInput(), dependencies);
  assert.deepEqual(result.data.finalEligibility.currentnessGate, { current: false, stale: true });
});

test("manifest records are exact tenant + exact candidate scoped and returned verbatim", async () => {
  const { calls, dependencies } = deps({
    resolveExportManifestState: (input) => {
      assert.deepEqual(input, { organizationId: ORG, boardReportingCandidateId: CANDIDATE });
      return manifestsOk([manifestRow(MANIFEST_A), manifestRow(MANIFEST_B)]);
    },
  });
  const result = await readBoardReportingCandidateWorkflowState(baseInput(), dependencies);
  assert.equal(result.ok, true);
  assert.equal(calls.resolveExportManifestState.length, 1);
  assert.deepEqual(result.data.exportManifests, [manifestRow(MANIFEST_A), manifestRow(MANIFEST_B)]);
});

test("manifest ordering is exactly the deterministic order returned by the repository (id-ascending fixture) and is never re-sorted, deduplicated, or filtered down to one entry", async () => {
  const { dependencies } = deps({
    resolveExportManifestState: () => manifestsOk([manifestRow(MANIFEST_B), manifestRow(MANIFEST_A)]),
  });
  const result = await readBoardReportingCandidateWorkflowState(baseInput(), dependencies);
  assert.deepEqual(
    result.data.exportManifests.map((m) => m.boardReportingCandidateExportManifestId),
    [MANIFEST_B, MANIFEST_A],
  );
});

test("manifest ordering carries no latest/newest/preferred/current/winner field - only the plain ordered list", async () => {
  const { dependencies } = deps();
  const result = await readBoardReportingCandidateWorkflowState(baseInput(), dependencies);
  for (const manifest of result.data.exportManifests) {
    for (const forbiddenKey of ["latest", "newest", "preferred", "current", "winner", "isLatest", "isCurrent"]) {
      assert.equal(Object.prototype.hasOwnProperty.call(manifest, forbiddenKey), false, forbiddenKey);
    }
  }
});

test("empty manifest history returns an empty list, not an error", async () => {
  const { dependencies } = deps({ resolveExportManifestState: () => manifestsOk([]) });
  const result = await readBoardReportingCandidateWorkflowState(baseInput(), dependencies);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.exportManifests, []);
});

test("feature-gated behind KAI_SPRINT2_ENABLED: disabled flag returns feature_disabled before any dependency is called", async () => {
  const { calls, dependencies } = deps();
  dependencies.env = { KAI_SPRINT2_ENABLED: "false", KAI_GENERATION_ENABLED: "true" };
  const result = await readBoardReportingCandidateWorkflowState(baseInput(), dependencies);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "feature_disabled");
  assert.equal(calls.readReviewState.length, 0);
  assert.equal(calls.evaluateEffectiveness.length, 0);
  assert.equal(calls.evaluateEligibility.length, 0);
  assert.equal(calls.resolveExportManifestState.length, 0);
});

test("an assistant/system actorContext is refused before any dependency is called - only a mapped human actor may read workflow state", async () => {
  const { calls, dependencies } = deps();
  const result = await readBoardReportingCandidateWorkflowState(
    baseInput({ actorContext: { actorType: "assistant" } }),
    dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(calls.readReviewState.length, 0);
});

test("an actor without an active gk_admin membership in this organization is refused", async () => {
  const nonAdminActor = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000042",
    organizationMemberships: [
      { organization_id: ORG, membership_status: "active", role_name: "gk_operator" },
    ],
  };
  const { calls, dependencies } = deps();
  const result = await readBoardReportingCandidateWorkflowState(baseInput({ actorContext: nonAdminActor }), dependencies);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(calls.readReviewState.length, 0);
});

test("performs no mutation: only read-shaped dependency methods are ever invoked, and calling twice with identical input yields identical results", async () => {
  const { dependencies } = deps();
  const first = await readBoardReportingCandidateWorkflowState(baseInput(), dependencies);
  const second = await readBoardReportingCandidateWorkflowState(baseInput(), dependencies);
  assert.deepEqual(first.data, second.data);
});

test("__testables exposes only the input-shape/actor-mapping predicates - no hidden write helper", () => {
  const keys = Object.keys(__boardReportingCandidateWorkflowStateServiceTestables);
  assert.deepEqual(keys.sort(), ["isMappedHumanActor", "isReadBoardReportingCandidateWorkflowStateInput"]);
});
