import test from "node:test";
import assert from "node:assert/strict";

import { resolveKaiActorContext } from "../Backend/kai/auth/kaiActorContext.js";
import { listOrganizationSources, __sourceLibraryServiceContract } from "../Backend/kai/services/kaiSourceLibraryService.js";
import { extractEvidenceFromSourceVersion, __evidenceLineageServiceContract } from "../Backend/kai/services/kaiEvidenceLineageService.js";
import { listOrganizationEvidenceLibrary, __evidenceLibraryServiceContract } from "../Backend/kai/services/kaiEvidenceLibraryService.js";
import { proposeClaim, __claimProposalServiceContract } from "../Backend/kai/services/kaiClaimProposalService.js";
import { listClaimLibraryCandidates, __claimLibraryServiceContract } from "../Backend/kai/services/kaiClaimLibraryService.js";
import { generateClaimGapFollowups, __claimGapFollowupServiceContract } from "../Backend/kai/services/kaiClaimGapFollowupService.js";
import { completeClientFollowup, __clientFollowupCompletionServiceContract } from "../Backend/kai/services/kaiClientFollowupCompletionService.js";
import { listClientFollowupWorkflows, __clientFollowupReadServiceContract } from "../Backend/kai/services/kaiClientFollowupReadService.js";
import { getClaimTraceabilitySummary } from "../Backend/kai/services/kaiClaimTraceabilityService.js";
import {
  acceptFunderCoverageLimitation,
  acceptInternalCoverageLimitation,
  acceptPublicCoverageLimitation,
} from "../Backend/kai/services/kaiCoverageReviewDecisionService.js";
import {
  createEvidenceSummaryDraft,
  createImpactNarrativeDraft,
  createReadinessAssessmentDraft,
  createCaseForSupportDraft,
  createBoardUpdateDraft,
  createAnnualReportSectionDraft,
  createFunderOutcomeTableDraft,
  createGrantResponseParagraphDraft,
  createDataGapMemoDraft,
  startGeneratedContentReview,
  completeGeneratedContentReview,
  __generatedContentServiceContract,
} from "../Backend/kai/services/kaiGeneratedContentService.js";
import { recordEvidenceReviewDecision, recordClaimReviewDecision, __humanReviewServiceContract } from "../Backend/kai/services/kaiHumanReviewService.js";
import { assessEvidenceCoverageForSourceVersion } from "../Backend/kai/services/kaiEvidenceCoverageAssessmentService.js";
import { authorizeSourcePromotionDecision } from "../Backend/kai/services/kaiSourcePromotionService.js";
import {
  computeOrganizationOperationReadiness,
  getOrganizationAccessCapabilities,
} from "../Backend/kai/services/kaiOrganizationAccessCapabilitiesService.js";
import { projectOrganizationAccessCapabilities } from "../frontend/impactEvidenceLibraryLogic.js";
import {
  INTERNAL_DRAFT_READINESS_MESSAGES,
  claimIdsByEvidenceItem,
  claimInternalDraftSelectability,
  clientEvidenceWorkflowAccess,
  gapFollowupFailureMessage,
  gapFollowupResultMessage,
  internalDraftFailureMessage,
  internalDraftReadiness,
  internalDraftRequestBody,
  internalDraftResultSummary,
  retainSelectableClaimIds,
} from "../frontend/knowledgeStudio/clientEvidenceWorkflowLogic.js";

/**
 * Owner decision 2026-10-18: a non-superuser, binding-derived client_admin
 * may run the organization's evidence-to-draft workflow - Sources read,
 * P2-01 extraction, Evidence Library read, P2-03 claim proposal, Claim
 * Library read, P2-04 claim gap follow-up generation, and INTERNAL
 * evidence-summary / impact-narrative generation - in the exact organization
 * it administers, and nothing else. P2-04 generation records open gaps and
 * open client follow-ups only: answering a follow-up, accepting a coverage
 * limitation, and every review decision keep their own role sets.
 *
 * Real: resolveKaiActorContext with the GK organization binding (no stored
 * kai.organization_memberships row, no kai.user_roles row, no site-admin
 * authority), validateActorCanPerformOperation, and every service below.
 * Injected: only each service's repository/read, recording every call, so a
 * refusal is proven to reach no repository. Real PostgreSQL persistence,
 * the mounted routes, and the browser are proven by
 * kai-client-admin-evidence-to-draft-browser-acceptance.integration.spec.js.
 */

const ENV = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });
const ORG_X = "11111111-2222-4333-8444-555555555555";
const ORG_Y = "99999999-8888-4777-8666-555555555555";
const ENGAGEMENT_X = "22222222-3333-4444-8555-666666666666";
const ENGAGEMENT_Y = "22222222-3333-4444-8555-777777777777";
const SOURCE = "3a000000-0000-4000-8000-000000000001";
const SOURCE_VERSION = "3b000000-0000-4000-8000-000000000001";
const EVIDENCE = "3c000000-0000-4000-8000-000000000001";
const CLAIM = "3d000000-0000-4000-8000-000000000001";
const QUEUE = "3e000000-0000-4000-8000-000000000001";
const DRAFT = "3f000000-0000-4000-8000-000000000001";
const GK_ORG_X = 401;
const NOW = "2026-10-18T12:00:00.000Z";
const KAI_USER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

async function bindingDerivedClientAdmin({ gkMembership = { orgId: GK_ORG_X, role: "admin", is_active: true }, bindingStatus = "active" } = {}) {
  const result = await resolveKaiActorContext(
    { user: { id: 7301, email: "org-admin@harbourline.test" } },
    {
      findOrCreateKaiUserByLegacyPublicUserdataId: async ({ legacyPublicUserdataId, email }) => ({
        user_id: KAI_USER,
        legacy_identity_source: "public.userdata",
        legacy_public_userdata_id: legacyPublicUserdataId,
        status: "active",
        email,
      }),
      listKaiRolesForUser: async () => [],
      listOrganizationMembershipsForUser: async () => [],
      resolveOrgScopeForUserId: async () => ({ memberships: gkMembership ? [gkMembership] : [] }),
      listActiveGkOrganizationBindingsForGkOrganizationIds: async (ids) => (ids.includes(GK_ORG_X)
        ? [{ gk_organization_id: GK_ORG_X, kai_organization_id: ORG_X, status: bindingStatus }]
        : []),
    },
  );
  assert.equal(result.ok, true);
  return result.actorContext;
}

function memberActor(roleName, { organizationId = ORG_X, kaiRoles = [], extra = {} } = {}) {
  return {
    actorType: "human",
    actorUserId: `0000000${roleName.length}-0000-4000-8000-000000000001`,
    kaiRoles,
    platformSuperuser: false,
    organizationMemberships: [{ organization_id: organizationId, role_name: roleName, membership_status: "active" }],
    ...extra,
  };
}

const sourceRow = (organizationId = ORG_X) => ({ source_id: SOURCE, source_code: "harbourline-households", reviewed_source_type: "organization_primary_record", created_at: new Date(NOW), organization_id: organizationId });
const versionRow = () => ({ source_version_id: SOURCE_VERSION, source_id: SOURCE, is_current: true, created_at: new Date(NOW) });
const evidenceRow = (organizationId = ORG_X) => ({
  evidence_item_id: EVIDENCE,
  organization_id: organizationId,
  source_id: SOURCE,
  source_version_id: SOURCE_VERSION,
  evidence_type: "dictionary_field_presence_fact",
  data_class: "aggregate",
  sensitivity_level: "low",
  support_strength: "unassessed",
  statement: "Source version's committed data dictionary includes field \"households_served\" of committed type \"number\".",
  evidence_review_status: "needs_gk_review",
  internal_only: true,
  public_use_allowed: false,
  funder_use_allowed: false,
  review_queue_item_id: QUEUE,
  review_queue_status: "open",
  review_queue_review_status: "needs_gk_review",
  review_queue_updated_at: new Date(NOW),
  evidence_review_decision_head_count: 0,
  evidence_review_decision_outcome: null,
});
const claimRow = (organizationId = ORG_X, overrides = {}) => ({
  claim_id: CLAIM,
  organization_id: organizationId,
  evidence_item_id: EVIDENCE,
  claim_type: "finding",
  claim_status: "proposed",
  claim_review_status: "needs_gk_review",
  claim_strength: "unassessed",
  claim_statement: "Households served is recorded for the programme.",
  evidence_statement: "Source version's committed data dictionary includes field \"households_served\".",
  evidence_support_strength: "unassessed",
  evidence_review_status: "needs_gk_review",
  evidence_source_id: SOURCE,
  evidence_source_version_id: SOURCE_VERSION,
  evidence_internal_only: true,
  evidence_public_use_allowed: false,
  evidence_funder_use_allowed: false,
  review_queue_items: [{ review_queue_item_id: QUEUE, queue_type: "claim_review", target_object_type: "claim", target_object_id: CLAIM, queue_status: "open", review_status: "needs_gk_review" }],
  ...overrides,
});

function draftResult(contentType) {
  return {
    ok: true,
    data: {
      generationRunId: "40000000-0000-4000-8000-000000000001",
      generatedContentDraftId: DRAFT,
      requestedAudience: "internal",
      draftStatus: "draft",
      reviewStatus: "needs_gk_review",
      reviewQueueItemId: QUEUE,
      blocks: [{ ordinal: 1, text: `${contentType} block`, citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }] }],
      replayed: false,
    },
  };
}

const noAudit = () => ({ prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } });

const GAP = "41000000-0000-4000-8000-000000000001";
const FOLLOWUP = "42000000-0000-4000-8000-000000000001";
function gapFollowupData(organizationId, replayed = false) {
  return {
    gapItems: [{ gap_log_item_id: GAP, organization_id: organizationId, claim_id: CLAIM, dimension_key: "definition_clarity", assessment_status: "unresolved", safe_summary: "Field definitions are not yet confirmed." }],
    clientFollowupItems: [{ client_followup_item_id: FOLLOWUP, organization_id: organizationId, claim_id: CLAIM, gap_log_item_id: GAP, dimension_key: "definition_clarity", question_text: "How is this field defined?" }],
    reviewQueueItems: [{ review_queue_item_id: QUEUE, organization_id: organizationId, queue_type: "client_followup", target_object_type: "client_followup_item", target_object_id: FOLLOWUP, queue_status: "waiting_on_client", review_status: "proposed" }],
    replayed,
  };
}

// Runs one of the eight workflow operations in `organizationId` with
// recording doubles; returns the result and every repository/read call.
async function runWorkflowOperation(name, actorContext, organizationId, { engagementId = ENGAGEMENT_X, engagementOrganizationId = organizationId, rows = null } = {}) {
  const calls = [];
  const record = (label, value) => { calls.push([label, value]); return value; };
  const engagementRead = async ({ organizationId: scoped, engagementId: requested }) => {
    record("engagement", scoped);
    // Only ENGAGEMENT_X exists; it belongs to engagementOrganizationId.
    return requested === ENGAGEMENT_X ? { engagement_id: requested, organization_id: engagementOrganizationId } : null;
  };
  const generationRepository = {
    async createEvidenceSummaryDraft(input) { record("generate", input.organizationId); return draftResult("evidence_summary"); },
    async createImpactNarrativeDraft(input) { record("generate", input.organizationId); return draftResult("impact_narrative"); },
  };
  const generationInput = { organizationId, engagementId, requestedAudience: "internal", claimIds: [CLAIM], idempotencyKey: "client-admin-workflow-1", actorContext, now: NOW };
  const generationDeps = { env: ENV, getEngagementForOrganization: engagementRead, generatedContentRepository: generationRepository, draftGenerator: async () => ({ blocks: [] }), metadataOnlyAudit: noAudit() };
  switch (name) {
    case "sources":
      return { calls, result: await listOrganizationSources({ organizationId, actorContext }, {
        env: ENV,
        listScopedSourcesForOrganization: async ({ organizationId: scoped }) => { record("sources", scoped); return rows ?? [sourceRow(scoped)]; },
        listScopedSourceVersionsForSourceIds: async ({ organizationId: scoped }) => { record("versions", scoped); return [versionRow()]; },
      }) };
    case "extract":
      return { calls, result: await extractEvidenceFromSourceVersion({ organizationId, sourceVersionId: SOURCE_VERSION, actorContext, now: NOW }, {
        env: ENV,
        metadataOnlyAudit: noAudit(),
        evidenceLineageRepository: { async extractEvidenceFromSourceVersion(input) { record("extract", input.organizationId); return { ok: true, data: { evidenceItems: [{ evidence_item_id: EVIDENCE }], replayed: false }, error: null }; } },
      }) };
    case "evidence":
      return { calls, result: await listOrganizationEvidenceLibrary({ organizationId, actorContext }, {
        env: ENV,
        listOrganizationEvidenceItems: async (scoped) => { record("evidence", scoped); return rows ?? [evidenceRow(scoped)]; },
      }) };
    case "propose":
      return { calls, result: await proposeClaim({ organizationId, evidenceItemId: EVIDENCE, actorContext, now: NOW }, {
        env: ENV,
        metadataOnlyAudit: noAudit(),
        claimProposalRepository: { async proposeClaim(input) { record("propose", input.organizationId); return { ok: true, data: { claim: { claim_id: CLAIM }, replayed: false, warnings: [] }, error: null }; } },
      }) };
    case "claims":
      return { calls, result: await listClaimLibraryCandidates({ organizationId, actorContext }, {
        env: ENV,
        listClaimLibraryReviewCandidates: async (scoped) => { record("claims", scoped); return rows ?? [claimRow(scoped)]; },
      }) };
    case "gapFollowups":
      return { calls, result: await generateClaimGapFollowups({ organizationId, claimId: CLAIM, actorContext, now: NOW }, {
        env: ENV,
        metadataOnlyAudit: noAudit(),
        claimGapFollowupRepository: { async generateClaimGapsAndFollowups(input) { record("gaps", input.organizationId); return { ok: true, data: gapFollowupData(input.organizationId), error: null }; } },
      }) };
    case "evidenceSummary":
      return { calls, result: await createEvidenceSummaryDraft(generationInput, generationDeps) };
    case "impactNarrative":
      return { calls, result: await createImpactNarrativeDraft(generationInput, generationDeps) };
    default:
      throw new Error(name);
  }
}

const WORKFLOW_OPERATIONS = Object.freeze(["sources", "extract", "evidence", "propose", "claims", "gapFollowups", "evidenceSummary", "impactNarrative"]);

function assertDenied(result, reason, label) {
  assert.equal(result.ok, false, label);
  assert.equal(result.error.code, "authorization_denied", `${label}: ${JSON.stringify(result.error)}`);
  assert.equal(result.blockers?.[0]?.blocking_reason, reason, `${label}: ${JSON.stringify(result.blockers)}`);
}

// ---------------------------------------------------------------------------
// The actor
// ---------------------------------------------------------------------------

test("the principal actor is a binding-derived client_admin: no stored membership, no global or staff role, not a platform superuser", async () => {
  const actor = await bindingDerivedClientAdmin();
  assert.equal(actor.platformSuperuser, false);
  assert.deepEqual(actor.kaiRoles, []);
  assert.deepEqual(actor.organizationMemberships, [{
    organization_id: ORG_X, role_name: "client_admin", membership_status: "active", source: "gk_organization_binding", gk_organization_id: GK_ORG_X,
  }]);
});

// ---------------------------------------------------------------------------
// A. Organization X: all eight operations authorized
// ---------------------------------------------------------------------------

test("A: binding-derived client_admin is authorized for all eight operations in organization X, each scoped to X", async () => {
  const actor = await bindingDerivedClientAdmin();
  const expectedCalls = {
    sources: [["sources", ORG_X], ["versions", ORG_X]],
    extract: [["extract", ORG_X]],
    evidence: [["evidence", ORG_X]],
    propose: [["propose", ORG_X]],
    claims: [["claims", ORG_X]],
    gapFollowups: [["gaps", ORG_X]],
    evidenceSummary: [["engagement", ORG_X], ["generate", ORG_X]],
    impactNarrative: [["engagement", ORG_X], ["generate", ORG_X]],
  };
  for (const name of WORKFLOW_OPERATIONS) {
    const { result, calls } = await runWorkflowOperation(name, actor, ORG_X);
    assert.equal(result.ok, true, `${name}: ${JSON.stringify(result)}`);
    assert.deepEqual(calls, expectedCalls[name], name);
  }
});

test("A: role sets - the five write operations admit client_admin by organization membership; the three reads admit it through a dedicated organization-only set", () => {
  const gk = ["gk_admin", "gk_operator", "gk_reviewer"];
  assert.deepEqual([...__claimGapFollowupServiceContract.CLAIM_GAP_FOLLOWUP_ALLOWED_ROLES].sort(), ["client_admin", ...gk]);
  assert.equal(__claimGapFollowupServiceContract.CLAIM_GAP_FOLLOWUP_OPERATION, "generate_claim_gap_followups");
  // Answering and listing client follow-ups stay client_reviewer only.
  assert.deepEqual([...__clientFollowupCompletionServiceContract.COMPLETE_CLIENT_FOLLOWUP_ALLOWED_ROLES], ["client_reviewer"]);
  assert.deepEqual([...__clientFollowupReadServiceContract.LIST_CLIENT_FOLLOWUP_WORKFLOWS_ALLOWED_ROLES], ["client_reviewer"]);
  assert.deepEqual([...__evidenceLineageServiceContract.EVIDENCE_LINEAGE_ALLOWED_ROLES].sort(), ["client_admin", ...gk]);
  assert.deepEqual([...__claimProposalServiceContract.CLAIM_PROPOSAL_ALLOWED_ROLES].sort(), ["client_admin", ...gk]);
  assert.deepEqual([...__generatedContentServiceContract.CLIENT_ADMIN_DRAFT_ALLOWED_ROLES].sort(), ["client_admin", ...gk]);
  assert.deepEqual([...__generatedContentServiceContract.GENERATED_CONTENT_ALLOWED_ROLES].sort(), gk);
  assert.deepEqual([...__sourceLibraryServiceContract.SOURCE_LIBRARY_ALLOWED_ROLES].sort(), gk);
  assert.deepEqual([...__evidenceLibraryServiceContract.EVIDENCE_LIBRARY_READ_ROLES].sort(), gk);
  assert.deepEqual([...__claimLibraryServiceContract.CLAIM_LIBRARY_READ_ROLES].sort(), gk);
  for (const roles of [
    __sourceLibraryServiceContract.SOURCE_LIBRARY_CLIENT_ADMIN_ROLES,
    __evidenceLibraryServiceContract.EVIDENCE_LIBRARY_CLIENT_ADMIN_ROLES,
    __claimLibraryServiceContract.CLAIM_LIBRARY_CLIENT_ADMIN_ROLES,
  ]) assert.deepEqual([...roles], ["client_admin"]);
  assert.deepEqual([...__humanReviewServiceContract.RECORD_EVIDENCE_REVIEW_DECISION_ALLOWED_ROLES].sort(), ["gk_admin", "gk_reviewer"]);
  assert.deepEqual([...__humanReviewServiceContract.RECORD_CLAIM_REVIEW_DECISION_ALLOWED_ROLES].sort(), ["gk_admin", "gk_reviewer"]);
});

test("A: a stored client_admin membership in X is admitted the same way", async () => {
  for (const name of WORKFLOW_OPERATIONS) {
    const { result } = await runWorkflowOperation(name, memberActor("client_admin"), ORG_X);
    assert.equal(result.ok, true, name);
  }
});

// ---------------------------------------------------------------------------
// C. Organization Y and foreign identifiers
// ---------------------------------------------------------------------------

test("C: the same actor is denied all eight operations in organization Y before any read or write", async () => {
  const actor = await bindingDerivedClientAdmin();
  for (const name of WORKFLOW_OPERATIONS) {
    const { result, calls } = await runWorkflowOperation(name, actor, ORG_Y);
    assertDenied(result, "missing_active_organization_membership", name);
    assert.deepEqual(calls, [], `${name}: no repository or read call`);
    assert.ok(!JSON.stringify(result).includes(SOURCE_VERSION) && !JSON.stringify(result).includes(EVIDENCE), `${name}: no object data`);
  }
});

test("C: inactive Get Kinder administrator membership, a missing binding, or an inactive binding derive no access", async () => {
  for (const [label, options] of [
    ["inactive GK admin membership", { gkMembership: { orgId: GK_ORG_X, role: "admin", is_active: false } }],
    ["GK member, not admin", { gkMembership: { orgId: GK_ORG_X, role: "member", is_active: true } }],
    ["no GK membership", { gkMembership: null }],
    ["inactive binding", { bindingStatus: "inactive" }],
  ]) {
    const actor = await bindingDerivedClientAdmin(options);
    assert.deepEqual(actor.organizationMemberships, [], label);
    for (const name of WORKFLOW_OPERATIONS) {
      const { result, calls } = await runWorkflowOperation(name, actor, ORG_X);
      assertDenied(result, "missing_active_organization_membership", `${label} ${name}`);
      assert.deepEqual(calls, [], `${label} ${name}`);
    }
  }
});

test("C: foreign identifiers in organization X - another organization's engagement, source version, evidence, or rows - return no organization-Y data", async () => {
  const actor = await bindingDerivedClientAdmin();
  // An engagement that is not organization X's, or another organization's engagement.
  for (const [label, options] of [
    ["unknown engagement", { engagementId: ENGAGEMENT_Y }],
    ["engagement owned by Y", { engagementOrganizationId: ORG_Y }],
  ]) {
    for (const name of ["evidenceSummary", "impactNarrative"]) {
      const { result, calls } = await runWorkflowOperation(name, actor, ORG_X, options);
      assert.equal(result.error?.code, "tenant_boundary_violation", `${label} ${name}: ${JSON.stringify(result)}`);
      assert.deepEqual(calls.filter(([kind]) => kind === "generate"), [], `${label} ${name}: no generation`);
    }
  }
  // The organization-scoped repositories' not_found passes through without detail.
  const foreignExtract = await extractEvidenceFromSourceVersion({ organizationId: ORG_X, sourceVersionId: SOURCE_VERSION, actorContext: actor, now: NOW }, {
    env: ENV, metadataOnlyAudit: noAudit(),
    evidenceLineageRepository: { async extractEvidenceFromSourceVersion() { return { ok: false, data: null, error: { code: "not_found", status: 404 } }; } },
  });
  assert.deepEqual([foreignExtract.ok, foreignExtract.error.code, foreignExtract.data ?? null], [false, "not_found", null]);
  const foreignProposal = await proposeClaim({ organizationId: ORG_X, evidenceItemId: EVIDENCE, actorContext: actor, now: NOW }, {
    env: ENV, metadataOnlyAudit: noAudit(),
    claimProposalRepository: { async proposeClaim() { return { ok: false, data: null, error: { code: "not_found", status: 404 } }; } },
  });
  assert.deepEqual([foreignProposal.ok, foreignProposal.error.code, foreignProposal.data ?? null], [false, "not_found", null]);
  // A read that ever returned an organization-Y row fails the whole read closed.
  for (const [name, rows] of [["evidence", [evidenceRow(ORG_Y)]], ["claims", [claimRow(ORG_Y)]]]) {
    const { result } = await runWorkflowOperation(name, actor, ORG_X, { rows });
    assert.deepEqual([result.ok, result.error.code], [false, "system_error"], name);
    assert.ok(!JSON.stringify(result).includes(ORG_Y), name);
  }
});

// ---------------------------------------------------------------------------
// Read safety for the client_admin projection
// ---------------------------------------------------------------------------

test("read safety: Sources returns ids, code, reviewed type, currentness, and timestamps only", async () => {
  const { result } = await runWorkflowOperation("sources", await bindingDerivedClientAdmin(), ORG_X);
  assert.deepEqual(result.data, {
    sources: [{
      source_id: SOURCE, source_code: "harbourline-households", reviewed_source_type: "organization_primary_record", created_at: NOW,
      source_versions: [{ source_version_id: SOURCE_VERSION, source_id: SOURCE, is_current: true, created_at: NOW }],
    }],
  });
});

test("read safety: Evidence returns the review posture without P2-12 write coordinates, and no decision capability", async () => {
  const { result } = await runWorkflowOperation("evidence", await bindingDerivedClientAdmin(), ORG_X);
  assert.deepEqual(result.data.capabilities, { canRecordEvidenceReviewDecision: false });
  const [item] = result.data.items;
  assert.deepEqual(item.evidenceReview, { queueStatus: "open", reviewStatus: "needs_gk_review", currentDecisionOutcome: null });
  assert.equal(item.evidenceReviewStatus, "needs_gk_review", "status preserved, not promoted");
  assert.equal(item.supportStrength, "unassessed");
  assert.equal(item.sensitivityLevel, "low");
  assert.ok(!JSON.stringify(result.data).includes(QUEUE), "no review queue item id");
  // A GK reviewer still receives the write coordinates (unchanged).
  const gk = await runWorkflowOperation("evidence", memberActor("gk_reviewer", { kaiRoles: ["gk_reviewer"] }), ORG_X);
  assert.equal(gk.result.data.items[0].evidenceReview.reviewQueueItemId, QUEUE);
});

test("read safety: Claims keep status, review status, and strength but drop the GK review queue item and target ids for client_admin only", async () => {
  const { result } = await runWorkflowOperation("claims", await bindingDerivedClientAdmin(), ORG_X);
  const [claim] = result.data.items;
  assert.deepEqual([claim.claimStatus, claim.claimReviewStatus, claim.claimStrength], ["proposed", "needs_gk_review", "unassessed"]);
  assert.deepEqual(claim.reviewQueueItems, [{ queue_type: "claim_review", target_object_type: "claim", queue_status: "open", review_status: "needs_gk_review" }]);
  assert.ok(!JSON.stringify(result.data).includes(QUEUE));
  const gk = await runWorkflowOperation("claims", memberActor("gk_operator"), ORG_X);
  assert.equal(gk.result.data.items[0].reviewQueueItems[0].review_queue_item_id, QUEUE, "GK projection unchanged");
});

// ---------------------------------------------------------------------------
// D. Protected operations
// ---------------------------------------------------------------------------

test("D: client_admin is denied the seven other generators, funder evidence summary, generated-content review, P2-02, and P1-08; its P2-12 decisions are its own, admitted per claim", async () => {
  const actor = await bindingDerivedClientAdmin();
  const tripwire = new Proxy({}, { get: (_target, property) => (property === "then" ? undefined : async () => assert.fail(`repository ${String(property)} reached`)) });
  const deps = { env: ENV, getEngagementForOrganization: async () => assert.fail("engagement read"), generatedContentRepository: tripwire, draftGenerator: async () => ({ blocks: [] }), metadataOnlyAudit: noAudit() };
  const base = { organizationId: ORG_X, engagementId: ENGAGEMENT_X, claimIds: [CLAIM], idempotencyKey: "client-admin-protected-1", actorContext: actor, now: NOW };
  const results = {
    readiness: await createReadinessAssessmentDraft({ ...base, requestedAudience: "internal" }, deps),
    caseForSupport: await createCaseForSupportDraft({ ...base, requestedAudience: "internal" }, deps),
    boardUpdate: await createBoardUpdateDraft({ ...base, requestedAudience: "internal" }, deps),
    annualReport: await createAnnualReportSectionDraft({ ...base, requestedAudience: "internal" }, deps),
    funderOutcomeTable: await createFunderOutcomeTableDraft({ ...base, requestedAudience: "funder" }, deps),
    grantResponse: await createGrantResponseParagraphDraft({ ...base, requestedAudience: "internal" }, deps),
    dataGapMemo: await createDataGapMemoDraft({ organizationId: ORG_X, engagementId: ENGAGEMENT_X, requestedAudience: "internal", idempotencyKey: "client-admin-protected-2", actorContext: actor, now: NOW }, deps),
    funderEvidenceSummary: await createEvidenceSummaryDraft({ ...base, requestedAudience: "funder" }, deps),
    publicEvidenceSummary: await createEvidenceSummaryDraft({ ...base, requestedAudience: "public" }, deps),
    startReview: await startGeneratedContentReview({ organizationId: ORG_X, generatedContentDraftId: DRAFT, reviewQueueItemId: QUEUE, expectedUpdatedAt: NOW, actorContext: actor, now: NOW }, { env: ENV, generatedContentRepository: tripwire }),
    completeReview: await completeGeneratedContentReview({ organizationId: ORG_X, generatedContentDraftId: DRAFT, reviewQueueItemId: QUEUE, expectedUpdatedAt: NOW, actorContext: actor, now: NOW }, { env: ENV, generatedContentRepository: tripwire }),
    coverage: await assessEvidenceCoverageForSourceVersion({ organizationId: ORG_X, sourceVersionId: SOURCE_VERSION, actorContext: actor }, { env: ENV, evidenceCoverageAssessmentRepository: tripwire }),
  };
  for (const [label, result] of Object.entries(results)) assertDenied(result, "role_not_allowed", label);
  // Owner authorization 2026-10-24: the administrator's P2-12 evidence and
  // claim decisions reach the repository only as client_admin, each with its
  // in-transaction admission (ordinary measurement, no GK decision), and a
  // claim approval only for the internal audience.
  const calls = [];
  const probe = { async recordEvidenceReviewDecision(input) { calls.push(input); return { ok: true, data: {} }; }, async recordClaimReviewDecision(input) { calls.push(input); return { ok: true, data: {} }; } };
  await recordEvidenceReviewDecision({ organizationId: ORG_X, evidenceItemId: EVIDENCE, reviewQueueItemId: QUEUE, expectedUpdatedAt: NOW, decision: "supported", actorContext: actor, now: NOW }, { env: ENV, humanReviewRepository: probe, metadataOnlyAudit: noAudit() });
  await recordClaimReviewDecision({ organizationId: ORG_X, claimId: CLAIM, reviewQueueItemId: QUEUE, expectedUpdatedAt: NOW, decision: "approved", approvedAudiences: ["internal"], actorContext: actor, now: NOW }, { env: ENV, humanReviewRepository: probe, metadataOnlyAudit: noAudit() });
  assert.deepEqual(calls.map((input) => [input.actorRole, input.actorUserId, typeof input.reviewAdmission]), [["client_admin", KAI_USER, "function"], ["client_admin", KAI_USER, "function"]]);
  const funder = await recordClaimReviewDecision({ organizationId: ORG_X, claimId: CLAIM, reviewQueueItemId: QUEUE, expectedUpdatedAt: NOW, decision: "approved", approvedAudiences: ["internal", "funder"], actorContext: actor, now: NOW }, { env: ENV, humanReviewRepository: tripwire, metadataOnlyAudit: noAudit() });
  assertDenied(funder, "audience_requires_get_kinder_review", "funder approval");
  // Owner decision 2026-10-18: P1-08 admits the binding-derived administrator
  // through its dedicated organization-administrator half only.
  assert.deepEqual(authorizeSourcePromotionDecision(actor, ORG_X), { ok: true, organizationAdminAuthorized: true });
  assert.equal(authorizeSourcePromotionDecision({ ...memberActor("client_admin"), kaiUserStatus: "active" }, ORG_X).ok, false,
    "a stored (unbound) client_admin still may not promote");
  assert.equal(authorizeSourcePromotionDecision(actor, ORG_Y).ok, false, "never in another organization");
});

test("D: client_contributor and client_reviewer gain none of the eight operations", async () => {
  for (const role of ["client_contributor", "client_reviewer"]) {
    for (const name of WORKFLOW_OPERATIONS) {
      const { result, calls } = await runWorkflowOperation(name, memberActor(role), ORG_X);
      assertDenied(result, "role_not_allowed", `${role} ${name}`);
      assert.deepEqual(calls, [], `${role} ${name}`);
    }
  }
});

test("D: a global client_admin role never satisfies the reads, and a global GK role with a client_contributor membership gets no write", async () => {
  const globalClientAdmin = memberActor("client_contributor", { kaiRoles: ["client_admin"] });
  for (const name of WORKFLOW_OPERATIONS) {
    const { result, calls } = await runWorkflowOperation(name, globalClientAdmin, ORG_X);
    assertDenied(result, "role_not_allowed", `global client_admin ${name}`);
    assert.deepEqual(calls, [], name);
  }
  const mixed = memberActor("client_contributor", { kaiRoles: ["gk_reviewer"] });
  for (const name of ["extract", "propose", "gapFollowups", "evidenceSummary", "impactNarrative"]) {
    assertDenied((await runWorkflowOperation(name, mixed, ORG_X)).result, "role_not_allowed", `mixed ${name}`);
  }
  for (const name of ["sources", "evidence", "claims"]) {
    assert.equal((await runWorkflowOperation(name, mixed, ORG_X)).result.ok, true, `GK combineGlobalRoles read unchanged: ${name}`);
  }
});

test("D: GK staff and the platform superuser keep every operation, including the other generators", async () => {
  const superuser = memberActor("client_contributor", { extra: { platformSuperuser: true, platformSuperuserAuthority: "get_kinder_site_admin" } });
  for (const actor of [memberActor("gk_admin"), memberActor("gk_operator"), memberActor("gk_reviewer"), superuser]) {
    for (const name of WORKFLOW_OPERATIONS) {
      assert.equal((await runWorkflowOperation(name, actor, ORG_X)).result.ok, true, `${actor.organizationMemberships[0].role_name} ${name}`);
    }
    const capabilities = await getOrganizationAccessCapabilities({ organizationId: ORG_X, actorContext: actor }, { env: ENV });
    assert.equal(capabilities.data.workflowOperations.generateAllDraftTypes, true);
  }
});

test("disabled: KAI_SPRINT2_ENABLED off returns feature_disabled for all eight before any read", async () => {
  const actor = await bindingDerivedClientAdmin();
  const off = { KAI_SPRINT2_ENABLED: "false", KAI_GENERATION_ENABLED: "true" };
  const never = async () => assert.fail("read while disabled");
  const results = [
    await listOrganizationSources({ organizationId: ORG_X, actorContext: actor }, { env: off, listScopedSourcesForOrganization: never }),
    await extractEvidenceFromSourceVersion({ organizationId: ORG_X, sourceVersionId: SOURCE_VERSION, actorContext: actor, now: NOW }, { env: off }),
    await listOrganizationEvidenceLibrary({ organizationId: ORG_X, actorContext: actor }, { env: off, listOrganizationEvidenceItems: never }),
    await proposeClaim({ organizationId: ORG_X, evidenceItemId: EVIDENCE, actorContext: actor, now: NOW }, { env: off }),
    await listClaimLibraryCandidates({ organizationId: ORG_X, actorContext: actor }, { env: off, listClaimLibraryReviewCandidates: never }),
    await generateClaimGapFollowups({ organizationId: ORG_X, claimId: CLAIM, actorContext: actor, now: NOW }, { env: off, claimGapFollowupRepository: { generateClaimGapsAndFollowups: never } }),
    await createEvidenceSummaryDraft({ organizationId: ORG_X, engagementId: ENGAGEMENT_X, requestedAudience: "internal", claimIds: [CLAIM], idempotencyKey: "client-admin-off-1", actorContext: actor, now: NOW }, { env: off }),
    await createImpactNarrativeDraft({ organizationId: ORG_X, engagementId: ENGAGEMENT_X, requestedAudience: "internal", claimIds: [CLAIM], idempotencyKey: "client-admin-off-1", actorContext: actor, now: NOW }, { env: off }),
  ];
  for (const result of results) assert.equal(result.error.code, "feature_disabled");
});

// ---------------------------------------------------------------------------
// F. Capabilities and the client workflow logic
// ---------------------------------------------------------------------------

test("F: capabilities - client_admin gets extraction, proposal, gap follow-ups, and internal drafts only; readiness reports role authority, not content", async () => {
  const actor = await bindingDerivedClientAdmin();
  const capabilities = await getOrganizationAccessCapabilities({ organizationId: ORG_X, actorContext: actor }, { env: ENV });
  const operations = capabilities.data.workflowOperations;
  assert.deepEqual(
    Object.fromEntries(Object.entries(operations).filter(([, value]) => value === true)),
    // reviewSensitivity / promoteSource: owner decisions 2026-10-12 and 2026-10-18;
    // readInternalDrafts (the administrator's own internal drafts): owner decision 2026-10-19.
    // recordSourceMeasurement (P2-01M, the extraction authority) and
    // readReleasedInternalReports (read-only receipt of a GK-released internal report): Plan A Prompt 8.
    // reviewInternalDraftFactualContent (factual review of an ordinary internal evidence summary) and
    // releaseInternalReports (its separate final release): owner amendment 2026-10-23.
    // readClaimTraceabilityDiagnostics (the client-safe internal traceability diagnostic) and
    // reviewMeasuredClaimFactualContent (the organization's own measured-claim factual review): owner authorization 2026-10-24.
    {
      reviewSensitivity: true, promoteSource: true, generateDrafts: true, readInternalDrafts: true, extractEvidence: true, proposeClaim: true,
      generateClaimGapFollowups: true, recordSourceMeasurement: true, readReleasedInternalReports: true, reviewInternalDraftFactualContent: true,
      releaseInternalReports: true, readClaimTraceabilityDiagnostics: true, reviewMeasuredClaimFactualContent: true,
    },
  );
  assert.equal(capabilities.data.internalKnowledgeWorkspace, false);
  const readiness = Object.fromEntries(computeOrganizationOperationReadiness(actor, ORG_X).map((row) => [row.key, row.ready]));
  assert.equal(readiness.evidence_processing, true);
  assert.equal(readiness.draft_generation, true);
  assert.equal(readiness.source_review, true);
  for (const key of ["evidence_review", "claim_review", "generated_content_review", "export_release", "coverage_acceptance"]) {
    assert.equal(readiness[key], false, key);
  }
  for (const role of ["client_contributor", "client_reviewer"]) {
    const other = await getOrganizationAccessCapabilities({ organizationId: ORG_X, actorContext: memberActor(role) }, { env: ENV });
    assert.deepEqual(Object.values(other.data.workflowOperations).filter(Boolean), [], role);
  }
  const denied = await getOrganizationAccessCapabilities({ organizationId: ORG_Y, actorContext: actor }, { env: ENV });
  assertDenied(denied, "missing_active_organization_membership", "capabilities in Y");
  // The browser projection carries the split and fails closed.
  const projected = projectOrganizationAccessCapabilities(capabilities.data);
  assert.deepEqual([projected.workflowOperations.generateDrafts, projected.workflowOperations.generateAllDraftTypes], [true, false]);
  assert.deepEqual(clientEvidenceWorkflowAccess(projected), {
    visible: true, reviewSensitivity: true, promoteSource: true, extractEvidence: true, proposeClaim: true, generateClaimGapFollowups: true, generateDrafts: true,
    readInternalDrafts: true, recordSourceMeasurement: true, readReleasedInternalReports: true, reviewInternalDraftFactualContent: true,
    releaseInternalReports: true, readClaimTraceabilityDiagnostics: true, reviewMeasuredClaimFactualContent: true,
  });
});

test("F: the client workflow is offered to client_admin only, never to other client roles or the GK workspace", async () => {
  for (const [label, actorContext, visible] of [
    ["client_admin", await bindingDerivedClientAdmin(), true],
    ["client_contributor", memberActor("client_contributor"), false],
    ["client_reviewer", memberActor("client_reviewer"), false],
    ["gk_reviewer (GK Knowledge Studio)", memberActor("gk_reviewer", { kaiRoles: ["gk_reviewer"] }), false],
  ]) {
    const capabilities = await getOrganizationAccessCapabilities({ organizationId: ORG_X, actorContext }, { env: ENV });
    assert.equal(clientEvidenceWorkflowAccess(projectOrganizationAccessCapabilities(capabilities.data)).visible, visible, label);
  }
  assert.equal(clientEvidenceWorkflowAccess(null).visible, false, "unknown capabilities offer nothing");
});

test("F: authorization and input readiness stay distinct; internal selection admits unreviewed claims but never reviewed_not_supported", () => {
  const selected = [CLAIM];
  assert.deepEqual(internalDraftReadiness({ canGenerate: false, engagementId: ENGAGEMENT_X, selectedClaimIds: selected }), { ready: false, reason: "not_authorized" });
  assert.deepEqual(internalDraftReadiness({ canGenerate: true, engagementId: "", selectedClaimIds: selected }), { ready: false, reason: "no_project" });
  assert.deepEqual(internalDraftReadiness({ canGenerate: true, engagementId: ENGAGEMENT_X, selectedClaimIds: [] }), { ready: false, reason: "no_claims_selected" });
  assert.deepEqual(internalDraftReadiness({ canGenerate: true, engagementId: ENGAGEMENT_X, selectedClaimIds: selected }), { ready: true, reason: null });
  for (const reason of ["not_authorized", "no_project", "no_claims_selected", "too_many_claims"]) assert.ok(INTERNAL_DRAFT_READINESS_MESSAGES[reason]);

  const unreviewed = { claimId: CLAIM, evidenceItemId: EVIDENCE, claimStrength: "unassessed", claimReviewStatus: "needs_gk_review" };
  const rejected = { ...unreviewed, claimId: "3d000000-0000-4000-8000-000000000002", claimStrength: "reviewed_not_supported" };
  assert.deepEqual(claimInternalDraftSelectability(unreviewed), { selectable: true, reason: null });
  assert.deepEqual(claimInternalDraftSelectability(rejected), { selectable: false, reason: "reviewed_not_supported" });
  assert.deepEqual(retainSelectableClaimIds([CLAIM, rejected.claimId, "gone"], [unreviewed, rejected]), [CLAIM]);
  assert.deepEqual(claimIdsByEvidenceItem([unreviewed]).get(EVIDENCE), [CLAIM]);
  assert.deepEqual(
    internalDraftRequestBody({ claimIds: ["b0000000-0000-4000-8000-000000000001", CLAIM], idempotencyKey: "k-123456789", engagementId: ENGAGEMENT_X }),
    { claim_ids: [CLAIM, "b0000000-0000-4000-8000-000000000001"], idempotency_key: "k-123456789", engagement_id: ENGAGEMENT_X },
  );
  const summary = internalDraftResultSummary(draftResult("impact_narrative").data, "impact_narrative");
  assert.deepEqual(summary, {
    generatedContentDraftId: DRAFT, contentType: "impact_narrative", audience: "internal", draftStatus: "draft",
    reviewStatus: "needs_gk_review", blockCount: 1, citedClaimCount: 1, replayed: false,
  });
  assert.ok(!JSON.stringify(summary).includes(QUEUE), "the browser summary keeps no review queue id");
  assert.equal(internalDraftResultSummary({ generatedContentDraftId: "nope" }, "evidence_summary"), null);
  // An authorized request refused for content readiness is explained, never shown as success.
  // Without a diagnosis the reason is not assumed (owner authorization 2026-10-24;
  // the diagnosed messages are proven in kai-client-admin-traceability-diagnostic.spec.js).
  const traceabilityRefusal = { statusCode: 422, body: { error: { code: "validation_blocker", message: "Request failed KAI validation." }, blockers: [{ blocking_reason: "traceability_result_contract_invalid" }] } };
  for (const options of [undefined, { canGenerateGapFollowups: true }]) {
    assert.equal(internalDraftFailureMessage(traceabilityRefusal, options),
      "A selected claim did not pass its traceability checks, so no draft was created. The reason is not available here.");
  }
  assert.match(internalDraftFailureMessage({ statusCode: 422, body: { error: { code: "claim_reviewed_not_supported", message: "x" } } }), /not supported by Get Kinder review/);
  assert.equal(internalDraftFailureMessage({ statusCode: 403, body: { error: { code: "authorization_denied", message: "Denied." } } }), "Denied.");
});

// ---------------------------------------------------------------------------
// G. P2-04 claim gap follow-up generation
// ---------------------------------------------------------------------------

test("G: P2-04 for the binding-derived client_admin forwards only organization X, the claim, and its own KAI user, and returns the repository's open records unchanged", async () => {
  const actor = await bindingDerivedClientAdmin();
  const inputs = [];
  const result = await generateClaimGapFollowups({ organizationId: ORG_X, claimId: CLAIM, actorContext: actor, now: NOW }, {
    env: ENV,
    metadataOnlyAudit: noAudit(),
    claimGapFollowupRepository: { async generateClaimGapsAndFollowups(input) { inputs.push(input); return { ok: true, data: gapFollowupData(ORG_X), error: null }; } },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(inputs.length, 1);
  const { metadataOnlyAudit, ...forwarded } = inputs[0];
  assert.deepEqual(forwarded, { organizationId: ORG_X, claimId: CLAIM, actorUserId: KAI_USER, now: NOW });
  assert.ok(metadataOnlyAudit, "the required audit is forwarded");
  assert.deepEqual(result.data, gapFollowupData(ORG_X), "no state is rewritten by the service");
  assert.deepEqual(result.data.reviewQueueItems.map((item) => [item.queue_status, item.review_status]), [["waiting_on_client", "proposed"]], "follow-ups stay open");
});

test("G: P2-04 on a claim that is not organization X's passes the repository's not_found through without data", async () => {
  const actor = await bindingDerivedClientAdmin();
  const result = await generateClaimGapFollowups({ organizationId: ORG_X, claimId: CLAIM, actorContext: actor, now: NOW }, {
    env: ENV,
    metadataOnlyAudit: noAudit(),
    claimGapFollowupRepository: { async generateClaimGapsAndFollowups() { return { ok: false, data: null, error: { code: "not_found", status: 404 } }; } },
  });
  assert.deepEqual([result.ok, result.error.code, result.data ?? null], [false, "not_found", null]);
});

test("G: P2-04 authority opens no follow-up answer or list, no GK traceability DTO, and no funder or public coverage acceptance for client_admin", async () => {
  const actor = await bindingDerivedClientAdmin();
  const tripwire = new Proxy({}, { get: (_target, property) => (property === "then" ? undefined : async () => assert.fail(`repository ${String(property)} reached`)) });
  const never = async () => assert.fail("read reached");
  const results = {
    completeFollowup: await completeClientFollowup({ organizationId: ORG_X, claimId: CLAIM, clientFollowupItemId: FOLLOWUP, expectedUpdatedAt: NOW, actorContext: actor, now: NOW }, { env: ENV, clientFollowupCompletionRepository: tripwire, metadataOnlyAudit: noAudit() }),
    listFollowups: await listClientFollowupWorkflows({ organizationId: ORG_X, actorContext: actor }, { env: ENV, listClientFollowupWorkflowsForOrganization: never }),
    // Owner authorization 2026-10-24 admits only the client-safe INTERNAL
    // diagnostic (kai-client-admin-traceability-diagnostic.spec.js); funder
    // and public traceability stay GK-only.
    funderTraceability: await getClaimTraceabilitySummary({ organizationId: ORG_X, claimId: CLAIM, requestedAudience: "funder", actorContext: actor }, { env: ENV, claimTraceabilityRepository: tripwire }),
    publicTraceability: await getClaimTraceabilitySummary({ organizationId: ORG_X, claimId: CLAIM, requestedAudience: "public", actorContext: actor }, { env: ENV, claimTraceabilityRepository: tripwire }),
    acceptFunderCoverage: await acceptFunderCoverageLimitation({ organizationId: ORG_X, claimId: CLAIM, dimensionKey: "small_cell_risk", actorContext: actor, now: NOW }, { env: ENV, coverageReviewDecisionRepository: tripwire, metadataOnlyAudit: noAudit() }),
    acceptPublicCoverage: await acceptPublicCoverageLimitation({ organizationId: ORG_X, claimId: CLAIM, dimensionKey: "small_cell_risk", actorContext: actor, now: NOW }, { env: ENV, coverageReviewDecisionRepository: tripwire, metadataOnlyAudit: noAudit() }),
  };
  for (const [label, result] of Object.entries(results)) assertDenied(result, "role_not_allowed", label);
  // Owner authorization 2026-10-24: the internal acceptance reaches the
  // repository only as client_admin, with its in-transaction admission.
  const coverageCalls = [];
  await acceptInternalCoverageLimitation({ organizationId: ORG_X, claimId: CLAIM, dimensionKey: "small_cell_risk", actorContext: actor, now: NOW },
    { env: ENV, coverageReviewDecisionRepository: { async acceptInternalCoverageLimitation(input) { coverageCalls.push(input); return { ok: true, data: {} }; } }, metadataOnlyAudit: noAudit() });
  assert.deepEqual(coverageCalls.map((input) => [input.actorRole, typeof input.acceptanceAdmission]), [["client_admin", "function"]]);
  const internal = await getClaimTraceabilitySummary({ organizationId: ORG_X, claimId: CLAIM, requestedAudience: "internal", actorContext: actor }, {
    env: ENV,
    claimTraceabilityRepository: { async getClaimTraceabilitySummary() { return { ok: true, data: { claim: { claim_id: CLAIM, statement: "GK only" }, eligible: false, blockerCodes: ["claim_review_unresolved"] }, error: null }; } },
  });
  assert.equal(internal.data.view, "organization_internal_traceability_diagnostic");
  assert.equal(JSON.stringify(internal).includes("GK only"), false);
});

test("G: the P2-04 client messages report counts only, and refusals name the server's reason without detail", () => {
  assert.equal(gapFollowupResultMessage(gapFollowupData(ORG_X)),
    "Gap follow-ups generated: 1 open gap(s) and 1 client follow-up question(s) recorded. They stay open until answered and reviewed; the claim is not approved.");
  assert.equal(gapFollowupResultMessage(gapFollowupData(ORG_X, true)),
    "Gap follow-ups were already generated for this claim (1 open gap(s) and 1 client follow-up question(s)). Nothing new was written.");
  for (const text of [gapFollowupResultMessage(gapFollowupData(ORG_X)), gapFollowupResultMessage(gapFollowupData(ORG_X, true))]) {
    assert.ok(!text.includes("How is this field defined?") && !text.includes(QUEUE) && !text.includes(GAP), "no record content or ids");
  }
  assert.match(gapFollowupFailureMessage({ statusCode: 404, body: { error: { code: "not_found", message: "x" } } }), /not found in this organization\. Nothing was written\./);
  assert.match(gapFollowupFailureMessage({ statusCode: 409, body: { error: { code: "conflict_current_state_changed", message: "x" } } }), /Refresh and try again/);
  assert.equal(gapFollowupFailureMessage({ statusCode: 422, body: { error: { code: "validation_blocker", message: "x" }, blockers: [{ blocking_reason: "allowed_use_not_allowed" }] } }),
    "Gap follow-ups cannot be generated for this claim: it did not pass validation (allowed use not allowed). Nothing was written.");
  assert.equal(gapFollowupFailureMessage({ statusCode: 422, body: { error: { code: "validation_blocker", message: "x" } } }),
    "Gap follow-ups cannot be generated for this claim: it did not pass validation. Nothing was written.");
  assert.equal(gapFollowupFailureMessage({ statusCode: 403, body: { error: { code: "authorization_denied", message: "Denied." } } }), "Denied.");
});
