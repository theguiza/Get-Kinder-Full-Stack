import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  getClientInternalDraft,
  listClientInternalDrafts,
  __clientGeneratedContentServiceContract,
} from "../Backend/kai/services/kaiClientGeneratedContentService.js";
import { getOrganizationAccessCapabilities } from "../Backend/kai/services/kaiOrganizationAccessCapabilitiesService.js";
import { __clientEvidencePipelineServiceContract } from "../Backend/kai/services/kaiClientEvidencePipelineService.js";
import { STORED_ORGANIZATION_MEMBERSHIP_SOURCE } from "../Backend/kai/auth/kaiOrganizationMembershipSource.js";
import {
  projectClientInternalDraft,
  projectClientInternalDraftList,
  projectOrganizationAccessCapabilities,
} from "../frontend/impactEvidenceLibraryLogic.js";
import {
  clientEvidenceWorkflowAccess,
  isUseForImpactCandidate,
  processingPermissionReviewFiles,
  sourcePreparationFiles,
  sourceRestrictionLines,
  useForImpactStep,
} from "../frontend/knowledgeStudio/clientEvidenceWorkflowLogic.js";
import {
  PIPELINE_NEXT_ACTIONS,
  PIPELINE_REASONS,
  isClientSourceWork,
  nextActionText,
  pipelineReasonMessage,
  projectClientEvidencePipeline,
  reviewsTabView,
} from "../frontend/knowledgeStudio/clientEvidencePipelineLogic.js";

/**
 * Owner decision 2026-10-19, the client half of the source-to-impact repair:
 * the organization administrator reads its own persisted internal drafts with
 * their true review state; the pipeline names the organization's
 * administrator (not Get Kinder) as responsible for its steps, and closes a
 * file whose effective allowed use is not_allowed; and "Use for impact"
 * chooses the next governed step from persisted state. Services run for real
 * over injected reads; the assembled PostgreSQL/browser proof is
 * kai-source-to-impact-workflow-browser-acceptance.integration.spec.js.
 */

const ENV = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });
const ORG = "11111111-2222-4333-8444-555555555555";
const OTHER_ORG = "99999999-8888-4777-8666-555555555555";
const ENGAGEMENT = "22222222-3333-4444-8555-666666666666";
const ENGAGEMENT_B = "22222222-3333-4444-8555-777777777777";
const NOW = "2026-10-19T12:00:00.000Z";
const id = (prefix, n) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CLAIM_A = id("c", 1);
const CLAIM_B = id("c", 2);

const HIDDEN = ["GENERATION-RUN-SECRET", "reviewQueueItemId", "evidenceItemId", "sourceVersionId", "source-code-secret", "blockerCodes",
  "needs_gk_review", "supportStrength", "affectedObjectIds", "approvedAudiences", "exportReview", "validator"];

function citation(claimId, { eligible = false } = {}) {
  return {
    generatedContentCitationId: id("f", 1), claimId, evidenceItemId: id("e", 1), sourceId: id("b", 1), sourceCode: "source-code-secret",
    sourceVersionId: id("a", 9), supportStrength: "unassessed", claimReviewStatus: "needs_gk_review", evidenceReviewStatus: "needs_gk_review",
    currentEligible: eligible, blockerCodes: eligible ? [] : ["claim_review_unresolved"], affectedDimensionKeys: [], affectedObjectIds: [id("a", 9)],
    approvedAudiences: eligible ? ["internal"] : [],
  };
}

function packet(draftId, { audience = "internal", contentType = "evidence_summary", queue = ["open", "needs_gk_review"], citations = [citation(CLAIM_A)] } = {}) {
  return {
    generationRunId: id("a", 9), generatedContentDraftId: draftId, contentType, draftStatus: "draft", requestedAudience: audience,
    reviewQueueItemId: id("9", 1), queueStatus: queue[0], reviewStatus: queue[1], reviewUpdatedAt: NOW,
    currentUseEligible: citations.every((c) => c.currentEligible === true),
    exportReviewQueueItemId: null, exportReviewQueueStatus: null, exportReviewStatus: null,
    blocks: [{ generatedContentBlockId: id("8", 1), ordinal: 1, text: `Draft text of ${draftId}.`, citations }],
  };
}

const D_SUMMARY = id("d", 1);
const D_NARRATIVE = id("d", 2);
const D_REVIEWED = id("d", 3);
const D_FUNDER = id("d", 4);
const D_READINESS = id("d", 5);
const D_STALE = id("d", 6);
const D_OTHER_PROJECT = id("d", 7);
const PACKETS = {
  [D_SUMMARY]: packet(D_SUMMARY, { citations: [citation(CLAIM_A), citation(CLAIM_B), citation(CLAIM_A)] }),
  [D_NARRATIVE]: packet(D_NARRATIVE, { contentType: "impact_narrative", queue: ["in_progress", "needs_gk_review"] }),
  [D_REVIEWED]: packet(D_REVIEWED, { queue: ["resolved", "resolved"], citations: [citation(CLAIM_A, { eligible: true })] }),
  [D_FUNDER]: packet(D_FUNDER, { audience: "funder" }),
  [D_READINESS]: packet(D_READINESS, { contentType: "readiness_assessment" }),
  [D_STALE]: packet(D_STALE),
  [D_OTHER_PROJECT]: packet(D_OTHER_PROJECT),
};

function indexRow(draftId, p) {
  return {
    generated_content_draft_id: draftId, organization_id: ORG, content_type: p.contentType, requested_audience: p.requestedAudience,
    draft_status: "draft", review_queue_item_id: p.reviewQueueItemId, queue_status: p.queueStatus, review_status: p.reviewStatus, created_at: NOW,
    export_review_queue_item_id: null, export_review_organization_id: null, export_review_queue_type: null, export_review_target_object_type: null,
    export_review_target_object_id: null, export_review_priority: null, export_review_queue_status: null, export_review_status: null,
    export_review_blocked_reason: null, export_review_assigned_to: null, export_review_due_at: null, export_review_summary: null,
    export_review_required_action: null, export_review_queue_metadata: null, export_review_created_by: null, export_review_created_by_type: null,
  };
}

function dependencies(calls = []) {
  const engagementOf = (draftId) => (draftId === D_OTHER_PROJECT ? ENGAGEMENT_B : ENGAGEMENT);
  const ids = Object.keys(PACKETS).sort();
  return {
    env: ENV,
    getEngagementForOrganization: async ({ organizationId, engagementId }) => (organizationId === ORG && [ENGAGEMENT, ENGAGEMENT_B].includes(engagementId)
      ? { engagement_id: engagementId, organization_id: organizationId } : null),
    readGeneratedDraftEngagementId: async (organizationId, draftId) => (organizationId === ORG && PACKETS[draftId] ? engagementOf(draftId) : null),
    listGeneratedDraftLibraryIndex: async (organizationId, { limit, afterGeneratedContentDraftId, engagementId }) => {
      calls.push("index");
      return ids.filter((draftId) => engagementOf(draftId) === engagementId)
        .filter((draftId) => afterGeneratedContentDraftId === null || draftId > afterGeneratedContentDraftId)
        .slice(0, limit + 1).map((draftId) => indexRow(draftId, PACKETS[draftId]));
    },
    generatedContentRepository: {
      async getGeneratedDraftReviewPacket({ organizationId, generatedContentDraftId }) {
        calls.push(`packet:${generatedContentDraftId}`);
        // A cited claim no longer traceable (e.g. its file's allowed use became not_allowed).
        if (generatedContentDraftId === D_STALE) return { ok: false, error: { code: "conflict_current_state_changed", status: 409 } };
        if (organizationId !== ORG || !PACKETS[generatedContentDraftId]) return { ok: false, error: { code: "not_found", status: 404 } };
        return { ok: true, data: PACKETS[generatedContentDraftId] };
      },
    },
  };
}

function actor(roleName, { organizationId = ORG, kaiRoles = [], source = STORED_ORGANIZATION_MEMBERSHIP_SOURCE } = {}) {
  return {
    actorType: "human", actorUserId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", kaiUserStatus: "active", kaiRoles, platformSuperuser: false,
    organizationMemberships: [{ organization_id: organizationId, role_name: roleName, membership_status: "active", ...(source ? { source } : {}) }],
  };
}

function assertNoHidden(value, label) {
  const serialized = JSON.stringify(value);
  for (const secret of HIDDEN) assert.ok(!serialized.includes(secret), `${label} leaked ${secret}`);
}

test("internal drafts: the organization administrator lists its Project's internal evidence summaries and impact narratives in every review state, never funder/public or GK-only types, and never a draft that is no longer traceable", async () => {
  const calls = [];
  const result = await listClientInternalDrafts({ organizationId: ORG, engagementId: ENGAGEMENT, actorContext: actor("client_admin") }, dependencies(calls));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.data.items.map((item) => [item.generatedContentDraftId, item.contentType, item.audience, item.reviewState, item.blockCount]), [
    [D_SUMMARY, "evidence_summary", "internal", "awaiting_get_kinder_review", 1],
    [D_NARRATIVE, "impact_narrative", "internal", "in_get_kinder_review", 1],
    [D_REVIEWED, "evidence_summary", "internal", "reviewed_by_get_kinder", 1],
  ]);
  assert.equal(result.data.nextCursor, null);
  assert.ok(!calls.includes(`packet:${D_FUNDER}`) && !calls.includes(`packet:${D_READINESS}`), "excluded types are never loaded");
  assertNoHidden(result, "list");
  assert.deepEqual(projectClientInternalDraftList(result.data).items.length, 3);
});

test("internal drafts: the detail is the persisted text with cited claim ids, the true review state, and fixed limitations; other types, audiences, Projects, and stale drafts are not_found", async () => {
  const detail = await getClientInternalDraft({ organizationId: ORG, engagementId: ENGAGEMENT, generatedContentDraftId: D_SUMMARY, actorContext: actor("client_admin") }, dependencies());
  assert.equal(detail.ok, true, JSON.stringify(detail));
  assert.deepEqual(detail.data, {
    generatedContentDraftId: D_SUMMARY,
    contentType: "evidence_summary",
    audience: "internal",
    reviewState: "awaiting_get_kinder_review",
    citedClaimsCurrentlyEligible: false,
    limitations: ["internal_use_only", "not_approved_for_external_use", "awaiting_get_kinder_review", "cited_claims_not_currently_eligible"],
    blocks: [{ ordinal: 1, text: `Draft text of ${D_SUMMARY}.`, supportingClaimIds: [CLAIM_A, CLAIM_B].sort() }],
    // Plan A Prompt 8: nothing can be released before Get Kinder's review.
    release: { state: "awaiting_get_kinder_review", releasedReportId: null },
  });
  assertNoHidden(detail, "detail");
  assert.deepEqual(projectClientInternalDraft(detail.data).limitations, detail.data.limitations);
  const reviewed = await getClientInternalDraft({ organizationId: ORG, engagementId: ENGAGEMENT, generatedContentDraftId: D_REVIEWED, actorContext: actor("client_admin") }, dependencies());
  assert.deepEqual(reviewed.data.limitations, ["internal_use_only", "not_approved_for_external_use"], "a reviewed draft is still internal only");
  for (const [label, draftId, engagementId] of [["funder", D_FUNDER, ENGAGEMENT], ["GK-only type", D_READINESS, ENGAGEMENT], ["stale", D_STALE, ENGAGEMENT],
    ["other Project", D_OTHER_PROJECT, ENGAGEMENT], ["unknown", id("d", 99), ENGAGEMENT]]) {
    const refused = await getClientInternalDraft({ organizationId: ORG, engagementId, generatedContentDraftId: draftId, actorContext: actor("client_admin") }, dependencies());
    assert.equal(refused.error?.code, "not_found", label);
  }
});

test("internal drafts: only an active client_admin of the organization; other roles, global roles, other organizations, non-humans, and disabled flags are refused before any read", async () => {
  for (const [label, actorContext] of [
    ["binding-derived client_admin", actor("client_admin", { source: "gk_organization_binding" })],
  ]) {
    const allowed = await listClientInternalDrafts({ organizationId: ORG, engagementId: ENGAGEMENT, actorContext }, dependencies());
    assert.equal(allowed.ok, true, label);
  }
  for (const [label, actorContext] of [
    ["client_contributor", actor("client_contributor")],
    ["client_reviewer", actor("client_reviewer")],
    ["organization gk_reviewer", actor("gk_reviewer", { kaiRoles: ["gk_reviewer"] })],
    ["global client_admin over a contributor membership", actor("client_contributor", { kaiRoles: ["client_admin"] })],
    ["client_admin of another organization", actor("client_admin", { organizationId: OTHER_ORG })],
    ["system actor", { ...actor("client_admin"), actorType: "system" }],
  ]) {
    const calls = [];
    const refused = await listClientInternalDrafts({ organizationId: ORG, engagementId: ENGAGEMENT, actorContext }, dependencies(calls));
    assert.equal(refused.ok, false, label);
    assert.deepEqual(calls, [], `${label}: nothing read`);
  }
  const off = await listClientInternalDrafts({ organizationId: ORG, engagementId: ENGAGEMENT, actorContext: actor("client_admin") }, { ...dependencies(), env: { KAI_SPRINT2_ENABLED: "true" } });
  assert.equal(off.error.code, "feature_disabled");
  assert.deepEqual([...__clientGeneratedContentServiceContract.CLIENT_INTERNAL_DRAFT_READ_ROLES], ["client_admin"]);
});

test("capability: readInternalDrafts matches the server check exactly and is the client workflow's flag; readGeneratedDrafts (the GK library) stays false", async () => {
  for (const [roleName, expected] of [["client_admin", true], ["client_contributor", false], ["client_reviewer", false]]) {
    const result = await getOrganizationAccessCapabilities({ organizationId: ORG, actorContext: actor(roleName) }, { env: ENV });
    assert.equal(result.data.workflowOperations.readInternalDrafts, expected, roleName);
    assert.equal(result.data.workflowOperations.readGeneratedDrafts, false, roleName);
    assert.equal(clientEvidenceWorkflowAccess(projectOrganizationAccessCapabilities(result.data)).readInternalDrafts, expected, roleName);
  }
});

// ---------------------------------------------------------------------------
// Pipeline: who a step waits on, and the allowed-use closure
// ---------------------------------------------------------------------------

const { projectPipelineFile, NEXT_ACTION, PIPELINE_REASONS: SERVER_REASONS } = __clientEvidencePipelineServiceContract;
const FILE = "2c000000-0000-4000-8000-0000000000a1";
function row(overrides = {}) {
  return {
    intake_file_id: FILE, safe_filename: "harbourline.csv", upload_state: "confirmed", file_policy_status: "passed", created_at: new Date(NOW),
    parser_status: "completed", file_profile_complete: true, data_dictionary_complete: true, sensitivity_profile_complete: true,
    sensitivity_permission_predicate: true, sensitivity_decision_outcome: "reviewed", source_candidate_continuation_ready: false,
    effective_allowed_use_not_allowed: false, organization_administrator_available: true,
    source_candidate_count: 1, source_candidate_needs_review_count: 1, source_candidate_promoted_count: 0, source_candidate_rejected_count: 0,
    source_candidate_actionable_count: 1, source_version_count: 0, evidence_item_count: 0, evidence_needs_review_count: 0, evidence_reviewed_count: 0,
    claim_count: 0, claim_needs_review_count: 0, open_client_followup_count: 0, claim_ids: [], ...overrides,
  };
}
const NONE = { promoteSource: false, extractEvidence: false, continueSourcePreparation: false, reviewSensitivity: false, getKinderViewer: false };
const ADMIN = { promoteSource: true, extractEvidence: true, continueSourcePreparation: true, reviewSensitivity: true, getKinderViewer: false };
const current = (r, authority) => {
  const { file } = projectPipelineFile(r, new Set(), authority);
  return [file.currentStage, file.currentStatus, file.responsibleParty, file.nextAction, file.reason];
};
const ASK = (stage) => [stage, "waiting_for_client", "client", "ask_organization_administrator", "organization_administrator_action_ready"];

test("pipeline: the administrator's own steps, and for anyone else in the organization the administrator - not Get Kinder - when the organization has one", () => {
  const unreviewed = row({ sensitivity_decision_outcome: null });
  const continuable = row({ source_candidate_count: 0, source_candidate_actionable_count: 0, source_candidate_needs_review_count: 0, source_candidate_continuation_ready: true });
  const promoted = row({ source_candidate_promoted_count: 1, source_version_count: 1, source_candidate_actionable_count: 0 });
  assert.deepEqual(current(unreviewed, ADMIN), ["sensitivity_review", "waiting_for_client", "client", "review_sensitivity", "sensitivity_review_ready"]);
  assert.deepEqual(current(continuable, ADMIN), ["source_review", "waiting_for_client", "client", "continue_source_preparation", "source_preparation_ready"]);
  assert.deepEqual(current(row(), ADMIN), ["source_review", "waiting_for_client", "client", "promote_source", "source_promotion_ready"]);
  assert.deepEqual(current(promoted, ADMIN), ["evidence_extraction", "waiting_for_client", "client", "extract_evidence", "evidence_extraction_ready"]);
  // A contributor or reviewer: the organization's administrator is responsible.
  assert.deepEqual(current(unreviewed, NONE), ASK("sensitivity_review"));
  assert.deepEqual(current(continuable, NONE), ASK("source_review"));
  assert.deepEqual(current(row(), NONE), ASK("source_review"));
  assert.deepEqual(current(promoted, NONE), ASK("evidence_extraction"));
  // No administrator path at all, or a Get Kinder viewer: the Get Kinder state is unchanged.
  for (const [label, r, authority] of [["no administrator", row({ organization_administrator_available: false }), NONE], ["GK viewer", row(), { ...NONE, getKinderViewer: true }]]) {
    assert.deepEqual(current(r, authority), ["source_review", "waiting_for_get_kinder", "get_kinder", "none_waiting_for_get_kinder", "waiting_for_source_promotion"], label);
  }
  // A genuinely missing candidate (not continuable) still says so, for everyone.
  assert.deepEqual(current(row({ source_candidate_count: 0, source_candidate_actionable_count: 0 }), NONE),
    ["source_review", "waiting_for_get_kinder", "get_kinder", "contact_get_kinder", "source_candidate_missing"]);
  // Get Kinder review gates stay Get Kinder's.
  assert.deepEqual(current(row({ source_candidate_promoted_count: 1, source_version_count: 1, evidence_item_count: 2, evidence_needs_review_count: 2 }), ADMIN).slice(0, 3),
    ["evidence_review", "waiting_for_get_kinder", "get_kinder"]);
});

test("pipeline: an effective allowed use of not_allowed closes the file for everyone, before or after promotion; it is never a Get Kinder wait", () => {
  for (const authority of [ADMIN, NONE, { ...NONE, getKinderViewer: true }]) {
    assert.deepEqual(current(row({ effective_allowed_use_not_allowed: true }), authority), ["source_review", "closed", "none", "none", "allowed_use_not_allowed"]);
    assert.deepEqual(current(row({ effective_allowed_use_not_allowed: true, source_candidate_count: 0, source_candidate_actionable_count: 0 }), authority),
      ["source_review", "closed", "none", "none", "allowed_use_not_allowed"]);
    assert.deepEqual(current(row({ effective_allowed_use_not_allowed: true, source_candidate_promoted_count: 1, source_version_count: 1 }), authority),
      ["evidence_extraction", "closed", "none", "none", "allowed_use_not_allowed"]);
  }
  const { file } = projectPipelineFile(row({ effective_allowed_use_not_allowed: true }), new Set(), ADMIN);
  assert.equal(JSON.stringify(file).includes("effective_allowed_use"), false);
  assert.equal(JSON.stringify(file).includes("organization_administrator_available"), false);
  assert.match(nextActionText(file), /recorded allowed use is not_allowed/);
});

test("client vocabulary: the new next actions and reasons match the server, read as the right responsibility, and count as the administrator's source work", () => {
  assert.deepEqual([...PIPELINE_NEXT_ACTIONS].sort(), Object.values(NEXT_ACTION).sort());
  assert.deepEqual([...PIPELINE_REASONS], [...SERVER_REASONS]);
  const ask = { currentStage: "source_review", currentStatus: "waiting_for_client", responsibleParty: "client", nextAction: "ask_organization_administrator", reason: "organization_administrator_action_ready" };
  assert.match(nextActionText(ask), /^No action required from you\. Your organization's administrator can complete this file's source review/);
  assert.doesNotMatch(nextActionText(ask), /Contact Get Kinder/);
  assert.equal(isClientSourceWork(ask), false, "not this viewer's work");
  const review = { currentStage: "sensitivity_review", currentStatus: "waiting_for_client", responsibleParty: "client", nextAction: "review_sensitivity", reason: "sensitivity_review_ready" };
  assert.equal(isClientSourceWork(review), true);
  for (const reason of ["sensitivity_review_ready", "organization_administrator_action_ready", "allowed_use_not_allowed"]) {
    assert.equal(typeof pipelineReasonMessage(reason, 2), "string");
  }
  // Reviews: the administrator's own steps are its source work; other members
  // see them waiting on the administrator, never as Get Kinder's.
  const view = reviewsTabView({ status: "success_with_data", data: { files: [ask, review] } });
  assert.deepEqual([view.sourceWork, view.waitingForAdministrator, view.waitingForGetKinder], [[review], [ask], []]);
});

// ---------------------------------------------------------------------------
// "Use for impact": the next governed step, from persisted state only
// ---------------------------------------------------------------------------

test("Use for impact: each step is the actor's authorized existing operation or a human decision opened for them; everything else is reported, never forced", () => {
  const access = { reviewSensitivity: true, promoteSource: true, extractEvidence: true };
  const file = (nextAction, extra = {}) => ({ currentStage: "source_review", currentStatus: "waiting_for_client", responsibleParty: "client", nextAction, reason: "x", ...extra });
  assert.deepEqual(useForImpactStep(file("review_sensitivity", { currentStage: "sensitivity_review" }), access), { kind: "review_sensitivity" });
  assert.deepEqual(useForImpactStep(file("continue_source_preparation"), access), { kind: "continue" });
  assert.deepEqual(useForImpactStep(file("promote_source"), access), { kind: "confirm_promotion" });
  assert.deepEqual(useForImpactStep(file("extract_evidence", { currentStage: "evidence_extraction" }), access), { kind: "extract" });
  assert.deepEqual(useForImpactStep(file("none_waiting_for_get_kinder", { currentStage: "evidence_review", currentStatus: "waiting_for_get_kinder" }), access), { kind: "done" });
  // Without the authority, or for a blocked file, the actual next action is reported.
  const blocked = useForImpactStep(file("promote_source"), { ...access, promoteSource: false });
  assert.equal(blocked.kind, "blocked");
  const closed = useForImpactStep(file("none", { currentStatus: "closed", responsibleParty: "none", reason: "allowed_use_not_allowed" }), access);
  assert.deepEqual([closed.kind, /not_allowed/.test(closed.text)], ["blocked", true]);
  assert.equal(isUseForImpactCandidate(file("promote_source"), access), true);
  assert.equal(isUseForImpactCandidate(file("contact_get_kinder"), access), false);
});

test("processing permissions: every file whose current decision is a completed review is offered for a corrective re-review at any later stage, by its own intake file id, and only to an actor with the review capability", () => {
  const fileId = (n) => `2c000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
  const rows = {
    unreviewed: row({ intake_file_id: fileId(1), sensitivity_decision_outcome: null }),
    needsMoreInformation: row({ intake_file_id: fileId(2), sensitivity_decision_outcome: "needs_more_information" }),
    noCandidate: row({ intake_file_id: fileId(3), source_candidate_count: 0, source_candidate_actionable_count: 0, source_candidate_continuation_ready: true }),
    openCandidate: row({ intake_file_id: fileId(4) }),
    promoted: row({ intake_file_id: fileId(5), source_candidate_promoted_count: 1, source_version_count: 1, evidence_item_count: 2, evidence_needs_review_count: 2 }),
    closed: row({ intake_file_id: fileId(6), effective_allowed_use_not_allowed: true }),
    policyFailed: row({ intake_file_id: fileId(7), file_policy_status: "failed" }),
  };
  const pipeline = projectClientEvidencePipeline({
    engagementId: ENGAGEMENT,
    files: Object.values(rows).map((r) => projectPipelineFile(r, new Set(), ADMIN).file),
    reviewedImpactFacts: [],
  }, ENGAGEMENT);
  const ids = (files) => files.map((file) => file.intakeFileId);
  const access = { reviewSensitivity: true, promoteSource: true, extractEvidence: true };
  assert.deepEqual(ids(processingPermissionReviewFiles(pipeline, access)),
    [rows.noCandidate, rows.openCandidate, rows.promoted, rows.closed].map((r) => r.intake_file_id));
  // The defect: Source preparation never lists a promoted file, and offers no review on any reviewed file.
  assert.equal(ids(sourcePreparationFiles(pipeline, access)).includes(rows.promoted.intake_file_id), false);
  assert.deepEqual(sourcePreparationFiles(pipeline, access).filter((file) => file.currentStage === "sensitivity_review").map((file) => file.intakeFileId),
    [rows.unreviewed.intake_file_id, rows.needsMoreInformation.intake_file_id], "unreviewed and unresolved files keep their review in Source preparation");
  for (const denied of [{ ...access, reviewSensitivity: false }, {}, null]) assert.deepEqual(processingPermissionReviewFiles(pipeline, denied), []);
  assert.deepEqual(processingPermissionReviewFiles(null, access), []);
  assert.deepEqual(processingPermissionReviewFiles({ files: [{ intakeFileId: fileId(9) }] }, access), [], "a file without stages is never offered");
});

test("UI wiring: Review processing permissions opens the existing sensitivity panel on the pipeline's intake file and refreshes without resuming any processing", () => {
  const workflow = readFileSync(new URL("../frontend/knowledgeStudio/ClientEvidenceWorkflow.jsx", import.meta.url), "utf8");
  assert.match(workflow, /processingPermissionReviewFiles\(pipeline\.data, access\)/);
  assert.match(workflow, /\{access\.reviewSensitivity \? \(\s*<div className="admin-card mb-3" data-client-processing-permissions="">/);
  assert.match(workflow, /data-client-review-processing-permissions=\{file\.intakeFileId\}\s*onClick=\{\(\) => setPreparation\(\{ contextKey, kind: "permissions", file \}\)\}/);
  assert.match(workflow, /intakeFileId=\{openPreparation\.file\.intakeFileId\}\s*safeFilename=\{openPreparation\.file\.safeFilename\}\s*purpose="processing_permissions"/);
  const recorded = workflow.slice(workflow.indexOf("const permissionsRecorded"), workflow.indexOf("// --- Use for impact"));
  assert.match(recorded, /onPipelineRefresh\?\.\(\);\s*refresh\(\);\s*\};/);
  assert.doesNotMatch(recorded, /UseForImpact|postJson/, "a correction runs no step");
  const panel = readFileSync(new URL("../frontend/knowledgeStudio/ClientSensitivityReviewPanel.jsx", import.meta.url), "utf8");
  assert.match(panel, /data-client-processing-permissions-panel=\{permissionsReview \? intakeFileId : undefined\}/);
  assert.match(panel, /if \(result\.replayed\) \{/, "a server replay is never shown as a new decision");
  assert.match(panel, /handoff && handoff\.status === "replayed" \? \(\s*<div>\s*This file&rsquo;s existing source candidate is unchanged/);
  const body = readFileSync(new URL("../frontend/SensitivityReviewCardBody.jsx", import.meta.url), "utf8");
  assert.match(body, /<div data-sensitivity-current-decision>/);
  assert.match(body, /data-sensitivity-new-review/);
});

test("source authorization: the recorded restrictions are shown from the current decision, and a missing review says so", () => {
  const lines = sourceRestrictionLines({
    decision_outcome: "reviewed", reviewed_allowed_use_status: "unknown", reviewed_consent_basis_status: "unknown",
    reviewed_funder_use_allowed: false, reviewed_public_use_allowed: false, reviewed_product_learning_allowed: false, reviewed_llm_processing_allowed: false,
    reviewed_personal_data_status: "present", reviewed_minor_data_status: "absent",
  });
  assert.deepEqual(lines, [
    "Allowed use: unknown; consent basis: unknown.",
    "Funder use: not permitted; public use: not permitted; product learning: not permitted; recorded AI processing permission: not permitted.",
    "Recorded as present: personal information.",
  ]);
  assert.deepEqual(sourceRestrictionLines(null), ["No completed sensitivity & allowed-use review is recorded for this file."]);
});

test("UI wiring: the promotion panel never sends 'promoted' without the explicit confirmation, and a generated draft is opened from the persisted read", () => {
  const panel = readFileSync(new URL("../frontend/knowledgeStudio/ClientSourcePromotionPanel.jsx", import.meta.url), "utf8");
  assert.match(panel, /if \(payload\?\.outcome === "promoted" && !confirmed\) \{\s*setResult\(\{ kind: "warning", text: CONFIRMATION_REQUIRED \}\);\s*return;/);
  const workflow = readFileSync(new URL("../frontend/knowledgeStudio/ClientEvidenceWorkflow.jsx", import.meta.url), "utf8");
  assert.match(workflow, /focusDraftId=\{lastDraft\?\.generatedContentDraftId \|\| null\}/);
  assert.match(workflow, /data-client-use-for-impact=/);
  const drafts = readFileSync(new URL("../frontend/knowledgeStudio/ClientInternalDrafts.jsx", import.meta.url), "utf8");
  assert.match(drafts, /clientInternalDraftPath\(organizationId, engagementId, generatedContentDraftId\)/);
});
