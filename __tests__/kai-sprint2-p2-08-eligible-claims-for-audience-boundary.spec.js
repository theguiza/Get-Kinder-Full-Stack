import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { listEligibleClaimsForAudience } from "../Backend/kai/services/kaiEligibleClaimsForAudienceService.js";
import {
  createPostgresEligibleClaimsForAudienceRepository,
  __eligibleClaimsForAudienceRepositoryContract,
} from "../Backend/kai/dictionary/postgresEligibleClaimsForAudienceRepository.js";
import {
  getClaimTraceabilitySummaryTool,
  __assistantClaimTraceabilityToolContract,
} from "../Backend/kai/services/kaiAssistantClaimTraceabilityTool.js";
import { validateAssistantToolAuthorization } from "../Backend/kai/validators/assistantBoundaryValidators.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const CLAIM = "00000000-0000-4000-8000-000000000101";
const enabledEnv = Object.freeze({
  KAI_SPRINT2_ENABLED: "true",
  KAI_ASSISTANT_TOOLS_ENABLED: "true",
});
const actorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  source: "public.userdata",
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" },
  ],
});

function id(number) {
  return `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

function serviceInput(overrides = {}) {
  return {
    organizationId: ORG,
    requestedAudience: "internal",
    limit: 10,
    afterClaimId: null,
    actorContext,
    ...overrides,
  };
}

function wrapperRequest(overrides = {}) {
  return {
    toolName: "list_eligible_claims_for_audience",
    arguments: { organizationId: ORG, requestedAudience: "internal", limit: 10, afterClaimId: null },
    actorContext,
    ...overrides,
  };
}

function traceabilityRequest(overrides = {}) {
  return {
    toolName: "get_claim_traceability_summary",
    arguments: { organizationId: ORG, claimId: CLAIM, requestedAudience: "internal" },
    actorContext,
    ...overrides,
  };
}

function traceabilitySuccess(overrides = {}) {
  return {
    claim: {
      claim_id: overrides.claimId || CLAIM,
      claim_type: "finding",
      claim_status: "proposed",
      claim_review_status: "needs_gk_review",
      claim_strength: "unassessed",
      audience_gates: {
        internal_only: true,
        public_use_allowed: false,
        funder_use_allowed: false,
        export_ready: false,
      },
    },
    evidence: {
      evidence_item_id: id(201),
      evidence_review_status: "approved",
      support_strength: "strong",
      review_queue_item_id: id(301),
      review_queue_status: "closed",
      review_status: "approved",
      updated_at: "2026-08-22T20:00:00.000Z",
      sensitivity_level: "unknown",
    },
    locator: { source_locator_id: id(401) },
    source: { source_id: id(501), source_code: "annual_report" },
    source_version: { source_version_id: id(601), is_current: true },
    claim_review: {
      review_queue_item_id: id(701),
      queue_status: "closed",
      review_status: "approved",
      updated_at: "2026-08-22T20:00:00.000Z",
    },
    candidate: { intake_source_candidate_id: id(801) },
    promotion_decision: { intake_promotion_decision_id: id(901) },
    dimensions: {
      missingness: {
        assessment_status: "resolved",
        validator_key: "VAL-KAI-P2-02-missingness",
        internal_limitation_accepted: false,
        blocks_requested_audience: false,
      },
    },
    gap_items: [],
    client_followup_workflows: [],
    potential_conflict_groups: [],
    requestedAudience: overrides.requestedAudience || "internal",
    eligible: overrides.eligible ?? true,
    blockerCodes: overrides.eligible === false ? ["claim_not_approved_for_requested_audience"] : [],
    affectedDimensionKeys: [],
    affectedObjectIds: [],
    truncated: false,
  };
}

function listSuccess(overrides = {}) {
  return {
    requestedAudience: "internal",
    eligibleClaims: [],
    limit: 10,
    afterClaimId: null,
    truncated: false,
    nextAfterClaimId: null,
    ...overrides,
  };
}

function repositoryWithCandidates({ candidateIds, eligibleIds = new Set(), failures = new Map(), seen = [] }) {
  const sqlLog = [];
  let transactions = 0;
  const tx = {
    async query(sql, params) {
      sqlLog.push(String(sql));
      if (/SELECT claim_id/.test(sql)) {
        const after = params.length === 3 ? params[2] : null;
        const limit = params[1];
        return {
          rows: candidateIds
            .filter((claimId) => after === null || claimId > after)
            .slice(0, limit)
            .map((claim_id) => ({ claim_id })),
        };
      }
      return { rows: [] };
    },
  };
  const repository = createPostgresEligibleClaimsForAudienceRepository({
    async runInTransaction(callback) {
      transactions += 1;
      return callback(tx);
    },
    async evaluator(evaluatorTx, input) {
      assert.equal(evaluatorTx, tx);
      seen.push(input.claimId);
      if (failures.has(input.claimId)) return failures.get(input.claimId);
      return {
        ok: true,
        data: traceabilitySuccess({
          claimId: input.claimId,
          requestedAudience: input.requestedAudience,
          eligible: eligibleIds.has(input.claimId),
        }),
        error: null,
      };
    },
  });
  return { repository, sqlLog, get transactions() { return transactions; } };
}

test("P2-08 service: disabled, invalid, unauthorized, role, and tenant failures do not call list repository", async () => {
  let calls = 0;
  const repository = { async listEligibleClaimsForAudience() { calls += 1; throw new Error("must not call"); } };
  assert.equal((await listEligibleClaimsForAudience(serviceInput(), { env: {}, eligibleClaimsForAudienceRepository: repository })).error.code, "feature_disabled");
  assert.equal((await listEligibleClaimsForAudience({ ...serviceInput(), extra: true }, { env: enabledEnv, eligibleClaimsForAudienceRepository: repository })).error.code, "validation_blocker");
  assert.equal((await listEligibleClaimsForAudience(serviceInput({ requestedAudience: "partner" }), { env: enabledEnv, eligibleClaimsForAudienceRepository: repository })).error.code, "validation_blocker");
  assert.equal((await listEligibleClaimsForAudience(serviceInput({ limit: 0 }), { env: enabledEnv, eligibleClaimsForAudienceRepository: repository })).error.code, "validation_blocker");
  assert.equal((await listEligibleClaimsForAudience(serviceInput({ afterClaimId: "00000000-0000-4000-8000-0000000000AA" }), { env: enabledEnv, eligibleClaimsForAudienceRepository: repository })).error.code, "validation_blocker");
  assert.equal((await listEligibleClaimsForAudience(serviceInput({ actorContext: { actorType: "system", actorUserId: actorContext.actorUserId } }), { env: enabledEnv, eligibleClaimsForAudienceRepository: repository })).error.code, "authorization_denied");
  assert.equal((await listEligibleClaimsForAudience(serviceInput({ actorContext: { ...actorContext, organizationMemberships: [] } }), { env: enabledEnv, eligibleClaimsForAudienceRepository: repository })).error.code, "authorization_denied");
  assert.equal((await listEligibleClaimsForAudience(serviceInput({ organizationId: OTHER_ORG }), { env: enabledEnv, eligibleClaimsForAudienceRepository: repository })).error.code, "authorization_denied");
  assert.equal(calls, 0);
});

test("P2-08 repository: one read-only transaction-scoped snapshot and P2-06 evaluator seam are reused", async () => {
  const seen = [];
  const harness = repositoryWithCandidates({
    candidateIds: [id(1), id(2), id(3)],
    eligibleIds: new Set([id(2)]),
    seen,
  });
  const result = await harness.repository.listEligibleClaimsForAudience({
    organizationId: ORG,
    requestedAudience: "public",
    limit: 10,
    afterClaimId: null,
  });
  assert.equal(result.ok, true);
  assert.equal(harness.transactions, 1);
  assert.equal(harness.sqlLog.filter((sql) => /REPEATABLE READ READ ONLY/.test(sql)).length, 1);
  assert.deepEqual(seen, [id(1), id(2), id(3)]);
  assert.deepEqual(result.data.eligibleClaims.map((claim) => claim.claimId), [id(2)]);
  assert.equal(result.data.eligibleClaims[0].requestedAudience, "public");
  assert.equal(harness.sqlLog.some((sql) => /\bINSERT\b|\bUPDATE\b|\bDELETE\b|upload_lifecycle_audit/i.test(sql)), false);
});

test("P2-08 repository: scans across ineligible pages, orders eligible claims, and paginates on eligible cursor", async () => {
  const candidateIds = Array.from({ length: 103 }, (_, index) => id(index + 1));
  const { repository } = repositoryWithCandidates({
    candidateIds,
    eligibleIds: new Set([id(101), id(102), id(103)]),
  });
  const result = await repository.listEligibleClaimsForAudience({
    organizationId: ORG,
    requestedAudience: "internal",
    limit: 2,
    afterClaimId: null,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.eligibleClaims.map((claim) => claim.claimId), [id(101), id(102)]);
  assert.equal(result.data.truncated, true);
  assert.equal(result.data.nextAfterClaimId, id(102));
});

test("P2-08 repository: exhausted candidates return empty or partial successful pages without proving more eligibility", async () => {
  const empty = repositoryWithCandidates({ candidateIds: [] });
  const emptyResult = await empty.repository.listEligibleClaimsForAudience({
    organizationId: ORG,
    requestedAudience: "internal",
    limit: 5,
    afterClaimId: null,
  });
  assert.deepEqual(emptyResult.data, listSuccess({ limit: 5 }));

  const partial = repositoryWithCandidates({ candidateIds: [id(1), id(2)], eligibleIds: new Set([id(2)]) });
  const partialResult = await partial.repository.listEligibleClaimsForAudience({
    organizationId: ORG,
    requestedAudience: "internal",
    limit: 5,
    afterClaimId: id(1),
  });
  assert.equal(partialResult.data.truncated, false);
  assert.equal(partialResult.data.nextAfterClaimId, null);
  assert.deepEqual(partialResult.data.eligibleClaims.map((claim) => claim.claimId), [id(2)]);
});

test("P2-08 repository: 500-candidate cap truncates on the real final inspected claim boundary", async () => {
  const candidateIds = Array.from({ length: 501 }, (_, index) => id(index + 1));
  const { repository } = repositoryWithCandidates({ candidateIds, eligibleIds: new Set([id(250)]) });
  const result = await repository.listEligibleClaimsForAudience({
    organizationId: ORG,
    requestedAudience: "internal",
    limit: 10,
    afterClaimId: null,
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.truncated, true);
  assert.equal(result.data.nextAfterClaimId, id(500));
  assert.notEqual(result.data.nextAfterClaimId, null);
  assert.deepEqual(result.data.eligibleClaims.map((claim) => claim.claimId), [id(250)]);
});

test("P2-08 repository: unusable candidate state is omitted without poisoning the whole list request", async () => {
  const failures = new Map([[id(2), { ok: false, data: null, error: { code: "not_found", status: 404 } }]]);
  const { repository } = repositoryWithCandidates({
    candidateIds: [id(1), id(2), id(3)],
    eligibleIds: new Set([id(1), id(3)]),
    failures,
  });
  const result = await repository.listEligibleClaimsForAudience({
    organizationId: ORG,
    requestedAudience: "internal",
    limit: 10,
    afterClaimId: null,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.eligibleClaims.map((claim) => claim.claimId), [id(1), id(3)]);
});

test("P2-08 repository: current-state conflicts on one candidate are skipped and pagination advances past them", async () => {
  const failures = new Map([[id(2), { ok: false, data: null, error: { code: "conflict_current_state_changed", status: 409 } }]]);
  const { repository } = repositoryWithCandidates({
    candidateIds: [id(1), id(2), id(3), id(4)],
    eligibleIds: new Set([id(1), id(3), id(4)]),
    failures,
  });
  const result = await repository.listEligibleClaimsForAudience({
    organizationId: ORG,
    requestedAudience: "internal",
    limit: 2,
    afterClaimId: null,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.eligibleClaims.map((claim) => claim.claimId), [id(1), id(3)]);
  assert.equal(result.data.truncated, true);
  assert.equal(result.data.nextAfterClaimId, id(3));
});

test("P2-08 repository: unexpected evaluator failures still fail the whole list request", async () => {
  const failures = new Map([[id(2), { ok: false, data: null, error: { code: "system_error", status: 500 } }]]);
  const { repository } = repositoryWithCandidates({
    candidateIds: [id(1), id(2), id(3)],
    eligibleIds: new Set([id(1), id(3)]),
    failures,
  });
  const result = await repository.listEligibleClaimsForAudience({
    organizationId: ORG,
    requestedAudience: "internal",
    limit: 10,
    afterClaimId: null,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
});

test("P2-08 wrapper: traceability operation remains unchanged and exactly five assistant operations are allowlisted", async () => {
  const traceResult = { ok: true, data: traceabilitySuccess({ eligible: false }), error: null };
  const observed = [];
  const result = await getClaimTraceabilitySummaryTool(traceabilityRequest(), {
    env: enabledEnv,
    importClaimTraceabilityService: async () => ({
      async getClaimTraceabilitySummary(payload) {
        observed.push(payload);
        return traceResult;
      },
    }),
  });
  assert.equal(result, traceResult);
  assert.deepEqual(observed, [{ organizationId: ORG, claimId: CLAIM, requestedAudience: "internal", actorContext }]);

  assert.deepEqual([...__assistantClaimTraceabilityToolContract.TOOL_NAMES].sort(), [
    "get_claim_traceability_summary",
    "list_client_followup_workflows",
    "list_eligible_claims_for_audience",
    "list_governed_claims",
    "list_organization_evidence_gaps",
  ]);
  assert.equal(validateAssistantToolAuthorization({ operation: "get_claim_traceability_summary" }).severity, "pass");
  assert.equal(validateAssistantToolAuthorization({ operation: "list_eligible_claims_for_audience" }).severity, "pass");
  assert.equal(validateAssistantToolAuthorization({ operation: "list_governed_claims" }).severity, "pass");
  assert.equal(validateAssistantToolAuthorization({ operation: "list_client_followup_workflows" }).severity, "pass");
  assert.equal(validateAssistantToolAuthorization({ operation: "list_organization_evidence_gaps" }).severity, "pass");
  assert.equal(validateAssistantToolAuthorization({ operation: "get_claims" }).severity, "blocker");
});

test("P2-08 wrapper: malformed or forbidden calls cause zero list-service calls", async () => {
  for (const input of [
    {},
    { ...wrapperRequest(), extra: true },
    wrapperRequest({ toolName: "list_claims" }),
    wrapperRequest({ arguments: { organizationId: ORG, requestedAudience: "internal", limit: 10 } }),
    wrapperRequest({ arguments: { organizationId: ORG, requestedAudience: "internal", limit: 10, afterClaimId: null, rawFile: true } }),
    wrapperRequest({ arguments: { organizationId: ORG, requestedAudience: "public", limit: 101, afterClaimId: null } }),
    wrapperRequest({ actorContext: { actorType: "assistant" } }),
    wrapperRequest({ actorContext: { ...actorContext, organizationMemberships: [] } }),
  ]) {
    let calls = 0;
    const result = await getClaimTraceabilitySummaryTool(input, {
      env: enabledEnv,
      importEligibleClaimsForAudienceService: async () => ({
        async listEligibleClaimsForAudience() {
          calls += 1;
          throw new Error("must not call");
        },
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(calls, 0);
  }
});

test("P2-08 wrapper: valid list request delegates once and validates output allowlist", async () => {
  const serviceResult = {
    ok: true,
    data: listSuccess({
      eligibleClaims: [
        {
          claimId: id(1),
          claimType: "finding",
          claimStatus: "proposed",
          claimReviewStatus: "approved",
          supportStrength: "strong",
          evidenceItemId: id(2),
          sourceId: id(3),
          sourceVersionId: id(4),
          requestedAudience: "internal",
        },
      ],
    }),
    error: null,
  };
  const calls = [];
  const result = await getClaimTraceabilitySummaryTool(wrapperRequest(), {
    env: enabledEnv,
    eligibleClaimsForAudienceServiceDependencies: { env: { KAI_SPRINT2_ENABLED: "true" }, marker: "p2-08" },
    importEligibleClaimsForAudienceService: async () => ({
      async listEligibleClaimsForAudience(payload, dependencies) {
        calls.push({ payload, dependencies });
        return serviceResult;
      },
    }),
  });
  assert.equal(result, serviceResult);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].dependencies.marker, "p2-08");
  assert.deepEqual(calls[0].payload, { ...wrapperRequest().arguments, actorContext });
});

test("P2-08 wrapper: output tampering or prohibited fields fail closed with system_error and no data", async () => {
  for (const data of [
    listSuccess({ extra: true }),
    listSuccess({ truncated: true, nextAfterClaimId: null }),
    listSuccess({ eligibleClaims: [{ claimId: id(1), claimText: "unsafe" }] }),
    listSuccess({
      eligibleClaims: [
        {
          claimId: id(1),
          claimType: "finding",
          claimStatus: "proposed",
          claimReviewStatus: "approved",
          supportStrength: "strong",
          evidenceItemId: id(2),
          sourceId: id(3),
          sourceVersionId: id(4),
          requestedAudience: "internal",
          filename: "private.pdf",
        },
      ],
    }),
  ]) {
    const result = await getClaimTraceabilitySummaryTool(wrapperRequest(), {
      env: enabledEnv,
      importEligibleClaimsForAudienceService: async () => ({
        async listEligibleClaimsForAudience() {
          return { ok: true, data, error: null };
        },
      }),
    });
    assert.equal(result.error.code, "system_error");
    assert.equal("data" in result, false);
  }
});

test("P2-08 source contract: read-only, no extra wrapper, no nested public P2-06 service invocation", () => {
  const repositorySource = readFileSync(new URL("../Backend/kai/dictionary/postgresEligibleClaimsForAudienceRepository.js", import.meta.url), "utf8");
  const serviceSource = readFileSync(new URL("../Backend/kai/services/kaiEligibleClaimsForAudienceService.js", import.meta.url), "utf8");
  const wrapperSource = readFileSync(new URL("../Backend/kai/services/kaiAssistantClaimTraceabilityTool.js", import.meta.url), "utf8");
  assert.equal(__eligibleClaimsForAudienceRepositoryContract.MAX_CANDIDATES, 500);
  assert.equal(__eligibleClaimsForAudienceRepositoryContract.BATCH_SIZE, 100);
  assert.doesNotMatch(repositorySource, /getClaimTraceabilitySummary\(/);
  assert.match(repositorySource, /evaluateClaimTraceabilityInTransaction/);
  assert.doesNotMatch(repositorySource, /\bINSERT\b|\bUPDATE\b|\bDELETE\b|prepareMetadataOnlyAudit|upload_lifecycle_audit/);
  assert.doesNotMatch(serviceSource, /prepareMetadataOnlyAudit|upload_lifecycle_audit/);
  assert.match(wrapperSource, /import\("\.\/kaiEligibleClaimsForAudienceService\.js"\)/);
});
