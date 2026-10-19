import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ensureSensitivityReviewQueueItemAfterProfiling,
  __reviewQueueServiceContract,
} from "../Backend/kai/services/kaiReviewQueueService.js";
import { createPostgresReviewQueueRepository } from "../Backend/kai/dictionary/postgresReviewQueueRepository.js";
import {
  authorizeSourcePromotionDecision,
  createSourcePromotionDecision,
  __sourcePromotionServiceContract,
} from "../Backend/kai/services/kaiSourcePromotionService.js";
import {
  getReviewCockpitCapabilities,
  getReviewCockpitIntakeFileSourceCandidate,
  getReviewCockpitSourceCandidateDetail,
  listReviewCockpitQueue,
  submitSourceCandidateDecision,
} from "../Backend/kai/services/kaiReviewCockpitService.js";
import { validateActorIsOrganizationAdministrator } from "../Backend/kai/auth/kaiAuthorizationService.js";
import { getOrganizationAccessCapabilities } from "../Backend/kai/services/kaiOrganizationAccessCapabilitiesService.js";
import {
  sourcePreparationFiles,
  sourcePreparationGuidance,
  sourcePromotionFailureMessage,
  sourcePromotionResultMessage,
} from "../frontend/knowledgeStudio/clientEvidenceWorkflowLogic.js";

/**
 * Owner decision 2026-10-18: a binding-derived client_admin completes
 * permitted sensitivity review and P1-08 source promotion for its own
 * organization; the P1 worker creates the pending P1-06 item. Service-level
 * proof with recording repositories; the assembled PostgreSQL/browser proof
 * is kai-client-admin-source-promotion-browser-acceptance.integration.spec.js.
 */

const ENV = { KAI_SPRINT2_ENABLED: "true" };
const ORG = "0e000000-0000-4000-8000-0000000000a1";
const OTHER_ORG = "0e000000-0000-4000-8000-0000000000b1";
const ENGAGEMENT = "7e000000-0000-4000-8000-0000000000e1";
const FILE = "2e000000-0000-4000-8000-0000000000e1";
const PROFILE = "8e000000-0000-4000-8000-0000000000e1";
const CANDIDATE = "9e000000-0000-4000-8000-0000000000e1";
const QUEUE = "3e000000-0000-4000-8000-0000000000e1";
const NOW = "2026-10-18T12:00:00.000Z";
const SHA = "a".repeat(64);

function actor({ role = "client_admin", organizationId = ORG, bound = false, kaiRoles = [], kaiUserStatus = "active", gkOrganizationId = 4242, actorType = "human", platformSuperuser = false } = {}) {
  return {
    actorType,
    actorUserId: "5e000000-0000-4000-8000-0000000000e1",
    kaiUserStatus,
    kaiRoles,
    platformSuperuser,
    organizationMemberships: [{
      organization_id: organizationId,
      role_name: role,
      membership_status: "active",
      ...(bound ? { source: "gk_organization_binding", gk_organization_id: gkOrganizationId } : {}),
    }],
  };
}
const boundAdmin = (overrides = {}) => actor({ bound: true, ...overrides });

// ---------------------------------------------------------------------------
// P1-06: the worker's post-profiling handoff
// ---------------------------------------------------------------------------

function recordingReviewQueueRepository(result = { ok: true, data: { reviewQueueItem: { review_queue_item_id: QUEUE }, replayed: false } }) {
  const calls = [];
  return { calls, repository: { async createSensitivityReviewQueueItem(input) { calls.push(input); return result; } } };
}

test("P1-06 worker handoff: the fixed system identity, never a caller actor, creates the pending item through the P1-06 repository", async () => {
  const { calls, repository } = recordingReviewQueueRepository();
  const audit = { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) };
  const result = await ensureSensitivityReviewQueueItemAfterProfiling(
    { organizationId: ORG, intakeSensitivityProfileId: PROFILE, now: NOW },
    { env: ENV, reviewQueueRepository: repository, metadataOnlyAudit: audit },
  );
  assert.deepEqual(result, { ok: true, data: { reviewQueueItem: { review_queue_item_id: QUEUE }, replayed: false }, error: null });
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0]).sort(), ["createdByType", "identity", "metadataOnlyAudit", "now"]);
  assert.deepEqual([calls[0].createdByType, calls[0].identity, calls[0].actorUserId], ["system", { organizationId: ORG, intakeSensitivityProfileId: PROFILE }, undefined]);
  assert.deepEqual(__reviewQueueServiceContract.P1_06_WORKER_HANDOFF_ACTOR_CONTEXT, { actorType: "system", actorUserId: null });
});

test("P1-06 worker handoff: feature gate, strict input (no actor, no extra key, canonical ids), and repository refusals are returned as-is", async () => {
  const { calls, repository } = recordingReviewQueueRepository();
  assert.equal((await ensureSensitivityReviewQueueItemAfterProfiling({ organizationId: ORG, intakeSensitivityProfileId: PROFILE, now: NOW }, { env: {}, reviewQueueRepository: repository })).error.code, "feature_disabled");
  for (const input of [
    { organizationId: ORG, intakeSensitivityProfileId: PROFILE, now: NOW, actorContext: actor() },
    { organizationId: ORG.toUpperCase(), intakeSensitivityProfileId: PROFILE, now: NOW },
    { organizationId: ORG, intakeSensitivityProfileId: "not-a-uuid", now: NOW },
    { organizationId: ORG, intakeSensitivityProfileId: PROFILE, now: "yesterday" },
  ]) {
    assert.equal((await ensureSensitivityReviewQueueItemAfterProfiling(input, { env: ENV, reviewQueueRepository: repository })).error.code, "validation_blocker");
  }
  assert.equal(calls.length, 0);
  const blocked = recordingReviewQueueRepository({ ok: false, error: { code: "validation_blocker", status: 422 } });
  const refused = await ensureSensitivityReviewQueueItemAfterProfiling(
    { organizationId: ORG, intakeSensitivityProfileId: PROFILE, now: NOW },
    { env: ENV, reviewQueueRepository: blocked.repository, metadataOnlyAudit: { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) } },
  );
  assert.equal(refused.error.code, "validation_blocker");
});

test("P1-06 repository: a creator is either a mapped human or the system, never both or neither; refused input opens no transaction", async () => {
  let transactions = 0;
  const repository = createPostgresReviewQueueRepository({ runInTransaction: async () => { transactions += 1; throw new Error("no transaction expected"); } });
  const audit = { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) };
  const identity = { organizationId: ORG, intakeSensitivityProfileId: PROFILE };
  for (const input of [
    { identity, createdByType: "system", actorUserId: "5e000000-0000-4000-8000-0000000000e1", now: NOW, metadataOnlyAudit: audit },
    { identity, now: NOW, metadataOnlyAudit: audit },
    { identity, createdByType: "human", actorUserId: "5e000000-0000-4000-8000-0000000000e1", now: NOW, metadataOnlyAudit: audit },
    { identity, createdByType: "ai", now: NOW, metadataOnlyAudit: audit },
  ]) {
    assert.equal((await repository.createSensitivityReviewQueueItem(input)).error.code, "validation_blocker", JSON.stringify(input));
  }
  assert.equal(transactions, 0);
  const source = readFileSync("Backend/kai/dictionary/postgresReviewQueueRepository.js", "utf8");
  assert.match(source, /createdBy: creatorType === "human" \? actorUserId : null,\s+createdByType: creatorType,/);
  assert.match(source, /satisfiesCreationTriggerPredicate\(profileRow\)/, "VAL-FUP-001-P0 still gates every creator");
});

test("P1-06 human seams keep AUTH-KAI-003: the review-work route still resolves a mapped human, and no route reaches the worker handoff", () => {
  const routes = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  assert.doesNotMatch(routes, /ensureSensitivityReviewQueueItemAfterProfiling/);
  const service = readFileSync("Backend/kai/services/kaiReviewQueueService.js", "utf8");
  assert.match(service, /export async function createSensitivityReviewQueueItem[\s\S]*?if \(!isMappedHumanActor\(actorContext\)\) \{\s+return buildKaiError\("authorization_denied"\);/);
});

// ---------------------------------------------------------------------------
// P1-08: the dedicated organization-administrator rule
// ---------------------------------------------------------------------------

test("P1-08 authorization: the binding-derived client_admin of this organization is admitted through its own half; every other client actor is refused", () => {
  assert.deepEqual(authorizeSourcePromotionDecision(boundAdmin(), ORG), { ok: true, organizationAdminAuthorized: true });
  for (const [label, actorContext, organizationId] of [
    ["stored (unbound) client_admin", actor({ role: "client_admin" }), ORG],
    ["bound administrator of another organization", boundAdmin({ organizationId: OTHER_ORG }), ORG],
    ["bound administrator naming another organization", boundAdmin(), OTHER_ORG],
    ["inactive KAI account", boundAdmin({ kaiUserStatus: "suspended" }), ORG],
    ["missing KAI account status", boundAdmin({ kaiUserStatus: null }), ORG],
    ["invalid binding marker 0", boundAdmin({ gkOrganizationId: 0 }), ORG],
    ["invalid binding marker string", boundAdmin({ gkOrganizationId: "4242" }), ORG],
    ["client_reviewer", actor({ role: "client_reviewer" }), ORG],
    ["client_contributor", actor({ role: "client_contributor" }), ORG],
    ["global client_admin role over a contributor membership", actor({ role: "client_contributor", kaiRoles: ["client_admin"] }), ORG],
    ["global gk_reviewer over a contributor membership", actor({ role: "client_contributor", kaiRoles: ["gk_reviewer"] }), ORG],
    ["AI actor", boundAdmin({ actorType: "ai" }), ORG],
    ["system actor", boundAdmin({ actorType: "system" }), ORG],
  ]) {
    const result = authorizeSourcePromotionDecision(actorContext, organizationId);
    assert.equal(result.ok, false, label);
    assert.ok(["authorization_denied", "tenant_boundary_violation"].includes(result.error.error.code), `${label}: ${result.error.error.code}`);
  }
  // GK half unchanged: organization GK roles, organization-membership mode.
  assert.deepEqual([...__sourcePromotionServiceContract.SOURCE_PROMOTION_ALLOWED_ROLES].sort(), ["gk_admin", "gk_operator", "gk_reviewer"]);
  for (const role of ["gk_admin", "gk_operator", "gk_reviewer"]) {
    assert.deepEqual(authorizeSourcePromotionDecision(actor({ role }), ORG), { ok: true, organizationAdminAuthorized: false }, role);
  }
  assert.equal(validateActorIsOrganizationAdministrator(actor({ role: "client_contributor", platformSuperuser: true }), "create_source_promotion_decision", ORG).ok, false,
    "platform-superuser authority is not organization-administrator authority");
});

function recordingPromotionRepository() {
  const calls = [];
  return {
    calls,
    repository: {
      async createSourcePromotionDecision(input) {
        calls.push(input);
        return { ok: true, data: { promotionDecision: {}, replayed: false } };
      },
    },
  };
}

test("P1-08 service: the administrator reaches the unchanged repository (validators, transaction, audit) as itself; refusals reach no repository", async () => {
  const audit = { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) };
  const input = (actorContext) => ({ organizationId: ORG, intakeSourceCandidateId: CANDIDATE, outcome: "promoted", reviewedSourceType: "organization_primary_record", actorContext, now: NOW });
  const allowed = recordingPromotionRepository();
  assert.equal((await createSourcePromotionDecision(input(boundAdmin()), { env: ENV, sourcePromotionRepository: allowed.repository, metadataOnlyAudit: audit })).ok, true);
  assert.deepEqual(Object.keys(allowed.calls[0]).sort(), ["actorUserId", "identity", "metadataOnlyAudit", "now", "outcome", "reviewedSourceType"],
    "no role or authority flag is passed; the repository is identical for every decider");
  assert.equal(allowed.calls[0].actorUserId, boundAdmin().actorUserId);
  const refused = recordingPromotionRepository();
  for (const actorContext of [actor({ role: "client_admin" }), actor({ role: "client_reviewer" }), boundAdmin({ organizationId: OTHER_ORG })]) {
    const result = await createSourcePromotionDecision(input(actorContext), { env: ENV, sourcePromotionRepository: refused.repository, metadataOnlyAudit: audit });
    assert.equal(result.ok, false);
  }
  assert.equal(refused.calls.length, 0);
  assert.equal((await createSourcePromotionDecision(input(boundAdmin()), { env: {}, sourcePromotionRepository: refused.repository })).error.code, "feature_disabled");
});

// ---------------------------------------------------------------------------
// Review cockpit: candidate gate, Project-scoped lookup, capabilities
// ---------------------------------------------------------------------------

const candidateRecord = (overrides = {}) => ({
  sourceCandidate: {
    intake_source_candidate_id: CANDIDATE, organization_id: ORG, intake_file_id: FILE,
    file_profile_id: "4e000000-0000-4000-8000-0000000000e1", data_dictionary_id: "6e000000-0000-4000-8000-0000000000e1",
    intake_sensitivity_profile_id: PROFILE, profile_canonical_sha256: SHA, proposed_source_type: "unknown",
    candidate_status: "needs_gk_review", created_at: NOW,
  },
  reviewQueueItem: {
    review_queue_item_id: QUEUE, organization_id: ORG, queue_type: "source_candidate_review", target_object_type: "intake_source_candidate",
    target_object_id: CANDIDATE, queue_status: "open", review_status: "needs_gk_review", updated_at: NOW,
  },
  promotionDecision: null,
  source: null,
  sourceVersion: null,
  ...overrides,
});

test("cockpit: the bound administrator reads its candidate detail with decision controls; other client roles and other organizations are refused before any read", async () => {
  let reads = 0;
  const deps = { env: ENV, getReviewCockpitSourceCandidateRecord: async (organizationId, id) => { reads += 1; assert.equal(organizationId, ORG); return id === CANDIDATE ? candidateRecord() : null; } };
  const detail = await getReviewCockpitSourceCandidateDetail({ organizationId: ORG, intakeSourceCandidateId: CANDIDATE, actorContext: boundAdmin() }, deps);
  assert.equal(detail.ok, true, JSON.stringify(detail));
  assert.equal(detail.data.decision_controls_enabled, true);
  assert.deepEqual(detail.data.allowed_reviewed_source_types, ["organization_primary_record", "organization_secondary_record", "third_party_provided_record", "public_record"]);
  const terminal = await getReviewCockpitSourceCandidateDetail({ organizationId: ORG, intakeSourceCandidateId: CANDIDATE, actorContext: boundAdmin() },
    { ...deps, getReviewCockpitSourceCandidateRecord: async () => candidateRecord({ reviewQueueItem: { ...candidateRecord().reviewQueueItem, queue_status: "resolved" } }) });
  assert.equal(terminal.data.decision_controls_enabled, false, "the completeness predicate still decides");
  const readsBefore = reads;
  for (const actorContext of [actor({ role: "client_admin" }), actor({ role: "client_contributor" }), actor({ role: "client_reviewer" }), boundAdmin({ organizationId: OTHER_ORG }), boundAdmin({ kaiUserStatus: "disabled" })]) {
    const refused = await getReviewCockpitSourceCandidateDetail({ organizationId: ORG, intakeSourceCandidateId: CANDIDATE, actorContext }, deps);
    assert.equal(refused.ok, false);
    assert.equal(refused.error.code, "authorization_denied");
    const decided = await submitSourceCandidateDecision({ organizationId: ORG, intakeSourceCandidateId: CANDIDATE, actorContext, payload: { outcome: "promoted", reviewed_source_type: "public_record" } },
      { ...deps, createSourcePromotionDecision: async () => assert.fail("decision reached") });
    assert.equal(decided.error.code, "authorization_denied");
  }
  assert.equal(reads, readsBefore, "no read for a refused actor");
});

test("cockpit: the GK source review queue stays GK-only; the bound administrator cannot list it", async () => {
  const listed = await listReviewCockpitQueue(
    { organizationId: ORG, actorContext: boundAdmin(), selection: { queueType: "source_candidate_review" } },
    { env: ENV, listReviewCockpitQueueItems: async () => assert.fail("queue read") },
  );
  assert.deepEqual([listed.ok, listed.error.code, listed.blockers?.[0]?.blocking_reason], [false, "authorization_denied", "role_not_allowed"]);
});

test("cockpit: the file -> candidate lookup is organization-, Project-, and file-scoped and returns ids only", async () => {
  const calls = [];
  const deps = (record) => ({ env: ENV, getReviewCockpitIntakeFileSourceCandidateRecord: async (...args) => { calls.push(args); return record; } });
  const input = { organizationId: ORG, engagementId: ENGAGEMENT, intakeFileId: FILE, actorContext: boundAdmin() };
  const found = await getReviewCockpitIntakeFileSourceCandidate(input, deps({ organization_id: ORG, engagement_id: ENGAGEMENT, intake_file_id: FILE, intake_source_candidate_id: CANDIDATE }));
  assert.deepEqual(found, { ok: true, data: { intake_file_id: FILE, engagement_id: ENGAGEMENT, intake_source_candidate_id: CANDIDATE } });
  assert.deepEqual(calls[0], [ORG, ENGAGEMENT, FILE]);
  const none = await getReviewCockpitIntakeFileSourceCandidate(input, deps({ organization_id: ORG, engagement_id: ENGAGEMENT, intake_file_id: FILE, intake_source_candidate_id: null }));
  assert.equal(none.data.intake_source_candidate_id, null);
  assert.equal((await getReviewCockpitIntakeFileSourceCandidate(input, deps(null))).error.code, "not_found");
  assert.equal((await getReviewCockpitIntakeFileSourceCandidate(input, deps({ organization_id: ORG, engagement_id: "7e000000-0000-4000-8000-0000000000e9", intake_file_id: FILE, intake_source_candidate_id: CANDIDATE }))).error.code, "not_found");
  assert.equal((await getReviewCockpitIntakeFileSourceCandidate({ ...input, engagementId: "nope" }, deps(null))).error.code, "invalid_request");
  const refused = await getReviewCockpitIntakeFileSourceCandidate({ ...input, actorContext: actor({ role: "client_contributor" }) }, { env: ENV, getReviewCockpitIntakeFileSourceCandidateRecord: async () => assert.fail("read") });
  assert.equal(refused.error.code, "authorization_denied");
});

test("capabilities: reviewSensitivity / promoteSource and the cockpit probe match server authority for each actor", async () => {
  const cases = [
    ["bound client_admin", boundAdmin(), true, true, true],
    ["stored client_admin", actor({ role: "client_admin" }), false, false, false],
    ["client_contributor", actor({ role: "client_contributor" }), false, false, false],
    ["client_reviewer", actor({ role: "client_reviewer" }), false, false, false],
    ["global + org gk_operator", actor({ role: "gk_operator", kaiRoles: ["gk_operator"] }), true, true, true],
    ["org-only gk_reviewer (no cockpit read)", actor({ role: "gk_reviewer" }), false, false, false],
  ];
  for (const [label, actorContext, reviewSensitivity, promoteSource, probe] of cases) {
    const capabilities = await getOrganizationAccessCapabilities({ organizationId: ORG, actorContext }, { env: ENV });
    assert.deepEqual([capabilities.data.workflowOperations.reviewSensitivity, capabilities.data.workflowOperations.promoteSource], [reviewSensitivity, promoteSource], label);
    const cockpit = await getReviewCockpitCapabilities({ organizationId: ORG, actorContext }, { env: ENV });
    assert.equal(cockpit.data.can_promote_source_candidates, probe, label);
    if (label.includes("client")) assert.equal(capabilities.data.workflowOperations.readGeneratedDrafts, false, `${label}: readGeneratedDrafts unchanged`);
  }
});

// ---------------------------------------------------------------------------
// Client workflow logic
// ---------------------------------------------------------------------------

test("client logic: source preparation lists the actor's actionable files with server guidance, and decision results/refusals are explained", () => {
  const file = (n, currentStage, nextAction, currentStatus = "waiting_for_get_kinder", reason = "") => ({ intakeFileId: `f${n}`, currentStage, nextAction, currentStatus, reason });
  const data = { files: [
    file(1, "sensitivity_review", "none_waiting_for_get_kinder"),
    file(2, "source_review", "promote_source", "waiting_for_client", "source_promotion_ready"),
    file(3, "source_review", "contact_get_kinder", "waiting_for_get_kinder", "source_candidate_missing"),
    file(4, "evidence_extraction", "extract_evidence", "waiting_for_client"),
    file(5, "evidence_review", "none_waiting_for_get_kinder"),
  ] };
  assert.deepEqual(sourcePreparationFiles(data, { reviewSensitivity: true }).map((f) => f.intakeFileId), ["f1", "f2", "f3", "f4"]);
  assert.deepEqual(sourcePreparationFiles(data, { reviewSensitivity: false }).map((f) => f.intakeFileId), ["f2", "f3", "f4"]);
  assert.match(sourcePreparationGuidance(data.files[0], { reviewSensitivity: true }), /^Your action is needed: review this file's sensitivity/);
  assert.match(sourcePreparationGuidance(data.files[0], { reviewSensitivity: false }), /Waiting for Get Kinder sensitivity review/);
  assert.match(sourcePreparationGuidance(data.files[2], {}), /no source candidate was created/);
  assert.match(sourcePromotionResultMessage({ promotion_decision: { decision_status: "promoted" }, evidence_extraction_handoff: { status: "created", evidence_item_count: 2 }, replayed: false }),
    /^Source promoted\. Evidence extraction created 2 evidence item\(s\)/);
  assert.match(sourcePromotionResultMessage({ promotion_decision: { decision_status: "promoted" }, evidence_extraction_handoff: { status: "not_created", error_code: "system_error" } }), /Extract evidence/);
  assert.match(sourcePromotionFailureMessage({ body: { error: { code: "validation_blocker" }, data: { exact_verification_phase: "source_promotion_permission_predicate_failed" } } }),
    /recorded sensitivity and allowed-use restrictions do not permit promotion/);
  assert.match(sourcePromotionFailureMessage({ body: { error: { code: "authorization_denied" }, blockers: [{ blocking_reason: "role_not_allowed" }] } }), /\(role_not_allowed\)/);
});
