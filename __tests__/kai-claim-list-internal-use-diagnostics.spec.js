import test from "node:test";
import assert from "node:assert/strict";

import { STORED_ORGANIZATION_MEMBERSHIP_SOURCE } from "../Backend/kai/auth/kaiOrganizationMembershipSource.js";
import {
  getClaimTraceabilitySummary,
  listOrganizationInternalDraftDiagnostics,
} from "../Backend/kai/services/kaiClaimTraceabilityService.js";
import { listClaimLibraryCandidates } from "../Backend/kai/services/kaiClaimLibraryService.js";
import {
  createPostgresClaimTraceabilityRepository,
  __claimTraceabilityRepositoryContract,
} from "../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js";
import { projectCandidateClaims } from "../frontend/impactEvidenceLibraryLogic.js";
import { claimUseDiagnosis, listedClaimDiagnostics } from "../frontend/knowledgeStudio/clientEvidenceWorkflowLogic.js";

/**
 * Owner direction 2026-11-16: the claims page carries each claim's internal-use
 * answer (the organization administrator's client-safe P2-06 diagnostic and
 * provisional internal draft admission), evaluated server-side in one
 * read-only transaction, instead of the Knowledge Studio reading the
 * traceability route once per claim.
 *
 * Synthetic fixtures only. Real: authorization, the traceability service and
 * its response shaping, the claim library service and the client projection.
 * Injected: the repositories and, for the repository batch, the transaction.
 */

const ENV = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });
const ORG = "11111111-2222-4333-8444-555555555555";
const OTHER_ORG = "99999999-8888-4777-8666-555555555555";
const USER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const claimId = (n) => `3d000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function actor(roleName, { organizationId = ORG, source = STORED_ORGANIZATION_MEMBERSHIP_SOURCE } = {}) {
  return {
    actorType: "human", actorUserId: USER, kaiRoles: [], platformSuperuser: false,
    organizationMemberships: [{ organization_id: organizationId, role_name: roleName, membership_status: "active", ...(source ? { source } : {}) }],
  };
}
const ADMIN = actor("client_admin");

// One repository answering both the single read and the batch from the same
// per-claim results, so the two paths can be compared directly.
const RESULTS = new Map([
  [claimId(1), { ok: true, data: { eligible: true, blockerCodes: [] }, error: null, provisionalInternalDraft: { admitted: true, blockerCodes: [], sourceRole: "primary" } }],
  [claimId(2), { ok: true, data: { eligible: false, blockerCodes: ["claim_review_unresolved"] }, error: null, provisionalInternalDraft: { admitted: false, blockerCodes: ["ai_processing_not_permitted"], sourceRole: null } }],
  [claimId(3), { ok: false, data: null, error: { code: "conflict_current_state_changed", status: 409, reason: "source_version_not_current" } }],
  [claimId(4), { ok: false, data: null, error: { code: "conflict_current_state_changed", status: 409, reason: "not_an_allowlisted_reason" } }],
  [claimId(5), { ok: false, data: null, error: { code: "system_error", status: 500 } }],
  [claimId(8), { ok: true, data: { eligible: true, blockerCodes: [] }, error: null, provisionalInternalDraft: { admitted: true, blockerCodes: [], sourceRole: null } }],
]);
function repository() {
  const calls = { single: [], batch: [] };
  return {
    calls,
    async getOrganizationInternalDraftDiagnostic(input) { calls.single.push(input); return RESULTS.get(input.claimId); },
    async getOrganizationInternalDraftDiagnostics(input) {
      calls.batch.push(input);
      return { ok: true, data: { items: input.claimIds.map((id) => ({ claimId: id, result: RESULTS.get(id) })) }, error: null };
    },
    async getClaimTraceabilitySummary() { throw new Error("the organization diagnostic reads the combined form"); },
  };
}

test("the listed answer for each claim is exactly the per-claim route's answer: success, admission, allowlisted conflict, unexplained conflict, failure", async () => {
  const ids = [...RESULTS.keys()];
  const repo = repository();
  const batch = await listOrganizationInternalDraftDiagnostics({ organizationId: ORG, claimIds: ids, actorContext: ADMIN }, { env: ENV, claimTraceabilityRepository: repo });
  assert.equal(batch.ok, true, JSON.stringify(batch));
  assert.deepEqual(repo.calls.batch, [{ organizationId: ORG, claimIds: ids, requestedAudience: "internal" }], "one batch read, internal only");
  assert.deepEqual(batch.data.items.map((item) => item.claimId), ids, "in the requested order");
  for (const [index, id] of ids.entries()) {
    const single = await getClaimTraceabilitySummary({ organizationId: ORG, claimId: id, requestedAudience: "internal", actorContext: ADMIN },
      { env: ENV, claimTraceabilityRepository: repository() });
    assert.deepEqual(batch.data.items[index].response, single, id);
  }
  const [admitted, refused, conflict, unexplained, failed] = batch.data.items.map((item) => item.response);
  assert.deepEqual(admitted.data.provisional_internal_draft, { admitted: true, blocker_codes: [], source_role: "primary" });
  assert.deepEqual([refused.data.eligible, refused.data.blocker_codes, refused.data.provisional_internal_draft.blocker_codes],
    [false, ["claim_review_unresolved"], ["ai_processing_not_permitted"]]);
  assert.deepEqual([conflict.error.status, conflict.data], [409, { traceability_conflict_reason: "source_version_not_current" }]);
  assert.equal(unexplained.data, undefined, "an unexplained reason is never disclosed");
  assert.deepEqual([failed.ok, failed.error.code], [false, "system_error"]);
});

test("only an organization administrator of this organization gets the batch; nothing is read for anyone else", async () => {
  const refusals = [
    ["contributor", actor("client_contributor")],
    ["client reviewer", actor("client_reviewer")],
    ["administrator of another organization", actor("client_admin", { organizationId: OTHER_ORG })],
    ["Get Kinder reviewer (full DTO, never the batch)", actor("gk_reviewer", { source: null })],
    ["service actor", { ...ADMIN, actorType: "system" }],
  ];
  for (const [label, actorContext] of refusals) {
    const repo = repository();
    const result = await listOrganizationInternalDraftDiagnostics({ organizationId: ORG, claimIds: [claimId(1)], actorContext }, { env: ENV, claimTraceabilityRepository: repo });
    assert.equal(result.ok, false, label);
    assert.equal(result.error.code, "authorization_denied", label);
    assert.deepEqual(repo.calls.batch, [], `${label}: nothing read`);
  }
  const disabled = await listOrganizationInternalDraftDiagnostics({ organizationId: ORG, claimIds: [claimId(1)], actorContext: ADMIN }, { env: {}, claimTraceabilityRepository: repository() });
  assert.equal(disabled.error.code, "feature_disabled");
  for (const claimIds of [[claimId(1), claimId(1)], "x", [""]]) {
    const invalid = await listOrganizationInternalDraftDiagnostics({ organizationId: ORG, claimIds, actorContext: ADMIN }, { env: ENV, claimTraceabilityRepository: repository() });
    assert.equal(invalid.error.code, "validation_blocker", JSON.stringify(claimIds));
  }
  const repo = repository();
  const empty = await listOrganizationInternalDraftDiagnostics({ organizationId: ORG, claimIds: [], actorContext: ADMIN }, { env: ENV, claimTraceabilityRepository: repo });
  assert.deepEqual([empty.ok, empty.data.items, repo.calls.batch], [true, [], []], "an empty page reads nothing");
});

const row = (n, { evidenceType = "source_record_count_measurement", current = true } = {}) => ({
  claim_id: claimId(n), organization_id: ORG, evidence_item_id: `3c000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  claim_type: "finding", claim_status: "proposed", claim_review_status: "needs_gk_review", claim_strength: "unassessed",
  review_queue_items: [], evidence_type: evidenceType, evidence_source_version_is_current: current,
});
const PAGE = [
  row(1), row(2), row(3), row(5),
  row(6, { evidenceType: "dictionary_field_presence_fact" }),
  row(7, { current: false }),
  row(8, { current: null }),
];

test("the claims page carries each evaluated claim's answer for an administrator, in one batch; structural and non-current claims are not evaluated", async () => {
  const repo = repository();
  const result = await listClaimLibraryCandidates({ organizationId: ORG, actorContext: ADMIN }, {
    env: ENV, listClaimLibraryReviewCandidates: async () => PAGE, claimTraceabilityRepository: repo,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(repo.calls.batch.length, 1, "one evaluation for the whole page");
  assert.equal(repo.calls.single.length, 0);
  assert.deepEqual(repo.calls.batch[0].claimIds, [claimId(1), claimId(2), claimId(3), claimId(5), claimId(8)]);
  const listed = Object.fromEntries(result.data.items.map((item) => [item.claimId, item.internalUseDiagnostic]));
  assert.equal(listed[claimId(1)].status, 200);
  assert.equal(listed[claimId(1)].data.provisional_internal_draft.admitted, true);
  assert.deepEqual(listed[claimId(3)], { status: 409, error_code: "conflict_current_state_changed", traceability_conflict_reason: "source_version_not_current" });
  assert.deepEqual(listed[claimId(5)], { status: 500, error_code: "system_error", traceability_conflict_reason: null });
  assert.equal(listed[claimId(6)], null, "structural fact: not evaluated");
  assert.equal(listed[claimId(7)], null, "non-current source version: not evaluated");

  // Through the client projection, each listed answer is what the per-claim read gave the page.
  const claims = projectCandidateClaims(result.data);
  const byClaim = listedClaimDiagnostics(claims);
  for (const n of [1, 2, 3, 5, 8]) {
    const single = await getClaimTraceabilitySummary({ organizationId: ORG, claimId: claimId(n), requestedAudience: "internal", actorContext: ADMIN },
      { env: ENV, claimTraceabilityRepository: repository() });
    const viaRoute = claimUseDiagnosis({ statusCode: single.ok ? 200 : single.error.status, body: single });
    assert.deepEqual(byClaim.get(claimId(n)), viaRoute, `claim ${n}`);
  }
  assert.equal(byClaim.has(claimId(6)), false);
  assert.equal(byClaim.has(claimId(7)), false);
});

test("other readers' claims pages are unchanged and evaluate nothing; a failed evaluation never fails the claims read", async () => {
  const gk = actor("gk_reviewer", { source: null });
  const repo = repository();
  const gkRead = await listClaimLibraryCandidates({ organizationId: ORG, actorContext: gk }, {
    env: ENV, listClaimLibraryReviewCandidates: async () => PAGE, claimTraceabilityRepository: repo,
  });
  assert.equal(gkRead.ok, true, JSON.stringify(gkRead));
  assert.ok(gkRead.data.items.every((item) => !Object.hasOwn(item, "internalUseDiagnostic")), "no field for a Get Kinder reader");
  assert.deepEqual(repo.calls.batch, []);

  for (const [label, listOrganizationInternalDraftDiagnosticsStub] of [
    ["refused batch", async () => ({ ok: false, error: { code: "system_error", status: 500 } })],
    ["thrown batch", async () => { throw new Error("database unavailable"); }],
    ["batch missing a claim", async ({ claimIds }) => ({ ok: true, data: { items: claimIds.slice(1).map((id) => ({ claimId: id, response: { ok: true, data: {} } })) } })],
  ]) {
    const read = await listClaimLibraryCandidates({ organizationId: ORG, actorContext: ADMIN }, {
      env: ENV, listClaimLibraryReviewCandidates: async () => PAGE, listOrganizationInternalDraftDiagnostics: listOrganizationInternalDraftDiagnosticsStub,
    });
    assert.equal(read.ok, true, label);
    const first = read.data.items.find((item) => item.claimId === claimId(1)).internalUseDiagnostic;
    assert.deepEqual([first.status, first.error_code], [500, "system_error"], label);
    const diagnosis = listedClaimDiagnostics(projectCandidateClaims(read.data)).get(claimId(1));
    assert.equal(diagnosis.status, "unknown", `${label}: unknown, never adverse; "Check internal use" stays available`);
  }
});

test("the repository batch evaluates every claim in one read-only transaction, isolating each claim's database error with a savepoint", async () => {
  const sql = [];
  let transactions = 0;
  const failingClaim = claimId(2);
  const tx = {
    async query(text, params = []) {
      sql.push(text.trim().split(/\s+/).slice(0, 4).join(" "));
      if (Array.isArray(params) && params.includes(failingClaim)) throw Object.assign(new Error("synthetic"), { code: "XX000" });
      return { rows: [], rowCount: 0 };
    },
  };
  const repo = createPostgresClaimTraceabilityRepository({ runInTransaction: async (work) => { transactions += 1; return work(tx); } });
  const result = await repo.getOrganizationInternalDraftDiagnostics({ organizationId: ORG, claimIds: [claimId(1), failingClaim, claimId(3)], requestedAudience: "internal" });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(transactions, 1, "one transaction for the page");
  assert.equal(sql[0], "SET TRANSACTION ISOLATION LEVEL");
  assert.deepEqual(sql.filter((s) => /SAVEPOINT/.test(s)), [
    "SAVEPOINT kai_claim_internal_draft_diagnostic",
    "RELEASE SAVEPOINT kai_claim_internal_draft_diagnostic",
    "SAVEPOINT kai_claim_internal_draft_diagnostic",
    "ROLLBACK TO SAVEPOINT kai_claim_internal_draft_diagnostic",
    "SAVEPOINT kai_claim_internal_draft_diagnostic",
    "RELEASE SAVEPOINT kai_claim_internal_draft_diagnostic",
  ]);
  assert.ok(sql.every((s) => !/^(INSERT|UPDATE|DELETE)\b/i.test(s)), "read-only");
  assert.deepEqual(result.data.items.map((item) => item.claimId), [claimId(1), failingClaim, claimId(3)]);
  assert.deepEqual(result.data.items[1].result.error.code, "system_error", "the failing claim alone is a system error");
  // The other claims are evaluated as the single read evaluates them (here, nothing exists: the same not-ok answer).
  const single = await createPostgresClaimTraceabilityRepository({ runInTransaction: async (work) => work(tx) })
    .getOrganizationInternalDraftDiagnostic({ organizationId: ORG, claimId: claimId(1), requestedAudience: "internal" });
  assert.deepEqual(result.data.items[0].result, single);

  const { DIAGNOSTICS_BATCH_MAX_CLAIMS } = __claimTraceabilityRepositoryContract;
  assert.equal(DIAGNOSTICS_BATCH_MAX_CLAIMS, 25, "one claim library page");
  const never = createPostgresClaimTraceabilityRepository({ runInTransaction: async () => assert.fail("refused input opens no transaction") });
  for (const input of [
    { organizationId: ORG, claimIds: Array.from({ length: 26 }, (_, i) => claimId(i + 1)), requestedAudience: "internal" },
    { organizationId: ORG, claimIds: [claimId(1), claimId(1)], requestedAudience: "internal" },
    { organizationId: ORG, claimIds: [claimId(1)], requestedAudience: "funder" },
    { organizationId: ORG, claimIds: [claimId(1)], requestedAudience: "internal", extra: true },
  ]) {
    const refused = await never.getOrganizationInternalDraftDiagnostics(input);
    assert.equal(refused.error.code, "validation_blocker");
  }
});
