import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  proposeClaimAfterEvidenceReviewDecision,
  recordEvidenceReviewDecisionWithClaimProposalHandoff,
  __evidenceReviewClaimProposalHandoffContract,
} from "../Backend/kai/services/kaiEvidenceReviewClaimProposalHandoffService.js";
import { assessEvidenceCoverageForSourceVersion } from "../Backend/kai/services/kaiEvidenceCoverageAssessmentService.js";
import { proposeClaim } from "../Backend/kai/services/kaiClaimProposalService.js";
import { claimProposalHandoffOutcome } from "../frontend/impactEvidenceLibraryLogic.js";
import { assessEvidenceCoverageFromEvidenceReviewDecision } from "../Backend/kai/services/kaiEvidenceCoverageAssessmentService.js";
import { proposeClaimFromEvidenceReviewDecision } from "../Backend/kai/services/kaiClaimProposalService.js";
import { validateEvidenceReviewDecisionContinuation } from "../Backend/kai/validators/kaiEvidenceReviewContinuationValidators.js";
import { createProductionMetadataOnlyAuditForClaimProposal } from "../Backend/kai/services/kaiMetadataOnlyAuditComposition.js";

/**
 * KAI P2-12 -> P2-02 -> P2-03 handoff boundary: after a committed POSITIVE
 * P2-12 evidence-review decision (and only then), the route's composing service
 * runs the existing read-only P2-02 assessment for the evidence item's own
 * source_version, and only if P2-02 passes calls the existing P2-03 proposal
 * once, as the same human actor. Every collaborator is an injected double; no
 * database.
 */

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const EVIDENCE = "c0000000-0000-4000-8000-000000000001";
const EVIDENCE_QUEUE = "d0000000-0000-4000-8000-000000000001";
const SOURCE_VERSION = "b0000000-0000-4000-8000-000000000001";
const CLAIM = "e0000000-0000-4000-8000-000000000001";
const CLAIM_QUEUE = "f0000000-0000-4000-8000-000000000001";
const LINK = "f1000000-0000-4000-8000-000000000001";
const DECISION = "f2000000-0000-4000-8000-000000000001";
const REVIEWER = "90000000-0000-4000-8000-000000000001";
const NOW = "2026-09-26T12:00:00.000Z";
const TOKEN = "2026-09-26T11:59:00.000Z";
const ENV = { KAI_SPRINT2_ENABLED: "true" };
const STATEMENT_SENTINEL = "claim-statement-sentinel";

function gkActor(role = "gk_reviewer", organizationId = ORG, overrides = {}) {
  return {
    actorType: "human",
    actorUserId: REVIEWER,
    kaiRoles: role.startsWith("gk_") ? [role] : [],
    organizationMemberships: [{ organization_id: organizationId, membership_status: "active", role_name: role }],
    ...overrides,
  };
}
const reviewer = Object.freeze(gkActor());

const OUTCOME_STRENGTH = {
  supported: "reviewed_supported",
  supported_with_limitation: "reviewed_supported",
  not_supported: "reviewed_not_supported",
  needs_more_information: "unassessed",
};

function evidenceDecision(outcome, overrides = {}) {
  const terminal = outcome !== "needs_more_information";
  return {
    evidence_item_id: EVIDENCE,
    review_queue_item_id: EVIDENCE_QUEUE,
    queue_status: terminal ? "resolved" : "in_progress",
    review_status: terminal ? "resolved" : "needs_gk_review",
    evidence_review_status: terminal ? "reviewed" : "needs_gk_review",
    support_strength: OUTCOME_STRENGTH[outcome],
    decision_id: DECISION,
    decision_outcome: outcome,
    replayed: false,
    ...overrides,
  };
}

function evidenceRow(overrides = {}) {
  return {
    evidence_item_id: EVIDENCE,
    organization_id: ORG,
    source_version_id: SOURCE_VERSION,
    support_strength: "reviewed_supported",
    statement: STATEMENT_SENTINEL,
    ...overrides,
  };
}

function dimension(status) {
  return { severity: status === "resolved_risk_flagged" ? "warning" : "pass", evidence: { assessment_status: status } };
}

function assessmentResult(overrides = {}) {
  const keys = __evidenceReviewClaimProposalHandoffContract.COVERAGE_DIMENSION_KEYS;
  const dimensions = Object.fromEntries(keys.map((key) => [key, dimension("unresolved")]));
  dimensions.definition_clarity = dimension("resolved_risk_flagged");
  dimensions.coverage_gaps = dimension("resolved_clear");
  return {
    ok: true,
    data: { organization_id: ORG, source_version_id: SOURCE_VERSION, dimensions, ...overrides },
    error: null,
  };
}

function proposalResult({ replayed = false, claim = {}, link = {}, queue = {} } = {}) {
  return {
    ok: true,
    data: {
      claim: {
        claim_id: CLAIM,
        organization_id: ORG,
        evidence_item_id: EVIDENCE,
        claim_type: "finding",
        claim_status: "proposed",
        claim_review_status: "needs_gk_review",
        claim_strength: "unassessed",
        statement: STATEMENT_SENTINEL,
        internal_only: true,
        public_use_allowed: false,
        funder_use_allowed: false,
        llm_processing_allowed: false,
        product_learning_allowed: false,
        export_ready: false,
        ...claim,
      },
      claimEvidenceLink: { claim_evidence_link_id: LINK, organization_id: ORG, claim_id: CLAIM, evidence_item_id: EVIDENCE, ...link },
      reviewQueueItem: {
        review_queue_item_id: CLAIM_QUEUE,
        organization_id: ORG,
        queue_type: "claim_review",
        target_object_type: "claim",
        target_object_id: CLAIM,
        queue_status: "open",
        review_status: "needs_gk_review",
        ...queue,
      },
      warnings: [],
      replayed,
    },
    error: null,
  };
}

function harness({ reread = evidenceRow(), assessment = assessmentResult(), proposal = proposalResult() } = {}) {
  const calls = [];
  const audit = { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } };
  return {
    calls,
    audit,
    deps: {
      env: ENV,
      claimProposalMetadataOnlyAudit: audit,
      async getScopedEvidenceItemById(input) {
        calls.push(["reread", input]);
        if (reread instanceof Error) throw reread;
        return reread;
      },
      async assessEvidenceCoverageFromEvidenceReviewDecision(input, deps) {
        calls.push(["assess", input, deps]);
        if (assessment instanceof Error) throw assessment;
        return assessment;
      },
      async proposeClaimFromEvidenceReviewDecision(input, deps) {
        calls.push(["propose", input, deps]);
        if (proposal instanceof Error) throw proposal;
        return proposal;
      },
    },
  };
}

// The persisted rows the decision-bound entries read for themselves.
function persistedContinuationRows({ decision = {}, evidence = {}, queue = {} } = {}) {
  return {
    decisionRow: {
      decision_id: DECISION,
      organization_id: ORG,
      evidence_item_id: EVIDENCE,
      review_queue_item_id: EVIDENCE_QUEUE,
      decision_outcome: "supported",
      decided_by: REVIEWER,
      decided_by_role: "gk_reviewer",
      ...decision,
    },
    evidenceItemRow: {
      ...evidenceRow(),
      evidence_review_status: "reviewed",
      ...evidence,
    },
    evidenceReviewQueueItemRow: {
      review_queue_item_id: EVIDENCE_QUEUE,
      organization_id: ORG,
      queue_type: "evidence_review",
      target_object_type: "evidence_item",
      target_object_id: EVIDENCE,
      queue_status: "resolved",
      review_status: "resolved",
      ...queue,
    },
  };
}

function handoffInput(decision, actorContext = reviewer) {
  return { organizationId: ORG, evidenceItemId: EVIDENCE, evidenceReviewDecision: decision, actorContext, now: NOW };
}

test("A: a positive decision continues through the decision-bound P2-02 assessment for the evidence item first, then the decision-bound P2-03 proposal exactly once as the same human actor", async () => {
  for (const outcome of ["supported", "supported_with_limitation"]) {
    const { calls, deps, audit } = harness();
    const result = await proposeClaimAfterEvidenceReviewDecision(handoffInput(evidenceDecision(outcome)), deps);
    assert.deepEqual(calls.map(([name]) => name), ["reread", "assess", "propose"], outcome);
    assert.deepEqual(calls[0][1], { organizationId: ORG, evidenceItemId: EVIDENCE });
    // No decision object, id, or marker crosses into P2-02 or P2-03: each
    // re-reads the persisted decision itself.
    assert.deepEqual(calls[1][1], { organizationId: ORG, evidenceItemId: EVIDENCE, actorContext: reviewer });
    assert.equal(calls[1][2].env, ENV);
    assert.deepEqual(calls[2][1], { organizationId: ORG, evidenceItemId: EVIDENCE, actorContext: reviewer, now: NOW });
    assert.equal(calls[2][2].env, ENV);
    assert.equal(calls[2][2].metadataOnlyAudit, audit);
    assert.deepEqual(result, {
      status: "created",
      coverage_assessment: { status: "assessed", unresolved_dimension_count: 8, risk_flagged_dimension_count: 1, error_code: null },
      claim_id: CLAIM,
      claim_review_status: "needs_gk_review",
      claim_review_queue_item_id: CLAIM_QUEUE,
      error_code: null,
      blocking_reason: null,
    });
    assert.equal(JSON.stringify(result).includes(STATEMENT_SENTINEL), false, "no claim or evidence statement is reported");
  }
});

test("A: the default runtime path composes the production claim-proposal audit adapter the P2-03 route composes", async () => {
  const { calls, deps } = harness();
  delete deps.claimProposalMetadataOnlyAudit;
  await proposeClaimAfterEvidenceReviewDecision(handoffInput(evidenceDecision("supported")), deps);
  const audit = calls.find(([name]) => name === "propose")[2].metadataOnlyAudit;
  assert.equal(typeof audit.prepareMetadataOnlyAudit, "function");
  // Same contract as createProductionMetadataOnlyAuditForClaimProposal: a
  // payload without a claim_id is refused rather than substituted.
  assert.equal(audit.prepareMetadataOnlyAudit({ payload: {}, db: {} }).ok, false);
});

test("B: not_supported and needs_more_information never reach P2-02 or P2-03", async () => {
  for (const outcome of ["not_supported", "needs_more_information"]) {
    const { calls, deps } = harness();
    const result = await proposeClaimAfterEvidenceReviewDecision(handoffInput(evidenceDecision(outcome)), deps);
    assert.equal(calls.length, 0, outcome);
    assert.equal(result.status, "not_applicable");
    assert.equal(result.claim_id, null);
  }
});

test("B: a decision that is not a committed positive review (strength, queue state, or item mismatch) never reaches P2-02 or P2-03", async () => {
  for (const overrides of [
    { support_strength: "unassessed" },
    { support_strength: "reviewed_not_supported" },
    { queue_status: "in_progress" },
    { review_status: "needs_gk_review" },
    { evidence_item_id: "c0000000-0000-4000-8000-000000000009" },
    { decision_outcome: "approved" },
  ]) {
    const { calls, deps } = harness();
    const result = await proposeClaimAfterEvidenceReviewDecision(handoffInput(evidenceDecision("supported", overrides)), deps);
    assert.equal(calls.length, 0, JSON.stringify(overrides));
    assert.equal(result.status, "not_applicable");
  }
  for (const decision of [null, undefined, [], "supported"]) {
    const { calls, deps } = harness();
    assert.equal((await proposeClaimAfterEvidenceReviewDecision(handoffInput(decision), deps)).status, "not_applicable");
    assert.equal(calls.length, 0);
  }
});

test("C: the fresh evidence re-read must still be this organization's reviewed_supported item before P2-02 runs", async () => {
  for (const [reread, errorCode] of [
    [null, "not_found"],
    [evidenceRow({ organization_id: OTHER_ORG }), "not_found"],
    [evidenceRow({ evidence_item_id: "c0000000-0000-4000-8000-000000000009" }), "not_found"],
    [evidenceRow({ source_version_id: "not-a-uuid" }), "not_found"],
    [evidenceRow({ support_strength: "reviewed_not_supported" }), "conflict_current_state_changed"],
    [evidenceRow({ support_strength: "unassessed" }), "conflict_current_state_changed"],
    [new Error("db down"), "system_error"],
  ]) {
    const { calls, deps } = harness({ reread });
    const result = await proposeClaimAfterEvidenceReviewDecision(handoffInput(evidenceDecision("supported")), deps);
    assert.deepEqual(calls.map(([name]) => name), ["reread"]);
    assert.equal(result.status, "not_created");
    assert.equal(result.error_code, errorCode);
  }
});

test("D: a P2-02 refusal, throw, or incomplete assessment blocks the proposal - P2-03 is never called", async () => {
  for (const [assessment, errorCode] of [
    [{ ok: false, error: { code: "validation_blocker", status: 422 } }, "validation_blocker"],
    [{ ok: false, error: { code: "tenant_boundary_violation", status: 403 } }, "tenant_boundary_violation"],
    [{ ok: false, error: { code: "conflict_current_state_changed", status: 409 } }, "conflict_current_state_changed"],
    [{ ok: false, error: { code: "Raw Message With Spaces" } }, "system_error"],
    [assessmentResult({ source_version_id: "b0000000-0000-4000-8000-000000000009" }), "system_error"],
    [assessmentResult({ organization_id: OTHER_ORG }), "system_error"],
    [assessmentResult({ dimensions: { missingness: dimension("unresolved") } }), "system_error"],
    [new Error("boom"), "system_error"],
  ]) {
    const { calls, deps } = harness({ assessment });
    const result = await proposeClaimAfterEvidenceReviewDecision(handoffInput(evidenceDecision("supported")), deps);
    assert.deepEqual(calls.map(([name]) => name).filter((name) => name === "propose"), [], JSON.stringify(assessment));
    assert.equal(result.status, "not_created");
    assert.equal(result.error_code, errorCode);
    assert.equal(result.claim_id, null);
    if (!(assessment instanceof Error)) assert.equal(result.coverage_assessment.status, "blocked");
  }
});

test("E: a P2-03 refusal, throw, or any result that is not a review-gated internal-only proposal is not_created with a sanitized code", async () => {
  for (const [proposal, errorCode] of [
    [{ ok: false, error: { code: "not_found", status: 404 } }, "not_found"],
    [{ ok: false, error: { code: "conflict_current_state_changed", status: 409 } }, "conflict_current_state_changed"],
    [{ ok: false, error: { code: "authorization_denied", status: 403 } }, "authorization_denied"],
    [{ ok: false, error: { code: "<script>" } }, "system_error"],
    [new Error("boom"), "system_error"],
    [proposalResult({ claim: { claim_review_status: "approved_internal" } }), "system_error"],
    [proposalResult({ claim: { claim_strength: "reviewed_supported" } }), "system_error"],
    [proposalResult({ claim: { public_use_allowed: true } }), "system_error"],
    [proposalResult({ claim: { funder_use_allowed: true } }), "system_error"],
    [proposalResult({ claim: { export_ready: true } }), "system_error"],
    [proposalResult({ claim: { internal_only: false } }), "system_error"],
    [proposalResult({ claim: { organization_id: OTHER_ORG } }), "system_error"],
    [proposalResult({ claim: { evidence_item_id: "c0000000-0000-4000-8000-000000000009" } }), "system_error"],
    [proposalResult({ link: { evidence_item_id: "c0000000-0000-4000-8000-000000000009" } }), "system_error"],
    [proposalResult({ queue: { queue_type: "evidence_review" } }), "system_error"],
    [proposalResult({ queue: { target_object_id: "e0000000-0000-4000-8000-000000000009" } }), "system_error"],
  ]) {
    const { deps } = harness({ proposal });
    const result = await proposeClaimAfterEvidenceReviewDecision(handoffInput(evidenceDecision("supported")), deps);
    assert.equal(result.status, "not_created", JSON.stringify(proposal));
    assert.equal(result.error_code, errorCode);
    assert.equal(result.claim_id, null);
  }
});

test("F: an identical replay reports the P2-03 replay and creates nothing new", async () => {
  const { calls, deps } = harness({ proposal: proposalResult({ replayed: true }) });
  const result = await proposeClaimAfterEvidenceReviewDecision(
    handoffInput(evidenceDecision("supported", { replayed: true })),
    deps,
  );
  assert.equal(calls.filter(([name]) => name === "propose").length, 1);
  assert.equal(result.status, "replayed");
  assert.equal(result.claim_id, CLAIM);
});

test("G: the composing route service returns a refused or failed P2-12 result unchanged and never starts the handoff", async () => {
  for (const refusal of [
    { ok: false, data: null, error: { code: "authorization_denied", status: 403 } },
    { ok: false, data: null, error: { code: "conflict_current_state_changed", status: 409 } },
    { ok: false, data: null, error: { code: "validation_blocker", status: 422 } },
  ]) {
    const { calls, deps } = harness();
    const result = await recordEvidenceReviewDecisionWithClaimProposalHandoff(
      { organizationId: ORG, evidenceItemId: EVIDENCE, actorContext: reviewer, now: NOW },
      { ...deps, async recordEvidenceReviewDecision() { return refusal; } },
    );
    assert.equal(result, refusal);
    assert.equal(calls.length, 0);
  }
});

test("G: the composing route service passes the P2-12 input and audit through unchanged and appends the handoff to the P2-12 result", async () => {
  const { calls, deps } = harness();
  const reviewAudit = { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } };
  const input = {
    organizationId: ORG, evidenceItemId: EVIDENCE, reviewQueueItemId: EVIDENCE_QUEUE, expectedUpdatedAt: TOKEN,
    decision: "supported", limitationNotes: undefined, actorContext: reviewer, now: NOW,
  };
  let seen = null;
  const result = await recordEvidenceReviewDecisionWithClaimProposalHandoff(input, {
    ...deps,
    metadataOnlyAudit: reviewAudit,
    async recordEvidenceReviewDecision(receivedInput, receivedDeps) {
      seen = { receivedInput, receivedDeps };
      return { ok: true, data: evidenceDecision("supported"), error: null };
    },
  });
  assert.equal(seen.receivedInput, input);
  assert.equal(seen.receivedDeps.metadataOnlyAudit, reviewAudit);
  assert.equal(seen.receivedDeps.env, ENV);
  assert.equal(result.ok, true);
  assert.equal(result.data.decision_outcome, "supported");
  assert.equal(result.data.claim_proposal_handoff.status, "created");
  assert.deepEqual(calls.map(([name]) => name), ["reread", "assess", "propose"]);
});

test("H: real P2-12, P2-02, and P2-03 services - only gk_reviewer/gk_admin reach the handoff; operator, client, system, AI, assistant, inactive, and cross-organization actors are refused before any repository call", async () => {
  const mustNotRun = (name) => ({ async [name]() { throw new Error(`${name} must not be called`); } });
  const refused = [
    gkActor("gk_operator"),
    gkActor("client_admin"),
    gkActor("gk_reviewer", ORG, { actorType: "system" }),
    gkActor("gk_reviewer", ORG, { actorType: "ai" }),
    gkActor("gk_reviewer", ORG, { actorType: "assistant" }),
    gkActor("gk_reviewer", OTHER_ORG),
    { ...gkActor("gk_reviewer"), organizationMemberships: [{ organization_id: ORG, membership_status: "inactive", role_name: "gk_reviewer" }] },
  ];
  for (const actorContext of refused) {
    const { calls, deps } = harness();
    delete deps.assessEvidenceCoverageFromEvidenceReviewDecision;
    delete deps.proposeClaimFromEvidenceReviewDecision;
    const result = await recordEvidenceReviewDecisionWithClaimProposalHandoff(
      {
        organizationId: ORG, evidenceItemId: EVIDENCE, reviewQueueItemId: EVIDENCE_QUEUE, expectedUpdatedAt: TOKEN,
        decision: "supported", actorContext, now: NOW,
      },
      {
        ...deps,
        humanReviewRepository: mustNotRun("recordEvidenceReviewDecision"),
        evidenceCoverageAssessmentRepository: mustNotRun("readEvidenceReviewContinuationFacts"),
        claimProposalRepository: mustNotRun("proposeClaimFromEvidenceReviewDecision"),
        metadataOnlyAudit: harness().audit,
      },
    );
    assert.equal(result.ok, false, JSON.stringify(actorContext));
    assert.equal(calls.length, 0);
  }

  // A gk_reviewer passes P2-12 and then the real P2-02 and P2-03 checks.
  const { deps } = harness();
  delete deps.assessEvidenceCoverageFromEvidenceReviewDecision;
  delete deps.proposeClaimFromEvidenceReviewDecision;
  const repositoryCalls = [];
  const result = await recordEvidenceReviewDecisionWithClaimProposalHandoff(
    {
      organizationId: ORG, evidenceItemId: EVIDENCE, reviewQueueItemId: EVIDENCE_QUEUE, expectedUpdatedAt: TOKEN,
      decision: "supported", actorContext: reviewer, now: NOW,
    },
    {
      ...deps,
      metadataOnlyAudit: harness().audit,
      humanReviewRepository: {
        async recordEvidenceReviewDecision(input) {
          repositoryCalls.push(["p2-12", input.actorUserId, input.actorRole]);
          return { ok: true, data: evidenceDecision("supported"), error: null };
        },
      },
      evidenceCoverageAssessmentRepository: {
        async readEvidenceReviewContinuationFacts(input) {
          repositoryCalls.push(["p2-12-decision", input.evidenceItemId]);
          return { ok: true, data: { rows: persistedContinuationRows() }, error: null };
        },
        async readEvidenceCoverageAssessmentFacts(input) {
          repositoryCalls.push(["p2-02", input.sourceVersionId]);
          return { ok: false, error: { code: "not_found", status: 404 } };
        },
      },
      claimProposalRepository: mustNotRun("proposeClaimFromEvidenceReviewDecision"),
    },
  );
  assert.deepEqual(repositoryCalls, [["p2-12", REVIEWER, "gk_reviewer"], ["p2-12-decision", EVIDENCE], ["p2-02", SOURCE_VERSION]]);
  assert.equal(result.data.claim_proposal_handoff.status, "not_created");
  assert.equal(result.data.claim_proposal_handoff.error_code, "not_found");
});

test("H: the real P2-02 and P2-03 services refuse every non-human actor, so the handoff can never propose as a system or assistant actor", async () => {
  for (const actorType of ["system", "ai", "assistant", "import", "code"]) {
    const actorContext = gkActor("gk_reviewer", ORG, { actorType });
    const assessed = await assessEvidenceCoverageForSourceVersion(
      { organizationId: ORG, sourceVersionId: SOURCE_VERSION, actorContext },
      { env: ENV, evidenceCoverageAssessmentRepository: { async readEvidenceCoverageAssessmentFacts() { throw new Error("unreachable"); } } },
    );
    assert.equal(assessed.error.code, "authorization_denied");
    const proposed = await proposeClaim(
      { organizationId: ORG, evidenceItemId: EVIDENCE, actorContext, now: NOW },
      { env: ENV, claimProposalRepository: { async proposeClaim() { throw new Error("unreachable"); } } },
    );
    assert.equal(proposed.error.code, "authorization_denied");
  }
});

// J3-3 / Decision C Option A: a global gk_reviewer whose only membership in
// the organization is client_admin.
const mixedActor = Object.freeze({ ...gkActor("client_admin"), kaiRoles: ["gk_reviewer"] });

test("K: the continuation validator accepts only this actor's current positive decision on this evidence item's resolved review", () => {
  const base = { organizationId: ORG, evidenceItemId: EVIDENCE, actorUserId: REVIEWER };
  const accepted = validateEvidenceReviewDecisionContinuation({ ...base, ...persistedContinuationRows() });
  assert.deepEqual(accepted, { ok: true, decision: { decision_id: DECISION, decided_by_role: "gk_reviewer", decision_outcome: "supported" } });
  assert.equal(validateEvidenceReviewDecisionContinuation({
    ...base, ...persistedContinuationRows({ decision: { decision_outcome: "supported_with_limitation", decided_by_role: "gk_admin" } }),
  }).ok, true);
  for (const [rows, code, reason] of [
    [{ ...persistedContinuationRows(), decisionRow: null }, "authorization_denied", "evidence_review_decision_required"],
    [persistedContinuationRows({ decision: { organization_id: OTHER_ORG } }), "authorization_denied", "evidence_review_decision_required"],
    [persistedContinuationRows({ decision: { evidence_item_id: "c0000000-0000-4000-8000-000000000009" } }), "authorization_denied", "evidence_review_decision_required"],
    [persistedContinuationRows({ decision: { decided_by: "90000000-0000-4000-8000-000000000009" } }), "authorization_denied", "evidence_review_decision_not_by_actor"],
    [persistedContinuationRows({ decision: { decided_by_role: "gk_operator" } }), "authorization_denied", "evidence_review_decision_role_not_allowed"],
    [persistedContinuationRows({ decision: { decided_by_role: "client_admin" } }), "authorization_denied", "evidence_review_decision_role_not_allowed"],
    [persistedContinuationRows({ decision: { decision_outcome: "not_supported" } }), "authorization_denied", "evidence_review_decision_not_positive"],
    [persistedContinuationRows({ decision: { decision_outcome: "needs_more_information" } }), "authorization_denied", "evidence_review_decision_not_positive"],
    [persistedContinuationRows({ decision: { review_queue_item_id: "d0000000-0000-4000-8000-000000000009" } }), "conflict_current_state_changed", "evidence_review_decision_not_current"],
    [persistedContinuationRows({ queue: { queue_status: "in_progress" } }), "conflict_current_state_changed", "evidence_review_decision_not_current"],
    [persistedContinuationRows({ queue: { target_object_id: "c0000000-0000-4000-8000-000000000009" } }), "conflict_current_state_changed", "evidence_review_decision_not_current"],
    [persistedContinuationRows({ evidence: { support_strength: "reviewed_not_supported" } }), "conflict_current_state_changed", "evidence_review_decision_not_current"],
    [persistedContinuationRows({ evidence: { evidence_review_status: "needs_gk_review" } }), "conflict_current_state_changed", "evidence_review_decision_not_current"],
  ]) {
    const result = validateEvidenceReviewDecisionContinuation({ ...base, ...rows });
    assert.deepEqual([result.ok, result.code, result.blockers[0]?.blocking_reason], [false, code, reason], JSON.stringify(rows));
  }
  assert.equal(validateEvidenceReviewDecisionContinuation({ ...base, ...persistedContinuationRows(), actorUserId: undefined }).ok, false);
});

test("K: for the mixed-role reviewer the direct P2-02 entry stays role_not_allowed, direct P2-03 is admitted only by the organization client_admin membership, and the decision-bound entries proceed only on the persisted decision", async () => {
  const unreachable = { async readEvidenceCoverageAssessmentFacts() { throw new Error("unreachable"); }, async proposeClaim() { throw new Error("unreachable"); } };
  const assessed = await assessEvidenceCoverageForSourceVersion(
    { organizationId: ORG, sourceVersionId: SOURCE_VERSION, actorContext: mixedActor },
    { env: ENV, evidenceCoverageAssessmentRepository: unreachable },
  );
  assert.deepEqual([assessed.error.code, assessed.blockers[0].blocking_reason], ["authorization_denied", "role_not_allowed"]);
  // Owner decision 2026-10-18: direct P2-03 admits an active organization
  // client_admin membership (never the global gk_reviewer role).
  const directCalls = [];
  const proposed = await proposeClaim(
    { organizationId: ORG, evidenceItemId: EVIDENCE, actorContext: mixedActor, now: NOW },
    { env: ENV, metadataOnlyAudit: harness().audit, claimProposalRepository: { async proposeClaim(input) { directCalls.push(input.organizationId); return { ok: false, error: { code: "not_found", status: 404 } }; } } },
  );
  assert.deepEqual([proposed.error.code, directCalls], ["not_found", [ORG]]);
  const globalOnly = await proposeClaim(
    { organizationId: ORG, evidenceItemId: EVIDENCE, actorContext: { ...mixedActor, organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_contributor" }] }, now: NOW },
    { env: ENV, claimProposalRepository: unreachable },
  );
  assert.deepEqual([globalOnly.error.code, globalOnly.blockers[0].blocking_reason], ["authorization_denied", "role_not_allowed"]);

  // A persisted decision by someone else: refused before any assessment read.
  const reads = [];
  const notMine = await assessEvidenceCoverageFromEvidenceReviewDecision(
    { organizationId: ORG, evidenceItemId: EVIDENCE, actorContext: { ...mixedActor, actorUserId: "90000000-0000-4000-8000-000000000009" } },
    {
      env: ENV,
      evidenceCoverageAssessmentRepository: {
        async readEvidenceReviewContinuationFacts(input) { reads.push(["continuation", input]); return { ok: true, data: { rows: persistedContinuationRows() } }; },
        async readEvidenceCoverageAssessmentFacts() { throw new Error("unreachable"); },
      },
    },
  );
  assert.deepEqual([notMine.error.code, notMine.blockers[0].blocking_reason], ["authorization_denied", "evidence_review_decision_not_by_actor"]);
  assert.deepEqual(reads, [["continuation", { organizationId: ORG, evidenceItemId: EVIDENCE }]]);

  // The repository receives exactly the P2-03 identity: no decision, marker, or role.
  const received = [];
  await proposeClaimFromEvidenceReviewDecision(
    { organizationId: ORG, evidenceItemId: EVIDENCE, actorContext: mixedActor, now: NOW },
    {
      env: ENV,
      metadataOnlyAudit: harness().audit,
      claimProposalRepository: {
        async proposeClaim() { throw new Error("the direct repository entry is not used"); },
        async proposeClaimFromEvidenceReviewDecision(input) { received.push(Object.keys(input).sort()); return { ok: false, error: { code: "not_found", status: 404 } }; },
      },
    },
  );
  assert.deepEqual(received, [["actorUserId", "evidenceItemId", "metadataOnlyAudit", "now", "organizationId"]]);

  // Client-only, non-human, and inactive actors never reach a repository.
  for (const actorContext of [
    gkActor("client_admin"),
    { ...mixedActor, actorType: "system" },
    { ...mixedActor, actorType: "assistant" },
    { ...mixedActor, organizationMemberships: [{ organization_id: ORG, membership_status: "inactive", role_name: "client_admin" }] },
    { ...mixedActor, kaiRoles: ["gk_operator"] },
  ]) {
    const a = await assessEvidenceCoverageFromEvidenceReviewDecision(
      { organizationId: ORG, evidenceItemId: EVIDENCE, actorContext }, { env: ENV, evidenceCoverageAssessmentRepository: unreachable });
    const p = await proposeClaimFromEvidenceReviewDecision(
      { organizationId: ORG, evidenceItemId: EVIDENCE, actorContext, now: NOW }, { env: ENV, claimProposalRepository: unreachable });
    assert.deepEqual([a.ok, p.ok], [false, false], JSON.stringify(actorContext));
  }
  assert.equal((await proposeClaimFromEvidenceReviewDecision(
    { organizationId: ORG, evidenceItemId: EVIDENCE, actorContext: mixedActor, now: NOW }, { env: {}, claimProposalRepository: unreachable })).error.code, "feature_disabled");
});

test("K: the handoff reports the continuation's structured blocking reason; it is never a claim", async () => {
  const { deps } = harness({
    assessment: { ok: false, error: { code: "authorization_denied", status: 403 }, blockers: [{ blocking_reason: "evidence_review_decision_not_by_actor" }] },
  });
  const result = await proposeClaimAfterEvidenceReviewDecision(handoffInput(evidenceDecision("supported")), deps);
  assert.deepEqual([result.status, result.error_code, result.blocking_reason, result.claim_id],
    ["not_created", "authorization_denied", "evidence_review_decision_not_by_actor", null]);
  const { deps: unsafe } = harness({ proposal: { ok: false, error: { code: "conflict_current_state_changed" }, blockers: [{ blocking_reason: "<b>raw</b>" }] } });
  assert.equal((await proposeClaimAfterEvidenceReviewDecision(handoffInput(evidenceDecision("supported")), unsafe)).blocking_reason, null);
});

test("K: the claim-proposal audit records the authorizing evidence-review decision only from a well-formed repository payload", async () => {
  const written = [];
  const adapter = createProductionMetadataOnlyAuditForClaimProposal({
    organizationId: ORG, evidenceItemId: EVIDENCE, actorContext: mixedActor, now: NOW,
    async insertAuditEvent(metadata) { written.push(metadata); return { ok: true }; },
  });
  const payload = { attempted_operation: "claim_proposed", validator_key: "VAL-KAI-P2-03-001", claim_id: CLAIM };
  await adapter.prepareMetadataOnlyAudit({ payload: { ...payload, authority_source: "evidence_review_decision", decision_type: "evidence_review", decision_id: DECISION, decided_by_role: "gk_reviewer" }, db: {} }).publish();
  await adapter.prepareMetadataOnlyAudit({ payload, db: {} }).publish();
  await adapter.prepareMetadataOnlyAudit({ payload: { ...payload, authority_source: "evidence_review_decision", decision_id: "forged" }, db: {} }).publish();
  await adapter.prepareMetadataOnlyAudit({ payload: { ...payload, authority_source: "something_else", decision_id: DECISION }, db: {} }).publish();
  assert.deepEqual(
    [written[0].authority_source, written[0].decision_type, written[0].decision_id, written[0].decided_by_role, written[0].actor_user_id],
    ["evidence_review_decision", "evidence_review", DECISION, "gk_reviewer", REVIEWER],
  );
  for (const metadata of written.slice(1)) {
    assert.equal(Object.hasOwn(metadata, "authority_source"), false);
    assert.equal(Object.hasOwn(metadata, "decision_id"), false);
  }
});

const handoffSource = readFileSync("Backend/kai/services/kaiEvidenceReviewClaimProposalHandoffService.js", "utf8");

test("I: the handoff contains no SQL and no claim-review, approval, audience, or export write path; P2-12 itself is unchanged", () => {
  assert.doesNotMatch(handoffSource, /\b(INSERT|UPDATE|DELETE|SELECT)\b\s/);
  assert.doesNotMatch(handoffSource, /recordClaimReviewDecision|claim-review\/|approved_audiences|approve_internal|approve_funder|approve_public|export_ready\s*[:=]\s*true/);
  // Only the P2-03 contract constants are read from its repository module;
  // no repository is constructed or called here.
  assert.doesNotMatch(handoffSource, /createPostgresClaimProposalRepository|postgresHumanReviewRepository|\.query\(/);
  assert.match(handoffSource, /import \{ __claimProposalRepositoryContract \} from "\.\.\/dictionary\/postgresClaimProposalRepository\.js";/);
  const importLines = handoffSource.split("\n").filter((line) => line.startsWith("import "));
  assert.deepEqual(importLines.map((line) => line.match(/from "([^"]+)"/)[1]), [
    "../config/kaiSprint2P0Contract.js",
    "../db/kaiIntakeQueries.js",
    "./kaiHumanReviewService.js",
    "./kaiEvidenceCoverageAssessmentService.js",
    "./kaiClaimProposalService.js",
    "./kaiMetadataOnlyAuditComposition.js",
    "../dictionary/postgresClaimProposalRepository.js",
  ]);
  const humanReviewService = readFileSync("Backend/kai/services/kaiHumanReviewService.js", "utf8");
  assert.doesNotMatch(humanReviewService, /kaiClaimProposalService|kaiEvidenceCoverageAssessmentService|kaiEvidenceReviewClaimProposalHandoffService/);
  assert.deepEqual([...__evidenceReviewClaimProposalHandoffContract.POSITIVE_EVIDENCE_REVIEW_OUTCOMES], ["supported", "supported_with_limitation"]);
});

test("I: the P2-12 evidence-review route delegates once to the composing service; the P2-03 and P2-02 routes are unchanged", () => {
  const routes = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const start = routes.indexOf('"/admin/organizations/:organizationId/evidence-items/:evidenceItemId/evidence-review/:reviewQueueItemId/complete"');
  const region = routes.slice(start, routes.indexOf("function claimReviewCompletionIdentifiers", start));
  assert.equal((region.match(/service\.recordEvidenceReviewDecisionWithClaimProposalHandoff\(/g) || []).length, 1);
  assert.doesNotMatch(region, /service\.recordEvidenceReviewDecision\(|proposeClaim|assessEvidenceCoverage|\bSELECT\b|\bINSERT\b/);
  assert.match(routes, /evidenceReviewServicePromise \|\|= import\("\.\.\/services\/kaiEvidenceReviewClaimProposalHandoffService\.js"\);/);
  assert.equal((routes.match(/"\/admin\/organizations\/:organizationId\/evidence-items\/:evidenceItemId\/claim-proposal"/g) || []).length, 1);
});

const librarySource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");

test("J: the Evidence tab reports the server handoff and re-reads Claims, with no browser P2-02/P2-03 request and no claim-review control", () => {
  assert.deepEqual(claimProposalHandoffOutcome({ status: "created" }), {
    message: "KAI proposed an internal-only claim from this evidence. It still needs Get Kinder claim review before any use.",
    reloadClaims: true,
  });
  assert.equal(claimProposalHandoffOutcome({ status: "replayed" }).reloadClaims, true);
  assert.deepEqual(claimProposalHandoffOutcome({ status: "not_applicable" }), {
    message: "No claim was proposed: only evidence reviewed as supported can be proposed as a claim.",
    reloadClaims: false,
  });
  assert.equal(claimProposalHandoffOutcome({ status: "not_created", error_code: "validation_blocker" }).message,
    "KAI did not propose a claim from this evidence (validation_blocker). The evidence review decision is recorded.");
  for (const value of [null, undefined, {}, { status: "approved" }]) {
    assert.deepEqual(claimProposalHandoffOutcome(value), { message: "Claim continuation could not be confirmed. No completed claim is confirmed.", reloadClaims: false });
  }

  const handler = librarySource.slice(
    librarySource.indexOf("const runEvidenceLibraryReview = useCallback"),
    librarySource.indexOf("const runCompleteEvidenceReview = useCallback"),
  );
  assert.equal((handler.match(/postJson\(/g) || []).length, 1);
  assert.equal((handler.match(/getJson\(/g) || []).length, 0);
  assert.match(handler, /claimProposalHandoffOutcome\(result\.body\?\.data\?\.claim_proposal_handoff\)/);
  assert.match(handler, /if \(handoff\.reloadClaims\) await loadCandidateClaims\(\);/);
  assert.match(handler, /await loadReviewQueue\(\);/);
  assert.match(handler, /const recorded = result.statusCode === 200 && result.body\?\.ok === true/);
  assert.doesNotMatch(handler, /claimProposalPath|evidenceCoverageAssessmentPath|claimReviewCompletePath|claimReviewDecisionBody/);
});

test("J: the existing Claims card shows the proposed claim's text and that Get Kinder claim review is still required", () => {
  const card = librarySource.slice(librarySource.indexOf('<h5 className="mb-0">Claims</h5>'), librarySource.indexOf("Generate evidence summary"));
  assert.match(card, /\{claim\.claimStatement \? <div className="small mt-1 text-break">\{claim\.claimStatement\}<\/div> : null\}/);
  assert.match(card, /\{claim\.claimReviewStatus === "needs_gk_review" \? \(\s*<div className="small mt-1">Get Kinder claim review required<\/div>/);
  assert.doesNotMatch(card, /claimReviewComplete|Record claim review|approved_audiences/);
  assert.match(librarySource, /A supported decision lets KAI propose an internal-only claim that still needs Get Kinder\s*\n\s*claim review\./);
});
