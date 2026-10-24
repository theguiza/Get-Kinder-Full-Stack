import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import sprint2IntakeApiRouter, { __testables as intakeRouteTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";
import { requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";
import { requireKaiSprint2Authenticated } from "../Backend/kai/middleware/kaiSprint2Authentication.js";
import {
  handleKaiSprint2JsonParserError,
  kaiSprint2ActorMutationLimiter,
  kaiSprint2MetadataJsonParser,
  kaiSprint2OrganizationMutationLimiter,
  setKaiSprint2NoStore,
} from "../Backend/kai/middleware/kaiSprint2RequestSafety.js";
import { resolveKaiActorContext } from "../Backend/kai/auth/kaiActorContext.js";
import { STORED_ORGANIZATION_MEMBERSHIP_SOURCE } from "../Backend/kai/auth/kaiOrganizationMembershipSource.js";
import {
  authorizeClaimTraceabilityRead,
  getClaimTraceabilitySummary,
  listOrganizationReviewQueue,
  __claimTraceabilityServiceContract,
} from "../Backend/kai/services/kaiClaimTraceabilityService.js";
import { createEvidenceSummaryDraft, createImpactNarrativeDraft } from "../Backend/kai/services/kaiGeneratedContentService.js";
import { getOrganizationAccessCapabilities } from "../Backend/kai/services/kaiOrganizationAccessCapabilitiesService.js";
import { projectOrganizationAccessCapabilities } from "../frontend/impactEvidenceLibraryLogic.js";
import {
  clientEvidenceWorkflowAccess,
  internalDraftFailureMessage,
  internalDraftTraceabilityDiagnosis,
  isInternalDraftTraceabilityRefusal,
} from "../frontend/knowledgeStudio/clientEvidenceWorkflowLogic.js";

/**
 * Owner authorization 2026-10-24: an active organization administrator
 * (client_admin, stored or binding-derived) may read a client-safe INTERNAL
 * traceability diagnostic for a claim of that exact organization, through
 * the existing P2-06 route. GK roles keep the full DTO unchanged; every other
 * actor, audience, and GK operation keeps its refusal.
 *
 * Synthetic fixtures only. Real: actor resolution, authorization, the P2-06
 * service, the mounted route and its error sanitizer. Injected: the
 * traceability repository (recording every call) and the session.
 */

const ENV = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });
const ORG_X = "11111111-2222-4333-8444-555555555555";
const ORG_Y = "99999999-8888-4777-8666-555555555555";
const ENGAGEMENT_X = "22222222-3333-4444-8555-666666666666";
const CLAIM = "3d000000-0000-4000-8000-000000000001";
const SECOND_CLAIM = "3d000000-0000-4000-8000-000000000002";
const EVIDENCE = "3c000000-0000-4000-8000-000000000001";
const SOURCE = "3a000000-0000-4000-8000-000000000001";
const SOURCE_VERSION = "3b000000-0000-4000-8000-000000000001";
const QUEUE = "3e000000-0000-4000-8000-000000000001";
const DECISION = "3f000000-0000-4000-8000-000000000001";
const OTHER_CLAIM = "3d000000-0000-4000-8000-000000000009";
const GK_ORG_X = 401;
const KAI_USER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const NOW = "2026-10-24T12:00:00.000Z";
const RAW_EVIDENCE_TEXT = "Raw evidence statement: field households_served of type number.";
const RAW_CLAIM_TEXT = "Households served is recorded for the programme.";

async function bindingDerivedClientAdmin({ bindingStatus = "active", isActive = true } = {}) {
  const result = await resolveKaiActorContext(
    { user: { id: 7301, email: "org-admin@synthetic.test" } },
    {
      findOrCreateKaiUserByLegacyPublicUserdataId: async ({ legacyPublicUserdataId, email }) => ({
        user_id: KAI_USER, legacy_identity_source: "public.userdata", legacy_public_userdata_id: legacyPublicUserdataId, status: "active", email,
      }),
      listKaiRolesForUser: async () => [],
      listOrganizationMembershipsForUser: async () => [],
      resolveOrgScopeForUserId: async () => ({ memberships: [{ orgId: GK_ORG_X, role: "admin", is_active: isActive }] }),
      listActiveGkOrganizationBindingsForGkOrganizationIds: async (ids) => (ids.includes(GK_ORG_X)
        ? [{ gk_organization_id: GK_ORG_X, kai_organization_id: ORG_X, status: bindingStatus }]
        : []),
    },
  );
  assert.equal(result.ok, true);
  return result.actorContext;
}

function memberActor(roleName, { organizationId = ORG_X, membershipStatus = "active", source, kaiRoles = [], extra = {} } = {}) {
  return {
    actorType: "human",
    actorUserId: KAI_USER,
    kaiRoles,
    platformSuperuser: false,
    organizationMemberships: [{
      organization_id: organizationId, role_name: roleName, membership_status: membershipStatus, ...(source ? { source } : {}),
    }],
    ...extra,
  };
}

const storedClientAdmin = (overrides = {}) => memberActor("client_admin", { source: STORED_ORGANIZATION_MEMBERSHIP_SOURCE, ...overrides });

// A synthetic full GK traceability DTO carrying every GK-only field family.
function gkTraceabilityDto({ eligible = false, blockerCodes = ["claim_review_unresolved", "client_followup_unresolved"] } = {}) {
  return {
    claim: { claim_id: CLAIM, claim_type: "finding", claim_status: "proposed", claim_review_status: "needs_gk_review", claim_strength: "unassessed", statement: RAW_CLAIM_TEXT, audience_gates: { internal_only: true } },
    evidence: { evidence_item_id: EVIDENCE, review_queue_item_id: QUEUE, statement: RAW_EVIDENCE_TEXT, sensitivity_level: "low" },
    locator: { source_locator_id: "30000000-0000-4000-8000-000000000001" },
    source: { source_id: SOURCE, source_code: "synthetic-source-code" },
    source_version: { source_version_id: SOURCE_VERSION, is_current: true },
    claim_review: { review_queue_item_id: QUEUE, queue_status: "open", review_status: "needs_gk_review" },
    evidence_review_decision: { decision_id: DECISION, decision_outcome: "needs_more_information" },
    claim_review_decision: null,
    candidate: { intake_source_candidate_id: "60000000-0000-4000-8000-000000000001", intake_sensitivity_profile_id: "80000000-0000-4000-8000-000000000001" },
    promotion_decision: { intake_promotion_decision_id: "70000000-0000-4000-8000-000000000001" },
    dimensions: { definition_clarity: { assessment_status: "unresolved", validator_key: "VAL-COV-003", internal_limitation_accepted: false } },
    gap_items: [{ gap_log_item_id: "41000000-0000-4000-8000-000000000001", dimension_key: "definition_clarity" }],
    client_followup_workflows: [{ client_followup_item_id: "42000000-0000-4000-8000-000000000001" }],
    potential_conflict_groups: [{ conflict_group_id: "43000000-0000-4000-8000-000000000001", lower_claim_id: CLAIM, higher_claim_id: OTHER_CLAIM, basis_code: "same_field" }],
    graph_relationships: [{ relationship_type: "claim_supported_by_evidence", from_object_id: CLAIM, to_object_id: EVIDENCE }],
    graph_trace_completeness: { complete: true },
    requestedAudience: "internal",
    eligible,
    blockerCodes,
    affectedDimensionKeys: ["definition_clarity"],
    affectedObjectIds: [QUEUE],
    truncated: false,
  };
}

const GK_ONLY_FRAGMENTS = [
  RAW_EVIDENCE_TEXT, RAW_CLAIM_TEXT, EVIDENCE, SOURCE, SOURCE_VERSION, QUEUE, DECISION, OTHER_CLAIM, "synthetic-source-code",
  "graph_relationships", "potential_conflict_groups", "gap_items", "client_followup_workflows", "dimensions", "candidate",
  "promotion_decision", "evidence_review_decision", "claim_review_decision", "affectedObjectIds", "sensitivity_level", "statement",
];

function recordingRepository(result) {
  const calls = [];
  return {
    calls,
    async getClaimTraceabilitySummary(input) {
      calls.push(input);
      return typeof result === "function" ? result(input) : result;
    },
    async listOrganizationReviewQueue() { throw new Error("review queue must not be reached"); },
  };
}

const conflict = (reason) => ({ ok: false, data: null, error: { code: "conflict_current_state_changed", status: 409, reason } });

function assertDenied(result, reason, label) {
  assert.equal(result.ok, false, label);
  assert.equal(result.error.code, "authorization_denied", `${label}: ${JSON.stringify(result.error)}`);
  assert.equal(result.blockers?.[0]?.blocking_reason, reason, `${label}: ${JSON.stringify(result.blockers)}`);
}

const traceInput = (actorContext, overrides = {}) => ({ organizationId: ORG_X, claimId: CLAIM, requestedAudience: "internal", actorContext, ...overrides });

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

test("an active client_admin (binding-derived or stored) reads the client-safe internal diagnostic of its own organization's claim", async () => {
  for (const [label, actor] of [["binding-derived", await bindingDerivedClientAdmin()], ["stored", storedClientAdmin()]]) {
    const repository = recordingRepository({ ok: true, data: gkTraceabilityDto(), error: null });
    const result = await getClaimTraceabilitySummary(traceInput(actor), { env: ENV, claimTraceabilityRepository: repository });
    assert.equal(result.ok, true, `${label}: ${JSON.stringify(result)}`);
    assert.deepEqual(repository.calls, [{ organizationId: ORG_X, claimId: CLAIM, requestedAudience: "internal" }], label);
    assert.deepEqual(result.data, {
      view: "organization_internal_traceability_diagnostic",
      claim_id: CLAIM,
      requested_audience: "internal",
      traceability_passed: true,
      eligible: false,
      blocked: true,
      blocker_codes: ["claim_review_unresolved", "client_followup_unresolved"],
      traceability_conflict_reason: null,
    }, label);
  }
});

test("GK roles keep the full traceability DTO, unchanged, for every audience", async () => {
  const actors = [
    ["gk_admin", memberActor("gk_admin")],
    ["gk_operator", memberActor("gk_operator")],
    ["gk_reviewer", memberActor("gk_reviewer")],
    ["global gk_reviewer + client_admin membership", memberActor("client_admin", { source: STORED_ORGANIZATION_MEMBERSHIP_SOURCE, kaiRoles: ["gk_reviewer"] })],
    ["platform superuser", memberActor("client_contributor", { extra: { platformSuperuser: true } })],
  ];
  for (const [label, actor] of actors) {
    for (const audience of ["internal", "funder", "public"]) {
      const dto = { ...gkTraceabilityDto(), requestedAudience: audience };
      const repository = recordingRepository({ ok: true, data: dto, error: null });
      const result = await getClaimTraceabilitySummary(traceInput(actor, { requestedAudience: audience }), { env: ENV, claimTraceabilityRepository: repository });
      assert.deepEqual(result, { ok: true, data: dto, error: null }, `${label} ${audience}`);
    }
  }
  assert.deepEqual([...__claimTraceabilityServiceContract.CLAIM_TRACEABILITY_ALLOWED_ROLES], ["gk_admin", "gk_operator", "gk_reviewer"]);
  assert.equal(__claimTraceabilityServiceContract.REVIEW_QUEUE_ALLOWED_ROLES, __claimTraceabilityServiceContract.CLAIM_TRACEABILITY_ALLOWED_ROLES);
  assert.equal(__claimTraceabilityServiceContract.CLAIM_TRACEABILITY_ALLOWED_ROLES.has("client_admin"), false);
});

test("refusals reach no repository: inactive, cross-organization, unverified, other client roles, funder/public, non-human, feature gate", async () => {
  const cases = [
    ["inactive stored client_admin", traceInput(storedClientAdmin({ membershipStatus: "inactive" })), "missing_active_organization_membership"],
    ["revoked GK binding (no derived membership)", traceInput(await bindingDerivedClientAdmin({ bindingStatus: "revoked" })), "missing_active_organization_membership"],
    ["inactive GK organization admin", traceInput(await bindingDerivedClientAdmin({ isActive: false })), "missing_active_organization_membership"],
    ["client_admin of X reading organization Y", traceInput(storedClientAdmin(), { organizationId: ORG_Y }), "missing_active_organization_membership"],
    ["binding-derived X admin reading organization Y", traceInput(await bindingDerivedClientAdmin(), { organizationId: ORG_Y }), "missing_active_organization_membership"],
    ["client_admin membership without verified provenance", traceInput(memberActor("client_admin")), "role_not_allowed"],
    ["global client_admin role only", traceInput(memberActor("client_contributor", { kaiRoles: ["client_admin"] })), "role_not_allowed"],
    ["client_contributor", traceInput(memberActor("client_contributor")), "role_not_allowed"],
    ["client_reviewer", traceInput(memberActor("client_reviewer")), "role_not_allowed"],
    ["client_admin funder", traceInput(storedClientAdmin(), { requestedAudience: "funder" }), "role_not_allowed"],
    ["client_admin public", traceInput(storedClientAdmin(), { requestedAudience: "public" }), "role_not_allowed"],
    ["binding-derived funder", traceInput(await bindingDerivedClientAdmin(), { requestedAudience: "funder" }), "role_not_allowed"],
  ];
  for (const [label, input, reason] of cases) {
    const repository = recordingRepository(() => assert.fail(`${label}: repository reached`));
    assertDenied(await getClaimTraceabilitySummary(input, { env: ENV, claimTraceabilityRepository: repository }), reason, label);
    assert.equal(repository.calls.length, 0, label);
  }
  const repository = recordingRepository(() => assert.fail("repository reached"));
  const nonHuman = { ...storedClientAdmin(), actorType: "assistant" };
  assert.equal((await getClaimTraceabilitySummary(traceInput(nonHuman), { env: ENV, claimTraceabilityRepository: repository })).error.code, "authorization_denied");
  assert.equal(authorizeClaimTraceabilityRead(nonHuman, ORG_X, "internal").ok, false);
  assert.equal((await getClaimTraceabilitySummary(traceInput(storedClientAdmin()), { env: {}, claimTraceabilityRepository: repository })).error.code, "feature_disabled");
  assert.equal((await getClaimTraceabilitySummary(traceInput(storedClientAdmin()), { env: { KAI_SPRINT2_ENABLED: "false" }, claimTraceabilityRepository: repository })).error.code, "feature_disabled");
  assert.equal(repository.calls.length, 0);
});

// ---------------------------------------------------------------------------
// Response security
// ---------------------------------------------------------------------------

test("the client diagnostic never carries raw evidence, lineage, review identifiers, or GK-only fields", async () => {
  for (const dto of [gkTraceabilityDto(), gkTraceabilityDto({ eligible: true, blockerCodes: [] })]) {
    const repository = recordingRepository({ ok: true, data: dto, error: null });
    const result = await getClaimTraceabilitySummary(traceInput(storedClientAdmin()), { env: ENV, claimTraceabilityRepository: repository });
    const serialized = JSON.stringify(result);
    for (const fragment of GK_ONLY_FRAGMENTS) assert.equal(serialized.includes(fragment), false, fragment);
    assert.deepEqual(Object.keys(result.data).sort(), [
      "blocked", "blocker_codes", "claim_id", "eligible", "requested_audience", "traceability_conflict_reason", "traceability_passed", "view",
    ]);
  }
  const passing = await getClaimTraceabilitySummary(traceInput(storedClientAdmin()), {
    env: ENV, claimTraceabilityRepository: recordingRepository({ ok: true, data: gkTraceabilityDto({ eligible: true, blockerCodes: [] }), error: null }),
  });
  assert.deepEqual([passing.data.eligible, passing.data.blocked, passing.data.blocker_codes], [true, false, []]);
});

test("conflicts keep only the allowlisted reason, and 404/422/500 keep the GK error shape with no data", async () => {
  for (const reason of __claimTraceabilityServiceContract.TRACEABILITY_CONFLICT_REASONS) {
    const result = await getClaimTraceabilitySummary(traceInput(storedClientAdmin()), { env: ENV, claimTraceabilityRepository: recordingRepository(conflict(reason)) });
    assert.deepEqual([result.ok, result.error.code, result.data], [false, "conflict_current_state_changed", { traceability_conflict_reason: reason }], reason);
  }
  const unsafe = await getClaimTraceabilitySummary(traceInput(storedClientAdmin()), { env: ENV, claimTraceabilityRepository: recordingRepository(conflict("unlisted_detail")) });
  assert.equal("data" in unsafe, false);
  for (const [code, status] of [["not_found", 404], ["validation_blocker", 422], ["system_error", 500]]) {
    const result = await getClaimTraceabilitySummary(traceInput(storedClientAdmin()), {
      env: ENV, claimTraceabilityRepository: recordingRepository({ ok: false, data: null, error: { code, status, reason: "source_version_not_current" } }),
    });
    assert.deepEqual([result.ok, result.error.code, "data" in result], [false, code, false], code);
  }
});

// ---------------------------------------------------------------------------
// Governance isolation
// ---------------------------------------------------------------------------

test("the diagnostic grants no GK review queue or generation authority (the organization's own factual review is separate: kai-organization-factual-review-authority.spec.js)", async () => {
  const tripwire = new Proxy({}, { get: (_target, property) => (property === "then" ? undefined : async () => assert.fail(`repository ${String(property)} reached`)) });
  const noAudit = () => ({ prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } });
  for (const actor of [await bindingDerivedClientAdmin(), storedClientAdmin()]) {
    const results = {
      reviewQueue: await listOrganizationReviewQueue({ organizationId: ORG_X, actorContext: actor }, { env: ENV, claimTraceabilityRepository: tripwire }),
    };
    for (const [label, result] of Object.entries(results)) assertDenied(result, "role_not_allowed", label);
  }
  // Generation eligibility is the generation repository's own: the service
  // forwards a VAL-GEN-TRACE-P0-001 refusal unchanged for both internal types.
  const actor = storedClientAdmin();
  const refusal = { ok: false, error: { code: "validation_blocker", status: 422 }, blockers: [{ validator_key: "VAL-GEN-TRACE-P0-001", severity: "blocker", blocking_reason: "traceability_result_contract_invalid" }] };
  const generationRepository = { async createEvidenceSummaryDraft() { return refusal; }, async createImpactNarrativeDraft() { return refusal; } };
  const base = { organizationId: ORG_X, engagementId: ENGAGEMENT_X, requestedAudience: "internal", claimIds: [CLAIM], idempotencyKey: "diag-isolation-1", actorContext: actor, now: NOW };
  const deps = { env: ENV, getEngagementForOrganization: async () => ({ engagement_id: ENGAGEMENT_X, organization_id: ORG_X }), generatedContentRepository: generationRepository };
  for (const generate of [createEvidenceSummaryDraft, createImpactNarrativeDraft]) {
    const result = await generate(base, deps);
    assert.deepEqual([result.ok, result.error.code, result.blockers[0].validator_key], [false, "validation_blocker", "VAL-GEN-TRACE-P0-001"], generate.name);
  }
});

test("capabilities project the diagnostic for client_admin and GK roles only", async () => {
  const flag = async (actorContext) => {
    const capabilities = await getOrganizationAccessCapabilities({ organizationId: ORG_X, actorContext }, { env: ENV });
    return capabilities.data.workflowOperations.readClaimTraceabilityDiagnostics;
  };
  assert.equal(await flag(await bindingDerivedClientAdmin()), true);
  assert.equal(await flag(storedClientAdmin()), true);
  assert.equal(await flag(memberActor("gk_reviewer")), true);
  for (const role of ["client_contributor", "client_reviewer"]) assert.equal(await flag(memberActor(role)), false, role);
  assert.equal(await flag(memberActor("client_admin")), false, "unverified provenance");
  const projected = projectOrganizationAccessCapabilities((await getOrganizationAccessCapabilities({ organizationId: ORG_X, actorContext: storedClientAdmin() }, { env: ENV })).data);
  assert.equal(clientEvidenceWorkflowAccess(projected).readClaimTraceabilityDiagnostics, true);
  assert.equal(projectOrganizationAccessCapabilities({ ...projected, workflowOperations: {} })?.workflowOperations.readClaimTraceabilityDiagnostics ?? false, false);
});

// ---------------------------------------------------------------------------
// HTTP: the mounted P2-06 route with the real service
// ---------------------------------------------------------------------------

const basePath = "/api/kai/sprint2/intake";
const tracePath = (organizationId = ORG_X, claimId = CLAIM, query = "?requested_audience=internal") =>
  `${basePath}/admin/organizations/${organizationId}/claims/${claimId}/traceability${query}`;

async function withRouteServer(t, getScenario) {
  const originalFeatureFlag = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async getClaimTraceabilitySummary(input) {
      const scenario = getScenario();
      scenario.serviceCalls += 1;
      return getClaimTraceabilitySummary(input, { env: process.env, claimTraceabilityRepository: scenario.repository });
    },
  });
  const app = express();
  app.use(basePath, setKaiSprint2NoStore, requireKaiSprint2Enabled, kaiSprint2MetadataJsonParser);
  app.use(basePath, handleKaiSprint2JsonParserError);
  app.use(basePath, (req, res, next) => {
    req.isAuthenticated = () => true;
    req.user = { id: 7301 };
    req.kaiSprint2ActorContext = getScenario().actorContext;
    return next();
  });
  app.use(basePath, requireKaiSprint2Enabled, kaiSprint2OrganizationMutationLimiter, kaiSprint2ActorMutationLimiter, requireKaiSprint2Authenticated, sprint2IntakeApiRouter);
  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, "127.0.0.1");
    listening.once("listening", () => resolve(listening));
    listening.once("error", reject);
  });
  t.after(async () => {
    restore();
    if (originalFeatureFlag === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = originalFeatureFlag;
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
  return (path) => new Promise((resolve, reject) => {
    const request = http.request({ hostname: "127.0.0.1", port: server.address().port, path, method: "GET" }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ statusCode: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
    });
    request.on("error", reject);
    request.end();
  });
}

test("HTTP: positive and negative client_admin traceability reads through the mounted route", async (t) => {
  let scenario;
  const get = await withRouteServer(t, () => scenario);
  const set = (actorContext, repositoryResult) => {
    scenario = { actorContext, repository: recordingRepository(repositoryResult), serviceCalls: 0 };
  };
  const binding = await bindingDerivedClientAdmin();

  set(binding, { ok: true, data: gkTraceabilityDto(), error: null });
  const ok = await get(tracePath());
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data.view, "organization_internal_traceability_diagnostic");
  assert.deepEqual(ok.body.data.blocker_codes, ["claim_review_unresolved", "client_followup_unresolved"]);
  for (const fragment of GK_ONLY_FRAGMENTS) assert.equal(JSON.stringify(ok.body).includes(fragment), false, fragment);

  set(memberActor("gk_reviewer"), { ok: true, data: gkTraceabilityDto(), error: null });
  const gk = await get(tracePath());
  assert.equal(gk.statusCode, 200);
  assert.deepEqual(gk.body.data, gkTraceabilityDto(), "the GK response is unchanged");

  for (const [reason, status] of [["gap_dimension_requires_missing_p204_state", 409], ["source_version_not_current", 409]]) {
    set(binding, conflict(reason));
    const response = await get(tracePath());
    assert.deepEqual([response.statusCode, response.body.error.code, response.body.data], [status, "conflict_current_state_changed", { traceability_conflict_reason: reason }], reason);
  }

  set(binding, { ok: false, data: null, error: { code: "not_found", status: 404 } });
  const missing = await get(tracePath());
  assert.deepEqual([missing.statusCode, missing.body.error.code, missing.body.data], [404, "not_found", null]);

  for (const [label, actorContext, path, reason] of [
    ["funder audience", binding, tracePath(ORG_X, CLAIM, "?requested_audience=funder"), "role_not_allowed"],
    ["public audience", binding, tracePath(ORG_X, CLAIM, "?requested_audience=public"), "role_not_allowed"],
    ["other organization", binding, tracePath(ORG_Y), "missing_active_organization_membership"],
    ["client_reviewer", memberActor("client_reviewer"), tracePath(), "role_not_allowed"],
    ["client_contributor", memberActor("client_contributor"), tracePath(), "role_not_allowed"],
    ["inactive client_admin", storedClientAdmin({ membershipStatus: "inactive" }), tracePath(), "missing_active_organization_membership"],
  ]) {
    set(actorContext, () => assert.fail(`${label}: repository reached`));
    const response = await get(path);
    assert.deepEqual([response.statusCode, response.body.error.code, response.body.blockers?.[0]?.blocking_reason, response.body.data], [403, "authorization_denied", reason, null], label);
    assert.equal(scenario.repository.calls.length, 0, label);
  }

  // The route is organization-scoped; engagement or identity overrides fail closed before the service.
  for (const query of [`?requested_audience=internal&engagement_id=${ENGAGEMENT_X}`, "?requested_audience=internal&organization_id=" + ORG_Y, "?requested_audience=partner", ""]) {
    set(binding, () => assert.fail("repository reached"));
    const response = await get(tracePath(ORG_X, CLAIM, query));
    assert.deepEqual([response.statusCode, response.body.error.code, scenario.serviceCalls], [422, "validation_blocker", 0], query);
  }
});

test("HTTP: KAI_SPRINT2_ENABLED=false refuses the client_admin read before the service", async (t) => {
  let scenario = { actorContext: storedClientAdmin(), repository: recordingRepository(() => assert.fail("repository reached")), serviceCalls: 0 };
  const get = await withRouteServer(t, () => scenario);
  process.env.KAI_SPRINT2_ENABLED = "false";
  const response = await get(tracePath());
  assert.equal(response.statusCode, 403);
  assert.equal(scenario.serviceCalls, 0);
});

// ---------------------------------------------------------------------------
// Customer generation message
// ---------------------------------------------------------------------------

const generationRefusal = Object.freeze({
  statusCode: 422,
  body: { ok: false, error: { code: "validation_blocker", message: "Request failed KAI validation." }, blockers: [{ validator_key: "VAL-GEN-TRACE-P0-001", blocking_reason: "traceability_result_contract_invalid" }] },
});
const passingRead = { statusCode: 200, body: { ok: true, data: { view: "organization_internal_traceability_diagnostic", traceability_passed: true, blocked: true, blocker_codes: ["claim_review_unresolved"] } } };
const conflictRead = (reason) => ({ statusCode: 409, body: { ok: false, error: { code: "conflict_current_state_changed" }, data: { traceability_conflict_reason: reason } } });

test("missing P2-04 state names the claim and recommends Generate gap follow-ups only then", () => {
  assert.equal(isInternalDraftTraceabilityRefusal(generationRefusal), true);
  const diagnosis = internalDraftTraceabilityDiagnosis([
    { claimId: CLAIM, result: passingRead },
    { claimId: SECOND_CLAIM, result: conflictRead("gap_dimension_requires_missing_p204_state") },
  ]);
  assert.deepEqual(diagnosis, { status: "blocked", claimId: SECOND_CLAIM, reason: "gap_dimension_requires_missing_p204_state" });
  assert.equal(
    internalDraftFailureMessage(generationRefusal, { canGenerateGapFollowups: true, diagnosis, claimLabel: "Sessions delivered" }),
    "The selected claim \"Sessions delivered\" cannot be drafted from yet: its coverage gap follow-ups have not been generated yet. "
      + "Use \"Generate gap follow-ups\" on that claim, then try again. Nothing was created.",
  );
  assert.doesNotMatch(internalDraftFailureMessage(generationRefusal, { canGenerateGapFollowups: false, diagnosis }), /Use "Generate gap follow-ups"/);
});

test("stale source versions and other known conflicts are never labelled as missing follow-ups", () => {
  for (const reason of ["source_version_not_current", "gap_followup_queue_mismatch", "claim_evidence_link_mismatch", "conflict_queue_count_mismatch", "conflict_group_validation_failed"]) {
    const diagnosis = internalDraftTraceabilityDiagnosis([{ claimId: CLAIM, result: conflictRead(reason) }]);
    assert.deepEqual(diagnosis, { status: "blocked", claimId: CLAIM, reason }, reason);
    const text = internalDraftFailureMessage(generationRefusal, { canGenerateGapFollowups: true, diagnosis, claimLabel: "Sessions delivered" });
    assert.doesNotMatch(text, /Generate gap follow-ups/, reason);
    assert.match(text, new RegExp(`\\(${reason}\\)\\. Ask Get Kinder to reconcile it\\. Nothing was created\\.$`), reason);
  }
  const stale = internalDraftFailureMessage(generationRefusal, {
    canGenerateGapFollowups: true,
    diagnosis: internalDraftTraceabilityDiagnosis([{ claimId: CLAIM, result: conflictRead("source_version_not_current") }]),
  });
  assert.match(stale, /^A selected claim cannot be drafted from: the source version its evidence comes from has been replaced by a newer version/);
});

test("unknown or unavailable traceability failures receive a neutral message", () => {
  const neutral = "A selected claim did not pass its traceability checks, so no draft was created. The reason is not available here.";
  for (const reads of [
    [],
    [{ claimId: CLAIM, result: passingRead }],
    [{ claimId: CLAIM, result: { statusCode: 403, body: { ok: false, error: { code: "authorization_denied" } } } }],
    [{ claimId: CLAIM, result: { statusCode: 500, body: { ok: false, error: { code: "system_error" } } } }],
    [{ claimId: CLAIM, result: conflictRead("unlisted_reason") }],
    [{ claimId: CLAIM, result: { statusCode: 0, body: null } }],
  ]) {
    const diagnosis = internalDraftTraceabilityDiagnosis(reads);
    assert.equal(diagnosis.status, "unknown", JSON.stringify(reads));
    assert.equal(internalDraftFailureMessage(generationRefusal, { canGenerateGapFollowups: true, diagnosis }), neutral);
  }
  assert.equal(internalDraftFailureMessage(generationRefusal, { canGenerateGapFollowups: true }), neutral, "no diagnostic read");
  const notFound = internalDraftTraceabilityDiagnosis([{ claimId: CLAIM, result: { statusCode: 404, body: { ok: false, error: { code: "not_found" } } } }]);
  assert.deepEqual(notFound, { status: "blocked", claimId: CLAIM, reason: null });
  assert.equal(internalDraftFailureMessage(generationRefusal, { diagnosis: notFound }),
    "A selected claim cannot be drafted from: part of its evidence lineage could not be found in this organization. Nothing was created.");
  assert.equal(internalDraftFailureMessage({ statusCode: 403, body: { error: { code: "authorization_denied", message: "Denied." } } }), "Denied.");
});
