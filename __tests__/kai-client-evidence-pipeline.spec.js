import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";

import { KAI_SPRINT2_P0_OPERATION_ROLES } from "../Backend/kai/config/kaiSprint2P0Contract.js";
import {
  getClientEvidencePipeline,
  __clientEvidencePipelineServiceContract as contract,
} from "../Backend/kai/services/kaiClientEvidencePipelineService.js";
import { __clientImpactFactsServiceContract } from "../Backend/kai/services/kaiClientImpactFactsService.js";
import { __testables as routeTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";
import sprint2IntakeApiRouter from "../Backend/kai/routes/sprint2IntakeApi.js";
import {
  PIPELINE_NEXT_ACTIONS,
  PIPELINE_REASONS,
  PIPELINE_REQUEST_STATUS,
  PIPELINE_STAGE_LABELS,
  clientEvidencePipelinePath,
  evidenceTabView,
  nextActionText,
  pipelineReasonMessage,
  projectClientEvidencePipeline,
  readClientEvidencePipeline,
  reviewsTabView,
  stageStatusLabel,
} from "../frontend/knowledgeStudio/clientEvidencePipelineLogic.js";

/**
 * Client-safe Project evidence pipeline. The real service, stage derivation,
 * authorization, and tenant validation run; only the two lowest-level reads
 * (engagement row, file lineage rows) and the governed impact-facts read are
 * injected. The real-PostgreSQL lineage SQL is proven by the client
 * Knowledge Studio browser acceptance runner.
 */

const ENV = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });
const ORG = "11111111-2222-4333-8444-555555555555";
const OTHER_ORG = "99999999-8888-4777-8666-555555555555";
const ENGAGEMENT = "22222222-3333-4444-8555-666666666666";
const OTHER_ENGAGEMENT = "22222222-3333-4444-8555-777777777777";
const fileId = (n) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const claimId = (n) => `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function memberActor(roleName, { organizationId = ORG, kaiRoles = [] } = {}) {
  return {
    actorType: "human",
    actorUserId: `user-${roleName}`,
    kaiRoles,
    platformSuperuser: false,
    organizationMemberships: [{ organization_id: organizationId, role_name: roleName, membership_status: "active" }],
  };
}

// A lineage row, all upstream stages complete through the given point.
function row(n, overrides = {}) {
  return {
    intake_file_id: fileId(n),
    safe_filename: `file-${n}.csv`,
    upload_state: "confirmed",
    file_policy_status: "passed",
    created_at: new Date("2026-09-01T00:00:00Z"),
    parser_status: "completed",
    parser_error_code: null,
    file_profile_complete: true,
    data_dictionary_complete: true,
    sensitivity_profile_complete: true,
    sensitivity_decision_outcome: null,
    source_candidate_count: 0,
    source_candidate_needs_review_count: 0,
    source_candidate_promoted_count: 0,
    source_candidate_rejected_count: 0,
    source_version_count: 0,
    evidence_item_count: 0,
    evidence_needs_review_count: 0,
    evidence_reviewed_count: 0,
    claim_count: 0,
    claim_needs_review_count: 0,
    claim_ids: [],
    open_client_followup_count: 0,
    // Hidden internal values the read model never selects; if a projection
    // leaked row fields, these would surface.
    intake_sensitivity_profile_id: "sensitivity-profile-secret",
    error_message_safe: "PARSER MESSAGE SECRET",
    ...overrides,
  };
}

const promoted = { sensitivity_decision_outcome: "reviewed", source_candidate_count: 1, source_candidate_promoted_count: 1, source_version_count: 1 };
const extracted = { ...promoted, evidence_item_count: 3, evidence_needs_review_count: 3 };
const reviewed = { ...promoted, evidence_item_count: 3, evidence_reviewed_count: 3 };

function dependencies({ rows = [], facts = [], factsResult = null, engagement = { engagement_id: ENGAGEMENT, organization_id: ORG }, calls = [] } = {}) {
  return {
    env: ENV,
    getClientEvidencePipelineEngagement: async (organizationId, engagementId) => {
      calls.push(["engagement", organizationId, engagementId]);
      return engagement;
    },
    listClientEvidencePipelineFiles: async (organizationId, engagementId, options) => {
      calls.push(["files", organizationId, engagementId, options]);
      return rows;
    },
    listClientImpactFacts: async (input) => {
      calls.push(["facts", input.organizationId]);
      return factsResult || { ok: true, data: { items: facts, truncated: false } };
    },
  };
}

const fact = (n, statement = `Reviewed fact ${n}`) => ({ claimId: claimId(n), statement, claimType: "outcome", limitationDimensionKeys: [] });

async function read(rows, options = {}) {
  const calls = [];
  const result = await getClientEvidencePipeline(
    { organizationId: ORG, engagementId: ENGAGEMENT, actorContext: options.actor || memberActor("client_admin") },
    dependencies({ rows, calls, ...options }),
  );
  return { result, calls };
}

function currentOf(result, n) {
  const file = result.data.files.find((entry) => entry.intakeFileId === fileId(n));
  return { stage: file.currentStage, status: file.currentStatus, responsible: file.responsibleParty, next: file.nextAction, reason: file.reason, file };
}

// ---------------------------------------------------------------------------
// Contract and authorization
// ---------------------------------------------------------------------------

test("contract: admits exactly the read_intake set (unchanged); impact-facts admission unchanged", () => {
  assert.deepEqual([...contract.CLIENT_EVIDENCE_PIPELINE_ALLOWED_ROLES].sort(), [...KAI_SPRINT2_P0_OPERATION_ROLES.read_intake].sort());
  assert.deepEqual([...KAI_SPRINT2_P0_OPERATION_ROLES.read_intake].sort(), [
    "client_admin", "client_contributor", "client_reviewer", "gk_admin", "gk_operator", "gk_reviewer",
  ]);
  assert.deepEqual([...__clientImpactFactsServiceContract.CLIENT_IMPACT_FACTS_ALLOWED_ROLES].sort(), [...KAI_SPRINT2_P0_OPERATION_ROLES.read_intake].sort());
  // Frontend and service vocabularies agree.
  assert.deepEqual([...contract.PIPELINE_STAGES], Object.keys(PIPELINE_STAGE_LABELS));
  assert.deepEqual([...contract.PIPELINE_REASONS], [...PIPELINE_REASONS]);
  assert.deepEqual(Object.values(contract.NEXT_ACTION).sort(), [...PIPELINE_NEXT_ACTIONS].sort());
});

test("authorization: every client role reads its own organization; other orgs, non-members, and non-humans are refused before any read", async () => {
  for (const role of ["client_admin", "client_reviewer", "client_contributor"]) {
    const { result } = await read([row(1)], { actor: memberActor(role) });
    assert.equal(result.ok, true, `${role}: ${JSON.stringify(result)}`);
  }
  for (const actor of [
    memberActor("client_admin", { organizationId: OTHER_ORG }),
    memberActor("unknown_role"),
    { ...memberActor("client_admin"), actorType: "system" },
    { ...memberActor("client_admin"), actorType: "ai" },
  ]) {
    const { result, calls } = await read([row(1)], { actor });
    assert.equal(result.ok, false);
    assert.ok(["authorization_denied", "tenant_boundary_violation"].includes(result.error.code), result.error.code);
    assert.deepEqual(calls, [], "no read before admission");
  }
  const disabled = await getClientEvidencePipeline(
    { organizationId: ORG, engagementId: ENGAGEMENT, actorContext: memberActor("client_admin") },
    { ...dependencies(), env: {} },
  );
  assert.equal(disabled.error.code, "feature_disabled");
  for (const input of [
    { organizationId: ORG, engagementId: "not-a-uuid", actorContext: memberActor("client_admin") },
    { organizationId: ORG, engagementId: "ABCDEF00-3333-4444-8555-666666666666", actorContext: memberActor("client_admin") },
    { organizationId: ORG, engagementId: ENGAGEMENT, actorContext: memberActor("client_admin"), intakeFileId: fileId(1) },
  ]) {
    assert.equal((await getClientEvidencePipeline(input, dependencies())).error.code, "validation_blocker");
  }
});

test("scope: an engagement of another organization is not_found and no file is read; reads are keyed to organization + engagement", async () => {
  const foreign = await read([row(1)], { engagement: null });
  assert.equal(foreign.result.error.code, "not_found");
  assert.deepEqual(foreign.calls.map((c) => c[0]), ["engagement"]);
  const mismatched = await read([row(1)], { engagement: { engagement_id: OTHER_ENGAGEMENT, organization_id: ORG } });
  assert.equal(mismatched.result.error.code, "not_found");
  const crossOrg = await read([row(1)], { engagement: { engagement_id: ENGAGEMENT, organization_id: OTHER_ORG } });
  assert.equal(crossOrg.result.error.code, "not_found");
  const { calls } = await read([row(1)]);
  assert.deepEqual(calls[0], ["engagement", ORG, ENGAGEMENT]);
  assert.deepEqual(calls[1], ["files", ORG, ENGAGEMENT, { limit: contract.CLIENT_EVIDENCE_PIPELINE_FILE_LIMIT + 1 }]);
});

// ---------------------------------------------------------------------------
// Stage derivation (actual persisted statuses)
// ---------------------------------------------------------------------------

test("stages: automatic processing, failures, and every human gate map to the responsible party and next permitted action", async () => {
  const { result } = await read([
    row(1, { upload_state: "uploaded_unconfirmed" }),
    row(2, { upload_state: "expired" }),
    row(3, { file_policy_status: "blocked" }),
    row(4, { file_policy_status: null }),
    row(5, { parser_status: null, file_profile_complete: false }),
    row(6, { parser_status: "running", file_profile_complete: false }),
    row(7, { parser_status: "failed", parser_error_code: "safe_parser_error", file_profile_complete: false }),
    row(8, { parser_status: "failed", parser_error_code: "something_internal", file_profile_complete: false }),
    row(9, { data_dictionary_complete: false, sensitivity_profile_complete: false }),
    row(10),
    row(11, { sensitivity_decision_outcome: "needs_more_information" }),
    row(12, { sensitivity_decision_outcome: "reviewed" }),
    row(13, { sensitivity_decision_outcome: "reviewed", source_candidate_count: 1, source_candidate_needs_review_count: 1 }),
    row(14, { sensitivity_decision_outcome: "reviewed", source_candidate_count: 1, source_candidate_rejected_count: 1 }),
    row(15, promoted),
    row(16, extracted),
    row(17, { ...reviewed }),
    row(18, { ...reviewed, claim_count: 1, claim_needs_review_count: 1, claim_ids: [claimId(18)] }),
    row(19, { ...reviewed, claim_count: 1, claim_ids: [claimId(19)], open_client_followup_count: 2 }),
    row(20, { ...reviewed, claim_count: 1, claim_ids: [claimId(20)] }),
    row(21, { ...reviewed, claim_count: 2, claim_ids: [claimId(21), claimId(22)] }),
    row(23, { ...reviewed, claim_count: 2, claim_ids: [claimId(23), claimId(24)], open_client_followup_count: 1 }),
  ], { facts: [fact(21), fact(23)] });
  assert.equal(result.ok, true, JSON.stringify(result));
  const expected = {
    1: ["upload", "in_progress", "client", "none", "processing"],
    2: ["upload", "failed", "client", "upload_new_file", "failed"],
    3: ["security_check", "failed", "client", "upload_new_file", "failed"],
    4: ["security_check", "in_progress", "kai", "none_waiting_for_kai_processing", "processing"],
    5: ["processing", "not_started", "kai", "none_waiting_for_kai_processing", "processing"],
    6: ["processing", "in_progress", "kai", "none_waiting_for_kai_processing", "processing"],
    7: ["processing", "failed", "get_kinder", "contact_get_kinder", "failed"],
    8: ["processing", "failed", "get_kinder", "contact_get_kinder", "failed"],
    9: ["data_dictionary", "in_progress", "kai", "none_waiting_for_kai_processing", "processing"],
    10: ["sensitivity_review", "waiting_for_get_kinder", "get_kinder", "none_waiting_for_get_kinder", "waiting_for_get_kinder_review"],
    11: ["sensitivity_review", "waiting_for_get_kinder", "get_kinder", "none_waiting_for_get_kinder", "waiting_for_get_kinder_review"],
    12: ["source_review", "waiting_for_get_kinder", "get_kinder", "none_waiting_for_get_kinder", "waiting_for_source_promotion"],
    13: ["source_review", "waiting_for_get_kinder", "get_kinder", "none_waiting_for_get_kinder", "waiting_for_source_promotion"],
    14: ["source_review", "closed", "none", "none", "source_not_promoted"],
    15: ["evidence_extraction", "waiting_for_get_kinder", "get_kinder", "none_waiting_for_get_kinder", "evidence_extraction_pending"],
    16: ["evidence_review", "waiting_for_get_kinder", "get_kinder", "none_waiting_for_get_kinder", "evidence_awaiting_review"],
    17: ["impact_fact_review", "waiting_for_get_kinder", "get_kinder", "none_waiting_for_get_kinder", "impact_fact_review_pending"],
    18: ["impact_fact_review", "waiting_for_get_kinder", "get_kinder", "none_waiting_for_get_kinder", "impact_fact_review_pending"],
    19: ["impact_fact_review", "waiting_for_client", "client", "answer_client_followups", "waiting_for_client"],
    20: ["impact_fact_review", "not_currently_eligible", "get_kinder", "none_waiting_for_get_kinder", "not_currently_eligible"],
    21: [null, "complete", "none", "none", "complete"],
    // Open client follow-ups outrank an already-usable sibling claim.
    23: ["impact_fact_review", "waiting_for_client", "client", "answer_client_followups", "waiting_for_client"],
  };
  for (const [n, [stage, status, responsible, next, reason]] of Object.entries(expected)) {
    assert.deepEqual(Object.values(currentOf(result, Number(n))).slice(0, 5), [stage, status, responsible, next, reason], `file ${n}`);
  }
  assert.equal(currentOf(result, 7).file.failureCategory, "file_could_not_be_read");
  assert.equal(currentOf(result, 8).file.failureCategory, "processing_failed", "unknown parser codes are reduced to the generic category");
  assert.equal(currentOf(result, 2).file.failureCategory, "upload_not_completed");
  // Every file lists all ten stages; stages after the blocking one are not_started.
  for (const file of result.data.files) assert.deepEqual(file.stages.map((s) => s.key), [...contract.PIPELINE_STAGES]);
  assert.deepEqual(currentOf(result, 10).file.stages.slice(6).map((s) => s.status), ["not_started", "not_started", "not_started", "not_started"]);
  assert.equal(currentOf(result, 21).file.reviewedImpactFactCount, 1);
  assert.equal(currentOf(result, 23).file.reviewedImpactFactCount, 1);
  // Summary reasons are counted in the canonical order.
  assert.deepEqual(result.data.summary.reasons.map((r) => r.reason), PIPELINE_REASONS.filter((r) => result.data.summary.reasons.some((x) => x.reason === r)));
  assert.equal(result.data.summary.reasons.find((r) => r.reason === "failed").fileCount, 4);
});

// ---------------------------------------------------------------------------
// Reviewed Impact Facts: governed read only, Project lineage only, fail closed
// ---------------------------------------------------------------------------

test("facts: only governed-eligible facts in this Project's lineage are returned; other org facts never appear", async () => {
  const { result, calls } = await read(
    [row(1, { ...reviewed, claim_count: 2, claim_ids: [claimId(1), claimId(2)] })],
    { facts: [fact(1), fact(99, "OTHER PROJECT FACT")] },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.reviewedImpactFacts, [fact(1)]);
  assert.equal(result.data.summary.reviewedImpactFactCount, 1);
  assert.ok(!JSON.stringify(result).includes("OTHER PROJECT FACT"));
  assert.ok(!JSON.stringify(result).includes(claimId(2)), "a claim that is not governed-eligible is never named");
  assert.deepEqual(calls.find((c) => c[0] === "facts"), ["facts", ORG]);
});

test("facts: the governed read is not called without a claim; its failure fails the read closed, never zero", async () => {
  const noClaims = await read([row(1, extracted)]);
  assert.equal(noClaims.calls.some((c) => c[0] === "facts"), false);
  assert.deepEqual(noClaims.result.data.reviewedImpactFacts, []);
  const failed = await read([row(1, { ...reviewed, claim_count: 1, claim_ids: [claimId(1)] })], {
    factsResult: { ok: false, error: { code: "system_error" } },
  });
  assert.equal(failed.result.ok, false);
  assert.equal(failed.result.error.code, "system_error");
  const malformed = await read([row(1, { ...reviewed, claim_count: 1, claim_ids: [claimId(1)] })], { factsResult: { ok: true, data: {} } });
  assert.equal(malformed.result.ok, false);
  const badCount = await read([row(1, { evidence_item_count: -1, ...promoted })]);
  assert.equal(badCount.result.error.code, "system_error");
});

test("payload: exact client keys; no GK-only, raw, or internal field reaches the client", async () => {
  const { result } = await read([row(1, { ...reviewed, claim_count: 1, claim_ids: [claimId(1)], parser_error_code: "x" })], { facts: [fact(1)] });
  assert.deepEqual(Object.keys(result.data).sort(), ["engagementId", "files", "reviewedImpactFacts", "reviewedImpactFactsTruncated", "summary", "truncated"]);
  assert.deepEqual(Object.keys(result.data.files[0]).sort(), [
    "currentStage", "currentStatus", "evidenceItemCount", "failureCategory", "intakeFileId", "nextAction", "reason",
    "responsibleParty", "reviewedImpactFactCount", "safeFilename", "stages", "uploadedAt",
  ]);
  for (const s of result.data.files[0].stages) {
    for (const key of Object.keys(s)) assert.ok(["key", "status", "responsible", "count", "failureCategory"].includes(key), key);
  }
  const serialized = JSON.stringify(result);
  for (const hidden of [
    "sensitivity-profile-secret", "PARSER MESSAGE SECRET", "intake_sensitivity_profile_id", "decision_outcome", "reviewed_",
    "source_version", "evidence_item_id", "queue", "claim_ids", "error_message", "decided_by", "notes",
  ]) {
    assert.ok(!serialized.includes(hidden), `leaked ${hidden}`);
  }
});

test("empty and truncated: zero files is a successful empty read; more than the limit is marked truncated", async () => {
  const empty = await read([]);
  assert.equal(empty.result.ok, true);
  assert.deepEqual(empty.result.data.files, []);
  assert.deepEqual(empty.result.data.summary, { fileCount: 0, reasons: [], reviewedImpactFactCount: 0 });
  const many = Array.from({ length: contract.CLIENT_EVIDENCE_PIPELINE_FILE_LIMIT + 1 }, (_, i) => row(i + 1));
  const truncated = await read(many);
  assert.equal(truncated.result.data.truncated, true);
  assert.equal(truncated.result.data.files.length, contract.CLIENT_EVIDENCE_PIPELINE_FILE_LIMIT);
});

// ---------------------------------------------------------------------------
// Mounted route
// ---------------------------------------------------------------------------

test("route: forwards only the two path ids and the resolved actor; malformed ids are rejected before the service", async () => {
  const actorContext = memberActor("client_contributor");
  const received = [];
  const restoreService = routeTestables.setIntakeServiceForTest({
    getClientEvidencePipeline: async (input) => {
      received.push(input);
      return { ok: true, data: { engagementId: ENGAGEMENT, files: [] } };
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
    req.user = { id: 601 };
    next();
  });
  app.use("/api/kai/sprint2/intake", sprint2IntakeApiRouter);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  try {
    const { port } = server.address();
    const url = (org, eng, query = "") => `http://127.0.0.1:${port}/api/kai/sprint2/intake/admin/organizations/${org}/engagements/${eng}/client-evidence-pipeline${query}`;
    assert.equal(url(ORG, ENGAGEMENT).endsWith(clientEvidencePipelinePath(ORG, ENGAGEMENT)), true);
    assert.equal((await fetch(url(ORG, ENGAGEMENT, `?organization_id=${OTHER_ORG}&engagement_id=${OTHER_ENGAGEMENT}`))).status, 200);
    assert.deepEqual(received, [{ organizationId: ORG, engagementId: ENGAGEMENT, actorContext }]);
    assert.equal((await fetch(url("not-a-uuid", ENGAGEMENT))).status, 422);
    assert.equal((await fetch(url(ORG, "ABCDEF00-3333-4444-8555-666666666666"))).status, 422);
    assert.equal(received.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restoreActor();
    restoreService();
    process.env.KAI_SPRINT2_ENABLED = originalFlag;
  }
});

// ---------------------------------------------------------------------------
// Frontend logic
// ---------------------------------------------------------------------------

async function serviceDto(rows, facts = []) {
  const { result } = await read(rows, { facts });
  return result.data;
}

test("frontend read: explicit request states; an HTTP error, a malformed body, or another Project's body is an error, never zero", async () => {
  const empty = await serviceDto([]);
  const withData = await serviceDto([row(1)]);
  const ok = (data) => async () => ({ statusCode: 200, body: { ok: true, data } });
  assert.equal((await readClientEvidencePipeline(ok(empty), ORG, ENGAGEMENT)).status, PIPELINE_REQUEST_STATUS.SUCCESS_EMPTY);
  assert.equal((await readClientEvidencePipeline(ok(withData), ORG, ENGAGEMENT)).status, PIPELINE_REQUEST_STATUS.SUCCESS_WITH_DATA);
  for (const getJsonFn of [
    async () => ({ statusCode: 500, body: { ok: false } }),
    async () => ({ statusCode: 403, body: { ok: false } }),
    ok({ engagementId: ENGAGEMENT }),
    ok({ ...withData, engagementId: OTHER_ENGAGEMENT }),
    ok({ ...withData, files: [{ ...withData.files[0], stages: [] }] }),
    async () => { throw new Error("offline"); },
  ]) {
    const result = await readClientEvidencePipeline(getJsonFn, ORG, ENGAGEMENT);
    assert.equal(result.status, PIPELINE_REQUEST_STATUS.ERROR);
    assert.equal(result.data, null);
  }
  const paths = [];
  await readClientEvidencePipeline(async (path) => { paths.push(path); return { statusCode: 200, body: { ok: true, data: empty } }; }, ORG, ENGAGEMENT);
  assert.deepEqual(paths, [`/api/kai/sprint2/intake/admin/organizations/${ORG}/engagements/${ENGAGEMENT}/client-evidence-pipeline`]);
});

test("frontend Evidence tab: distinguishes loading, error, no files, each upstream reason, and reviewed evidence", async () => {
  assert.deepEqual(evidenceTabView({ status: PIPELINE_REQUEST_STATUS.NOT_STARTED }), { kind: "loading" });
  assert.deepEqual(evidenceTabView({ status: PIPELINE_REQUEST_STATUS.LOADING }), { kind: "loading" });
  assert.deepEqual(evidenceTabView({ status: PIPELINE_REQUEST_STATUS.ERROR, data: null }), { kind: "error" });
  const state = (dto) => ({ status: PIPELINE_REQUEST_STATUS.SUCCESS_WITH_DATA, data: projectClientEvidencePipeline(dto, ENGAGEMENT) });
  assert.deepEqual(evidenceTabView({ status: PIPELINE_REQUEST_STATUS.SUCCESS_EMPTY, data: projectClientEvidencePipeline(await serviceDto([]), ENGAGEMENT) }), { kind: "no_files" });

  const cases = [
    [row(1, { parser_status: "running", file_profile_complete: false }), "processing", /still being processed/],
    [row(1, { parser_status: "failed", file_profile_complete: false }), "failed", /could not be processed/],
    [row(1, { ...reviewed, claim_count: 1, claim_ids: [claimId(1)], open_client_followup_count: 1 }), "waiting_for_client", /client reviewer/],
    [row(1), "waiting_for_get_kinder_review", /^Your data has been processed and is waiting for Get Kinder review/],
    [row(1, { sensitivity_decision_outcome: "reviewed" }), "waiting_for_source_promotion", /promoted source/],
    [row(1, promoted), "evidence_extraction_pending", /has been promoted\. Get Kinder has not yet created evidence/],
    [row(1, extracted), "evidence_awaiting_review", /waiting for Get Kinder evidence review/],
    [row(1, { ...reviewed, claim_count: 1, claim_ids: [claimId(1)] }), "not_currently_eligible", /not currently usable/],
    [row(1, { sensitivity_decision_outcome: "reviewed", source_candidate_count: 1, source_candidate_rejected_count: 1 }), "source_not_promoted", /not promoted as a source/],
  ];
  for (const [lineage, reason, message] of cases) {
    const view = evidenceTabView(state(await serviceDto([lineage])));
    assert.equal(view.kind, "explained_empty", reason);
    assert.deepEqual(view.upstream, [{ reason, fileCount: 1 }]);
    assert.match(pipelineReasonMessage(reason, 1), message);
  }
  const factsView = evidenceTabView(state(await serviceDto([
    row(1, { ...reviewed, claim_count: 1, claim_ids: [claimId(1)] }),
    row(2),
  ], [fact(1)])));
  assert.equal(factsView.kind, "facts");
  assert.deepEqual(factsView.facts.map((f) => f.claimId), [claimId(1)]);
  assert.deepEqual(factsView.upstream, [{ reason: "waiting_for_get_kinder_review", fileCount: 1 }]);
});

test("frontend Reviews tab and next actions: client work only for client reviewers; GK gates shown as waiting, never as controls", async () => {
  const data = projectClientEvidencePipeline(await serviceDto([
    row(1, { ...reviewed, claim_count: 1, claim_ids: [claimId(1)], open_client_followup_count: 1 }),
    row(2),
    row(3, { parser_status: "failed", file_profile_complete: false }),
  ]), ENGAGEMENT);
  const view = reviewsTabView({ status: PIPELINE_REQUEST_STATUS.SUCCESS_WITH_DATA, data });
  assert.deepEqual(view.waitingForClient.map((f) => f.intakeFileId), [fileId(1)]);
  assert.deepEqual(view.waitingForGetKinder.map((f) => f.intakeFileId), [fileId(2)], "a failure is not listed as waiting for review");
  assert.deepEqual(reviewsTabView({ status: PIPELINE_REQUEST_STATUS.ERROR }), { kind: "error" });
  const [followup, gk, failed] = data.files;
  assert.match(nextActionText(followup, { canReviewFollowups: true }), /^Answer the follow-up questions/);
  assert.match(nextActionText(followup, { canReviewFollowups: false }), /^A client reviewer in your organization needs to answer/);
  assert.equal(nextActionText(gk), "No action required from you. Waiting for Get Kinder sensitivity review.");
  assert.equal(nextActionText(failed), "Contact Get Kinder. Processing cannot be retried from here.");
  assert.equal(stageStatusLabel(gk.stages[5]), "Waiting for Get Kinder");
  assert.equal(stageStatusLabel(gk.stages[6]), "Not available yet");
});

// ---------------------------------------------------------------------------
// Frontend source contract
// ---------------------------------------------------------------------------

const studioSource = readFileSync("frontend/knowledgeStudio/ClientKnowledgeStudio.jsx", "utf8");
const hookSource = readFileSync("frontend/knowledgeStudio/useClientEvidencePipeline.js", "utf8");
const statusSource = readFileSync("frontend/knowledgeStudio/ClientEvidencePipelineStatus.jsx", "utf8");
const logicSource = readFileSync("frontend/knowledgeStudio/clientEvidencePipelineLogic.js", "utf8");

test("frontend source: one pipeline request, keyed to organization + Project, with late responses discarded", () => {
  assert.equal((hookSource.match(/readClientEvidencePipeline\(getJson, organizationId, engagementId\)/g) || []).length, 1);
  assert.match(hookSource, /const key = organizationId && engagementId \? `\$\{organizationId\}:\$\{engagementId\}` : "";/);
  assert.match(hookSource, /if \(requestSeqRef\.current !== requestSeq\) return;/);
  assert.match(hookSource, /return state\.key === key \? state : \{ status: PIPELINE_REQUEST_STATUS\.LOADING, data: null, error: null \};/);
  assert.match(hookSource, /\}, \[key, organizationId, engagementId, refreshToken\]\);/);
  assert.match(studioSource, /const pipeline = useClientEvidencePipeline\(organizationId, engagementId, pipelineRefresh\);/);
  for (const source of [studioSource, statusSource]) assert.doesNotMatch(source, /getJson\(|postJson\(|fetch\(/);
  for (const source of [studioSource, statusSource, hookSource, logicSource]) {
    for (const builder of ["evidenceLibraryCandidatesPath", "claimLibraryCandidatesPath", "organizationReviewQueuePath", "organizationSourcesPath",
      "sensitivityReviewQueuePath", "reviewCockpit", "claimTraceabilityPath", "eligibleClaimsPath", "clientFollowupsPath", "postJson"]) {
      assert.doesNotMatch(source, new RegExp(`\\b${builder}\\b`), builder);
    }
  }
});

test("frontend source: Files shows the status card; Evidence uses the Project pipeline when a Project is selected; Reviews shows client work", () => {
  assert.match(studioSource, /\{tab === "files" && organizationId \? \(\s*<ClientEvidencePipelineStatus\s+request=\{pipeline\}/);
  assert.match(studioSource, /\{tab === "evidence" && engagementId \? \(\s*<ProjectEvidence\s+view=\{evidenceTabView\(pipeline\)\}/);
  assert.match(studioSource, /\{tab === "evidence" && !engagementId \? \(/);
  assert.match(studioSource, /<ProjectReviews view=\{engagementId \? reviewsTabView\(pipeline\) : null\} canReviewFollowups=\{canReviewFollowups\} \/>/);
  assert.match(statusSource, /Processing &amp; evidence status/);
  assert.match(statusSource, /file\.nextAction === "answer_client_followups" && canReviewFollowups \?/);
  // The org-wide zero message is reachable only without a selected Project.
  const projectEvidence = studioSource.slice(studioSource.indexOf("function ProjectEvidence"));
  assert.doesNotMatch(projectEvidence.slice(0, projectEvidence.indexOf("function ProjectReviews")), /No reviewed evidence yet for this organization/);
  assert.match(studioSource, /This does not mean the project has no evidence\./);
});
