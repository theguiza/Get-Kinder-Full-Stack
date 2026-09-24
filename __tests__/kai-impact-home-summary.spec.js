import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

import { getImpactHomeSummary, __impactHomeSummaryServiceContract } from "../Backend/kai/services/kaiImpactHomeSummaryService.js";
import { createPostgresEligibleClaimsForAudienceRepository } from "../Backend/kai/dictionary/postgresEligibleClaimsForAudienceRepository.js";
import { resolveKaiActorContext } from "../Backend/kai/auth/kaiActorContext.js";
import { KAI_SPRINT2_P0_OPERATION_ROLES } from "../Backend/kai/config/kaiSprint2P0Contract.js";
import { __claimLibraryServiceContract } from "../Backend/kai/services/kaiClaimLibraryService.js";
import { __claimTraceabilityServiceContract } from "../Backend/kai/services/kaiClaimTraceabilityService.js";
import sprint2IntakeApiRouter, { __testables as routeTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";

/**
 * Client-safe Impact Home summary. The actor for client_admin comes from the
 * real resolveKaiActorContext + GK organization-binding derivation (no
 * kai.organization_memberships row); the Impact Fact count runs through the
 * real P2-08 eligible-claims repository with an injected evaluator, and the
 * client follow-up path runs through the real P2-11 read service with an
 * injected row source.
 */

const ENV = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });
const ORG = "11111111-2222-4333-8444-555555555555";
const OTHER_ORG = "99999999-8888-4777-8666-555555555555";
const GK_ORG = 77;

const CLAIM_ELIGIBLE = "c0000000-0000-4000-8000-000000000001";
const CLAIM_UNREVIEWED = "c0000000-0000-4000-8000-000000000002";
const CLAIM_IN_GK_REVIEW = "c0000000-0000-4000-8000-000000000003";
const SECRETS = Object.freeze([
  "ELIGIBLE CLAIM STATEMENT",
  "UNREVIEWED CLAIM STATEMENT",
  "INTERNAL ONLY EVIDENCE TEXT",
  "GK REVIEW CLAIM STATEMENT",
  "source-code-secret",
  CLAIM_ELIGIBLE,
  CLAIM_UNREVIEWED,
  CLAIM_IN_GK_REVIEW,
  "rq-gk-claim-review",
  "followup-claim-id",
  "rq-followup-row",
]);

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
    result.actorContext.organizationMemberships.map(({ organization_id, role_name, membership_status, source }) => ({
      organization_id, role_name, membership_status, source,
    })),
    [{ organization_id: ORG, role_name: "client_admin", membership_status: "active", source: "gk_organization_binding" }],
  );
  return result.actorContext;
}

function memberActor(roleName, organizationId = ORG) {
  return {
    actorType: "human",
    actorUserId: `user-${roleName}`,
    kaiRoles: [],
    platformSuperuser: false,
    organizationMemberships: [{ organization_id: organizationId, role_name: roleName, membership_status: "active" }],
  };
}

// Governed P2-06 evaluation per claim, carrying the kinds of content a
// client must never receive through Home (statements, internal-only
// evidence, lineage, GK review-queue state).
const EVALUATIONS = Object.freeze({
  [CLAIM_ELIGIBLE]: {
    eligible: true,
    claim: { claim_id: CLAIM_ELIGIBLE, claim_type: "outcome", claim_status: "approved", claim_review_status: "reviewed", statement: "ELIGIBLE CLAIM STATEMENT" },
    evidence: { evidence_item_id: "e0000000-0000-4000-8000-000000000001", support_strength: "strong", statement: "INTERNAL ONLY EVIDENCE TEXT", internal_only: true },
    source: { source_id: "s0000000-0000-4000-8000-000000000001", source_code: "source-code-secret" },
    source_version: { source_version_id: "v0000000-0000-4000-8000-000000000001" },
  },
  [CLAIM_UNREVIEWED]: {
    eligible: false,
    blockerCodes: ["claim_review_unresolved"],
    claim: { claim_id: CLAIM_UNREVIEWED, statement: "UNREVIEWED CLAIM STATEMENT" },
  },
  [CLAIM_IN_GK_REVIEW]: {
    eligible: false,
    blockerCodes: ["evidence_review_unresolved"],
    claim: { claim_id: CLAIM_IN_GK_REVIEW, statement: "GK REVIEW CLAIM STATEMENT" },
    claim_review: { review_queue_item_id: "rq-gk-claim-review", queue_status: "open" },
  },
});

function realEligibleClaimsRepository({ claimIds = Object.keys(EVALUATIONS), calls = [] } = {}) {
  const tx = {
    async query(sql, params = []) {
      if (sql.startsWith("SET TRANSACTION")) return { rows: [] };
      assert.match(sql, /FROM kai\.claims/);
      const [organizationId, limit, afterClaimId] = params;
      assert.equal(organizationId, ORG);
      const rows = claimIds
        .filter((id) => afterClaimId === undefined || id > afterClaimId)
        .sort()
        .slice(0, limit)
        .map((claim_id) => ({ claim_id }));
      return { rows };
    },
  };
  return createPostgresEligibleClaimsForAudienceRepository({
    runInTransaction: async (callback) => callback(tx),
    evaluator: async (_tx, input) => {
      calls.push(input);
      const data = EVALUATIONS[input.claimId];
      return data ? { ok: true, data: { ...data, requestedAudience: input.requestedAudience } } : { ok: false, error: { code: "not_found" } };
    },
  });
}

const FOLLOWUP_ROWS = Object.freeze([
  {
    claim_id: "followup-claim-id",
    client_followup_item_id: "f0000000-0000-4000-8000-000000000001",
    dimension_key: "participants",
    question_text: "How many participants attended?",
    review_queue_item_id: "rq-followup-row",
    queue_status: "waiting_on_client",
    review_status: "proposed",
    updated_at: new Date("2026-09-01T00:00:00Z"),
  },
  {
    claim_id: "followup-claim-id",
    client_followup_item_id: "f0000000-0000-4000-8000-000000000002",
    dimension_key: "outcomes",
    question_text: "Already answered question",
    review_queue_item_id: "rq-followup-row",
    queue_status: "resolved",
    review_status: "completed",
    updated_at: new Date("2026-09-01T00:00:00Z"),
  },
]);

function dependencies(overrides = {}) {
  const followupCalls = [];
  return {
    followupCalls,
    deps: {
      env: ENV,
      eligibleClaimsForAudienceRepository: realEligibleClaimsRepository(overrides),
      listClientFollowupWorkflowsForOrganization: async (input) => {
        followupCalls.push(input);
        return FOLLOWUP_ROWS;
      },
      ...overrides.deps,
    },
  };
}

const SUMMARY_KEYS = [
  "clientActionCount",
  "clientActions",
  "internalReviewAvailable",
  "isFirstTime",
  "reviewedImpactFactCount",
  "reviewedImpactFactCountIsLowerBound",
];

function assertNoLeak(data) {
  assert.deepEqual(Object.keys(data).sort(), SUMMARY_KEYS);
  const serialized = JSON.stringify(data);
  for (const secret of SECRETS) assert.ok(!serialized.includes(secret), `summary leaked ${secret}`);
}

test("contract: admission reuses the read_intake role set; claim-library and Review Queue role lists are unchanged", () => {
  assert.deepEqual(
    [...__impactHomeSummaryServiceContract.IMPACT_HOME_SUMMARY_ALLOWED_ROLES].sort(),
    [...KAI_SPRINT2_P0_OPERATION_ROLES.read_intake].sort(),
  );
  assert.equal(__impactHomeSummaryServiceContract.IMPACT_FACT_AUDIENCE, "internal");
  assert.deepEqual([...__claimLibraryServiceContract.CLAIM_LIBRARY_READ_ROLES].sort(), ["gk_admin", "gk_operator", "gk_reviewer"]);
  assert.deepEqual([...__claimTraceabilityServiceContract.REVIEW_QUEUE_ALLOWED_ROLES].sort(), ["gk_admin", "gk_operator", "gk_reviewer"]);
});

test("same-org client_admin (binding-derived): 200 with the eligible Impact Fact aggregate only, no GK review content, no client-review tasks", async () => {
  const actorContext = await clientAdminActor();
  const calls = [];
  const { deps, followupCalls } = dependencies({ calls });
  const result = await getImpactHomeSummary({ organizationId: ORG, actorContext }, deps);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.data, {
    reviewedImpactFactCount: 1,
    reviewedImpactFactCountIsLowerBound: false,
    clientActionCount: 0,
    clientActions: [],
    internalReviewAvailable: false,
    isFirstTime: false,
  });
  assertNoLeak(result.data);
  assert.ok(calls.length === 3 && calls.every((call) => call.requestedAudience === "internal"), "governed evaluator, internal audience");
  assert.equal(followupCalls.length, 0, "client_admin is not a client reviewer: follow-ups are never read");
});

test("same-org client_reviewer: completable client follow-ups appear through the client-safe P2-11 DTO only", async () => {
  const { deps, followupCalls } = dependencies();
  const result = await getImpactHomeSummary({ organizationId: ORG, actorContext: memberActor("client_reviewer") }, deps);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.internalReviewAvailable, false);
  assert.equal(result.data.clientActionCount, 1);
  assert.deepEqual(result.data.clientActions, [
    { clientFollowupItemId: "f0000000-0000-4000-8000-000000000001", questionText: "How many participants attended?" },
  ]);
  assert.deepEqual(followupCalls, [{ organizationId: ORG }]);
  assertNoLeak(result.data);
});

test("same-org client_contributor: only the client-safe aggregate (read_intake policy), no tasks", async () => {
  const { deps, followupCalls } = dependencies();
  const result = await getImpactHomeSummary({ organizationId: ORG, actorContext: memberActor("client_contributor") }, deps);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.reviewedImpactFactCount, 1);
  assert.equal(result.data.clientActionCount, 0);
  assert.equal(result.data.internalReviewAvailable, false);
  assert.equal(followupCalls.length, 0);
  assertNoLeak(result.data);
});

test("cross-org client (client_admin of another org): denied before any governed read", async () => {
  const actorContext = await clientAdminActor();
  const calls = [];
  const { deps, followupCalls } = dependencies({ calls });
  const result = await getImpactHomeSummary({ organizationId: OTHER_ORG, actorContext }, deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(result.blockers[0].validator_key, "VAL-AUT-003");
  assert.equal(calls.length, 0);
  assert.equal(followupCalls.length, 0);
});

test("unmapped/non-human actor and malformed organization id are rejected", async () => {
  const { deps } = dependencies();
  assert.equal((await getImpactHomeSummary({ organizationId: ORG, actorContext: { actorType: "service" } }, deps)).error.code, "authorization_denied");
  assert.equal((await getImpactHomeSummary({ organizationId: "ABCDEF00-2222-4333-8444-555555555555", actorContext: memberActor("client_admin") }, deps)).error.code, "validation_blocker");
  assert.equal((await getImpactHomeSummary({ organizationId: ORG, actorContext: memberActor("client_admin"), extra: 1 }, deps)).error.code, "validation_blocker");
  assert.equal((await getImpactHomeSummary({ organizationId: ORG, actorContext: memberActor("client_admin") }, { ...deps, env: {} })).error.code, "feature_disabled");
});

test("GK reviewer: internalReviewAvailable reflects the unchanged Review Queue policy", async () => {
  const { deps } = dependencies();
  const result = await getImpactHomeSummary({ organizationId: ORG, actorContext: memberActor("gk_reviewer") }, deps);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.internalReviewAvailable, true);
  assert.equal(result.data.clientActionCount, 0);
});

test("first-time is client-visible only: hidden unreviewed claims and GK review work never make a client Home non-empty", async () => {
  const { deps } = dependencies({ claimIds: [CLAIM_UNREVIEWED, CLAIM_IN_GK_REVIEW] });
  const actorContext = await clientAdminActor();
  const result = await getImpactHomeSummary({ organizationId: ORG, actorContext }, deps);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.reviewedImpactFactCount, 0);
  assert.equal(result.data.isFirstTime, true);
  assertNoLeak(result.data);
});

test("governed evaluator failure fails closed (no guessed count)", async () => {
  const { deps } = dependencies({
    deps: { eligibleClaimsForAudienceRepository: { listEligibleClaimsForAudience: async () => ({ ok: false, error: { code: "conflict_current_state_changed" } }) } },
  });
  const result = await getImpactHomeSummary({ organizationId: ORG, actorContext: memberActor("client_admin") }, deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
});

test("route: mounted summary route forwards only the organization id and the resolved actor", async () => {
  const actorContext = await clientAdminActor();
  const received = [];
  const restoreService = routeTestables.setIntakeServiceForTest({
    getImpactHomeSummary: async (input) => {
      received.push(input);
      return { ok: true, data: { reviewedImpactFactCount: 1 } };
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
    const ok = await fetch(`${base}/${ORG}/impact-home/summary?organization_id=${OTHER_ORG}&user_id=9`);
    assert.equal(ok.status, 200);
    assert.deepEqual(received, [{ organizationId: ORG, actorContext }]);
    const bad = await fetch(`${base}/not-a-uuid/impact-home/summary`);
    assert.equal(bad.status, 422);
    assert.equal(received.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restoreActor();
    restoreService();
    process.env.KAI_SPRINT2_ENABLED = originalFlag;
  }
});

test("unchanged GK surfaces: claim-library and Review Queue still deny client_admin and still serve a GK reviewer", async () => {
  const { listClaimLibraryCandidates } = await import("../Backend/kai/services/kaiClaimLibraryService.js");
  const { listOrganizationReviewQueue } = await import("../Backend/kai/services/kaiClaimTraceabilityService.js");
  const clientAdmin = await clientAdminActor();
  const gkReviewer = memberActor("gk_reviewer");
  const claimDeps = { env: ENV, listClaimLibraryReviewCandidates: async () => [] };
  const queueDeps = {
    env: ENV,
    claimTraceabilityRepository: { listOrganizationReviewQueue: async () => ({ ok: true, data: { items: [], truncated: false, evaluationErrorCount: 0 } }) },
  };

  const deniedClaims = await listClaimLibraryCandidates({ organizationId: ORG, actorContext: clientAdmin, limit: 25 }, claimDeps);
  assert.equal(deniedClaims.blockers[0].blocking_reason, "role_not_allowed");
  const deniedQueue = await listOrganizationReviewQueue({ organizationId: ORG, actorContext: clientAdmin }, queueDeps);
  assert.equal(deniedQueue.blockers[0].blocking_reason, "role_not_allowed");

  assert.equal((await listClaimLibraryCandidates({ organizationId: ORG, actorContext: gkReviewer, limit: 25 }, claimDeps)).ok, true);
  assert.equal((await listOrganizationReviewQueue({ organizationId: ORG, actorContext: gkReviewer }, queueDeps)).ok, true);
});
