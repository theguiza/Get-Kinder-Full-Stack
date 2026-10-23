import test from "node:test";
import assert from "node:assert/strict";

import {
  getClientInternalDraft,
  releaseClientInternalReport,
  __clientGeneratedContentServiceContract,
} from "../Backend/kai/services/kaiClientGeneratedContentService.js";
import { getOrganizationAccessCapabilities } from "../Backend/kai/services/kaiOrganizationAccessCapabilitiesService.js";
import { STORED_ORGANIZATION_MEMBERSHIP_SOURCE } from "../Backend/kai/auth/kaiOrganizationMembershipSource.js";
import { RELEASE_BLOCKED_REASONS, GET_KINDER_REVIEW_REASONS, BLOCKED_REASONS } from "../Backend/kai/dictionary/postgresOrganizationInternalReviewRepository.js";
import {
  createPostgresHumanAuthorityDecisionRepository,
  __humanAuthorityDecisionRepositoryTestables,
} from "../Backend/kai/dictionary/postgresHumanAuthorityDecisionRepository.js";
import { createPostgresExportCandidateRepository } from "../Backend/kai/dictionary/postgresExportCandidateRepository.js";
import { LIMITATION_SNAPSHOT_ALLOWED_ROLES, EXPORT_CANDIDATE_ALLOWED_ROLES } from "../Backend/kai/dictionary/exportCandidateContract.js";
import { HUMAN_AUTHORITY_DECISION_ROLE_BY_TYPE } from "../Backend/kai/dictionary/humanAuthorityDecisionContract.js";
import { __exportReviewServiceContract } from "../Backend/kai/services/kaiExportReviewService.js";
import { CREATE_EXPORT_MANIFEST_ALLOWED_ROLES } from "../Backend/kai/dictionary/exportManifestContract.js";
import {
  CLIENT_INTERNAL_DRAFT_RELEASE_REASONS,
  CLIENT_INTERNAL_DRAFT_RELEASE_STATES,
  projectClientInternalDraft,
  projectOrganizationAccessCapabilities,
} from "../frontend/impactEvidenceLibraryLogic.js";
import {
  clientEvidenceWorkflowAccess,
  INTERNAL_DRAFT_RELEASE_REASON_MESSAGES,
  INTERNAL_DRAFT_RELEASE_STATE_LABELS,
  INTERNAL_DRAFT_RELEASE_STATE_MESSAGES,
} from "../frontend/knowledgeStudio/clientEvidenceWorkflowLogic.js";

/**
 * Owner amendment 2026-10-23: an active client_admin makes the final-release
 * decision for an ORDINARY internal evidence summary of its own organization
 * and Project whose factual review is complete. The release chain here is a
 * set of recording stand-ins for the real repositories that call the
 * caller's releaseAdmission inside their "transaction", as the real ones do.
 * The PostgreSQL proof (migration, constraints, real repositories) is
 * kai-sprint2-p2-01m-source-record-count-measurement.integration.spec.js on
 * the Plan A normal migration chain.
 */

const ENV = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true", KAI_PUBLIC_EXPORT_ENABLED: "true" });
const ORG = "11111111-2222-4333-8444-555555555555";
const OTHER_ORG = "99999999-8888-4777-8666-555555555555";
const ENGAGEMENT = "22222222-3333-4444-8555-666666666666";
const OTHER_ENGAGEMENT = "22222222-3333-4444-8555-777777777777";
const T0 = "2026-10-23T09:00:00.000Z";
const id = (prefix, n) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DRAFT = id("d", 1);
const CLAIM = id("c", 1);
const EVIDENCE = id("e", 1);
const QUEUE = id("9", 1);
const EXPORT_QUEUE = id("9", 2);
const CANDIDATE = id("6", 1);
const MANIFEST = id("5", 1);
const LIMITATIONS = Object.freeze(["measurement.counting_unit_human_defined", "measurement.period_attested_not_verified"]);
const ORDINARY = Object.freeze({ getKinderReviewReasons: [], blockedReasons: [], organizationMayRelease: true });

function packet({ contentType = "evidence_summary", audience = "internal", queue = ["resolved", "resolved"], eligible = true } = {}) {
  return {
    generationRunId: id("a", 1), generatedContentDraftId: DRAFT, contentType, draftStatus: "draft", requestedAudience: audience,
    reviewQueueItemId: QUEUE, queueStatus: queue[0], reviewStatus: queue[1], reviewUpdatedAt: T0, currentUseEligible: eligible,
    exportReviewQueueItemId: null, exportReviewQueueStatus: null, exportReviewStatus: null,
    blocks: [{
      generatedContentBlockId: id("8", 1), ordinal: 1, text: "The source records 5 programme sessions.",
      citations: [{
        generatedContentCitationId: id("f", 1), claimId: CLAIM, evidenceItemId: EVIDENCE, sourceId: id("b", 1), sourceCode: "src",
        sourceVersionId: id("7", 1), supportStrength: "strong", claimReviewStatus: "approved", evidenceReviewStatus: "approved",
        currentEligible: eligible, blockerCodes: [], affectedDimensionKeys: [], affectedObjectIds: [], approvedAudiences: ["internal"],
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

// The release chain stand-in: each write records itself after running the
// caller's admission "in its transaction"; `release` holds the latest
// manifest, `evaluation` what the in-transaction evaluator returns now.
function harness({ initial = packet(), evaluation = ORDINARY, refuseAt = null, released = null, exportReviewStatus = null } = {}) {
  const state = {
    packet: initial, evaluation, writes: [], admissions: [], audits: [], reads: 0, released,
    exportReview: exportReviewStatus ? { status: exportReviewStatus, updatedAt: T0 } : null,
  };
  const admitted = async (step, deps) => {
    assert.equal(typeof deps.releaseAdmission, "function", `${step}: the organization admission is always passed`);
    assert.ok(deps.metadataOnlyAudit, `${step}: audit is required`);
    state.admissions.push(step);
    if (refuseAt === step) state.evaluation = { getKinderReviewReasons: ["personal_information_not_cleared"], blockedReasons: [], organizationMayRelease: false };
    return deps.releaseAdmission("TX");
  };
  const write = (step, result) => async (input, deps) => {
    const refusal = await admitted(step, deps);
    if (refusal) return refusal;
    state.writes.push({ step, actorUserId: input.actorContext.actorUserId, role: input.confirmedByRole ?? input.decidedByRole ?? null, input });
    return result(input);
  };
  const dependencies = {
    env: ENV,
    now: (() => { let tick = 0; return () => new Date(Date.parse(T0) + (tick += 1000)).toISOString(); })(),
    createReleaseAudit: ({ step, now, exportCandidateId }) => {
      state.audits.push({ step, now, exportCandidateId: exportCandidateId ?? null });
      return { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => ({ ok: true }) }) };
    },
    evaluateOrganizationInternalReleaseInTransaction: async (tx, { organizationId, generatedContentDraftId }) => {
      assert.deepEqual([tx, organizationId, generatedContentDraftId], ["TX", ORG, DRAFT], "evaluated inside the write's transaction for this draft");
      return state.evaluation;
    },
    getEngagementForOrganization: async ({ organizationId, engagementId }) => (organizationId === ORG && [ENGAGEMENT, OTHER_ENGAGEMENT].includes(engagementId)
      ? { engagement_id: engagementId, organization_id: organizationId } : null),
    readGeneratedDraftEngagementId: async (organizationId, draftId) => (organizationId === ORG && draftId === DRAFT ? ENGAGEMENT : null),
    organizationReviewRepository: {
      evaluate: async () => ({ getKinderReviewReasons: [], blockedReasons: [], organizationMayReview: true }),
      evaluateRelease: async () => state.evaluation,
      readCompletedReviewer: async () => "organization",
      readExportReviewState: async ({ exportReviewQueueItemId }) => (state.exportReview && exportReviewQueueItemId === EXPORT_QUEUE
        ? { requestedExportAudience: "internal", exportReviewQueueItemId, exportReviewQueueStatus: state.exportReview.status, exportReviewStatus: state.exportReview.status === "resolved" ? "resolved" : "needs_gk_review", exportReviewUpdatedAt: state.exportReview.updatedAt }
        : null),
    },
    releasedReportRepository: {
      readLatestInternalReleaseForDraft: async () => state.released,
      readReleasedReportScope: async () => null,
    },
    renderModelRepository: { composeExportManifestRenderModel: async () => (state.released?.valid ? { ok: true, data: {} } : { ok: false, error: { code: "conflict_current_state_changed" } }) },
    generatedContentRepository: {
      async getGeneratedDraftReviewPacket() {
        state.reads += 1;
        return { ok: true, data: state.packet };
      },
      requestGeneratedDraftExportReview: write("export_review_request", (input) => {
        assert.equal(input.requestedExportAudience, "internal");
        state.exportReview ||= { status: "open", updatedAt: input.now };
        return { ok: true, data: { exportReviewRequestAccepted: true, reviewQueueItemId: EXPORT_QUEUE, replayed: false } };
      }),
      startGeneratedDraftExportReview: write("export_review_start", (input) => {
        assert.equal(input.expectedUpdatedAt, state.exportReview.updatedAt);
        state.exportReview = { status: "in_progress", updatedAt: input.now };
        return { ok: true, data: {} };
      }),
      completeGeneratedDraftExportReview: write("export_review_complete", (input) => {
        assert.equal(input.expectedUpdatedAt, state.exportReview.updatedAt);
        state.exportReview = { status: "resolved", updatedAt: input.now };
        return { ok: true, data: {} };
      }),
    },
    exportCandidateRepository: {
      loadCitedPairsForDraft: async () => ({ ok: true, data: { citedPairs: [{ claimId: CLAIM, evidenceItemId: EVIDENCE, limitationCodes: [...LIMITATIONS] }] } }),
      confirmLimitationSnapshot: write("limitation_snapshot", () => ({ ok: true, data: { limitationSnapshotId: id("4", 1), replayed: false } })),
      createExportCandidate: write("export_candidate", () => ({ ok: true, data: { exportCandidateId: CANDIDATE, replayed: false } })),
    },
    humanAuthorityDecisionRepository: {
      recordDecision: write("final_release_authority", (input) => ({ ok: true, data: { decisionId: id("3", 1), decidedByRole: input.decidedByRole, replayed: false } })),
    },
    exportManifestRepository: {
      createExportManifest: write("export_manifest", () => {
        state.released = { exportManifestId: MANIFEST, decidedByRole: "client_admin", valid: true };
        return { ok: true, data: { exportManifestId: MANIFEST, replayed: false } };
      }),
    },
  };
  return { state, dependencies };
}

const release = (dependencies, overrides = {}) => releaseClientInternalReport({
  organizationId: ORG, engagementId: ENGAGEMENT, generatedContentDraftId: DRAFT, decision: "release_for_internal_use", limitationsConfirmed: true,
  actorContext: actor("client_admin"), ...overrides,
}, dependencies);

const RELEASE_STEPS = ["export_review_request", "export_review_start", "export_review_complete", "limitation_snapshot", "export_candidate", "final_release_authority", "export_manifest"];

test("release: the administrator's one decision runs the existing chain, each write admitted in its own transaction and recorded under the human's own identity and client_admin role", async () => {
  const { state, dependencies } = harness();
  const released = await release(dependencies);
  assert.equal(released.ok, true, JSON.stringify(released));
  assert.deepEqual(released.data, { generatedContentDraftId: DRAFT, releaseState: "released_for_internal_use", releasedReportId: MANIFEST, releasedBy: "your_organization", replayed: false });
  assert.deepEqual(state.admissions, RELEASE_STEPS, "every write re-checks the draft before writing");
  assert.deepEqual(state.writes.map((w) => w.step), RELEASE_STEPS);
  assert.ok(state.writes.every((w) => w.actorUserId === actor("client_admin").actorUserId), "the real human on every write");
  const byStep = Object.fromEntries(state.writes.map((w) => [w.step, w]));
  assert.equal(byStep.limitation_snapshot.role, "client_admin");
  assert.deepEqual(byStep.limitation_snapshot.input.entries, [{ claimId: CLAIM, evidenceItemId: EVIDENCE, limitationCodes: [...LIMITATIONS] }],
    "the snapshot is the draft's own cited pairs with every derived limitation");
  assert.deepEqual(
    [byStep.final_release_authority.role, byStep.final_release_authority.input.decisionType, byStep.final_release_authority.input.decisionAction, byStep.final_release_authority.input.requestedAudience],
    ["client_admin", "export_authority_granted", "grant", "internal"],
  );
  assert.equal(byStep.export_manifest.input.exportReviewQueueItemId, EXPORT_QUEUE);
  assert.deepEqual(state.audits.map((a) => a.step), RELEASE_STEPS, "one production audit per step");
  assert.deepEqual(state.audits.filter((a) => a.exportCandidateId).map((a) => a.step), ["final_release_authority", "export_manifest"]);
  assert.deepEqual(__clientGeneratedContentServiceContract.RELEASE_AUDIT_STEPS, RELEASE_STEPS);

  // A repeat while the release is valid writes nothing.
  const replay = await release(dependencies);
  assert.deepEqual([replay.ok, replay.data.replayed, replay.data.releasedReportId], [true, true, MANIFEST]);
  assert.equal(state.writes.length, RELEASE_STEPS.length);
});

test("release: an interrupted release resumes where it stopped; an existing export review is advanced, never requested again", async () => {
  for (const [status, expected] of [
    ["resolved", ["limitation_snapshot", "export_candidate", "final_release_authority", "export_manifest"]],
    ["in_progress", ["export_review_complete", "limitation_snapshot", "export_candidate", "final_release_authority", "export_manifest"]],
  ]) {
    const exportReview = { exportReviewQueueItemId: EXPORT_QUEUE, exportReviewQueueStatus: status, exportReviewStatus: status === "resolved" ? "resolved" : "needs_gk_review" };
    const { state, dependencies } = harness({ initial: { ...packet(), ...exportReview }, exportReviewStatus: status });
    const result = await release(dependencies);
    assert.equal(result.ok, true, `${status}: ${JSON.stringify(result)}`);
    assert.deepEqual(state.writes.map((w) => w.step), expected, status);
  }
});

test("release: a draft that is no longer ordinary is refused with structured blockers, at the pre-check or inside whichever write sees it, and nothing further is written", async () => {
  for (const [label, evaluation, codes] of [
    ["high-risk source", { getKinderReviewReasons: ["small_cell_risk_not_cleared"], blockedReasons: [], organizationMayRelease: false }, ["small_cell_risk_not_cleared"]],
    ["sensitivity unknown", { getKinderReviewReasons: ["sensitivity_review_not_complete"], blockedReasons: [], organizationMayRelease: false }, ["sensitivity_review_not_complete"]],
    ["not reviewed", { getKinderReviewReasons: [], blockedReasons: ["factual_review_not_complete"], organizationMayRelease: false }, ["factual_review_not_complete"]],
    ["stale", { getKinderReviewReasons: [], blockedReasons: ["source_version_not_current", "release_state_not_current"], organizationMayRelease: false }, ["source_version_not_current", "release_state_not_current"]],
    ["prohibited use", { getKinderReviewReasons: [], blockedReasons: ["processing_permission_not_established"], organizationMayRelease: false }, ["processing_permission_not_established"]],
  ]) {
    const { state, dependencies } = harness({ evaluation });
    const refused = await release(dependencies);
    assert.deepEqual([refused.ok, refused.error.code, refused.error.status], [false, "blocked", 422], label);
    assert.deepEqual(refused.blockers.map((b) => b.blocking_reason), codes, label);
    assert.ok(refused.blockers.every((b) => b.validator_key === "VAL-KAI-ORG-REVIEW-001" && b.severity === "blocker"), label);
    assert.deepEqual(state.writes, [], `${label}: nothing written`);
  }
  for (const step of ["export_review_start", "limitation_snapshot", "final_release_authority", "export_manifest"]) {
    const { state, dependencies } = harness({ refuseAt: step });
    const refused = await release(dependencies);
    assert.deepEqual([refused.error.code, refused.blockers.map((b) => b.blocking_reason)], ["blocked", ["personal_information_not_cleared"]], step);
    assert.equal(state.writes.some((w) => w.step === step), false, `${step}: refused before its write`);
    assert.equal(state.writes.length, RELEASE_STEPS.indexOf(step), `${step}: nothing after it`);
  }
  const narrative = harness({ initial: packet({ contentType: "impact_narrative" }), evaluation: { getKinderReviewReasons: ["content_type_requires_get_kinder_review"], blockedReasons: [], organizationMayRelease: false } });
  const held = await release(narrative.dependencies);
  assert.deepEqual([held.error.code, held.blockers.map((b) => b.blocking_reason)], ["blocked", ["content_type_requires_get_kinder_review"]]);
});

test("release: only an active client_admin of this organization, for its Project's internal draft, with the explicit decision and confirmation; AI, GK, other roles and organizations, inactive members and disabled flags are refused before any read", async () => {
  for (const [label, actorContext] of [
    ["client_reviewer", actor("client_reviewer")],
    ["client_contributor", actor("client_contributor")],
    ["organization gk_reviewer", actor("gk_reviewer", { kaiRoles: ["gk_reviewer"] })],
    ["organization gk_admin (GK releases through its own routes)", actor("gk_admin", { kaiRoles: ["gk_admin"] })],
    ["client_admin of another organization", actor("client_admin", { organizationId: OTHER_ORG })],
    ["inactive client_admin", actor("client_admin", { status: "inactive" })],
    ["AI actor", actor("client_admin", { actorType: "ai" })],
    ["system actor", actor("client_admin", { actorType: "system" })],
  ]) {
    const { state, dependencies } = harness();
    const refused = await release(dependencies, { actorContext });
    assert.deepEqual([refused.ok, refused.error.status], [false, 403], `${label}: ${refused.error.code}`);
    assert.deepEqual([state.reads, state.writes.length], [0, 0], `${label}: nothing read or written`);
  }
  for (const [label, overrides] of [
    ["no confirmation", { limitationsConfirmed: false }],
    ["confirmation not a boolean", { limitationsConfirmed: "true" }],
    ["other decision", { decision: "approved" }],
    ["funder release", { decision: "release_for_funder_use" }],
    ["missing decision", { decision: undefined }],
  ]) {
    const { state, dependencies } = harness();
    assert.equal((await release(dependencies, overrides)).error.code, "validation_blocker", label);
    assert.equal(state.reads, 0, label);
  }
  for (const [label, env] of [
    ["export flag off", { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" }],
    ["generation flag off", { KAI_SPRINT2_ENABLED: "true", KAI_PUBLIC_EXPORT_ENABLED: "true" }],
    ["Sprint 2 flag off", { KAI_GENERATION_ENABLED: "true", KAI_PUBLIC_EXPORT_ENABLED: "true" }],
  ]) {
    const { state, dependencies } = harness();
    assert.equal((await release({ ...dependencies, env })).error.code, "feature_disabled", label);
    assert.deepEqual([state.reads, state.writes.length], [0, 0], label);
  }
  for (const [label, options, overrides] of [
    ["another Project", {}, { engagementId: OTHER_ENGAGEMENT }],
    ["another organization's path", {}, { organizationId: OTHER_ORG, actorContext: actor("client_admin", { organizationId: OTHER_ORG }) }],
    ["funder audience", { initial: packet({ audience: "funder" }) }, {}],
    ["public audience", { initial: packet({ audience: "public" }) }, {}],
    ["GK-only type", { initial: packet({ contentType: "readiness_assessment" }) }, {}],
  ]) {
    const { state, dependencies } = harness(options);
    assert.equal((await release(dependencies, overrides)).error.code, "not_found", label);
    assert.deepEqual(state.writes, [], label);
  }
  const { dependencies } = harness();
  assert.equal((await release({ ...dependencies, createReleaseAudit: undefined })).error.code, "system_error", "never without audit");
  assert.deepEqual([...__clientGeneratedContentServiceContract.CLIENT_INTERNAL_RELEASE_ROLES], ["client_admin"]);
});

test("detail: a reviewed ordinary summary awaits the organization's release with the action offered; a held one names Get Kinder's reasons; a released one says who released it", async () => {
  const read = (dependencies, actorContext = actor("client_admin")) => getClientInternalDraft(
    { organizationId: ORG, engagementId: ENGAGEMENT, generatedContentDraftId: DRAFT, actorContext }, dependencies);
  const ordinary = harness();
  const detail = await read(ordinary.dependencies);
  assert.deepEqual(detail.data.release, { state: "awaiting_organization_release", releasedReportId: null });
  assert.deepEqual(detail.data.organizationRelease, { actorMayRelease: true, getKinderReleaseReasons: [], blockedReasons: [], releasedBy: null });
  assert.deepEqual(projectClientInternalDraft(detail.data).organizationRelease, detail.data.organizationRelease);

  const held = harness({ evaluation: { getKinderReviewReasons: ["story_testimonial_not_cleared"], blockedReasons: [], organizationMayRelease: false } });
  const heldDetail = await read(held.dependencies);
  assert.deepEqual(heldDetail.data.release, { state: "awaiting_get_kinder_release", releasedReportId: null });
  assert.deepEqual(heldDetail.data.organizationRelease, { actorMayRelease: false, getKinderReleaseReasons: ["story_testimonial_not_cleared"], blockedReasons: [], releasedBy: null });

  const flagOff = await read({ ...ordinary.dependencies, env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" } });
  assert.deepEqual([flagOff.data.release.state, flagOff.data.organizationRelease.actorMayRelease], ["release_status_unavailable", false]);

  assert.equal((await release(ordinary.dependencies)).ok, true);
  const after = await read(ordinary.dependencies);
  assert.deepEqual(after.data.release, { state: "released_for_internal_use", releasedReportId: MANIFEST });
  assert.deepEqual(after.data.organizationRelease, { actorMayRelease: false, getKinderReleaseReasons: [], blockedReasons: [], releasedBy: "your_organization" });

  const byGk = harness({ released: { exportManifestId: MANIFEST, decidedByRole: "gk_admin", valid: true } });
  assert.equal((await read(byGk.dependencies)).data.organizationRelease.releasedBy, "get_kinder");
  const withdrawn = harness({ released: { exportManifestId: MANIFEST, decidedByRole: "client_admin", valid: false } });
  const withdrawnDetail = await read(withdrawn.dependencies);
  assert.deepEqual([withdrawnDetail.data.release.state, withdrawnDetail.data.organizationRelease.releasedBy], ["release_no_longer_valid", "your_organization"]);

  const unreviewed = harness({ initial: packet({ queue: ["open", "needs_gk_review"] }) });
  const unreviewedDetail = await read(unreviewed.dependencies);
  assert.deepEqual([unreviewedDetail.data.release.state, unreviewedDetail.data.organizationRelease.actorMayRelease], ["awaiting_organization_review", false]);
});

test("repositories: client_admin is recorded only with the caller's release admission, only as an internal export_authority_granted grant; the GK role sets are unchanged", async () => {
  const { isOrganizationInternalReleaseDecision } = __humanAuthorityDecisionRepositoryTestables;
  const admission = { releaseAdmission: async () => null };
  const base = { decidedByRole: "client_admin", decisionType: "export_authority_granted", decisionAction: "grant", requestedAudience: "internal" };
  assert.equal(isOrganizationInternalReleaseDecision(base, admission), true);
  for (const [label, input, deps] of [
    ["no admission", base, {}],
    ["revoke", { ...base, decisionAction: "revoke" }, admission],
    ["funder audience", { ...base, requestedAudience: "funder" }, admission],
    ["public audience", { ...base, requestedAudience: "public" }, admission],
    ["funder_ready", { ...base, decisionType: "funder_ready" }, admission],
    ["public_ready", { ...base, decisionType: "public_ready" }, admission],
    ["client_reviewed", { ...base, decisionType: "client_reviewed" }, admission],
    ["client_reviewer role", { ...base, decidedByRole: "client_reviewer" }, admission],
  ]) {
    assert.equal(isOrganizationInternalReleaseDecision(input, deps), false, label);
  }

  let transactions = 0;
  const runInTransaction = async () => { transactions += 1; throw new Error("no transaction expected"); };
  const authority = createPostgresHumanAuthorityDecisionRepository({ runInTransaction });
  const decision = {
    organizationId: ORG, exportCandidateId: CANDIDATE, decisionType: "export_authority_granted", decisionAction: "grant", requestedAudience: "internal",
    actorContext: actor("client_admin"), decidedByRole: "client_admin", now: T0,
  };
  assert.equal((await authority.recordDecision(decision, { metadataOnlyAudit: {} })).error.code, "validation_blocker", "client_admin without admission");
  assert.equal((await authority.recordDecision({ ...decision, requestedAudience: "funder" }, { metadataOnlyAudit: {}, ...admission })).error.code, "validation_blocker");
  assert.equal((await authority.recordDecision({ ...decision, decisionAction: "revoke" }, { metadataOnlyAudit: {}, ...admission })).error.code, "validation_blocker");
  const candidates = createPostgresExportCandidateRepository({ runInTransaction });
  const snapshot = {
    organizationId: ORG, generatedContentDraftId: DRAFT, entries: [{ claimId: CLAIM, evidenceItemId: EVIDENCE, limitationCodes: [...LIMITATIONS] }],
    actorContext: actor("client_admin"), confirmedByRole: "client_admin", now: T0,
  };
  const refusedSnapshot = await candidates.confirmLimitationSnapshot(snapshot, { metadataOnlyAudit: {} });
  assert.deepEqual([refusedSnapshot.error.code, refusedSnapshot.error.reason], ["validation_blocker", "confirmed_by_role_not_derivable"]);
  assert.equal(transactions, 0, "refused before any transaction");

  // The GK routes' role sets are unchanged.
  assert.deepEqual([...LIMITATION_SNAPSHOT_ALLOWED_ROLES], ["gk_reviewer", "gk_admin"]);
  assert.deepEqual([...EXPORT_CANDIDATE_ALLOWED_ROLES], ["gk_admin"]);
  assert.deepEqual({ ...HUMAN_AUTHORITY_DECISION_ROLE_BY_TYPE }, { client_reviewed: "client_reviewer", funder_ready: "gk_admin", public_ready: "gk_admin", export_authority_granted: "gk_admin" });
  assert.deepEqual([...__exportReviewServiceContract.EXPORT_REVIEW_ALLOWED_ROLES], ["gk_admin"]);
  assert.deepEqual([...CREATE_EXPORT_MANIFEST_ALLOWED_ROLES], ["gk_admin"]);
});

test("capability and browser projection: releaseInternalReports is the service's own role check, client_admin only; every reason and state has wording, and a malformed view offers no release", async () => {
  for (const [roleName, expected] of [["client_admin", true], ["client_contributor", false], ["client_reviewer", false]]) {
    const result = await getOrganizationAccessCapabilities({ organizationId: ORG, actorContext: actor(roleName) }, { env: ENV });
    assert.equal(result.data.workflowOperations.releaseInternalReports, expected, roleName);
    assert.equal(clientEvidenceWorkflowAccess(projectOrganizationAccessCapabilities(result.data)).releaseInternalReports, expected, roleName);
  }
  const inactive = await getOrganizationAccessCapabilities({ organizationId: ORG, actorContext: actor("client_admin", { status: "inactive" }) }, { env: ENV });
  assert.notEqual(inactive.data?.workflowOperations?.releaseInternalReports, true);

  const serverReasons = [...GET_KINDER_REVIEW_REASONS, ...BLOCKED_REASONS, ...RELEASE_BLOCKED_REASONS, "release_withdrawn_by_get_kinder"];
  assert.deepEqual([...CLIENT_INTERNAL_DRAFT_RELEASE_REASONS].sort(), [...new Set(serverReasons)].sort());
  for (const code of CLIENT_INTERNAL_DRAFT_RELEASE_REASONS) assert.equal(typeof INTERNAL_DRAFT_RELEASE_REASON_MESSAGES[code], "string", code);
  for (const state of CLIENT_INTERNAL_DRAFT_RELEASE_STATES) {
    assert.equal(typeof INTERNAL_DRAFT_RELEASE_STATE_LABELS[state], "string", state);
    assert.equal(typeof INTERNAL_DRAFT_RELEASE_STATE_MESSAGES[state], "string", state);
  }
  const { dependencies } = harness();
  const { data } = await getClientInternalDraft({ organizationId: ORG, engagementId: ENGAGEMENT, generatedContentDraftId: DRAFT, actorContext: actor("client_admin") }, dependencies);
  const closed = { actorMayRelease: false, getKinderReleaseReasons: [], blockedReasons: [], releasedBy: null };
  for (const malformed of [undefined, null, [], { actorMayRelease: true }, { ...data.organizationRelease, blockedReasons: ["made_up"] }]) {
    assert.deepEqual(projectClientInternalDraft({ ...data, organizationRelease: malformed }).organizationRelease, closed);
  }
  assert.equal(projectClientInternalDraft({ ...data, organizationRelease: { ...data.organizationRelease, releasedBy: "someone" } }).organizationRelease.releasedBy, null);
});
