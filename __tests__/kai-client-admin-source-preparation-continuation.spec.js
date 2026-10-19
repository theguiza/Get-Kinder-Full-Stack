import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { continueIntakeFileSourcePreparation } from "../Backend/kai/services/kaiReviewCockpitService.js";
import {
  authorizeSourceCandidateContinuation,
  createSourceCandidateStub,
} from "../Backend/kai/services/kaiSourceCandidateService.js";
import { __clientEvidencePipelineServiceContract } from "../Backend/kai/services/kaiClientEvidencePipelineService.js";
import {
  sourcePreparationContinuationFailureMessage,
  sourcePreparationContinuationMessage,
  sourcePreparationGuidance,
} from "../frontend/knowledgeStudio/clientEvidenceWorkflowLogic.js";
import {
  PIPELINE_NEXT_ACTIONS,
  PIPELINE_REASONS,
  isClientSourceWork,
  nextActionText,
  pipelineReasonMessage,
} from "../frontend/knowledgeStudio/clientEvidencePipelineLogic.js";

/**
 * Owner decision 2026-10-19: an authorized binding-derived client_admin can
 * continue an existing file whose authoritative sensitivity review is
 * complete but whose P1-07 source candidate was never created, through the
 * same P1-07 handoff the decision seam runs. Service-level proof with
 * recording doubles; the assembled PostgreSQL/browser proof is
 * kai-client-admin-source-preparation-continuation-browser-acceptance.integration.spec.js.
 */

const ENV = { KAI_SPRINT2_ENABLED: "true" };
const ORG = "0f000000-0000-4000-8000-0000000000a1";
const OTHER_ORG = "0f000000-0000-4000-8000-0000000000b1";
const ENGAGEMENT = "7f000000-0000-4000-8000-0000000000e1";
const OTHER_ENGAGEMENT = "7f000000-0000-4000-8000-0000000000e2";
const FILE = "2f000000-0000-4000-8000-0000000000e1";
const PROFILE = "8f000000-0000-4000-8000-0000000000e1";
const CANDIDATE = "9f000000-0000-4000-8000-0000000000e1";
const SENSITIVITY_QUEUE = "3f000000-0000-4000-8000-0000000000e1";
const CANDIDATE_QUEUE = "3f000000-0000-4000-8000-0000000000e2";
const DECISION = "4f000000-0000-4000-8000-0000000000e1";
const ADMIN = "5f000000-0000-4000-8000-0000000000e1";
const OTHER_ADMIN = "5f000000-0000-4000-8000-0000000000e2";
const NOW = "2026-10-19T12:00:00.000Z";

function actor({ role = "client_admin", organizationId = ORG, bound = true, stored = false, kaiRoles = [], kaiUserStatus = "active", gkOrganizationId = 4242, actorType = "human", membershipStatus = "active", actorUserId = ADMIN } = {}) {
  return {
    actorType,
    actorUserId,
    kaiUserStatus,
    kaiRoles,
    platformSuperuser: false,
    organizationMemberships: [{
      organization_id: organizationId,
      role_name: role,
      membership_status: membershipStatus,
      ...(bound ? { source: "gk_organization_binding", gk_organization_id: gkOrganizationId } : {}),
      // kaiActorContext tags every kai.organization_memberships row it reads.
      ...(stored ? { source: "kai_organization_membership" } : {}),
    }],
  };
}

const REVIEWED_SNAPSHOT = Object.freeze({
  reviewed_personal_data_status: "absent",
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

function fileRecord(overrides = {}) {
  return {
    organization_id: ORG,
    engagement_id: ENGAGEMENT,
    intake_file_id: FILE,
    upload_state: "confirmed",
    file_policy_status: "passed",
    intake_sensitivity_profile_id: PROFILE,
    allowed_use_status: "unknown",
    intake_source_candidate_id: null,
    candidate_status: null,
    ...overrides,
  };
}

function headRow(overrides = {}) {
  return {
    decision_id: DECISION,
    organization_id: ORG,
    intake_sensitivity_profile_id: PROFILE,
    review_queue_item_id: SENSITIVITY_QUEUE,
    decision_outcome: "reviewed",
    ...REVIEWED_SNAPSHOT,
    decided_by: ADMIN,
    decided_by_role: "client_admin",
    supersedes_decision_id: "4f000000-0000-4000-8000-0000000000e0",
    created_by_type: "human",
    created_at: "2026-10-12T10:00:00.000Z",
    ...overrides,
  };
}

function queueRow(overrides = {}) {
  return {
    review_queue_item_id: SENSITIVITY_QUEUE,
    organization_id: ORG,
    queue_type: "sensitivity_review",
    target_object_type: "intake_sensitivity_profile",
    target_object_id: PROFILE,
    queue_status: "resolved",
    review_status: "resolved",
    updated_at: "2026-10-12T10:00:00.000Z",
    ...overrides,
  };
}

function harness({
  file = fileRecord(),
  decision = { reviewQueueItem: queueRow(), currentDecision: headRow(), lineageAmbiguous: false },
  candidateResult = {
    ok: true,
    data: {
      sourceCandidate: { intake_source_candidate_id: CANDIDATE, organization_id: ORG, intake_sensitivity_profile_id: PROFILE, candidate_status: "needs_gk_review" },
      reviewQueueItem: { review_queue_item_id: CANDIDATE_QUEUE, organization_id: ORG, queue_type: "source_candidate_review", target_object_type: "intake_source_candidate", target_object_id: CANDIDATE, queue_status: "open" },
      replayed: false,
    },
  },
  env = ENV,
} = {}) {
  const calls = { file: [], decision: [], candidate: [], recordDecision: 0, promotion: 0 };
  const deps = {
    env,
    now: () => Date.parse(NOW),
    async getReviewCockpitIntakeFileSourcePreparationRecord(...args) { calls.file.push(args); return file; },
    async getReviewCockpitSensitivityDecisionRecord(...args) { calls.decision.push(args); return decision; },
    async createSourceCandidateStub(input) { calls.candidate.push(input); return candidateResult; },
    sourceCandidateMetadataOnlyAudit: { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) },
    async recordSensitivityAllowedUseDecision() { calls.recordDecision += 1; throw new Error("no decision may be recorded"); },
    async createSourcePromotionDecision() { calls.promotion += 1; throw new Error("no promotion may be made"); },
  };
  return { calls, deps };
}

const request = (overrides = {}) => ({ organizationId: ORG, engagementId: ENGAGEMENT, intakeFileId: FILE, actorContext: actor(), ...overrides });
const blockingReason = (result) => result.blockers?.[0]?.blocking_reason;

// ---------------------------------------------------------------------------
// Eligible continuation
// ---------------------------------------------------------------------------

test("continuation: an eligible reviewed file with no candidate runs the P1-07 handoff once, as the administrator, from the authoritative head; no decision or promotion", async () => {
  const { calls, deps } = harness();
  const result = await continueIntakeFileSourcePreparation(request(), deps);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.data, {
    intake_file_id: FILE,
    intake_sensitivity_profile_id: PROFILE,
    source_candidate_handoff: {
      status: "created",
      intake_source_candidate_id: CANDIDATE,
      candidate_status: "needs_gk_review",
      review_queue_item_id: CANDIDATE_QUEUE,
      queue_status: "open",
      error_code: null,
    },
  });
  assert.deepEqual(calls.file, [[ORG, ENGAGEMENT, FILE]]);
  assert.deepEqual(calls.decision, [[ORG, PROFILE]]);
  assert.equal(calls.candidate.length, 1);
  assert.deepEqual(Object.keys(calls.candidate[0]).sort(), ["actorContext", "intakeSensitivityProfileId", "now", "organizationId"]);
  assert.deepEqual([calls.candidate[0].organizationId, calls.candidate[0].intakeSensitivityProfileId, calls.candidate[0].now], [ORG, PROFILE, NOW]);
  assert.equal(calls.candidate[0].actorContext.actorUserId, ADMIN);
  assert.deepEqual([calls.recordDecision, calls.promotion], [0, 0]);
});

test("continuation: a P1-07 replay (concurrent creator) is reported as replayed; an existing candidate is returned with no P1-07 call and no decision read", async () => {
  const replay = harness({ candidateResult: { ok: true, data: {
    sourceCandidate: { intake_source_candidate_id: CANDIDATE, organization_id: ORG, intake_sensitivity_profile_id: PROFILE, candidate_status: "needs_gk_review" },
    reviewQueueItem: { review_queue_item_id: CANDIDATE_QUEUE, organization_id: ORG, queue_type: "source_candidate_review", target_object_type: "intake_source_candidate", target_object_id: CANDIDATE, queue_status: "open" },
    replayed: true,
  } } });
  const replayed = await continueIntakeFileSourcePreparation(request(), replay.deps);
  assert.equal(replayed.data.source_candidate_handoff.status, "replayed");

  const existing = harness({ file: fileRecord({ intake_source_candidate_id: CANDIDATE, candidate_status: "needs_gk_review" }) });
  const result = await continueIntakeFileSourcePreparation(request(), existing.deps);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.source_candidate_handoff, {
    status: "existing", intake_source_candidate_id: CANDIDATE, candidate_status: "needs_gk_review", review_queue_item_id: null, queue_status: null, error_code: null,
  });
  assert.deepEqual([existing.calls.decision.length, existing.calls.candidate.length], [0, 0]);
  // Even a promoted candidate, or one created by Get Kinder, is only reported.
  const promoted = harness({ file: fileRecord({ intake_source_candidate_id: CANDIDATE, candidate_status: "promoted" }) });
  assert.equal((await continueIntakeFileSourcePreparation(request(), promoted.deps)).data.source_candidate_handoff.status, "existing");
  assert.equal(promoted.calls.candidate.length, 0);
});

// ---------------------------------------------------------------------------
// Eligibility refusals (nothing reaches P1-07)
// ---------------------------------------------------------------------------

async function refused(overrides, expectedCode, expectedReason) {
  const { calls, deps } = harness(overrides);
  const result = await continueIntakeFileSourcePreparation(request(), deps);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, expectedCode, JSON.stringify(result));
  assert.equal(blockingReason(result), expectedReason, JSON.stringify(result));
  assert.equal(result.blockers[0].validator_key, "VAL-KAI-P1-07-002");
  assert.equal(result.blockers[0].object_id, FILE);
  assert.deepEqual([calls.candidate.length, calls.recordDecision, calls.promotion], [0, 0, 0]);
  return calls;
}

test("continuation refusals: failed or pending file policy, unconfirmed upload, and no complete profile", async () => {
  for (const file of [
    fileRecord({ file_policy_status: "blocked" }),
    fileRecord({ file_policy_status: "failed" }),
    fileRecord({ file_policy_status: "pending" }),
    fileRecord({ upload_state: "policy_blocked" }),
  ]) {
    const calls = await refused({ file }, "validation_blocker", "file_policy_not_passed");
    assert.equal(calls.decision.length, 0);
  }
  await refused({ file: fileRecord({ intake_sensitivity_profile_id: null }) }, "validation_blocker", "sensitivity_profile_not_ready");
});

test("continuation refusals: no decision, a needs_more_information head, an unresolved or mismatched review item, and an ambiguous lineage", async () => {
  const decision = (overrides) => ({ reviewQueueItem: queueRow(), currentDecision: headRow(), lineageAmbiguous: false, ...overrides });
  await refused({ decision: decision({ currentDecision: null }) }, "validation_blocker", "sensitivity_review_not_complete");
  const needsMore = headRow({ decision_outcome: "needs_more_information", ...Object.fromEntries(Object.keys(REVIEWED_SNAPSHOT).map((k) => [k, null])) });
  await refused({ decision: decision({ currentDecision: needsMore, reviewQueueItem: queueRow({ queue_status: "open", review_status: "needs_gk_review" }) }) }, "validation_blocker", "sensitivity_review_not_complete");
  await refused({ decision: decision({ reviewQueueItem: queueRow({ queue_status: "in_progress" }) }) }, "validation_blocker", "sensitivity_review_not_complete");
  await refused({ decision: decision({ reviewQueueItem: queueRow({ review_status: "needs_gk_review" }) }) }, "validation_blocker", "sensitivity_review_not_complete");
  await refused({ decision: decision({ reviewQueueItem: null }) }, "validation_blocker", "sensitivity_review_not_complete");
  await refused({ decision: decision({ reviewQueueItem: queueRow({ review_queue_item_id: CANDIDATE_QUEUE }) }) }, "validation_blocker", "sensitivity_review_not_complete");
  // The read model reports more than one head: refused, never resolved by picking one.
  await refused({ decision: decision({ currentDecision: null, lineageAmbiguous: true }) }, "conflict_current_state_changed", "sensitivity_decision_lineage_ambiguous");
});

test("continuation refusals: a head that breaks the reviewed-snapshot rules, and a prohibited reviewed or committed allowed use", async () => {
  const decision = (head) => ({ reviewQueueItem: queueRow(), currentDecision: head, lineageAmbiguous: false });
  await refused({ decision: decision(headRow({ reviewed_llm_processing_allowed: true })) }, "validation_blocker", "sensitivity_decision_invalid");
  await refused({ decision: decision(headRow({ reviewed_public_use_allowed: true, reviewed_allowed_use_status: "allowed" })) }, "validation_blocker", "sensitivity_decision_invalid");
  await refused({ decision: decision(headRow({ reviewed_allowed_use_status: "not_allowed" })) }, "validation_blocker", "allowed_use_not_allowed");
  await refused({ file: fileRecord({ allowed_use_status: "not_allowed" }) }, "validation_blocker", "allowed_use_not_allowed");
});

test("continuation (owner decision 2026-10-19): a current decision recorded by another administrator, or by Get Kinder, is continued by this administrator without replacing or re-attributing it", async () => {
  const decision = (head) => ({ reviewQueueItem: queueRow(), currentDecision: head, lineageAmbiguous: false });
  for (const head of [headRow({ decided_by: OTHER_ADMIN }), headRow({ decided_by: OTHER_ADMIN, decided_by_role: "gk_reviewer" })]) {
    const { calls, deps } = harness({ decision: decision(head) });
    const result = await continueIntakeFileSourcePreparation(request(), deps);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.source_candidate_handoff.status, "created");
    // P1-07 runs as the requesting administrator; no decision is recorded.
    assert.equal(calls.candidate[0].actorContext.actorUserId, ADMIN);
    assert.deepEqual([calls.recordDecision, calls.promotion], [0, 0]);
  }
  // A delegated (stored) administrator continues the binding-derived administrator's review.
  const stored = harness({ decision: decision(headRow({ decided_by: OTHER_ADMIN })) });
  const storedActor = actor({ bound: false, stored: true, actorUserId: "5f000000-0000-4000-8000-0000000000e3" });
  const result = await continueIntakeFileSourcePreparation(request({ actorContext: storedActor }), stored.deps);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(stored.calls.candidate[0].actorContext.actorUserId, storedActor.actorUserId);
});

test("continuation: a P1-07 refusal (prerequisite, predicate, conflict) is returned with the handoff's code and nothing else is attempted", async () => {
  for (const code of ["authorization_denied", "validation_blocker", "conflict_current_state_changed", "not_found"]) {
    const { calls, deps } = harness({ candidateResult: { ok: false, error: { code, status: 0 } } });
    const result = await continueIntakeFileSourcePreparation(request(), deps);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, code);
    assert.deepEqual(result.data.source_candidate_handoff, {
      status: "not_created", intake_source_candidate_id: null, candidate_status: null, review_queue_item_id: null, queue_status: null, error_code: code,
    });
    assert.equal(calls.candidate.length, 1);
  }
});

// ---------------------------------------------------------------------------
// Authority and scope (nothing is read)
// ---------------------------------------------------------------------------

test("continuation authority: only an active client_admin of the exact organization with verified provenance (binding-derived or a stored grant) and an active account", async () => {
  const denied = [
    ["client_admin membership with no verified provenance", actor({ bound: false })],
    ["inactive stored client_admin grant", actor({ bound: false, stored: true, membershipStatus: "inactive" })],
    ["global client_admin role with a contributor membership", actor({ role: "client_contributor", bound: false, stored: true, kaiRoles: ["client_admin"] })],
    ["binding-derived client_reviewer", actor({ role: "client_reviewer" })],
    ["binding-derived client_contributor", actor({ role: "client_contributor" })],
    ["stored client_contributor", actor({ role: "client_contributor", bound: false })],
    ["GK reviewer membership with a global GK role", actor({ role: "gk_reviewer", bound: false, kaiRoles: ["gk_reviewer"] })],
    ["inactive KAI account", actor({ kaiUserStatus: "inactive" })],
    ["inactive binding membership", actor({ membershipStatus: "inactive" })],
    ["binding without a GK organization id", actor({ gkOrganizationId: null })],
    ["administrator of another organization", actor({ organizationId: OTHER_ORG })],
    ["system actor", actor({ actorType: "system" })],
    ["ai actor", actor({ actorType: "ai" })],
  ];
  for (const [label, actorContext] of denied) {
    const { calls, deps } = harness();
    const result = await continueIntakeFileSourcePreparation(request({ actorContext }), deps);
    assert.equal(result.ok, false, label);
    assert.ok(["authorization_denied", "tenant_boundary_violation"].includes(result.error.code), `${label}: ${result.error.code}`);
    assert.deepEqual([calls.file.length, calls.decision.length, calls.candidate.length], [0, 0, 0], label);
    assert.equal(authorizeSourceCandidateContinuation(actorContext, ORG).ok === true, false, label);
  }
  assert.equal(authorizeSourceCandidateContinuation(actor(), ORG).ok, true);
  assert.equal(authorizeSourceCandidateContinuation(actor({ bound: false, stored: true }), ORG).ok, true, "a delegated, active stored grant");
  assert.equal(authorizeSourceCandidateContinuation(actor(), OTHER_ORG).ok, false);
  assert.equal(authorizeSourceCandidateContinuation(actor({ bound: false, stored: true }), OTHER_ORG).ok, false);
});

test("continuation scope: another Project's or organization's file is not_found; feature flag and identifiers are enforced first", async () => {
  for (const file of [null, fileRecord({ engagement_id: OTHER_ENGAGEMENT }), fileRecord({ organization_id: OTHER_ORG }), fileRecord({ intake_file_id: CANDIDATE })]) {
    const { calls, deps } = harness({ file });
    const result = await continueIntakeFileSourcePreparation(request(), deps);
    assert.equal(result.error.code, "not_found");
    assert.deepEqual([calls.decision.length, calls.candidate.length], [0, 0]);
  }
  const off = harness({ env: {} });
  assert.equal((await continueIntakeFileSourcePreparation(request(), off.deps)).error.code, "feature_disabled");
  for (const overrides of [{ engagementId: "" }, { intakeFileId: FILE.toUpperCase() }, { organizationId: "not-a-uuid" }]) {
    const { calls, deps } = harness();
    const result = await continueIntakeFileSourcePreparation(request(overrides), deps);
    assert.equal(result.error.code, "invalid_request");
    assert.equal(calls.file.length, 0);
  }
  // A decision read that names a different organization's head is not trusted.
  const foreignHead = harness({ decision: { reviewQueueItem: queueRow(), currentDecision: headRow({ organization_id: OTHER_ORG }), lineageAmbiguous: false } });
  assert.equal((await continueIntakeFileSourcePreparation(request(), foreignHead.deps)).error.code, "system_error");
  assert.equal(foreignHead.calls.candidate.length, 0);
});

test("P1-07 itself still enforces the current-reviewed-decision prerequisite for the continuation's call", async () => {
  const calls = [];
  const repository = { async createSourceCandidateStub(input) { calls.push(input); return { ok: false, error: { code: "authorization_denied", status: 403 } }; } };
  const result = await createSourceCandidateStub(
    { organizationId: ORG, intakeSensitivityProfileId: PROFILE, actorContext: actor(), now: NOW },
    { env: ENV, sourceCandidateRepository: repository, metadataOnlyAudit: { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) } },
  );
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(calls[0].requireCurrentReviewedDecision, true);
});

// ---------------------------------------------------------------------------
// Route and source boundaries
// ---------------------------------------------------------------------------

test("route: the continuation is one empty-body POST on the Project-scoped file -> source-candidate path that delegates once to the service", () => {
  const routeSource = readFileSync(new URL("../Backend/kai/routes/sprint2IntakeApi.js", import.meta.url), "utf8");
  const body = routeSource.match(/router\.post\("\/admin\/review-cockpit\/intake-files\/:intakeFileId\/source-candidate"[\s\S]*?\n}\);\n/)?.[0];
  assert.ok(body);
  assert.match(body, /engagement_id/);
  assert.match(body, /Object\.keys\(requestPayload\(req\)\)\.length !== 0/);
  assert.equal((body.match(/service\.[A-Za-z]+\(/g) || []).join(","), "service.continueIntakeFileSourcePreparation(");
  assert.doesNotMatch(body, /actorUserId|decided_by|decision|reviewed_snapshot|req\.body\.[a-z]/);
});

test("service boundary: the continuation records no sensitivity decision, reaches no P1-08 promotion, and reuses the one P1-07 handoff", () => {
  const source = readFileSync(new URL("../Backend/kai/services/kaiReviewCockpitService.js", import.meta.url), "utf8");
  const body = source.match(/export async function continueIntakeFileSourcePreparation\([\s\S]*?\n}\n/)?.[0];
  assert.ok(body);
  assert.match(body, /await ensureSourceCandidateAfterReviewedDecision\(/);
  assert.doesNotMatch(body, /recordSensitivityAllowedUseDecision|recordDecision|createSourcePromotionDecision|submitSourceCandidateDecision|createSourceCandidateStub|ensureSensitivityReviewQueueItem|INSERT|UPDATE/);
});

// ---------------------------------------------------------------------------
// Client pipeline: the next action follows persisted eligibility and authority
// ---------------------------------------------------------------------------

const { projectPipelineFile, resolveClientAuthority } = __clientEvidencePipelineServiceContract;

function pipelineRow(overrides = {}) {
  return {
    intake_file_id: FILE,
    safe_filename: "harbourline.csv",
    upload_state: "confirmed",
    file_policy_status: "passed",
    created_at: new Date("2026-10-12T00:00:00Z"),
    parser_status: "completed",
    file_profile_complete: true,
    data_dictionary_complete: true,
    sensitivity_profile_complete: true,
    sensitivity_permission_predicate: true,
    sensitivity_decision_outcome: "reviewed",
    source_candidate_continuation_ready: true,
    source_candidate_count: 0,
    source_candidate_needs_review_count: 0,
    source_candidate_promoted_count: 0,
    source_candidate_rejected_count: 0,
    source_candidate_actionable_count: 0,
    source_version_count: 0,
    evidence_item_count: 0,
    evidence_needs_review_count: 0,
    evidence_reviewed_count: 0,
    claim_count: 0,
    claim_needs_review_count: 0,
    open_client_followup_count: 0,
    claim_ids: [],
    ...overrides,
  };
}
const AUTHORITY = Object.freeze({ promoteSource: true, extractEvidence: true, continueSourcePreparation: true });
const projected = (row, authority = AUTHORITY) => {
  const { file } = projectPipelineFile(row, new Set(), authority);
  return [file.currentStage, file.currentStatus, file.responsibleParty, file.nextAction, file.reason];
};

test("pipeline: a reviewed file with no candidate is the administrator's continue_source_preparation only when its committed state makes it eligible", () => {
  assert.deepEqual(projected(pipelineRow()), ["source_review", "waiting_for_client", "client", "continue_source_preparation", "source_preparation_ready"]);
  const missing = ["source_review", "waiting_for_get_kinder", "get_kinder", "contact_get_kinder", "source_candidate_missing"];
  // Not eligible for this actor (not their decision, unresolved, prohibited use, ambiguous head): the Get Kinder state stays.
  assert.deepEqual(projected(pipelineRow({ source_candidate_continuation_ready: false })), missing);
  // The fail-closed P1-07 predicate no longer holds.
  assert.deepEqual(projected(pipelineRow({ sensitivity_permission_predicate: false })), missing);
  // Another actor (no continuation authority), even an organization role that can promote elsewhere.
  assert.deepEqual(projected(pipelineRow(), { ...AUTHORITY, continueSourcePreparation: false }), missing);
  // Not reviewed: still the sensitivity stage; failed policy: still the security stage.
  assert.equal(projected(pipelineRow({ sensitivity_decision_outcome: "needs_more_information" }))[0], "sensitivity_review");
  assert.deepEqual(projected(pipelineRow({ file_policy_status: "blocked" })).slice(0, 2), ["security_check", "failed"]);
  // An existing candidate keeps the P1-08 behavior unchanged.
  assert.deepEqual(projected(pipelineRow({ source_candidate_count: 1, source_candidate_needs_review_count: 1, source_candidate_actionable_count: 1 })),
    ["source_review", "waiting_for_client", "client", "promote_source", "source_promotion_ready"]);
  // The internal eligibility value is never returned.
  const { file } = projectPipelineFile(pipelineRow(), new Set(), AUTHORITY);
  assert.equal(JSON.stringify(file).includes("continuation_ready"), false);
  assert.ok(__clientEvidencePipelineServiceContract.PIPELINE_REASONS.includes("source_preparation_ready"));
});

test("pipeline authority: continueSourcePreparation is an organization administrator (binding-derived or a stored grant) only", () => {
  assert.equal(resolveClientAuthority(actor(), ORG).continueSourcePreparation, true);
  assert.equal(resolveClientAuthority(actor({ bound: false, stored: true }), ORG).continueSourcePreparation, true);
  for (const actorContext of [actor({ bound: false }), actor({ role: "client_reviewer" }), actor({ kaiUserStatus: "inactive" }), actor({ organizationId: OTHER_ORG })]) {
    assert.equal(resolveClientAuthority(actorContext, ORG).continueSourcePreparation, false);
  }
});

// ---------------------------------------------------------------------------
// Frontend logic
// ---------------------------------------------------------------------------

test("UI logic: vocabulary, guidance, Reviews source work, and the continuation result and refusal text", () => {
  assert.ok(PIPELINE_NEXT_ACTIONS.includes("continue_source_preparation"));
  assert.ok(PIPELINE_REASONS.includes("source_preparation_ready"));
  const file = { currentStage: "source_review", currentStatus: "waiting_for_client", responsibleParty: "client", nextAction: "continue_source_preparation", reason: "source_preparation_ready" };
  assert.match(nextActionText(file), /Continue source preparation in Data Sources/);
  assert.match(sourcePreparationGuidance(file, { promoteSource: true }), /Continue source preparation/);
  assert.match(pipelineReasonMessage("source_preparation_ready", 1), /Continue source preparation/);
  assert.equal(isClientSourceWork(file), true);
  assert.equal(isClientSourceWork({ ...file, responsibleParty: "get_kinder", nextAction: "contact_get_kinder" }), false);

  assert.match(sourcePreparationContinuationMessage({ source_candidate_handoff: { status: "created" } }), /source candidate was created/);
  assert.match(sourcePreparationContinuationMessage({ source_candidate_handoff: { status: "existing" } }), /Nothing new was written/);
  assert.match(sourcePreparationContinuationFailureMessage({ statusCode: 422, body: { error: { code: "validation_blocker" }, blockers: [{ blocking_reason: "allowed_use_not_allowed" }] } }),
    /allowed use is not_allowed \(allowed_use_not_allowed\)\. Nothing was written\./);
  assert.match(sourcePreparationContinuationFailureMessage({ statusCode: 403, body: { error: { code: "authorization_denied" }, data: { source_candidate_handoff: { status: "not_created", error_code: "authorization_denied" } } } }),
    /refused \(authorization_denied\)/);
});
