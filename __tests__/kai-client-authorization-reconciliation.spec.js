import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";

import { resolveKaiActorContext } from "../Backend/kai/auth/kaiActorContext.js";
import { validateActorCanPerformOperation } from "../Backend/kai/auth/kaiAuthorizationService.js";
import { KAI_SPRINT2_P0_OPERATION_ROLES } from "../Backend/kai/config/kaiSprint2P0Contract.js";
import {
  listClientImpactFacts,
  __clientImpactFactsServiceContract,
} from "../Backend/kai/services/kaiClientImpactFactsService.js";
import {
  getOrganizationAccessCapabilities,
  __organizationAccessCapabilitiesServiceContract,
} from "../Backend/kai/services/kaiOrganizationAccessCapabilitiesService.js";
import { getImpactHomeSummary } from "../Backend/kai/services/kaiImpactHomeSummaryService.js";
import { createPostgresEligibleClaimsForAudienceRepository } from "../Backend/kai/dictionary/postgresEligibleClaimsForAudienceRepository.js";
import { listAuthorizedOrganizations } from "../Backend/kai/services/kaiOrganizationContextService.js";
import { listAuthorizedEngagements } from "../Backend/kai/services/kaiEngagementContextService.js";
import { listImprovementPracticesForOrganizationOperation } from "../Backend/kai/services/kaiImprovementPracticeService.js";
import { listIntakeBatchesForOrganization } from "../Backend/kai/services/kaiIntakeService.js";
import { getReviewCockpitCapabilities } from "../Backend/kai/services/kaiReviewCockpitService.js";
import { listClaimLibraryCandidates, __claimLibraryServiceContract } from "../Backend/kai/services/kaiClaimLibraryService.js";
import { listOrganizationEvidenceLibrary, __evidenceLibraryServiceContract } from "../Backend/kai/services/kaiEvidenceLibraryService.js";
import { listEligibleClaimsForAudience, __eligibleClaimsForAudienceServiceContract } from "../Backend/kai/services/kaiEligibleClaimsForAudienceService.js";
import { getClaimTraceabilitySummary, listOrganizationReviewQueue } from "../Backend/kai/services/kaiClaimTraceabilityService.js";
import { listOrganizationSources } from "../Backend/kai/services/kaiSourceLibraryService.js";
import { listOrganizationRequirementsReadiness } from "../Backend/kai/services/kaiRequirementAssessmentService.js";
import { listGeneratedDraftLibraryIndex } from "../Backend/kai/services/kaiGeneratedDraftLibraryService.js";
import { getGrantResponsePacket } from "../Backend/kai/services/kaiGrantResponsePacketService.js";
import { getBoardReportingPacket } from "../Backend/kai/services/kaiBoardReportingPacketService.js";
import { createBoardReportingCandidate } from "../Backend/kai/services/kaiBoardReportingCandidateService.js";
import { listClientFollowupWorkflows } from "../Backend/kai/services/kaiClientFollowupReadService.js";
import { completeClientFollowup } from "../Backend/kai/services/kaiClientFollowupCompletionService.js";
import { DECISION_ALLOWED_ROLES } from "../Backend/kai/dictionary/humanReviewDecisionContract.js";
import sprint2IntakeApiRouter, { __testables as routeTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";

/**
 * Client authorization contract reconciliation across the reachable Impact
 * Library client. client_admin is derived through the real
 * resolveKaiActorContext + GK organization binding (no manual
 * kai.organization_memberships row). Owner contract: client_admin is the
 * ordinary organization-administration client role with client-safe reads
 * and client contribution; it is not client_reviewer and not a GK role.
 */

const ENV = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });
const ORG = "11111111-2222-4333-8444-555555555555";
const OTHER_ORG = "99999999-8888-4777-8666-555555555555";
const ENGAGEMENT = "22222222-3333-4444-8555-666666666666";
const GK_ORG = 77;

const CLAIM_ELIGIBLE = "c0000000-0000-4000-8000-000000000001";
const CLAIM_LIMITED = "c0000000-0000-4000-8000-000000000002";
const CLAIM_UNREVIEWED = "c0000000-0000-4000-8000-000000000003";
const CLAIM_IN_GK_REVIEW = "c0000000-0000-4000-8000-000000000004";
const CLAIM_SENSITIVE = "c0000000-0000-4000-8000-000000000005";

// Content the client must never receive through a client-safe read.
const HIDDEN = Object.freeze([
  "UNREVIEWED CLAIM STATEMENT",
  "GK REVIEW CLAIM STATEMENT",
  "SENSITIVE RESTRICTED STATEMENT",
  "VERBATIM EVIDENCE TEXT",
  "source-code-secret",
  "reviewer note: internal",
  "VAL-COV-SECRET",
  CLAIM_UNREVIEWED,
  CLAIM_IN_GK_REVIEW,
  CLAIM_SENSITIVE,
  "e0000000-0000-4000-8000-000000000001",
  "s0000000-0000-4000-8000-000000000001",
  "v0000000-0000-4000-8000-000000000001",
  "rq-evidence-review",
  "rq-claim-review",
  "profile-secret-id",
  "needs_gk_review",
  "approved_audiences",
]);

function eligibleEvaluation(claimId, statement, dimensions = {}) {
  return {
    eligible: true,
    blockerCodes: [],
    claim: {
      claim_id: claimId,
      claim_type: "outcome",
      claim_status: "approved",
      claim_review_status: "reviewed",
      claim_strength: "reviewed_supported",
      statement,
      audience_gates: { internal_only: true, public_use_allowed: false, funder_use_allowed: false, export_ready: false },
    },
    evidence: {
      evidence_item_id: "e0000000-0000-4000-8000-000000000001",
      support_strength: "reviewed_supported",
      statement: "VERBATIM EVIDENCE TEXT",
      review_queue_item_id: "rq-evidence-review",
      review_status: "resolved",
      sensitivity_level: "restricted",
    },
    source: { source_id: "s0000000-0000-4000-8000-000000000001", source_code: "source-code-secret" },
    source_version: { source_version_id: "v0000000-0000-4000-8000-000000000001", is_current: true },
    claim_review: { review_queue_item_id: "rq-claim-review", queue_status: "resolved", review_status: "resolved" },
    claim_review_decision: { decision_id: "d1", decision_outcome: "approved", approved_audiences: ["internal"] },
    candidate: { intake_source_candidate_id: "cand", intake_sensitivity_profile_id: "profile-secret-id" },
    dimensions,
    gap_items: [{ gap_log_item_id: "g1", validator_key: "VAL-COV-SECRET", notes: "reviewer note: internal" }],
  };
}

const EVALUATIONS = Object.freeze({
  [CLAIM_ELIGIBLE]: eligibleEvaluation(CLAIM_ELIGIBLE, "Participants completed the program", {
    missingness: { assessment_status: "resolved", validator_key: "VAL-COV-SECRET", internal_limitation_accepted: false },
  }),
  [CLAIM_LIMITED]: eligibleEvaluation(CLAIM_LIMITED, "Attendance increased year over year", {
    missingness: { assessment_status: "unresolved", validator_key: "VAL-COV-SECRET", internal_limitation_accepted: true },
    duplicates: { assessment_status: "resolved", validator_key: "VAL-COV-SECRET", internal_limitation_accepted: true },
    definition_clarity: { assessment_status: "unresolved", validator_key: "VAL-COV-SECRET", internal_limitation_accepted: false, funder_limitation_accepted: true },
  }),
  [CLAIM_UNREVIEWED]: { eligible: false, blockerCodes: ["claim_review_unresolved"], claim: { claim_id: CLAIM_UNREVIEWED, statement: "UNREVIEWED CLAIM STATEMENT", claim_review_status: "needs_gk_review" } },
  [CLAIM_IN_GK_REVIEW]: { eligible: false, blockerCodes: ["evidence_review_unresolved"], claim: { claim_id: CLAIM_IN_GK_REVIEW, statement: "GK REVIEW CLAIM STATEMENT" } },
  [CLAIM_SENSITIVE]: { eligible: false, blockerCodes: ["audience_gate_closed"], claim: { claim_id: CLAIM_SENSITIVE, statement: "SENSITIVE RESTRICTED STATEMENT" } },
});

function claimsTransaction(claimIds, organizationScope = ORG) {
  return {
    async query(sql, params = []) {
      if (sql.startsWith("SET TRANSACTION")) return { rows: [] };
      assert.match(sql, /FROM kai\.claims/);
      const [organizationId, limit, afterClaimId] = params;
      assert.equal(organizationId, organizationScope, "claims are only ever scanned inside the requested organization");
      return {
        rows: claimIds
          .filter((id) => afterClaimId === undefined || id > afterClaimId)
          .sort()
          .slice(0, limit)
          .map((claim_id) => ({ claim_id })),
      };
    },
  };
}

function factsDependencies({ claimIds = Object.keys(EVALUATIONS), calls = [] } = {}) {
  const tx = claimsTransaction(claimIds);
  return {
    env: ENV,
    runInTransaction: async (callback) => callback(tx),
    claimTraceabilityEvaluator: async (_tx, input) => {
      calls.push(input);
      const data = EVALUATIONS[input.claimId];
      return data ? { ok: true, data: { ...data, requestedAudience: input.requestedAudience } } : { ok: false, error: { code: "not_found" } };
    },
  };
}

async function clientAdminActor() {
  const result = await resolveKaiActorContext(
    { user: { id: 501, email: "admin@harbourline.test" } },
    {
      findOrCreateKaiUserByLegacyPublicUserdataId: async ({ legacyPublicUserdataId, email }) => ({
        user_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        legacy_identity_source: "public.userdata",
        legacy_public_userdata_id: legacyPublicUserdataId,
        status: "active",
        email,
      }),
      listKaiRolesForUser: async () => [],
      listOrganizationMembershipsForUser: async () => [],
      resolveOrgScopeForUserId: async () => ({ memberships: [{ orgId: GK_ORG, role: "admin", is_active: true }] }),
      listActiveGkOrganizationBindingsForGkOrganizationIds: async (ids) =>
        ids.includes(GK_ORG) ? [{ gk_organization_id: GK_ORG, kai_organization_id: ORG, status: "active" }] : [],
    },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.actorContext.organizationMemberships.map(({ organization_id, role_name, source }) => ({ organization_id, role_name, source })),
    [{ organization_id: ORG, role_name: "client_admin", source: "gk_organization_binding" }],
  );
  return result.actorContext;
}

function memberActor(roleName, { organizationId = ORG, kaiRoles = [] } = {}) {
  return {
    actorType: "human",
    actorUserId: `user-${roleName}`,
    kaiRoles,
    platformSuperuser: false,
    organizationMemberships: [{ organization_id: organizationId, role_name: roleName, membership_status: "active" }],
  };
}

function assertNoHidden(value, label) {
  const serialized = JSON.stringify(value);
  for (const secret of HIDDEN) assert.ok(!serialized.includes(secret), `${label} leaked ${secret}`);
}

function assertRoleDenied(result, label) {
  assert.equal(result.ok, false, `${label} must deny`);
  assert.equal(result.error.code, "authorization_denied", `${label}: ${JSON.stringify(result.error)}`);
  assert.equal(result.blockers?.[0]?.validator_key, "VAL-AUT-004", label);
  assert.equal(result.blockers?.[0]?.blocking_reason, "role_not_allowed", label);
}

const throwingRead = (name) => async () => {
  throw new Error(`${name} must not be read for a denied actor`);
};

// ---------------------------------------------------------------------------
// Contracts: no GK role set was widened; new reads reuse read_intake.
// ---------------------------------------------------------------------------

test("contract: new client-safe reads admit exactly the read_intake set; GK-internal role sets are unchanged", () => {
  const readIntake = [...KAI_SPRINT2_P0_OPERATION_ROLES.read_intake].sort();
  assert.deepEqual([...__clientImpactFactsServiceContract.CLIENT_IMPACT_FACTS_ALLOWED_ROLES].sort(), readIntake);
  assert.deepEqual([...__organizationAccessCapabilitiesServiceContract.ACCESS_CAPABILITIES_ALLOWED_ROLES].sort(), readIntake);
  assert.equal(__clientImpactFactsServiceContract.CLIENT_IMPACT_FACT_AUDIENCE, "internal");
  const gkRead = ["gk_admin", "gk_operator", "gk_reviewer"];
  assert.deepEqual([...__claimLibraryServiceContract.CLAIM_LIBRARY_READ_ROLES].sort(), gkRead);
  assert.deepEqual([...__evidenceLibraryServiceContract.EVIDENCE_LIBRARY_READ_ROLES].sort(), gkRead);
  assert.deepEqual([...__eligibleClaimsForAudienceServiceContract.ELIGIBLE_CLAIMS_ALLOWED_ROLES].sort(), gkRead);
  assert.deepEqual([...DECISION_ALLOWED_ROLES].sort(), ["gk_admin", "gk_reviewer"]);
});

// ---------------------------------------------------------------------------
// Client-safe reviewed Impact Facts.
// ---------------------------------------------------------------------------

test("impact facts, binding-derived client_admin: only governed-eligible claims, exact client-safe keys, accepted internal limitations only", async () => {
  const actorContext = await clientAdminActor();
  const calls = [];
  const result = await listClientImpactFacts({ organizationId: ORG, actorContext }, factsDependencies({ calls }));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.data, {
    items: [
      { claimId: CLAIM_ELIGIBLE, statement: "Participants completed the program", claimType: "outcome", limitationDimensionKeys: [] },
      { claimId: CLAIM_LIMITED, statement: "Attendance increased year over year", claimType: "outcome", limitationDimensionKeys: ["missingness"] },
    ],
    truncated: false,
  });
  assertNoHidden(result.data, "impact facts");
  assert.equal(calls.length, 5);
  assert.ok(calls.every((call) => call.requestedAudience === "internal" && call.organizationId === ORG));
});

test("impact facts: hidden/ineligible items change neither the payload nor any count, and only unreviewed data yields a genuine empty state", async () => {
  const actorContext = await clientAdminActor();
  const onlyHidden = await listClientImpactFacts(
    { organizationId: ORG, actorContext },
    factsDependencies({ claimIds: [CLAIM_UNREVIEWED, CLAIM_IN_GK_REVIEW, CLAIM_SENSITIVE] }),
  );
  assert.deepEqual(onlyHidden.data, { items: [], truncated: false });
  const mixed = await listClientImpactFacts({ organizationId: ORG, actorContext }, factsDependencies());
  const eligibleOnly = await listClientImpactFacts(
    { organizationId: ORG, actorContext },
    factsDependencies({ claimIds: [CLAIM_ELIGIBLE, CLAIM_LIMITED] }),
  );
  assert.deepEqual(mixed.data, eligibleOnly.data, "adding hidden claims is invisible to the client");
});

test("impact facts: client_reviewer and client_contributor get the same client-safe facts; GK reviewer is admitted too", async () => {
  for (const role of ["client_reviewer", "client_contributor", "gk_reviewer"]) {
    const result = await listClientImpactFacts({ organizationId: ORG, actorContext: memberActor(role) }, factsDependencies());
    assert.equal(result.ok, true, `${role}: ${JSON.stringify(result)}`);
    assert.equal(result.data.items.length, 2);
    assertNoHidden(result.data, role);
  }
});

test("impact facts: cross-org client_admin denied (VAL-AUT-003) before any claim is scanned; malformed input and unmapped actors rejected", async () => {
  const actorContext = await clientAdminActor();
  const calls = [];
  const denied = await listClientImpactFacts({ organizationId: OTHER_ORG, actorContext }, factsDependencies({ calls }));
  assert.equal(denied.ok, false);
  assert.equal(denied.blockers[0].validator_key, "VAL-AUT-003");
  assert.equal(calls.length, 0);
  assertNoHidden(denied, "cross-org error");
  const deps = factsDependencies();
  assert.equal((await listClientImpactFacts({ organizationId: ORG, actorContext: { actorType: "service" } }, deps)).error.code, "authorization_denied");
  assert.equal((await listClientImpactFacts({ organizationId: "ABCDEF00-2222-4333-8444-555555555555", actorContext }, deps)).error.code, "validation_blocker");
  assert.equal((await listClientImpactFacts({ organizationId: ORG, actorContext, limit: 5 }, deps)).error.code, "validation_blocker");
  assert.equal((await listClientImpactFacts({ organizationId: ORG, actorContext }, { ...deps, env: {} })).error.code, "feature_disabled");
});

test("impact facts: bounded at 100 with a truncated flag and no scan cursor (a cursor could name an ineligible claim)", async () => {
  const ids = Array.from({ length: 130 }, (_, index) => `c1000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
  const evaluations = Object.fromEntries(ids.map((id) => [id, eligibleEvaluation(id, `Fact ${id}`)]));
  const tx = claimsTransaction(ids);
  const result = await listClientImpactFacts(
    { organizationId: ORG, actorContext: memberActor("client_admin") },
    {
      env: ENV,
      runInTransaction: async (callback) => callback(tx),
      claimTraceabilityEvaluator: async (_tx, input) => ({ ok: true, data: evaluations[input.claimId] }),
    },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.items.length, 100);
  assert.equal(result.data.truncated, true);
  assert.deepEqual(Object.keys(result.data).sort(), ["items", "truncated"]);
});

test("impact facts: governed evaluator failure fails closed", async () => {
  const tx = claimsTransaction([CLAIM_ELIGIBLE]);
  const result = await listClientImpactFacts(
    { organizationId: ORG, actorContext: memberActor("client_admin") },
    {
      env: ENV,
      runInTransaction: async (callback) => callback(tx),
      claimTraceabilityEvaluator: async () => ({ ok: false, error: { code: "system_error" } }),
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
});

test("P2-08 repository default projection is unchanged when no projection is supplied", async () => {
  const tx = claimsTransaction([CLAIM_ELIGIBLE, CLAIM_UNREVIEWED]);
  const repository = createPostgresEligibleClaimsForAudienceRepository({
    runInTransaction: async (callback) => callback(tx),
    evaluator: async (_tx, input) => ({ ok: true, data: { ...EVALUATIONS[input.claimId], requestedAudience: input.requestedAudience } }),
  });
  const result = await repository.listEligibleClaimsForAudience({ organizationId: ORG, requestedAudience: "internal", limit: 25, afterClaimId: null });
  assert.deepEqual(Object.keys(result.data.eligibleClaims[0]).sort(), [
    "claimId", "claimReviewStatus", "claimStatus", "claimType", "evidenceItemId", "requestedAudience", "sourceId", "sourceVersionId", "supportStrength",
  ]);
  assert.equal(result.data.eligibleClaims.length, 1);
});

// ---------------------------------------------------------------------------
// Access capabilities (server-derived, no parallel role system).
// ---------------------------------------------------------------------------

test("access capabilities follow each existing policy: client_admin contributes but is neither GK nor client reviewer", async () => {
  const expectations = [
    [await clientAdminActor(), { internalKnowledgeWorkspace: false, intakeContribution: true, clientFollowupReview: false }],
    [memberActor("client_reviewer"), { internalKnowledgeWorkspace: false, intakeContribution: false, clientFollowupReview: true }],
    [memberActor("client_contributor"), { internalKnowledgeWorkspace: false, intakeContribution: false, clientFollowupReview: false }],
    [memberActor("gk_reviewer"), { internalKnowledgeWorkspace: true, intakeContribution: false, clientFollowupReview: false }],
    [memberActor("gk_operator", { kaiRoles: ["gk_operator"] }), { internalKnowledgeWorkspace: true, intakeContribution: true, clientFollowupReview: false }],
  ];
  for (const [actorContext, expected] of expectations) {
    const result = await getOrganizationAccessCapabilities({ organizationId: ORG, actorContext }, { env: ENV });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.data, expected, actorContext.organizationMemberships[0].role_name);
  }
});

test("access capabilities: cross-org denied, malformed/unmapped rejected, feature flag honoured", async () => {
  const actorContext = await clientAdminActor();
  const denied = await getOrganizationAccessCapabilities({ organizationId: OTHER_ORG, actorContext }, { env: ENV });
  assert.equal(denied.blockers[0].validator_key, "VAL-AUT-003");
  assert.equal((await getOrganizationAccessCapabilities({ organizationId: ORG, actorContext: { actorType: "service" } }, { env: ENV })).error.code, "authorization_denied");
  assert.equal((await getOrganizationAccessCapabilities({ organizationId: "bad", actorContext }, { env: ENV })).error.code, "validation_blocker");
  assert.equal((await getOrganizationAccessCapabilities({ organizationId: ORG, actorContext }, { env: {} })).error.code, "feature_disabled");
});

// ---------------------------------------------------------------------------
// Mounted routes.
// ---------------------------------------------------------------------------

test("routes: access-capabilities and impact-facts forward only the path organization id and the resolved actor", async () => {
  const actorContext = await clientAdminActor();
  const received = [];
  const restoreService = routeTestables.setIntakeServiceForTest({
    getOrganizationAccessCapabilities: async (input) => {
      received.push(["capabilities", input]);
      return { ok: true, data: { internalKnowledgeWorkspace: false } };
    },
    listClientImpactFacts: async (input) => {
      received.push(["facts", input]);
      return { ok: true, data: { items: [], truncated: false } };
    },
  });
  const restoreActor = routeTestables.setActorContextMiddlewareForTest((req, _res, next) => {
    req.kaiSprint2ActorContext = actorContext;
    next();
  });
  const originalFlag = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  const app = express();
  app.use((req, _res, next) => {
    req.isAuthenticated = () => true;
    req.user = { id: 501, email: "admin@harbourline.test" };
    next();
  });
  app.use("/api/kai/sprint2/intake", sprint2IntakeApiRouter);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}/api/kai/sprint2/intake/admin/organizations`;
    assert.equal((await fetch(`${base}/${ORG}/access-capabilities?organization_id=${OTHER_ORG}`)).status, 200);
    assert.equal((await fetch(`${base}/${ORG}/impact-facts?organization_id=${OTHER_ORG}&audience=public`)).status, 200);
    assert.deepEqual(received, [
      ["capabilities", { organizationId: ORG, actorContext }],
      ["facts", { organizationId: ORG, actorContext }],
    ]);
    assert.equal((await fetch(`${base}/not-a-uuid/access-capabilities`)).status, 422);
    assert.equal((await fetch(`${base}/not-a-uuid/impact-facts`)).status, 422);
    assert.equal(received.length, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restoreActor();
    restoreService();
    process.env.KAI_SPRINT2_ENABLED = originalFlag;
  }
});

// ---------------------------------------------------------------------------
// Assembled client authorization journey.
// ---------------------------------------------------------------------------

test("assembled journey, client_admin: every read the client UI issues is admitted and returns client-safe content", async () => {
  const actorContext = await clientAdminActor();

  // Shell bootstrap.
  const organizations = await listAuthorizedOrganizations({ actorContext }, { env: ENV });
  assert.deepEqual(organizations.data.items.map((item) => item.organization_id), [ORG]);
  const capabilities = await getOrganizationAccessCapabilities({ organizationId: ORG, actorContext }, { env: ENV });
  assert.equal(capabilities.data.internalKnowledgeWorkspace, false, "client UI mounts client views, never the GK cockpit");
  const engagements = await listAuthorizedEngagements(
    { organizationId: ORG, actorContext },
    { env: ENV, listEngagementsForOrganization: async () => [] },
  );
  assert.equal(engagements.ok, true, JSON.stringify(engagements));
  const practices = await listImprovementPracticesForOrganizationOperation(
    { organizationId: ORG, actorContext },
    { env: ENV, listImprovementPracticesForOrganization: async () => [] },
  );
  assert.equal(practices.ok, true, JSON.stringify(practices));

  // Impact Home + Needs Attention bell.
  const summary = await getImpactHomeSummary(
    { organizationId: ORG, actorContext },
    {
      env: ENV,
      eligibleClaimsForAudienceRepository: createPostgresEligibleClaimsForAudienceRepository({
        runInTransaction: async (callback) => callback(claimsTransaction(Object.keys(EVALUATIONS))),
        evaluator: async (_tx, input) => ({ ok: true, data: { ...EVALUATIONS[input.claimId], requestedAudience: input.requestedAudience } }),
      }),
      listClientFollowupWorkflowsForOrganization: throwingRead("client follow-ups"),
    },
  );
  assert.equal(summary.ok, true, JSON.stringify(summary));
  assert.equal(summary.data.reviewedImpactFactCount, 2);
  assert.equal(summary.data.internalReviewAvailable, false, "Review Queue is never requested");
  assert.deepEqual(summary.data.clientActions, []);
  const sensitivity = await getReviewCockpitCapabilities({ organizationId: ORG, actorContext }, { env: ENV });
  assert.deepEqual(sensitivity, { ok: true, data: { can_manage_sensitivity_review: false } }, "200 false, never a 403 probe");

  // Knowledge Studio -> Files / Data Sources (intake reads).
  const batches = await listIntakeBatchesForOrganization(
    { organizationId: ORG, actorContext },
    { env: ENV, listIntakeBatchesForOrganization: async () => [] },
  );
  assert.equal(batches.ok, true, JSON.stringify(batches));

  // Knowledge Studio -> Evidence and Impact Library (client-safe facts).
  const facts = await listClientImpactFacts({ organizationId: ORG, actorContext }, factsDependencies());
  assert.equal(facts.ok, true);
  assert.equal(facts.data.items.length, 2);
  for (const value of [organizations, capabilities, engagements, practices, summary, sensitivity, batches, facts]) {
    assertNoHidden(value, "client_admin journey");
  }
});

test("assembled journey, client_admin contribution: intake writes pass policy; client-review and GK operations do not", async () => {
  const actorContext = await clientAdminActor();
  assert.equal(validateActorCanPerformOperation(actorContext, "create_intake_batch", ORG).ok, true);
  assert.equal(validateActorCanPerformOperation(actorContext, "create_intake_file", ORG).ok, true);
  for (const operation of ["mark_file_policy_blocked", "create_review_queue_item", "update_review_queue_status"]) {
    assert.equal(validateActorCanPerformOperation(actorContext, operation, ORG).ok, false, operation);
  }
  assert.equal(
    validateActorCanPerformOperation(actorContext, "record_claim_review_decision", ORG, { allowedRoles: new Set(DECISION_ALLOWED_ROLES) }).ok,
    false,
    "no GK claim/evidence review decision authority",
  );
  assert.equal(validateActorCanPerformOperation(actorContext, "create_intake_batch", OTHER_ORG).ok, false, "no cross-org contribution");
});

test("assembled journey, client_admin: GK-internal, client-reviewer, and high-risk surfaces deny with role_not_allowed before any read", async () => {
  const actorContext = await clientAdminActor();
  const now = "2026-09-24T12:00:00.000Z";
  const denials = {
    "evidence-library/candidates": await listOrganizationEvidenceLibrary(
      { organizationId: ORG, limit: 25, afterEvidenceItemId: null, actorContext },
      { env: ENV, listOrganizationEvidenceItems: throwingRead("evidence items") },
    ),
    "claim-library/candidates": await listClaimLibraryCandidates(
      { organizationId: ORG, actorContext, limit: 25 },
      { env: ENV, listClaimLibraryReviewCandidates: throwingRead("claim library") },
    ),
    "eligible-claims": await listEligibleClaimsForAudience(
      { organizationId: ORG, requestedAudience: "internal", limit: 25, afterClaimId: null, actorContext },
      { env: ENV, eligibleClaimsForAudienceRepository: { listEligibleClaimsForAudience: throwingRead("eligible claims") } },
    ),
    "claims/:id/traceability": await getClaimTraceabilitySummary(
      { organizationId: ORG, claimId: CLAIM_ELIGIBLE, requestedAudience: "internal", actorContext },
      { env: ENV, claimTraceabilityRepository: { getClaimTraceabilitySummary: throwingRead("traceability") } },
    ),
    "review-queue": await listOrganizationReviewQueue(
      { organizationId: ORG, actorContext },
      { env: ENV, claimTraceabilityRepository: { listOrganizationReviewQueue: throwingRead("review queue") } },
    ),
    sources: await listOrganizationSources({ organizationId: ORG, actorContext }, { env: ENV }),
    requirements: await listOrganizationRequirementsReadiness({ organizationId: ORG, actorContext }, { env: ENV }),
    "generated-content-drafts": await listGeneratedDraftLibraryIndex({ organizationId: ORG, limit: 25, actorContext }, { env: ENV }),
    "grant-response-packet": await getGrantResponsePacket({ organizationId: ORG, engagementId: ENGAGEMENT, actorContext }, { env: ENV }),
    "board-reporting": await getBoardReportingPacket({ organizationId: ORG, engagementId: ENGAGEMENT, actorContext }, { env: ENV }),
    "board-reporting/candidates (POST)": await createBoardReportingCandidate(
      { organizationId: ORG, engagementId: ENGAGEMENT, idempotencyKey: "journey-key-0001", actorContext, now },
      { env: ENV },
    ),
    "client-followups (client_reviewer only)": await listClientFollowupWorkflows(
      { organizationId: ORG, actorContext },
      { env: ENV, listClientFollowupWorkflowsForOrganization: throwingRead("follow-ups") },
    ),
    "client-followups complete (client_reviewer only)": await completeClientFollowup(
      { organizationId: ORG, claimId: CLAIM_ELIGIBLE, clientFollowupItemId: "f1", expectedUpdatedAt: now, actorContext, now },
      { env: ENV },
    ),
  };
  for (const [label, result] of Object.entries(denials)) {
    assertRoleDenied(result, label);
    assertNoHidden(result, `${label} error`);
  }
});

test("assembled journey, client_reviewer / client_contributor / GK reviewer / cross-org boundaries are preserved", async () => {
  const now = "2026-09-24T12:00:00.000Z";
  const reviewer = memberActor("client_reviewer");
  const followups = await listClientFollowupWorkflows(
    { organizationId: ORG, actorContext: reviewer },
    { env: ENV, listClientFollowupWorkflowsForOrganization: async () => [] },
  );
  assert.equal(followups.ok, true, "client_reviewer keeps explicit follow-up review");
  assert.equal(
    validateActorCanPerformOperation(reviewer, "complete_client_followup", ORG, { allowedRoles: new Set(["client_reviewer"]) }).ok,
    true,
  );
  assert.equal(validateActorCanPerformOperation(reviewer, "create_intake_batch", ORG).ok, false);

  const contributor = memberActor("client_contributor");
  assert.equal(validateActorCanPerformOperation(contributor, "read_intake", ORG).ok, true, "contributor keeps its read_intake reads");
  const contributorFollowups = await listClientFollowupWorkflows(
    { organizationId: ORG, actorContext: contributor },
    { env: ENV, listClientFollowupWorkflowsForOrganization: throwingRead("follow-ups") },
  );
  assertRoleDenied(contributorFollowups, "contributor follow-up review");

  const gkReviewer = memberActor("gk_reviewer");
  const gkLibrary = await listOrganizationEvidenceLibrary(
    { organizationId: ORG, limit: 25, afterEvidenceItemId: null, actorContext: gkReviewer },
    { env: ENV, listOrganizationEvidenceItems: async () => [] },
  );
  assert.equal(gkLibrary.ok, true, "GK evidence library unchanged for gk_reviewer");
  const gkQueue = await listOrganizationReviewQueue(
    { organizationId: ORG, actorContext: gkReviewer },
    { env: ENV, claimTraceabilityRepository: { listOrganizationReviewQueue: async () => ({ ok: true, data: { items: [], truncated: false, evaluationErrorCount: 0 } }) } },
  );
  assert.equal(gkQueue.ok, true);

  const crossOrg = memberActor("client_admin", { organizationId: OTHER_ORG });
  for (const result of [
    await listClientImpactFacts({ organizationId: ORG, actorContext: crossOrg }, factsDependencies()),
    await getOrganizationAccessCapabilities({ organizationId: ORG, actorContext: crossOrg }, { env: ENV }),
    await getImpactHomeSummary({ organizationId: ORG, actorContext: crossOrg }, { env: ENV }),
    await completeClientFollowup(
      { organizationId: ORG, claimId: CLAIM_ELIGIBLE, clientFollowupItemId: "f1", expectedUpdatedAt: now, actorContext: memberActor("client_reviewer", { organizationId: OTHER_ORG }), now },
      { env: ENV },
    ),
  ]) {
    assert.equal(result.ok, false);
    assert.equal(result.blockers[0].validator_key, "VAL-AUT-003");
  }
});

// ---------------------------------------------------------------------------
// Frontend: the client product never calls a known GK-only endpoint.
// ---------------------------------------------------------------------------

const appSource = readFileSync("frontend/ImpactLibraryApp.jsx", "utf8");
const clientStudioSource = readFileSync("frontend/knowledgeStudio/ClientKnowledgeStudio.jsx", "utf8");
const clientLibrarySource = readFileSync("frontend/impactLibrary/ClientImpactLibraryView.jsx", "utf8");
const evidenceLibrarySource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");
const intakeSource = readFileSync("frontend/KaiWebIntake.jsx", "utf8");

const GK_ONLY_PATH_BUILDERS = [
  "claimLibraryCandidatesPath",
  "evidenceLibraryCandidatesPath",
  "eligibleClaimsPath",
  "claimTraceabilityPath",
  "organizationReviewQueuePath",
  "organizationSourcesPath",
  "organizationRequirementsReadinessPath",
  "engagementFunderRequirementsPath",
  "generatedDraftLibraryIndexPath",
  "grantResponsePacketPath",
  "boardReportingPacketPath",
  "boardReportingCandidatesPath",
  "sensitivityReviewQueuePath",
  "clientFollowupsPath",
];

test("frontend: client Knowledge Studio and client Impact Library reference no GK-only read and issue no request of their own", () => {
  for (const source of [clientStudioSource, clientLibrarySource]) {
    for (const builder of GK_ONLY_PATH_BUILDERS) assert.doesNotMatch(source, new RegExp(`\\b${builder}\\b`), builder);
    assert.doesNotMatch(source, /getJson\(|postJson\(|fetch\(/);
  }
  assert.doesNotMatch(clientStudioSource, /import ImpactEvidenceLibrary|<ImpactEvidenceLibrary/);
  assert.match(clientStudioSource, /<KaiWebIntake[\s\S]*canContribute=\{canContribute\}/);
  assert.match(clientStudioSource, /const canContribute = capabilities\?\.intakeContribution === true;/);
  assert.match(clientStudioSource, /\{canReviewFollowups \? \(\s*<a className="btn btn-sm btn-outline-primary mt-2" href=\{CLIENT_FOLLOWUP_REVIEW_HREF\}>/);
});

test("frontend: the GK cockpit and GK Impact Library views mount only when the server reports internalKnowledgeWorkspace", () => {
  assert.match(appSource, /getJson\(organizationAccessCapabilitiesPath\(selectedOrganizationId\)\)/);
  assert.match(appSource, /const internalKnowledgeWorkspace = capabilitiesResolved && accessCapabilities\.data\?\.internalKnowledgeWorkspace === true;/);
  const unresolved = appSource.indexOf('(activeSection === "knowledgeStudio" || activeSection === "impactLibrary") && !capabilitiesResolved');
  const clientStudio = appSource.indexOf('activeSection === "knowledgeStudio" && !internalKnowledgeWorkspace');
  const clientLibrary = appSource.indexOf('activeSection === "impactLibrary" && !internalKnowledgeWorkspace');
  const gkStudio = appSource.indexOf("<ImpactEvidenceLibrary");
  const gkLibrary = appSource.indexOf("<ImpactLibraryListView");
  assert.ok(unresolved > 0 && unresolved < clientStudio && clientStudio < clientLibrary && clientLibrary < gkStudio && gkStudio < gkLibrary);
  // Client facts: one shared read per organization, never for a GK workspace actor.
  assert.match(appSource, /capabilitiesResolved && !internalKnowledgeWorkspace && \(activeSection === "impactLibrary" \|\| activeSection === "knowledgeStudio"\)/);
  assert.match(appSource, /if \(clientFactsRequestedForRef\.current === selectedOrganizationId\) return;/);
  assert.equal((appSource.match(/clientImpactFactsPath\(/g) || []).length, 1);
});

test("frontend: evidence-library/candidates has exactly one caller, inside the GK cockpit, keyed only to the organization", () => {
  const callers = [appSource, clientStudioSource, clientLibrarySource, intakeSource, readFileSync("frontend/ImpactHomeView.jsx", "utf8"), readFileSync("frontend/needsAttention/useNeedsAttention.js", "utf8")];
  for (const source of callers) assert.doesNotMatch(source, /evidenceLibraryCandidatesPath\(/);
  assert.equal((evidenceLibrarySource.match(/getJson\(evidenceLibraryCandidatesPath\(/g) || []).length, 1);
  assert.match(evidenceLibrarySource, /const loadEvidenceItems = useCallback\(async \(\) => \{[\s\S]*?\}, \[organizationId\]\);/);
  assert.match(evidenceLibrarySource, /if \(organizationId\) loadEvidenceItems\(\);\s*\}, \[organizationId, loadEvidenceItems\]\);/);
});

test("frontend: KaiWebIntake offers batch/upload writes only with contribution capability (default unchanged)", () => {
  assert.match(intakeSource, /canContribute = true,/);
  assert.match(intakeSource, /\{canContribute \? \(\s*<button type="button" className="btn btn-sm btn-primary" onClick=\{createBatch\}/);
  assert.match(intakeSource, /\{canContribute \? \(\s*<div className="admin-card mb-3">\s*<h5 className="mb-2">2\. Upload file<\/h5>/);
  assert.match(readFileSync("frontend/adminDashboard.jsx", "utf8"), /<KaiWebIntake \/>/);
});
