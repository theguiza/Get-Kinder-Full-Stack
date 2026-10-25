import test from "node:test";
import assert from "node:assert/strict";

import {
  approveClientInternalDraftFactualReview,
  getClientInternalDraft,
  __clientGeneratedContentServiceContract,
} from "../Backend/kai/services/kaiClientGeneratedContentService.js";
import { getOrganizationAccessCapabilities } from "../Backend/kai/services/kaiOrganizationAccessCapabilitiesService.js";
import { STORED_ORGANIZATION_MEMBERSHIP_SOURCE } from "../Backend/kai/auth/kaiOrganizationMembershipSource.js";
import {
  BLOCKED_REASONS,
  GET_KINDER_REVIEW_REASONS,
  HIGH_RISK_SENSITIVITY_FIELDS,
  ORGANIZATION_REVIEW_COMPLETION_AUDIT_CONTRACT,
  classifyDraftPacket,
  classifySourceDecision,
  organizationReviewBlockers,
} from "../Backend/kai/dictionary/postgresOrganizationInternalReviewRepository.js";
import {
  CLIENT_INTERNAL_DRAFT_FACTUAL_REVIEW_REASONS,
  projectClientInternalDraft,
  projectOrganizationAccessCapabilities,
} from "../frontend/impactEvidenceLibraryLogic.js";
import {
  clientEvidenceWorkflowAccess,
  INTERNAL_DRAFT_FACTUAL_REVIEW_REASON_MESSAGES,
  INTERNAL_DRAFT_FACTUAL_REVIEW_NEXT_ACTIONS,
  internalDraftFactualReviewHeading,
  internalDraftFactualReviewNextActions,
} from "../frontend/knowledgeStudio/clientEvidenceWorkflowLogic.js";

/**
 * Owner amendment 2026-10-23: an active client_admin is the accountable
 * factual reviewer of an ORDINARY internal evidence summary of its own
 * organization and Project. The classification is the real one; the review
 * lifecycle is a recording stand-in for the generated-content repository
 * that calls the caller's admission hook inside its "transaction", as the
 * real repository does. The PostgreSQL proof is
 * kai-sprint2-p2-01m-source-record-count-measurement.integration.spec.js.
 */

const ENV = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });
const ORG = "11111111-2222-4333-8444-555555555555";
const OTHER_ORG = "99999999-8888-4777-8666-555555555555";
const ENGAGEMENT = "22222222-3333-4444-8555-666666666666";
const OTHER_ENGAGEMENT = "22222222-3333-4444-8555-777777777777";
const T0 = "2026-10-23T09:00:00.000Z";
const id = (prefix, n) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CLAIM = id("c", 1);
const QUEUE = id("9", 1);

const CLEARED = Object.freeze({
  decision_outcome: "reviewed", reviewed_allowed_use_status: "allowed", reviewed_llm_processing_allowed: true,
  reviewed_personal_data_status: "absent", reviewed_minor_data_status: "absent", reviewed_health_housing_justice_immigration_status: "absent",
  reviewed_indigenous_governance_status: "absent", reviewed_story_testimonial_status: "absent", reviewed_small_cell_risk_status: "absent",
  reviewed_consent_basis_status: "unknown", reviewed_staff_notes_status: "present", reviewed_financial_records_status: "unknown",
});

function packet({ contentType = "evidence_summary", audience = "internal", queue = ["open", "needs_gk_review"], eligible = true, updatedAt = T0 } = {}) {
  return {
    generationRunId: id("a", 1), generatedContentDraftId: id("d", 1), contentType, draftStatus: "draft", requestedAudience: audience,
    reviewQueueItemId: QUEUE, queueStatus: queue[0], reviewStatus: queue[1], reviewUpdatedAt: updatedAt, currentUseEligible: eligible,
    exportReviewQueueItemId: null, exportReviewQueueStatus: null, exportReviewStatus: null,
    blocks: [{
      generatedContentBlockId: id("8", 1), ordinal: 1, text: "The source records 5 programme sessions.",
      citations: [{
        generatedContentCitationId: id("f", 1), claimId: CLAIM, evidenceItemId: id("e", 1), sourceId: id("b", 1), sourceCode: "src",
        sourceVersionId: id("7", 1), supportStrength: "strong", claimReviewStatus: "approved", evidenceReviewStatus: "approved",
        currentEligible: eligible, blockerCodes: eligible ? [] : ["claim_review_unresolved"], affectedDimensionKeys: [], affectedObjectIds: [],
        approvedAudiences: ["internal"],
      }],
    }],
  };
}

function actor(roleName, { organizationId = ORG, status = "active", actorType = "human", kaiRoles = [] } = {}) {
  return {
    actorType, actorUserId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", kaiUserStatus: "active", kaiRoles, platformSuperuser: false,
    organizationMemberships: [{ organization_id: organizationId, role_name: roleName, membership_status: status, source: STORED_ORGANIZATION_MEMBERSHIP_SOURCE }],
  };
}

function internalReportAvailability(evaluation, p) {
  const getKinderReviewReasons = evaluation.getKinderReviewReasons
    .filter((reason) => reason !== "content_type_requires_get_kinder_review" || !["evidence_summary", "impact_narrative"].includes(p.contentType));
  return {
    available: getKinderReviewReasons.length === 0 && evaluation.blockedReasons.length === 0,
    getKinderReviewReasons,
    blockedReasons: evaluation.blockedReasons,
  };
}

// A review lifecycle stand-in: state, the admission hook run "in the
// transaction" before any write, and a write log.
function harness({ initial = packet(), decision = CLEARED, reviewer = null } = {}) {
  const state = { packet: initial, decision, writes: [], audits: [], admissions: 0, reviewer, reads: 0 };
  const evaluateInTransaction = async (tx, { packet: p }) => {
    assert.equal(tx, "TX", "evaluated inside the transition's transaction");
    const draft = classifyDraftPacket(p);
    const source = classifySourceDecision(state.decision);
    const getKinderReviewReasons = [...draft.getKinderReviewReasons, ...source.getKinderReviewReasons];
    const blockedReasons = [...draft.blockedReasons, ...source.blockedReasons];
    return { getKinderReviewReasons, blockedReasons, organizationMayReview: getKinderReviewReasons.length + blockedReasons.length === 0 };
  };
  let tick = 0;
  const transition = (from, to) => async (input, deps) => {
    assert.ok(deps.metadataOnlyAudit, "audit is required");
    assert.equal(typeof deps.reviewAdmission, "function", "the organization admission is always passed");
    if (input.expectedUpdatedAt !== state.packet.reviewUpdatedAt) return { ok: false, error: { code: "conflict_current_state_changed", status: 409 } };
    if (state.packet.queueStatus !== from) return { ok: false, error: { code: "conflict_current_state_changed", status: 409 } };
    state.admissions += 1;
    const refusal = await deps.reviewAdmission("TX", state.packet);
    if (refusal) return refusal;
    state.writes.push({ method: to, actorUserId: input.actorContext.actorUserId, contract: deps.completionAuditContract ?? null });
    state.packet = { ...state.packet, queueStatus: to, reviewStatus: to === "resolved" ? "resolved" : "needs_gk_review", reviewUpdatedAt: input.now };
    if (to === "resolved") state.reviewer = deps.completionAuditContract === ORGANIZATION_REVIEW_COMPLETION_AUDIT_CONTRACT ? "organization" : "get_kinder";
    return { ok: true, data: { replayed: false } };
  };
  const dependencies = {
    env: ENV,
    now: () => new Date(Date.parse(T0) + (tick += 1000)).toISOString(),
    createReviewAudit: ({ reviewQueueItemId, now }) => {
      state.audits.push({ reviewQueueItemId, now });
      return { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => ({ ok: true }) }) };
    },
    evaluateOrganizationInternalReviewInTransaction: evaluateInTransaction,
    getEngagementForOrganization: async ({ organizationId, engagementId }) => (organizationId === ORG && [ENGAGEMENT, OTHER_ENGAGEMENT].includes(engagementId)
      ? { engagement_id: engagementId, organization_id: organizationId } : null),
    readGeneratedDraftEngagementId: async (organizationId, draftId) => (organizationId === ORG && draftId === id("d", 1) ? ENGAGEMENT : null),
    organizationReviewRepository: {
      evaluate: async ({ packet: p }) => evaluateInTransaction("TX", { packet: p }),
      evaluateInternalReport: async ({ packet: p }) => internalReportAvailability(await evaluateInTransaction("TX", { packet: p }), p),
      readCompletedReviewer: async () => state.reviewer,
    },
    // The internal report read over the same classifiers (owner decision
    // 2026-10-25): available with no review once ordinary and eligible.
    internalReportRepository: {
      async readInternalReport() {
        return { ok: true, data: internalReportAvailability(await evaluateInTransaction("TX", { packet: state.packet }), state.packet) };
      },
    },
    generatedContentRepository: {
      async getGeneratedDraftReviewPacket() {
        state.reads += 1;
        return { ok: true, data: state.packet };
      },
      startGeneratedContentReview: transition("open", "in_progress"),
      completeGeneratedContentReview: transition("in_progress", "resolved"),
    },
  };
  return { state, dependencies };
}

const approve = (dependencies, overrides = {}) => approveClientInternalDraftFactualReview({
  organizationId: ORG, engagementId: ENGAGEMENT, generatedContentDraftId: id("d", 1), decision: "approved", actorContext: actor("client_admin"), ...overrides,
}, dependencies);

test("classification: an ordinary source is a complete 'reviewed' decision permitting use and AI with every section 7.2 high-risk category 'absent'", () => {
  assert.deepEqual(classifySourceDecision(CLEARED), { getKinderReviewReasons: [], blockedReasons: [] });
  for (const [field, reason] of Object.entries(HIGH_RISK_SENSITIVITY_FIELDS)) {
    for (const value of ["present", "unknown", null]) {
      assert.deepEqual(classifySourceDecision({ ...CLEARED, [field]: value }).getKinderReviewReasons, [reason], `${field}=${value}`);
    }
  }
  assert.deepEqual(classifySourceDecision(null).getKinderReviewReasons, ["sensitivity_review_not_complete"]);
  assert.deepEqual(classifySourceDecision({ ...CLEARED, decision_outcome: "needs_more_information" }).getKinderReviewReasons, ["sensitivity_review_not_complete"]);
  assert.deepEqual(classifySourceDecision({ ...CLEARED, reviewed_allowed_use_status: "not_allowed" }).blockedReasons, ["processing_permission_not_established"]);
  assert.deepEqual(classifySourceDecision({ ...CLEARED, reviewed_llm_processing_allowed: false }).blockedReasons, ["processing_permission_not_established"]);
  assert.deepEqual(classifyDraftPacket(packet()), { getKinderReviewReasons: [], blockedReasons: [] });
  assert.deepEqual(classifyDraftPacket(packet({ contentType: "impact_narrative" })).getKinderReviewReasons, ["content_type_requires_get_kinder_review"]);
  assert.deepEqual(classifyDraftPacket(packet({ audience: "funder" })).getKinderReviewReasons, ["audience_requires_get_kinder_review"]);
  assert.deepEqual(classifyDraftPacket(packet({ eligible: false })).blockedReasons, ["cited_claims_not_currently_eligible"]);
  assert.deepEqual(organizationReviewBlockers({ getKinderReviewReasons: ["story_testimonial_not_cleared"], blockedReasons: [] }),
    [{ validator_key: "VAL-KAI-ORG-REVIEW-001", severity: "blocker", blocking_reason: "story_testimonial_not_cleared" }]);
  // The browser knows every server reason, with words for each.
  assert.deepEqual([...CLIENT_INTERNAL_DRAFT_FACTUAL_REVIEW_REASONS].sort(), [...GET_KINDER_REVIEW_REASONS, ...BLOCKED_REASONS].sort());
  for (const reason of CLIENT_INTERNAL_DRAFT_FACTUAL_REVIEW_REASONS) assert.ok(INTERNAL_DRAFT_FACTUAL_REVIEW_REASON_MESSAGES[reason], reason);
});

test("approval: the administrator's one action runs the existing start then complete, each admitted in its transaction, attributed to the human, with the organization completion contract", async () => {
  const { state, dependencies } = harness();
  const result = await approve(dependencies);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.data, { generatedContentDraftId: id("d", 1), reviewState: "reviewed_by_your_organization", replayed: false });
  assert.deepEqual(state.writes, [
    { method: "in_progress", actorUserId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", contract: null },
    { method: "resolved", actorUserId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", contract: ORGANIZATION_REVIEW_COMPLETION_AUDIT_CONTRACT },
  ]);
  assert.equal(state.admissions, 2, "both transitions re-checked the draft");
  assert.deepEqual(state.audits.map((audit) => audit.reviewQueueItemId), [QUEUE, QUEUE]);
  // Idempotent: a repeat records nothing new.
  const again = await approve(dependencies);
  assert.deepEqual(again.data, { generatedContentDraftId: id("d", 1), reviewState: "reviewed_by_your_organization", replayed: true });
  assert.equal(state.writes.length, 2);
  // A review already in progress is completed without a second start.
  const started = harness({ initial: packet({ queue: ["in_progress", "needs_gk_review"] }) });
  assert.equal((await approve(started.dependencies)).ok, true);
  assert.deepEqual(started.state.writes.map((write) => write.method), ["resolved"]);
});

test("approval: a high-risk, unsupported, stale or no-longer-permitted draft is refused with structured blockers and nothing is written", async () => {
  for (const [label, options, reason] of [
    ["story/testimonial present", { decision: { ...CLEARED, reviewed_story_testimonial_status: "present" } }, "story_testimonial_not_cleared"],
    ["identifying personal information present", { decision: { ...CLEARED, reviewed_personal_data_status: "present" } }, "personal_information_not_cleared"],
    ["minors unknown", { decision: { ...CLEARED, reviewed_minor_data_status: "unknown" } }, "minor_information_not_cleared"],
    ["governance unresolved", { decision: { ...CLEARED, reviewed_indigenous_governance_status: "unknown" } }, "indigenous_governance_not_cleared"],
    ["no completed sensitivity review", { decision: null }, "sensitivity_review_not_complete"],
    ["prohibited use", { decision: { ...CLEARED, reviewed_allowed_use_status: "not_allowed", reviewed_llm_processing_allowed: false } }, "processing_permission_not_established"],
    ["cited claim not currently eligible (unsupported or stale)", { initial: packet({ eligible: false }) }, "cited_claims_not_currently_eligible"],
  ]) {
    const { state, dependencies } = harness(options);
    const refused = await approve(dependencies);
    assert.equal(refused.ok, false, label);
    assert.equal(refused.error.code, "blocked", label);
    assert.equal(refused.error.status, 422, label);
    assert.ok(refused.blockers.some((blocker) => blocker.blocking_reason === reason && blocker.validator_key === "VAL-KAI-ORG-REVIEW-001"), label);
    assert.deepEqual(state.writes, [], `${label}: nothing written`);
  }
  // A change between the reviewer's read and the write is caught by the
  // in-transaction re-check (the read said ordinary; the write sees risk).
  const { state, dependencies } = harness();
  const start = dependencies.generatedContentRepository.startGeneratedContentReview;
  dependencies.generatedContentRepository.startGeneratedContentReview = async (input, deps) => {
    state.decision = { ...CLEARED, reviewed_small_cell_risk_status: "present" };
    return start(input, deps);
  };
  const raced = await approve(dependencies);
  assert.equal(raced.error.code, "blocked");
  assert.deepEqual(state.writes, []);
  // A stale optimistic version is a conflict, never a write.
  const stale = harness();
  stale.dependencies.generatedContentRepository.getGeneratedDraftReviewPacket = async () => ({ ok: true, data: { ...stale.state.packet, reviewUpdatedAt: "2026-10-23T08:00:00.000Z" } });
  assert.equal((await approve(stale.dependencies)).error.code, "conflict_current_state_changed");
  assert.deepEqual(stale.state.writes, []);
  // A draft whose cited claim is no longer traceable cannot be read, so it cannot be reviewed.
  const untraceable = harness();
  untraceable.dependencies.generatedContentRepository.getGeneratedDraftReviewPacket = async () => ({ ok: false, error: { code: "conflict_current_state_changed", status: 409 } });
  assert.equal((await approve(untraceable.dependencies)).error.code, "conflict_current_state_changed");
});

test("approval: only an active client_admin of this organization, for its Project's internal evidence summary; AI, system, GK, other roles, other organizations, inactive members, other decisions and disabled flags are refused before any read", async () => {
  for (const [label, actorContext] of [
    ["client_reviewer", actor("client_reviewer")],
    ["client_contributor", actor("client_contributor")],
    ["organization gk_reviewer", actor("gk_reviewer", { kaiRoles: ["gk_reviewer"] })],
    ["organization gk_admin (GK uses its own review route)", actor("gk_admin", { kaiRoles: ["gk_admin"] })],
    ["client_admin of another organization", actor("client_admin", { organizationId: OTHER_ORG })],
    ["inactive client_admin", actor("client_admin", { status: "inactive" })],
    ["AI actor", actor("client_admin", { actorType: "ai" })],
    ["system actor", actor("client_admin", { actorType: "system" })],
  ]) {
    const { state, dependencies } = harness();
    const refused = await approve(dependencies, { actorContext });
    assert.equal(refused.ok, false, label);
    assert.equal(refused.error.status, 403, `${label}: ${refused.error.code}`);
    assert.deepEqual([state.reads, state.writes.length], [0, 0], `${label}: nothing read or written`);
  }
  for (const [label, overrides] of [["rejected", { decision: "rejected" }], ["needs_changes", { decision: "needs_changes" }], ["missing", { decision: undefined }]]) {
    const { state, dependencies } = harness();
    assert.equal((await approve(dependencies, overrides)).error.code, "validation_blocker", label);
    assert.equal(state.reads, 0, label);
  }
  const off = harness();
  assert.equal((await approve({ ...off.dependencies, env: { KAI_SPRINT2_ENABLED: "true" } })).error.code, "feature_disabled");
  assert.equal((await approve({ ...off.dependencies, env: { KAI_GENERATION_ENABLED: "true" } })).error.code, "feature_disabled");
  // The internal review needs no export flag (it releases nothing).
  assert.equal((await approve(off.dependencies)).ok, true);
  for (const [label, options, overrides] of [
    ["another Project", {}, { engagementId: OTHER_ENGAGEMENT }],
    ["another organization's path", {}, { organizationId: OTHER_ORG, actorContext: actor("client_admin", { organizationId: OTHER_ORG }) }],
    ["funder audience", { initial: packet({ audience: "funder" }) }, {}],
    ["GK-only type", { initial: packet({ contentType: "readiness_assessment" }) }, {}],
  ]) {
    const { state, dependencies } = harness(options);
    const refused = await approve(dependencies, overrides);
    assert.equal(refused.error.code, "not_found", label);
    assert.deepEqual(state.writes, [], label);
  }
  const narrative = harness({ initial: packet({ contentType: "impact_narrative" }) });
  const held = await approve(narrative.dependencies);
  assert.deepEqual([held.error.code, held.blockers.map((b) => b.blocking_reason)], ["blocked", ["content_type_requires_get_kinder_review"]]);
  const { dependencies } = harness();
  assert.equal((await approve({ ...dependencies, createReviewAudit: undefined })).error.code, "system_error", "never without audit");
  assert.deepEqual([...__clientGeneratedContentServiceContract.CLIENT_INTERNAL_FACTUAL_REVIEW_ROLES], ["client_admin"]);
});

test("detail: an ordinary unreviewed summary is the organization's internal report with no approval offered; a held one shows Get Kinder's reasons; a completed one says who reviewed it", async () => {
  const read = (dependencies) => getClientInternalDraft({ organizationId: ORG, engagementId: ENGAGEMENT, generatedContentDraftId: id("d", 1), actorContext: actor("client_admin") }, dependencies);
  const ordinary = harness();
  const detail = await read(ordinary.dependencies);
  assert.equal(detail.ok, true, JSON.stringify(detail));
  assert.equal(detail.data.reviewState, "awaiting_organization_review", "the review lifecycle itself is reported unchanged");
  // Owner decision 2026-10-25: no factual approval is required for internal use.
  assert.deepEqual(detail.data.internalReport, { available: true, getKinderReviewReasons: [], blockedReasons: [] });
  assert.equal(detail.data.internalReportAvailable, true);
  assert.deepEqual(detail.data.limitations, ["internal_use_only", "not_approved_for_external_use"]);
  assert.deepEqual(detail.data.release, { state: "awaiting_organization_review", releasedReportId: null });
  assert.deepEqual(detail.data.factualReview, { actorMayApprove: false, getKinderReviewReasons: [], blockedReasons: [] }, "no approval is offered");
  const projected = projectClientInternalDraft(detail.data);
  assert.equal(projected.factualReview.actorMayApprove, false);
  assert.equal(projected.internalReport.available, true);
  assert.equal(projectClientInternalDraft({ ...detail.data, factualReview: { actorMayApprove: true, getKinderReviewReasons: ["invented"], blockedReasons: [] } })
    .factualReview.actorMayApprove, false, "a malformed view offers no approval");

  const held = harness({ decision: { ...CLEARED, reviewed_story_testimonial_status: "present" } });
  const heldDetail = await read(held.dependencies);
  assert.equal(heldDetail.data.reviewState, "awaiting_get_kinder_review");
  assert.deepEqual(heldDetail.data.factualReview, { actorMayApprove: false, getKinderReviewReasons: ["story_testimonial_not_cleared"], blockedReasons: [] });

  const blocked = harness({ initial: packet({ eligible: false }) });
  const blockedDetail = await read(blocked.dependencies);
  assert.equal(blockedDetail.data.reviewState, "awaiting_organization_review");
  assert.deepEqual(blockedDetail.data.factualReview, { actorMayApprove: false, getKinderReviewReasons: [], blockedReasons: ["cited_claims_not_currently_eligible"] });
  assert.equal(internalDraftFactualReviewHeading(blockedDetail.data.reviewState, blockedDetail.data.factualReview), "Factual approval blocked");
  assert.deepEqual(internalDraftFactualReviewNextActions(blockedDetail.data.factualReview.blockedReasons), [
    INTERNAL_DRAFT_FACTUAL_REVIEW_NEXT_ACTIONS.cited_claims_not_currently_eligible,
  ]);
  assert.match(INTERNAL_DRAFT_FACTUAL_REVIEW_NEXT_ACTIONS.cited_claims_not_currently_eligible, /Ask Get Kinder/);
  assert.equal(blockedDetail.data.factualReview.actorMayApprove, false, "no approval action is exposed for the blocked draft");

  assert.equal((await approve(ordinary.dependencies)).ok, true);
  const after = await read(ordinary.dependencies);
  assert.equal(after.data.reviewState, "reviewed_by_your_organization");
  assert.deepEqual(after.data.limitations, ["internal_use_only", "not_approved_for_external_use"]);
  assert.deepEqual(after.data.factualReview, { actorMayApprove: false, getKinderReviewReasons: [], blockedReasons: [] });
  // Release stays Get Kinder's; without the export flag the status is unavailable, never "released".
  assert.deepEqual(after.data.release, { state: "release_status_unavailable", releasedReportId: null });
  const gk = harness({ initial: packet({ queue: ["resolved", "resolved"] }), reviewer: "get_kinder" });
  assert.equal((await read(gk.dependencies)).data.reviewState, "reviewed_by_get_kinder");
});

test("capability: reviewInternalDraftFactualContent is the service's own role check, client_admin only, and fails closed in the browser projection", async () => {
  for (const [roleName, expected] of [["client_admin", true], ["client_contributor", false], ["client_reviewer", false]]) {
    const result = await getOrganizationAccessCapabilities({ organizationId: ORG, actorContext: actor(roleName) }, { env: ENV });
    assert.equal(result.data.workflowOperations.reviewInternalDraftFactualContent, expected, roleName);
    assert.equal(clientEvidenceWorkflowAccess(projectOrganizationAccessCapabilities(result.data)).reviewInternalDraftFactualContent, expected, roleName);
  }
  const inactive = await getOrganizationAccessCapabilities({ organizationId: ORG, actorContext: actor("client_admin", { status: "inactive" }) }, { env: ENV });
  assert.notEqual(inactive.data?.workflowOperations?.reviewInternalDraftFactualContent, true);
});
