import test from "node:test";
import assert from "node:assert/strict";

import {
  getClaimTraceabilitySummaryTool,
  __assistantClaimTraceabilityToolContract,
} from "../Backend/kai/services/kaiAssistantClaimTraceabilityTool.js";
import { validateAssistantToolAuthorization } from "../Backend/kai/validators/assistantBoundaryValidators.js";
import {
  getToolDefinitionsForKaiContext,
  IMPACT_EVIDENCE_LIBRARY_SURFACE,
} from "../Backend/services/kai-tool-definitions.js";
import { executeToolCall, __testables as executorTestables } from "../Backend/services/kai-tool-executor.js";
import { listOrganizationEvidenceGapsForImpactLibrary } from "../Backend/kai/services/kaiOrganizationEvidenceGapReadService.js";

/**
 * KAI Package 4 (Organization-Level Evidence Gap Read): enumerate an
 * organization's governed evidence gaps on impact_evidence_library without
 * per-claim traceability fan-out. Layers a new assistant-specific gap read
 * (listOrganizationEvidenceGapsForImpactLibrary) over a single bounded,
 * organization-scoped, keyset-paginated query against kai.gap_log_items -
 * the same table already read per-claim by
 * postgresClaimTraceabilityRepository.js#readGapRows and surfaced per-claim
 * by get_claim_traceability_summary's gap_items (TRACEABILITY_GAP_ITEM_KEYS)
 * - to the same gk_admin/gk_operator/gk_reviewer role set that governs every
 * other tool on this surface. This does not list claims and call
 * traceability per claim to aggregate; it is one direct query.
 */

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const USER_ID = 424242;

const clientReviewerActorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  source: "public.userdata",
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "client_reviewer" },
  ],
});
const gkReviewerActorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000002",
  source: "public.userdata",
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" },
  ],
});
const gkAdminActorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000003",
  source: "public.userdata",
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "gk_admin" },
  ],
});
const enabledEnv = Object.freeze({
  KAI_SPRINT2_ENABLED: "true",
  KAI_ASSISTANT_TOOLS_ENABLED: "true",
});

// The Package 4 repair reads candidate gaps and batch-validates their owning
// claims' current-state in one shared read-only transaction/snapshot
// (Backend/kai/dictionary/postgresOrganizationEvidenceGapCurrentStateRepository.js).
// These wiring/pagination tests are not exercising that current-state
// semantic gate at all (that is covered by
// __tests__/kai-package-4-organization-evidence-gaps-semantic-parity.spec.js
// and __tests__/kai-package-4-organization-evidence-gaps-repair.spec.js), so
// `runInTransaction` is stubbed to call straight through with an opaque fake
// tx (never touching a real database connection) and
// `filterCurrentOrganizationEvidenceGaps` is stubbed as an identity
// pass-through over the already-paginated candidate rows.
function noDbDependencies(extra = {}) {
  return {
    runInTransaction: (callback) => callback({ query: async () => ({ rows: [] }) }),
    filterCurrentOrganizationEvidenceGaps: async (_tx, { candidateGapRows }) => candidateGapRows,
    ...extra,
  };
}

function request(overrides = {}) {
  return {
    toolName: "list_organization_evidence_gaps",
    arguments: { organizationId: ORG, limit: 10, afterGapLogItemId: null },
    actorContext: gkReviewerActorContext,
    ...overrides,
  };
}

function gapEntry(overrides = {}) {
  return {
    gap_log_item_id: "00000000-0000-4000-8000-000000002101",
    claim_id: "00000000-0000-4000-8000-000000000101",
    dimension_key: "definition_clarity",
    assessment_status: "unresolved",
    validator_key: "VAL-KAI-P2-02-definition_clarity",
    ...overrides,
  };
}

test.afterEach(() => {
  executorTestables.resetResolveKaiActorContextForTests();
  executorTestables.resetGetClaimTraceabilitySummaryToolForTests();
});

// --- model-visible on the impact_evidence_library surface, absent elsewhere ---

test("list_organization_evidence_gaps is model-visible only on the impact_evidence_library surface", () => {
  const impactTools = getToolDefinitionsForKaiContext("pro", { surface: IMPACT_EVIDENCE_LIBRARY_SURFACE });
  assert.ok(impactTools.some((tool) => tool.name === "list_organization_evidence_gaps"));

  for (const tier of ["guest", "free", "plus", "pro", "agent", "org_growth", "org_enterprise"]) {
    const defaultTools = getToolDefinitionsForKaiContext(tier, {}).map((tool) => tool.name);
    assert.ok(!defaultTools.includes("list_organization_evidence_gaps"), `default surface (${tier}) must not include it`);
  }
  const reportingTools = getToolDefinitionsForKaiContext("pro", { surface: "reporting_readiness" }).map(
    (tool) => tool.name,
  );
  assert.ok(!reportingTools.includes("list_organization_evidence_gaps"));

  const definition = impactTools.find((tool) => tool.name === "list_organization_evidence_gaps");
  assert.deepEqual(
    Object.keys(definition.input_schema.properties).sort(),
    ["afterGapLogItemId", "limit", "organizationId"],
  );
  assert.deepEqual(definition.input_schema.required, ["organizationId", "limit", "afterGapLogItemId"]);
  assert.equal(definition.input_schema.additionalProperties, false);
});

test("assistant boundary allowlists exactly five metadata-read operations", () => {
  assert.deepEqual(
    [...__assistantClaimTraceabilityToolContract.TOOL_NAMES].sort(),
    [
      "get_claim_traceability_summary",
      "list_client_followup_workflows",
      "list_eligible_claims_for_audience",
      "list_governed_claims",
      "list_organization_evidence_gaps",
    ],
  );
  assert.equal(validateAssistantToolAuthorization({ operation: "list_organization_evidence_gaps" }).severity, "pass");
});

test("the assistant-surface role set for list_organization_evidence_gaps is the same ALLOWED_ROLES as the other governed tools", () => {
  assert.deepEqual(
    [...__assistantClaimTraceabilityToolContract.ORGANIZATION_EVIDENCE_GAPS_ALLOWED_ROLES].sort(),
    [...__assistantClaimTraceabilityToolContract.ALLOWED_ROLES].sort(),
  );
});

// --- the wrapper delegates to the new organization-scoped read, not per-claim fan-out ---

test("wrapper delegates exactly once to kaiOrganizationEvidenceGapReadService.listOrganizationEvidenceGapsForImpactLibrary and passes through its result", async () => {
  const serviceResult = {
    ok: true,
    data: { items: [gapEntry()], limit: 10, afterGapLogItemId: null, truncated: false, nextAfterGapLogItemId: null },
    error: null,
  };
  const calls = [];
  const result = await getClaimTraceabilitySummaryTool(request(), {
    env: enabledEnv,
    organizationEvidenceGapReadServiceDependencies: { env: { KAI_SPRINT2_ENABLED: "true" }, marker: "impact-gaps" },
    importOrganizationEvidenceGapReadService: async () => ({
      async listOrganizationEvidenceGapsForImpactLibrary(payload, dependencies) {
        calls.push({ payload, dependencies });
        return serviceResult;
      },
    }),
  });
  assert.equal(result, serviceResult);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].payload, {
    organizationId: ORG,
    limit: 10,
    afterGapLogItemId: null,
    actorContext: gkReviewerActorContext,
  });
  assert.equal(calls[0].dependencies.marker, "impact-gaps");
});

// --- server-authorized org context controls the read; tool input cannot widen tenant scope ---

test("a tool-supplied organizationId that does not match the server-composed organization is rejected before any read", async () => {
  let calls = 0;
  executorTestables.setGetClaimTraceabilitySummaryToolForTests(async () => {
    calls += 1;
    throw new Error("must not be called");
  });
  const result = await executeToolCall(
    "list_organization_evidence_gaps",
    { organizationId: OTHER_ORG, limit: 10, afterGapLogItemId: null },
    USER_ID,
    null,
    { organizationContext: { organizationId: ORG }, actorContext: gkReviewerActorContext },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "tenant_boundary_violation");
  assert.equal(calls, 0);
});

test("wrapper: malformed calls, disabled flags, wrong role, and cross-tenant calls cause zero read-service calls", async () => {
  const cases = [
    request({ arguments: { organizationId: ORG, limit: 10, afterGapLogItemId: null, extra: true } }),
    request({ arguments: { organizationId: "", limit: 10, afterGapLogItemId: null } }),
    request({ arguments: { organizationId: ORG, limit: 0, afterGapLogItemId: null } }),
    request({ arguments: { organizationId: ORG, limit: 26, afterGapLogItemId: null } }),
    request({ arguments: { organizationId: ORG, limit: 10, afterGapLogItemId: "not-a-uuid" } }),
    request({ actorContext: clientReviewerActorContext }),
    request({ actorContext: { ...gkReviewerActorContext, organizationMemberships: [] } }),
    request({ actorContext: { actorType: "assistant" } }),
  ];
  for (const input of cases) {
    let calls = 0;
    const result = await getClaimTraceabilitySummaryTool(input, {
      env: enabledEnv,
      importOrganizationEvidenceGapReadService: async () => ({
        async listOrganizationEvidenceGapsForImpactLibrary() {
          calls += 1;
          throw new Error("must not be called");
        },
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(calls, 0);
  }

  const disabledResult = await getClaimTraceabilitySummaryTool(request(), {
    env: {},
    importOrganizationEvidenceGapReadService: async () => ({
      async listOrganizationEvidenceGapsForImpactLibrary() {
        throw new Error("must not be called");
      },
    }),
  });
  assert.equal(disabledResult.error.code, "feature_disabled");
});

test("a GK-staff actor (gk_admin, gk_operator, or gk_reviewer) with active membership is authorized", async () => {
  for (const actorContext of [gkReviewerActorContext, gkAdminActorContext]) {
    const serviceResult = {
      ok: true,
      data: { items: [], limit: 10, afterGapLogItemId: null, truncated: false, nextAfterGapLogItemId: null },
      error: null,
    };
    const result = await getClaimTraceabilitySummaryTool(request({ actorContext }), {
      env: enabledEnv,
      importOrganizationEvidenceGapReadService: async () => ({
        async listOrganizationEvidenceGapsForImpactLibrary() {
          return serviceResult;
        },
      }),
    });
    assert.equal(result, serviceResult);
  }
});

test("a client-only actor without a GK role is denied authorization_denied", async () => {
  const result = await getClaimTraceabilitySummaryTool(request({ actorContext: clientReviewerActorContext }), {
    env: enabledEnv,
    importOrganizationEvidenceGapReadService: async () => ({
      async listOrganizationEvidenceGapsForImpactLibrary() {
        throw new Error("must not be called");
      },
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

// --- output fields are explicitly allowlisted/minimized; no raw/private/storage data ---

test("wrapper: output tampering or prohibited fields fail closed with system_error and no data", async () => {
  const badPayloads = [
    { items: [gapEntry({ safe_summary: "Claim gap requires review for dimension: definition_clarity." })], limit: 10, afterGapLogItemId: null, truncated: false, nextAfterGapLogItemId: null },
    { items: [gapEntry()], limit: 10, afterGapLogItemId: null, truncated: false, nextAfterGapLogItemId: null, extra: true },
    { items: [{ ...gapEntry(), storage_key: "s3://bucket/object" }], limit: 10, afterGapLogItemId: null, truncated: false, nextAfterGapLogItemId: null },
    { items: [gapEntry()], limit: 26, afterGapLogItemId: null, truncated: false, nextAfterGapLogItemId: null },
    { items: [gapEntry()], limit: 10, afterGapLogItemId: null, truncated: true, nextAfterGapLogItemId: null },
  ];
  for (const data of badPayloads) {
    const result = await getClaimTraceabilitySummaryTool(request(), {
      env: enabledEnv,
      importOrganizationEvidenceGapReadService: async () => ({
        async listOrganizationEvidenceGapsForImpactLibrary() {
          return { ok: true, data, error: null };
        },
      }),
    });
    assert.equal(result.error.code, "system_error");
    assert.equal("data" in result, false);
  }
});

test("wrapper: a well-formed paginated gap list passes output validation unchanged", async () => {
  const serviceResult = {
    ok: true,
    data: {
      items: [gapEntry(), gapEntry({ gap_log_item_id: "00000000-0000-4000-8000-000000002102", dimension_key: "missingness" })],
      limit: 2,
      afterGapLogItemId: null,
      truncated: true,
      nextAfterGapLogItemId: "00000000-0000-4000-8000-000000002102",
    },
    error: null,
  };
  const result = await getClaimTraceabilitySummaryTool(request({ arguments: { organizationId: ORG, limit: 2, afterGapLogItemId: null } }), {
    env: enabledEnv,
    importOrganizationEvidenceGapReadService: async () => ({
      async listOrganizationEvidenceGapsForImpactLibrary() {
        return serviceResult;
      },
    }),
  });
  assert.equal(result, serviceResult);
});

// --- no write/approve/finalize keyword anywhere in its name ---

test("the operation is a read only - no write/approve/finalize keyword anywhere in its name", () => {
  assert.doesNotMatch("list_organization_evidence_gaps", /approve|finalize|promote|delete|mutate|create/i);
});

// --- existing governed tools still work (regression) ---

test("the pre-existing governed operations are unaffected by the new operation's argument/role branching", async () => {
  const governedResult = { ok: true, data: { items: [], limit: 10, afterClaimId: null, truncated: false, nextAfterClaimId: null }, error: null };
  const result = await getClaimTraceabilitySummaryTool(
    {
      toolName: "list_governed_claims",
      arguments: { organizationId: ORG, limit: 10, afterClaimId: null },
      actorContext: gkReviewerActorContext,
    },
    {
      env: enabledEnv,
      importClaimLibraryService: async () => ({
        async listClaimLibraryCandidates() {
          return governedResult;
        },
      }),
    },
  );
  assert.equal(result, governedResult);
});

// --- the underlying service: no per-claim fan-out, single bounded query, keyset pagination ---

test("listOrganizationEvidenceGapsForImpactLibrary denies client_reviewer and authorizes GK staff via exactly one organization-scoped read call", async () => {
  const deniedForClientReviewer = await listOrganizationEvidenceGapsForImpactLibrary(
    { organizationId: ORG, limit: 10, afterGapLogItemId: null, actorContext: clientReviewerActorContext },
    noDbDependencies({ env: enabledEnv, listOrganizationEvidenceGaps: async () => { throw new Error("must not be called"); } }),
  );
  assert.equal(deniedForClientReviewer.ok, false);
  assert.equal(deniedForClientReviewer.error.code, "authorization_denied");

  // "Current" gap: filterCurrentOrganizationEvidenceGaps is stubbed as an
  // identity pass-through here (this test is about authorization/read-call
  // wiring, not current-state semantics, which is covered elsewhere), so
  // every candidate row returned by listOrganizationEvidenceGaps is treated
  // as current.
  const row = gapEntry();
  let queryCalls = 0;
  const allowedForGkReviewer = await listOrganizationEvidenceGapsForImpactLibrary(
    { organizationId: ORG, limit: 10, afterGapLogItemId: null, actorContext: gkReviewerActorContext },
    noDbDependencies({
      env: enabledEnv,
      listOrganizationEvidenceGaps: async (organizationId, options) => {
        queryCalls += 1;
        assert.equal(organizationId, ORG);
        assert.deepEqual(options, { limit: 10, afterGapLogItemId: null });
        return [row];
      },
    }),
  );
  assert.equal(allowedForGkReviewer.ok, true);
  assert.equal(queryCalls, 1, "exactly one bounded organization-scoped candidate-page query, no per-claim fan-out");
  assert.deepEqual(allowedForGkReviewer.data.items, [row]);
  assert.equal(allowedForGkReviewer.data.truncated, false);
  assert.equal(allowedForGkReviewer.data.nextAfterGapLogItemId, null);
});

test("listOrganizationEvidenceGapsForImpactLibrary paginates via keyset cursor (limit+1 lookahead), never OFFSET", async () => {
  const rows = [gapEntry(), gapEntry({ gap_log_item_id: "00000000-0000-4000-8000-000000002102" }), gapEntry({ gap_log_item_id: "00000000-0000-4000-8000-000000002103" })];
  let capturedOptions = null;
  const result = await listOrganizationEvidenceGapsForImpactLibrary(
    { organizationId: ORG, limit: 2, afterGapLogItemId: null, actorContext: gkReviewerActorContext },
    noDbDependencies({
      env: enabledEnv,
      listOrganizationEvidenceGaps: async (organizationId, options) => {
        capturedOptions = options;
        return rows; // limit+1 lookahead row present
      },
    }),
  );
  assert.deepEqual(capturedOptions, { limit: 2, afterGapLogItemId: null });
  assert.equal(result.data.items.length, 2);
  assert.equal(result.data.truncated, true);
  assert.equal(result.data.nextAfterGapLogItemId, rows[1].gap_log_item_id);
});

test("listOrganizationEvidenceGapsForImpactLibrary fails closed for cross-tenant, disabled-feature, and malformed-row reads", async () => {
  const crossTenant = await listOrganizationEvidenceGapsForImpactLibrary(
    { organizationId: ORG, limit: 10, afterGapLogItemId: null, actorContext: { ...gkReviewerActorContext, organizationMemberships: [] } },
    noDbDependencies({ env: enabledEnv, listOrganizationEvidenceGaps: async () => { throw new Error("must not be called"); } }),
  );
  assert.equal(crossTenant.ok, false);

  const disabled = await listOrganizationEvidenceGapsForImpactLibrary(
    { organizationId: ORG, limit: 10, afterGapLogItemId: null, actorContext: gkReviewerActorContext },
    noDbDependencies({ env: {}, listOrganizationEvidenceGaps: async () => { throw new Error("must not be called"); } }),
  );
  assert.equal(disabled.error.code, "feature_disabled");

  const malformedRow = await listOrganizationEvidenceGapsForImpactLibrary(
    { organizationId: ORG, limit: 10, afterGapLogItemId: null, actorContext: gkReviewerActorContext },
    noDbDependencies({ env: enabledEnv, listOrganizationEvidenceGaps: async () => [{ gap_log_item_id: "not-a-uuid" }] }),
  );
  assert.equal(malformedRow.error.code, "system_error");
});
