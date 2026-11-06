import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { listClaimLibraryReviewCandidates } from "../Backend/kai/db/kaiClaimLibraryReadModels.js";
import { listOrganizationEvidenceItems } from "../Backend/kai/db/kaiEvidenceLibraryReadModels.js";
import { listScopedSourcesForOrganization } from "../Backend/kai/db/kaiIntakeQueries.js";
import { listOrganizationEvidenceLibrary } from "../Backend/kai/services/kaiEvidenceLibraryService.js";
import { listClaimLibraryCandidates } from "../Backend/kai/services/kaiClaimLibraryService.js";
import { listOrganizationSources } from "../Backend/kai/services/kaiSourceLibraryService.js";
import { claimLibraryCandidatesPath, evidenceLibraryCandidatesPath, organizationSourcesPath } from "../frontend/impactEvidenceLibraryLogic.js";
import sprint2IntakeApiRouter, { __testables as intakeRouteTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";
import { requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";
import { requireKaiSprint2Authenticated } from "../Backend/kai/middleware/kaiSprint2Authentication.js";
import { handleKaiSprint2JsonParserError, kaiSprint2MetadataJsonParser, setKaiSprint2NoStore } from "../Backend/kai/middleware/kaiSprint2RequestSafety.js";
import { STORED_ORGANIZATION_MEMBERSHIP_SOURCE } from "../Backend/kai/auth/kaiOrganizationMembershipSource.js";
import { omitDirectIdentifiersForExternalUse } from "../Backend/kai/validators/kaiDocumentEvidenceValidators.js";
import { makeStoryEvidenceFixture } from "./fixtures/kai-story-evidence-memory.js";
import { evaluateClaimTraceabilityInTransaction } from "../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js";
import { createPostgresGeneratedContentRepository } from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";

// Owner direction 2026-11-06. Synthetic only: no database, network or
// provider. The SQL is inspected (no local PostgreSQL is used here); the
// services, routes and the generation repository are the production code.

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const PROJECT_A = "71000000-0000-4000-8000-00000000000a";
const PROJECT_B = "71000000-0000-4000-8000-00000000000b";
const ENV = { KAI_SPRINT2_ENABLED: "true" };
const ADMIN = { actorType: "human", actorUserId: "72000000-0000-4000-8000-000000000001", organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_admin", source: STORED_ORGANIZATION_MEMBERSHIP_SOURCE }] };

function capturingDb() {
  const calls = [];
  return { calls, async query(sql, params) { calls.push({ sql: sql.replace(/\s+/g, " "), params }); return { rows: [] }; } };
}

function assertScopedBeforeLimit(sql, engagementParam) {
  const where = sql.indexOf(" WHERE ");
  const scope = sql.indexOf("scope_f.engagement_id = " + engagementParam + "::uuid");
  const reuse = sql.indexOf("scope_gr.engagement_id = " + engagementParam + "::uuid");
  const limit = sql.lastIndexOf(" LIMIT ");
  assert.ok(where > 0 && scope > where && reuse > where, "scope predicate is in the WHERE clause");
  assert.ok(scope < limit && reuse < limit, "filtered before LIMIT, so the page and truncation describe the Project scope");
  assert.match(sql, /EXISTS \( SELECT 1 FROM kai\.source_versions scope_sv JOIN kai\.intake_source_candidates scope_ic/);
  assert.match(sql, /JOIN kai\.intake_files scope_f ON scope_f\.organization_id = scope_ic\.organization_id AND scope_f\.intake_file_id = scope_ic\.intake_file_id/);
  assert.match(sql, /EXISTS \( SELECT 1 FROM kai\.generated_content_citations scope_gc JOIN kai\.generated_content_blocks scope_gb/);
}

test("10 read models: the Project working view filters with EXISTS before LIMIT; without a Project the organization library read is byte-for-byte unchanged", async () => {
  for (const [label, read, cursorKey] of [
    ["evidence", listOrganizationEvidenceItems, "afterEvidenceItemId"],
    ["claims", listClaimLibraryReviewCandidates, "afterClaimId"],
  ]) {
    const org = capturingDb();
    await read(ORG, { limit: 25 }, org);
    assert.deepEqual(org.calls[0].params, [ORG, 26], label);
    assert.doesNotMatch(org.calls[0].sql, /scope_|engagement_id/, `${label}: organization-wide read`);

    const scoped = capturingDb();
    await read(ORG, { limit: 25, engagementId: PROJECT_A }, scoped);
    assert.deepEqual(scoped.calls[0].params, [ORG, 26, PROJECT_A], label);
    assertScopedBeforeLimit(scoped.calls[0].sql, "$3");

    const paged = capturingDb();
    await read(ORG, { limit: 25, [cursorKey]: "6d000000-0000-4000-8000-000000000001", engagementId: PROJECT_B }, paged);
    assert.deepEqual(paged.calls[0].params, [ORG, 26, "6d000000-0000-4000-8000-000000000001", PROJECT_B], label);
    assert.match(paged.calls[0].sql, / > \$3::uuid/);
    assertScopedBeforeLimit(paged.calls[0].sql, "$4");
  }
  // Claims: the scope is a correlated EXISTS, never a join, so a claim (and a
  // multi-source claim's grouped queue rows) is neither duplicated nor dropped.
  const claims = capturingDb();
  await listClaimLibraryReviewCandidates(ORG, { limit: 25, engagementId: PROJECT_A }, claims);
  const fromClause = claims.calls[0].sql.slice(claims.calls[0].sql.indexOf(" FROM kai.claims c"), claims.calls[0].sql.indexOf(" WHERE c.organization_id"));
  assert.doesNotMatch(fromClause, /scope_|intake_files|generation_runs/);
  assert.match(claims.calls[0].sql, /GROUP BY c\.claim_id/);

  const sourcesOrg = capturingDb();
  await listScopedSourcesForOrganization({ organizationId: ORG }, sourcesOrg);
  assert.deepEqual(sourcesOrg.calls[0].params, [ORG, 200]);
  assert.doesNotMatch(sourcesOrg.calls[0].sql, /scope_/);
  const sourcesScoped = capturingDb();
  await listScopedSourcesForOrganization({ organizationId: ORG, engagementId: PROJECT_A }, sourcesScoped);
  assert.deepEqual(sourcesScoped.calls[0].params, [ORG, 200, PROJECT_A]);
  assertScopedBeforeLimit(sourcesScoped.calls[0].sql, "$3");
  assert.match(sourcesScoped.calls[0].sql, /scope_sv\.source_id = s\.source_id/);
});

// A synthetic organization with two Projects. Rows are what the scoped SQL
// selects for each scope; the services decide which scope is asked for.
const EVIDENCE = {
  a1: { evidence_item_id: "6d000000-0000-4000-8000-0000000000a1", project: PROJECT_A },
  b1: { evidence_item_id: "6d000000-0000-4000-8000-0000000000b1", project: PROJECT_B },
  // Project B evidence that an authorized drafting choice reused in Project A.
  b2: { evidence_item_id: "6d000000-0000-4000-8000-0000000000b2", project: PROJECT_B, reusedIn: PROJECT_A },
};
function evidenceRow(item) {
  return { evidence_item_id: item.evidence_item_id, organization_id: ORG, source_id: "5e000000-0000-4000-8000-000000000001", source_version_id: "5f000000-0000-4000-8000-000000000001",
    evidence_type: "source_document_statement", data_class: "source_document_excerpt", sensitivity_level: "unknown", support_strength: "unassessed",
    statement: "Source document statement (line 1, sentence 1): \"Participants attended the weekly sessions.\"", evidence_review_status: "unassessed",
    internal_only: true, public_use_allowed: false, funder_use_allowed: false, review_queue_item_id: null, review_queue_status: null, review_queue_review_status: null,
    review_queue_updated_at: null, evidence_review_decision_outcome: null, evidence_review_decision_head_count: 0 };
}
const inScope = (engagementId) => Object.values(EVIDENCE)
  .filter((item) => !engagementId || item.project === engagementId || item.reusedIn === engagementId)
  .map(evidenceRow);

test("10 two Projects: each working view shows its own evidence plus explicitly reused evidence, without duplication; the organization library shows all; another organization's Project is refused", async () => {
  const asked = [];
  const deps = {
    env: ENV,
    listOrganizationEvidenceItems: async (organizationId, options) => { asked.push(options); return inScope(options.engagementId); },
    getEngagementForOrganization: async ({ organizationId, engagementId }) => ([PROJECT_A, PROJECT_B].includes(engagementId) && organizationId === ORG ? { organization_id: ORG, engagement_id: engagementId } : null),
  };
  const read = (engagementId) => listOrganizationEvidenceLibrary({ organizationId: ORG, limit: 25, actorContext: ADMIN, ...(engagementId ? { engagementId } : {}) }, deps);
  const ids = (result) => result.data.items.map((item) => item.evidenceItemId);

  const library = await read(null);
  assert.equal(library.ok, true, JSON.stringify(library));
  assert.deepEqual(asked.at(-1), { limit: 25, afterEvidenceItemId: null }, "organization library: read-model arguments unchanged");
  assert.deepEqual(ids(library).sort(), Object.values(EVIDENCE).map((item) => item.evidence_item_id).sort());

  const projectA = await read(PROJECT_A);
  assert.deepEqual(asked.at(-1), { limit: 25, afterEvidenceItemId: null, engagementId: PROJECT_A });
  assert.deepEqual(ids(projectA).sort(), [EVIDENCE.a1.evidence_item_id, EVIDENCE.b2.evidence_item_id].sort(), "own evidence plus authorized reuse");
  assert.equal(new Set(ids(projectA)).size, ids(projectA).length, "no duplicates");

  const projectB = await read(PROJECT_B);
  assert.deepEqual(ids(projectB).sort(), [EVIDENCE.b1.evidence_item_id, EVIDENCE.b2.evidence_item_id].sort(), "the reused item is still Project B's own evidence");
  assert.equal(ids(projectB).includes(EVIDENCE.a1.evidence_item_id), false, "unrelated evidence does not appear in another Project");

  const foreign = await read("71000000-0000-4000-8000-0000000000ff");
  assert.equal(foreign.ok, false);
  assert.equal(foreign.error.code, "not_found");
  const crossTenant = await listOrganizationEvidenceLibrary({ organizationId: ORG, limit: 25, actorContext: ADMIN, engagementId: PROJECT_A },
    { ...deps, getEngagementForOrganization: async () => ({ organization_id: OTHER_ORG, engagement_id: PROJECT_A }) });
  assert.equal(crossTenant.ok, false);
  assert.equal(crossTenant.error.code, "tenant_boundary_violation");
  const malformed = await listOrganizationEvidenceLibrary({ organizationId: ORG, limit: 25, actorContext: ADMIN, engagementId: "not-a-uuid" }, deps);
  assert.equal(malformed.error.code, "validation_blocker");

  // Claims and Sources take the same scope through the same check.
  const claimCalls = [];
  const claims = await listClaimLibraryCandidates({ organizationId: ORG, limit: 25, actorContext: ADMIN, engagementId: PROJECT_B },
    { ...deps, listClaimLibraryReviewCandidates: async (organizationId, options) => { claimCalls.push(options); return []; } });
  assert.equal(claims.ok, true, JSON.stringify(claims));
  assert.deepEqual(claimCalls, [{ limit: 25, afterClaimId: null, engagementId: PROJECT_B }]);
  const sourceCalls = [];
  const sources = await listOrganizationSources({ organizationId: ORG, actorContext: ADMIN, engagementId: PROJECT_A },
    { ...deps, listScopedSourcesForOrganization: async (args) => { sourceCalls.push(args); return []; }, listScopedSourceVersionsForSourceIds: async () => [] });
  assert.equal(sources.ok, true, JSON.stringify(sources));
  assert.deepEqual(sourceCalls, [{ organizationId: ORG, engagementId: PROJECT_A }]);
  const orgSources = [];
  await listOrganizationSources({ organizationId: ORG, actorContext: ADMIN }, { ...deps, listScopedSourcesForOrganization: async (args) => { orgSources.push(args); return []; }, listScopedSourceVersionsForSourceIds: async () => [] });
  assert.deepEqual(orgSources, [{ organizationId: ORG }]);
});

test("10 routes and browser paths: engagement_id is optional, forwarded when present, refused when malformed", async (t) => {
  assert.equal(evidenceLibraryCandidatesPath(ORG), `/api/kai/sprint2/intake/admin/organizations/${ORG}/evidence-library/candidates?limit=25`);
  assert.equal(evidenceLibraryCandidatesPath(ORG, null, PROJECT_A), `/api/kai/sprint2/intake/admin/organizations/${ORG}/evidence-library/candidates?limit=25&engagement_id=${PROJECT_A}`);
  assert.equal(claimLibraryCandidatesPath(ORG, "6d000000-0000-4000-8000-000000000001", PROJECT_A),
    `/api/kai/sprint2/intake/admin/organizations/${ORG}/claim-library/candidates?limit=25&after_claim_id=6d000000-0000-4000-8000-000000000001&engagement_id=${PROJECT_A}`);
  assert.equal(organizationSourcesPath(ORG, PROJECT_B), `/api/kai/sprint2/intake/admin/organizations/${ORG}/sources?engagement_id=${PROJECT_B}`);
  assert.equal(organizationSourcesPath(ORG), `/api/kai/sprint2/intake/admin/organizations/${ORG}/sources`);

  const received = [];
  const ok = (data) => ({ ok: true, data, error: null, warnings: [] });
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async listOrganizationEvidenceLibrary(input) { received.push(["evidence", input]); return ok({ items: [], limit: 25, afterEvidenceItemId: null, truncated: false }); },
    async listClaimLibraryCandidates(input) { received.push(["claims", input]); return ok({ items: [], limit: 25, afterClaimId: null, truncated: false, nextAfterClaimId: null }); },
    async listOrganizationSources(input) { received.push(["sources", input]); return ok({ sources: [] }); },
  });
  t.after(restore);
  const original = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  t.after(() => { if (original === undefined) delete process.env.KAI_SPRINT2_ENABLED; else process.env.KAI_SPRINT2_ENABLED = original; });
  const app = express();
  const base = "/api/kai/sprint2/intake";
  app.use(base, setKaiSprint2NoStore, requireKaiSprint2Enabled, kaiSprint2MetadataJsonParser, handleKaiSprint2JsonParserError);
  app.use(base, (req, res, next) => { req.isAuthenticated = () => true; req.user = { id: 46 }; req.kaiSprint2ActorContext = ADMIN; next(); });
  app.use(base, requireKaiSprint2Enabled, requireKaiSprint2Authenticated, sprint2IntakeApiRouter);
  const server = await new Promise((resolve, reject) => { const l = app.listen(0, "127.0.0.1"); l.once("listening", () => resolve(l)); l.once("error", reject); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const get = (path) => new Promise((resolve, reject) => {
    http.request({ hostname: "127.0.0.1", port: server.address().port, path, method: "GET" }, (res) => {
      const chunks = []; res.on("data", (c) => chunks.push(c)); res.on("end", () => resolve({ statusCode: res.statusCode }));
    }).on("error", reject).end();
  });
  assert.equal((await get(evidenceLibraryCandidatesPath(ORG, null, PROJECT_A))).statusCode, 200);
  assert.equal((await get(claimLibraryCandidatesPath(ORG, null, PROJECT_B))).statusCode, 200);
  assert.equal((await get(organizationSourcesPath(ORG, PROJECT_A))).statusCode, 200);
  assert.equal((await get(evidenceLibraryCandidatesPath(ORG))).statusCode, 200);
  assert.deepEqual(received.map(([kind, input]) => [kind, input.engagementId ?? null]),
    [["evidence", PROJECT_A], ["claims", PROJECT_B], ["sources", PROJECT_A], ["evidence", null]]);
  for (const path of [`${base}/admin/organizations/${ORG}/evidence-library/candidates?engagement_id=nope`, `${base}/admin/organizations/${ORG}/claim-library/candidates?engagement_id=nope`, `${base}/admin/organizations/${ORG}/sources?engagement_id=nope`]) {
    assert.equal((await get(path)).statusCode, 422, path);
  }
  assert.equal(received.length, 4, "a malformed scope never reaches a service");
});

test("10 browser: Data Sources reads follow the selected Project; the organization library stays reachable for reuse while drafting stays in the Project", async () => {
  const { readFileSync } = await import("node:fs");
  const workflow = readFileSync(new URL("../frontend/knowledgeStudio/ClientEvidenceWorkflow.jsx", import.meta.url), "utf8");
  assert.match(workflow, /const scope = isRouteUuid\(engagementId\) && !includeOrganizationLibrary \? engagementId : "";/);
  assert.match(workflow, /data-client-include-organization-library=""/);
  assert.match(workflow, /setIncludeOrganizationLibrary\(false\); \}, \[organizationId, engagementId\]\);/, "the choice resets per Project");
  assert.match(workflow, /internalDraftRequestBody\(\{ claimIds: selectedClaimIds, idempotencyKey, engagementId \}\)/, "drafts stay bound to the selected Project");
});

test("11 external privacy: direct identifiers are generalized and the rest of the finding is kept", () => {
  const cases = [
    ["Youth participant Maria Lopez told staff the weekly sessions helped her feel more confident about finding work.",
      "Youth participant [name omitted] told staff the weekly sessions helped her feel more confident about finding work."],
    ["Daniel Okafor, 14, said the mentoring sessions were the best part of his week; 12 of 15 youth attended every session.",
      "[name and age omitted] said the mentoring sessions were the best part of his week; 12 of 15 youth attended every session."],
    ["Families can reach the coordinator at coordinator@example.org or 555-123-4567 to book a session.",
      "Families can reach the coordinator at [contact detail omitted] or [contact detail omitted] to book a session."],
    ["Client ID 123-456-789 completed all eight sessions.", "Client ID [identifier omitted] completed all eight sessions."],
  ];
  for (const [input, expected] of cases) assert.equal(omitDirectIdentifiersForExternalUse(input), expected);
  const plain = "Numeric outcome field_6 (column F): 25 of 38 comparable participant pairs (65.79%) have a numerically higher follow-up value.";
  assert.equal(omitDirectIdentifiersForExternalUse(plain), plain, "measurements and unrelated findings are unchanged");
});

test("11 external privacy through generation: a funder draft never receives or contains the participant's name; the internal draft and stored claim keep authorized detail", async () => {
  const excerpt = "Youth participant Maria Lopez told staff the weekly sessions helped her feel more confident about finding work.";
  const fixture = makeStoryEvidenceFixture({ kind: "document", excerpt });
  // The funder audience still requires current eligibility (unchanged). This
  // synthetic evaluator stands for an already-approved claim so the test can
  // observe the external composition; it does not change P2-06.
  const evaluator = async (tx, input) => {
    const result = await evaluateClaimTraceabilityInTransaction(tx, input);
    return result.ok ? { ...result, data: { ...result.data, eligible: true, blockerCodes: [] } } : result;
  };
  const drafts = [];
  const tx = { async query(raw, params = []) {
    const sql = raw.replace(/\s+/g, " ").trim();
    if (sql.startsWith("INSERT INTO kai.generation_runs")) return { rows: [{ generation_run_id: "73000000-0000-4000-8000-000000000001" }] };
    if (sql.startsWith("INSERT INTO kai.generated_content_drafts")) { drafts.push({ blocks: [] }); return { rows: [{ generated_content_draft_id: "73000000-0000-4000-8000-000000000002" }] }; }
    if (sql.startsWith("INSERT INTO kai.generated_content_blocks")) { drafts.at(-1).blocks.push(params[3]); return { rows: [{ generated_content_block_id: "73000000-0000-4000-8000-000000000003" }] }; }
    if (sql.startsWith("INSERT INTO kai.")) return { rows: [{ review_queue_item_id: "73000000-0000-4000-8000-000000000004" }] };
    if (sql.includes("JOIN kai.claim_evidence_links")) return { rows: [{ claim_id: fixture.claimId, intake_sensitivity_profile_id: fixture.profileId, evidence_type: fixture.evidenceItemRow.evidence_type }] };
    if (sql.includes("c.statement AS claim_statement")) return { rows: [{ claim_id: fixture.claimId, claim_statement: fixture.claimRow.statement, claim_type: "finding", evidence_item_id: fixture.evidenceItemId,
      evidence_type: fixture.evidenceItemRow.evidence_type, internal_only: true, funder_use_allowed: true, public_use_allowed: false, source_id: fixture.sourceId, source_version_id: fixture.sourceVersionId,
      intake_file_id: fixture.candidateRow.intake_file_id, upload_state: "confirmed" }] };
    if (sql.includes("FROM kai.intake_sensitivity_profiles") && Array.isArray(params[1])) return { rows: [fixture.profileRow] };
    if (sql.includes("FROM kai.intake_sensitivity_review_decisions") && Array.isArray(params[1])) return { rows: [fixture.head] };
    return fixture.tx.query(raw, params);
  } };
  const seen = [];
  const repository = createPostgresGeneratedContentRepository({ runInTransaction: async (callback) => callback(tx), evaluator });
  const generate = (requestedAudience, idempotencyKey) => repository.createEvidenceSummaryDraft(
    { organizationId: ORG, engagementId: PROJECT_A, requestedAudience, claimIds: [fixture.claimId], idempotencyKey, actorContext: ADMIN, now: "2026-11-06T12:00:00.000Z" },
    { draftGenerator: async (input) => {
      seen.push(input.claims[0].claimStatement);
      return { blocks: [{ ordinal: 1, text: input.claims[0].claimStatement, citations: [{ claimId: input.claims[0].claimId, evidenceItemId: input.claims[0].evidenceItemId }] }] };
    }, metadataOnlyAudit: { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) } },
  ).catch((error) => ({ thrown: error }));
  await generate("funder", "external-privacy-funder");
  await generate("internal", "external-privacy-internal");
  assert.equal(seen.length, 2, JSON.stringify(seen));
  assert.doesNotMatch(seen[0], /Maria|Lopez/, "the model never receives the name for external content");
  assert.match(seen[0], /Youth participant \[name omitted\] told staff the weekly sessions helped her feel more confident about finding work/);
  assert.match(seen[0], /\(line 3\)/, "the source locator stays with the generalized finding");
  assert.ok(drafts[0].blocks.every((text) => !/Maria|Lopez/.test(text)), "the persisted external draft omits it");
  assert.match(seen[1], /Maria Lopez/, "internal drafting keeps authorized detail");
  assert.match(fixture.claimRow.statement, /Maria Lopez/, "the stored claim (and source record) is not modified");
});
