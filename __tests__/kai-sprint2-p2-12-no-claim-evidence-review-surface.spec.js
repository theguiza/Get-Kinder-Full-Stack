import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  listOrganizationEvidenceLibrary,
  __testables as evidenceLibraryTestables,
} from "../Backend/kai/services/kaiEvidenceLibraryService.js";
import { recordEvidenceReviewDecision, canRecordEvidenceReviewDecision } from "../Backend/kai/services/kaiHumanReviewService.js";
import {
  projectEvidenceLibraryItems,
  projectEvidenceLibraryCapabilities,
  canCompleteEvidenceLibraryReview,
  evidenceLibraryReviewRequest,
  evidenceReviewCompletePath,
} from "../frontend/impactEvidenceLibraryLogic.js";

/**
 * KAI P2-12 no-claim evidence review: the GK Knowledge Studio Evidence tab
 * (Evidence Library read) exposes each evidence item's own evidence_review
 * queue item so a GK reviewer can record the existing P2-12 decision without
 * a claim. The real-PostgreSQL proof is
 * kai-sprint2-p2-12-no-claim-evidence-review.integration.spec.js.
 */

const ORG = "00000000-0000-4000-8000-00000000000a";
const EVIDENCE = "10000000-0000-4000-8000-000000000001";
const QUEUE = "40000000-0000-4000-8000-000000000001";
const ENV = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });
const NOW = "2026-09-26T12:00:00.000Z";
const TOKEN = "2026-09-26T11:59:00.123Z";

const reader = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  kaiRoles: ["gk_reviewer"],
  organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
});

function evidenceRow(overrides = {}) {
  return {
    evidence_item_id: EVIDENCE,
    organization_id: ORG,
    source_id: "20000000-0000-4000-8000-000000000001",
    source_version_id: "30000000-0000-4000-8000-000000000001",
    evidence_type: "dictionary_field_presence_fact",
    data_class: "organization_committed_metadata",
    sensitivity_level: "unknown",
    support_strength: "unassessed",
    statement: "Field households_served is present.",
    evidence_review_status: "needs_gk_review",
    internal_only: true,
    public_use_allowed: false,
    funder_use_allowed: false,
    review_queue_item_id: QUEUE,
    review_queue_status: "open",
    review_queue_review_status: "needs_gk_review",
    review_queue_updated_at: new Date(TOKEN),
    evidence_review_decision_outcome: null,
    evidence_review_decision_head_count: 0,
    ...overrides,
  };
}

async function listWith(rows, actorContext = reader) {
  return listOrganizationEvidenceLibrary(
    { organizationId: ORG, limit: 25, actorContext },
    { env: ENV, listOrganizationEvidenceItems: async () => rows },
  );
}

test("DTO: a no-claim evidence item carries its evidence_review queue identity, status pair, concurrency token, and current outcome only", async () => {
  const result = await listWith([evidenceRow()]);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.data.items[0].evidenceReview, {
    reviewQueueItemId: QUEUE,
    queueStatus: "open",
    reviewStatus: "needs_gk_review",
    expectedUpdatedAt: TOKEN,
    currentDecisionOutcome: null,
  });
  assert.equal(result.data.items[0].sensitivityLevel, "unknown");
});

test("DTO: evidence with no queue item has evidenceReview null; rows from before this change (no queue columns) still project", async () => {
  const withoutQueue = await listWith([evidenceRow({
    review_queue_item_id: null, review_queue_status: null, review_queue_review_status: null, review_queue_updated_at: null,
  })]);
  assert.equal(withoutQueue.ok, true);
  assert.equal(withoutQueue.data.items[0].evidenceReview, null);
  const legacyShape = evidenceRow();
  for (const key of ["sensitivity_level", "review_queue_item_id", "review_queue_status", "review_queue_review_status", "review_queue_updated_at", "evidence_review_decision_outcome", "evidence_review_decision_head_count"]) {
    delete legacyShape[key];
  }
  const legacy = await listWith([legacyShape]);
  assert.equal(legacy.ok, true);
  assert.equal(legacy.data.items[0].evidenceReview, null);
});

test("DTO fails closed on a malformed queue projection", async () => {
  for (const overrides of [
    { review_queue_item_id: "not-a-uuid" },
    { review_queue_updated_at: null },
    { review_queue_updated_at: "yesterday" },
    { review_queue_status: "Open Now" },
    { evidence_review_decision_outcome: "Supported!" },
    { review_queue_item_id: null, review_queue_updated_at: null, evidence_review_decision_outcome: "supported", evidence_review_decision_head_count: 1 },
  ]) {
    const result = await listWith([evidenceRow(overrides)]);
    assert.equal(result.ok, false, JSON.stringify(overrides));
    assert.equal(result.error.code, "system_error");
  }
});

test("read model: joins only the P2-01 evidence_review queue row and the decision-lineage head's outcome; never reviewer identity, notes, queue metadata, or claims; read-only", () => {
  const source = readFileSync("Backend/kai/db/kaiEvidenceLibraryReadModels.js", "utf8");
  assert.match(source, /rq\.queue_type = 'evidence_review'/);
  assert.match(source, /rq\.target_object_type = 'evidence_item'/);
  assert.match(source, /rq\.organization_id = ei\.organization_id/);
  assert.match(source, /d\.organization_id = ei\.organization_id/);
  assert.match(source, /SELECT count\(\*\)::int AS head_count,\s*CASE WHEN count\(\*\) = 1 THEN min\(d\.decision_outcome\) END AS decision_outcome/);
  assert.doesNotMatch(source, /LIMIT 1/, "the decision head is never chosen by ordering");
  assert.match(source, /WHERE ei\.organization_id = \$1::uuid/);
  const sql = source.slice(source.indexOf("`SELECT"), source.lastIndexOf("`"));
  assert.doesNotMatch(sql, /decided_by|limitation_notes|queue_metadata|summary|required_action|assigned_to|kai\.claims/);
  assert.doesNotMatch(sql, /\bINSERT\b|\bUPDATE\b|\bDELETE\b|FOR UPDATE/);
  assert.match(evidenceLibraryTestables.responseEvidenceReview.toString(), /currentDecisionOutcome/);
});

const CAPABLE = Object.freeze({ canRecordEvidenceReviewDecision: true });

test("frontend gating mirrors canCompleteEvidenceReview exactly: open/needs_gk_review or a resolved legacy row with no decision head", () => {
  const item = (review) => ({ evidenceItemId: EVIDENCE, evidenceReview: review });
  const review = (overrides = {}) => ({
    reviewQueueItemId: QUEUE, queueStatus: "open", reviewStatus: "needs_gk_review", expectedUpdatedAt: TOKEN, currentDecisionOutcome: null, ...overrides,
  });
  assert.equal(canCompleteEvidenceLibraryReview(item(review()), CAPABLE), true);
  assert.equal(canCompleteEvidenceLibraryReview(item(review({ currentDecisionOutcome: "needs_more_information" })), CAPABLE), true, "reopened item");
  assert.equal(canCompleteEvidenceLibraryReview(item(review({ queueStatus: "resolved", reviewStatus: "resolved" })), CAPABLE), true, "legacy repair");
  for (const outcome of ["supported", "supported_with_limitation", "not_supported"]) {
    assert.equal(canCompleteEvidenceLibraryReview(item(review({ queueStatus: "resolved", reviewStatus: "resolved", currentDecisionOutcome: outcome })), CAPABLE), false, outcome);
  }
  assert.equal(canCompleteEvidenceLibraryReview(item(review({ queueStatus: "in_progress" })), CAPABLE), false);
  assert.equal(canCompleteEvidenceLibraryReview(item(null), CAPABLE), false);
  assert.equal(canCompleteEvidenceLibraryReview(null, CAPABLE), false);
});

test("frontend projection drops malformed write coordinates, so no P2-12 request can be built from them", () => {
  const [kept, dropped, missing] = projectEvidenceLibraryItems({
    items: [
      { evidenceItemId: EVIDENCE, evidenceReview: { reviewQueueItemId: QUEUE, queueStatus: "open", reviewStatus: "needs_gk_review", expectedUpdatedAt: TOKEN, currentDecisionOutcome: null } },
      { evidenceItemId: "10000000-0000-4000-8000-000000000002", evidenceReview: { reviewQueueItemId: "../../x", expectedUpdatedAt: TOKEN } },
      { evidenceItemId: "10000000-0000-4000-8000-000000000003", evidenceReview: { reviewQueueItemId: QUEUE } },
    ],
  });
  assert.equal(kept.evidenceReview.reviewQueueItemId, QUEUE);
  assert.equal(canCompleteEvidenceLibraryReview(kept, CAPABLE), true);
  for (const unsafe of [dropped, missing]) {
    assert.equal(unsafe.evidenceReview.reviewQueueItemId, null);
    assert.equal(unsafe.evidenceReview.expectedUpdatedAt, null);
    assert.equal(canCompleteEvidenceLibraryReview(unsafe, CAPABLE), false);
  }
});

test("frontend request is exactly the existing P2-12 route and body: queue updated_at as expected_updated_at, limitation notes only when required", () => {
  const item = { evidenceItemId: EVIDENCE, evidenceReview: { reviewQueueItemId: QUEUE, expectedUpdatedAt: TOKEN } };
  const supported = evidenceLibraryReviewRequest(ORG, item, { decision: "supported", limitationNotes: "ignored" });
  assert.equal(supported.path, evidenceReviewCompletePath(ORG, EVIDENCE, QUEUE));
  assert.equal(supported.path, `/api/kai/sprint2/intake/admin/organizations/${ORG}/evidence-items/${EVIDENCE}/evidence-review/${QUEUE}/complete`);
  assert.deepEqual(supported.body, { expected_updated_at: TOKEN, decision: "supported" });
  const limited = evidenceLibraryReviewRequest(ORG, item, { decision: "supported_with_limitation", limitationNotes: " first \n\n second " });
  assert.deepEqual(limited.body, { expected_updated_at: TOKEN, decision: "supported_with_limitation", limitation_notes: ["first", "second"] });
  for (const forbidden of ["claim", "audience", "approved", "actor", "role", "organization"]) {
    assert.equal(JSON.stringify(limited.body).includes(forbidden), false, forbidden);
  }
});

test("P2-12 service accepts an evidence decision with no claim input at all, and refuses every non-GK-reviewer actor before any repository call", async () => {
  const calls = [];
  const humanReviewRepository = {
    async recordEvidenceReviewDecision(input) {
      calls.push(input);
      return { ok: true, data: { evidence_item_id: input.evidenceItemId }, error: null };
    },
  };
  const input = (actorContext) => ({
    organizationId: ORG, evidenceItemId: EVIDENCE, reviewQueueItemId: QUEUE, expectedUpdatedAt: TOKEN,
    decision: "supported", actorContext, now: NOW,
  });
  const deps = { env: ENV, humanReviewRepository, metadataOnlyAudit: { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } } };

  const allowed = await recordEvidenceReviewDecision(input(reader), deps);
  assert.equal(allowed.ok, true, JSON.stringify(allowed));
  assert.equal(calls.length, 1);
  assert.equal(Object.keys(calls[0]).some((key) => /claim/i.test(key)), false, "no claim is passed to or required by the repository");
  assert.equal(calls[0].actorRole, "gk_reviewer");

  const membership = (role, status = "active", organizationId = ORG) => [{ organization_id: organizationId, membership_status: status, role_name: role }];
  for (const [label, actorContext] of [
    ["client_admin", { ...reader, kaiRoles: [], organizationMemberships: membership("client_admin") }],
    ["gk_operator", { ...reader, kaiRoles: ["gk_operator"], organizationMemberships: membership("gk_operator") }],
    ["system", { ...reader, actorType: "system" }],
    ["ai", { ...reader, actorType: "ai" }],
    ["assistant", { ...reader, actorType: "assistant" }],
    ["inactive membership", { ...reader, organizationMemberships: membership("gk_reviewer", "inactive") }],
    ["cross-organization", { ...reader, organizationMemberships: membership("gk_reviewer", "active", "00000000-0000-4000-8000-00000000000b") }],
    ["unmapped", { actorType: "human" }],
  ]) {
    const result = await recordEvidenceReviewDecision(input(actorContext), deps);
    assert.equal(result.ok, false, label);
  }
  assert.equal(calls.length, 1, "no refused actor reached the repository");
  const disabled = await recordEvidenceReviewDecision(input(reader), { ...deps, env: {} });
  assert.equal(disabled.error.code, "feature_disabled");
});

const librarySource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");

test("UI: the Evidence tab submits only through evidenceLibraryReviewRequest (the P2-12 route) and re-reads the Evidence Library afterwards", () => {
  const handler = librarySource.slice(
    librarySource.indexOf("const runEvidenceLibraryReview = useCallback"),
    librarySource.indexOf("const runCompleteEvidenceReview = useCallback"),
  );
  assert.match(handler, /canCompleteEvidenceLibraryReview\(item, evidenceLibraryCapabilities\)/);
  assert.match(handler, /evidenceLibraryReviewRequest\(organizationId, item,/);
  assert.match(handler, /await postJson\(request\.path, request\.body\)/);
  assert.match(handler, /if \(organizationIdRef\.current !== requestOrganizationId\) return;/);
  assert.match(handler, /await loadEvidenceItems\(\);/);
  assert.equal((handler.match(/postJson\(/g) || []).length, 1);
  // The claim proposal after a positive decision runs on the server; the
  // browser never calls the P2-03 route or the P2-02 assessment itself.
  assert.doesNotMatch(handler, /claimProposalPath|claim-proposal|evidenceCoverageAssessmentPath|claimReviewComplete|evidence-extraction|approved_audiences/);
  assert.match(librarySource, /\{canCompleteEvidenceLibraryReview\(item, evidenceLibraryCapabilities\) && evidenceReviewTargetId !== item\.evidenceItemId \? \(/);
  assert.match(librarySource, /\{evidenceReviewTargetId === item\.evidenceItemId && evidenceLibraryCapabilities\.canRecordEvidenceReviewDecision \? \(/);
  assert.equal((librarySource.match(/canCompleteEvidenceLibraryReview\(item\)/g) || []).length, 0, "every gate passes the server capability");
  assert.match(librarySource, /setEvidenceLibraryCapabilities\(projectEvidenceLibraryCapabilities\(result\.body\.data\)\);/);
  assert.match(librarySource, /never approves a claim and does not\s*\n\s*make this evidence available to funders or the public/);
});

test("UI: a late Evidence Library response for a previous organization cannot repopulate the current one", () => {
  const loader = librarySource.slice(
    librarySource.indexOf("const loadEvidenceItems = useCallback"),
    librarySource.indexOf("}, [organizationId]);", librarySource.indexOf("const loadEvidenceItems = useCallback")),
  );
  assert.match(loader, /const requestGeneration = \+\+evidenceRequestGenerationRef\.current;/);
  assert.match(loader, /currentOrganizationId: organizationIdRef\.current,/);
  assert.ok(loader.indexOf("shouldApplyCandidateResponse") < loader.indexOf("setLoadingEvidenceItems(false)"));
  assert.match(librarySource, /setEvidenceReviewTargetId\(""\);\s*setEvidenceTabReviewResult\(""\);\s*setEvidenceTabReviewPending\(false\);\s*if \(organizationId\) loadEvidenceItems\(\);/);
});

test("client product surfaces do not reference the GK evidence-review action or data", () => {
  for (const path of [
    "frontend/knowledgeStudio/ClientKnowledgeStudio.jsx",
    "frontend/impactLibrary/ClientImpactLibraryView.jsx",
    "frontend/knowledgeStudio/clientEvidencePipelineLogic.js",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /evidenceLibraryReviewRequest|canCompleteEvidenceLibraryReview|evidenceReviewCompletePath|evidence-review\/|reviewQueueItemId/, path);
  }
});

const membership = (role, status = "active", organizationId = ORG) => [{ organization_id: organizationId, membership_status: status, role_name: role }];
const ACTORS = Object.freeze([
  ["gk_reviewer", reader, true],
  ["gk_admin", { ...reader, kaiRoles: ["gk_admin"], organizationMemberships: membership("gk_admin") }, true],
  ["gk_operator", { ...reader, kaiRoles: ["gk_operator"], organizationMemberships: membership("gk_operator") }, false],
  ["client_admin", { ...reader, kaiRoles: [], organizationMemberships: membership("client_admin") }, false],
  ["system", { ...reader, actorType: "system" }, false],
  ["ai", { ...reader, actorType: "ai" }, false],
  ["assistant", { ...reader, actorType: "assistant" }, false],
  ["inactive membership", { ...reader, organizationMemberships: membership("gk_reviewer", "inactive") }, false],
  ["cross-organization", { ...reader, organizationMemberships: membership("gk_reviewer", "active", "00000000-0000-4000-8000-00000000000b") }, false],
  ["unmapped", { actorType: "human" }, false],
]);

test("capability: canRecordEvidenceReviewDecision agrees with the P2-12 service's own authorization for every actor", async () => {
  for (const [label, actorContext, expected] of ACTORS) {
    assert.equal(canRecordEvidenceReviewDecision({ actorContext, organizationId: ORG }), expected, label);
    let reached = false;
    const result = await recordEvidenceReviewDecision({
      organizationId: ORG, evidenceItemId: EVIDENCE, reviewQueueItemId: QUEUE, expectedUpdatedAt: TOKEN,
      decision: "supported", actorContext, now: NOW,
    }, {
      env: ENV,
      metadataOnlyAudit: { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } },
      humanReviewRepository: { async recordEvidenceReviewDecision() { reached = true; return { ok: true, data: {}, error: null }; } },
    });
    assert.equal(reached, expected, `${label}: P2-12 reaches its repository exactly when the capability is true`);
    assert.equal(result.ok, expected, label);
  }
  assert.equal(canRecordEvidenceReviewDecision({ actorContext: reader, organizationId: "" }), false);
  assert.equal(canRecordEvidenceReviewDecision({}), false);
});

test("least privilege: write coordinates are returned only to actors with P2-12 authority; every GK reader keeps the review posture", async () => {
  for (const [label, actorContext, expected] of ACTORS) {
    const result = await listWith([evidenceRow({ evidence_review_decision_outcome: "needs_more_information", evidence_review_decision_head_count: 1 })], actorContext);
    const readable = ["gk_reviewer", "gk_admin", "gk_operator"].includes(label);
    assert.equal(result.ok, readable, `${label}: Evidence Library read contract unchanged`);
    if (!readable) continue;
    assert.deepEqual(result.data.capabilities, { canRecordEvidenceReviewDecision: expected }, label);
    const review = result.data.items[0].evidenceReview;
    assert.deepEqual(review, expected
      ? { reviewQueueItemId: QUEUE, expectedUpdatedAt: TOKEN, queueStatus: "open", reviewStatus: "needs_gk_review", currentDecisionOutcome: "needs_more_information" }
      : { queueStatus: "open", reviewStatus: "needs_gk_review", currentDecisionOutcome: "needs_more_information" }, label);
    const [projected] = projectEvidenceLibraryItems(result.data);
    assert.equal(
      canCompleteEvidenceLibraryReview(projected, projectEvidenceLibraryCapabilities(result.data)),
      expected,
      `${label}: the Evidence tab offers the decision exactly when the server capability is true`,
    );
  }
  assert.deepEqual(projectEvidenceLibraryCapabilities({}), { canRecordEvidenceReviewDecision: false });
  assert.deepEqual(projectEvidenceLibraryCapabilities({ capabilities: { canRecordEvidenceReviewDecision: "true" } }), { canRecordEvidenceReviewDecision: false });
  const item = { evidenceItemId: EVIDENCE, evidenceReview: { reviewQueueItemId: QUEUE, expectedUpdatedAt: TOKEN, queueStatus: "open", reviewStatus: "needs_gk_review", currentDecisionOutcome: null } };
  assert.equal(canCompleteEvidenceLibraryReview(item, { canRecordEvidenceReviewDecision: false }), false);
  assert.equal(canCompleteEvidenceLibraryReview(item, undefined), false);
});

test("ambiguous decision lineage fails the whole Evidence Library read closed; 0 heads and 1 head stay valid, including the resolved legacy-repair row", async () => {
  for (const overrides of [
    { evidence_review_decision_head_count: 2, evidence_review_decision_outcome: null },
    { evidence_review_decision_head_count: 3, evidence_review_decision_outcome: null },
    { evidence_review_decision_head_count: 1, evidence_review_decision_outcome: null },
    { evidence_review_decision_head_count: 0, evidence_review_decision_outcome: "supported" },
    { evidence_review_decision_head_count: "1", evidence_review_decision_outcome: "supported" },
    { evidence_review_decision_head_count: -1 },
  ]) {
    const result = await listWith([evidenceRow(), evidenceRow({ evidence_item_id: "10000000-0000-4000-8000-000000000009", ...overrides })]);
    assert.equal(result.ok, false, JSON.stringify(overrides));
    assert.equal(result.error.code, "system_error");
    assert.equal(JSON.stringify(result).includes(QUEUE), false, "no write coordinates leak from a failed read");
  }
  const single = await listWith([evidenceRow({ evidence_review_decision_head_count: 1, evidence_review_decision_outcome: "supported", review_queue_status: "resolved", review_queue_review_status: "resolved" })]);
  assert.equal(single.ok, true);
  assert.equal(single.data.items[0].evidenceReview.currentDecisionOutcome, "supported");
  const legacyRepair = await listWith([evidenceRow({ review_queue_status: "resolved", review_queue_review_status: "resolved" })]);
  assert.equal(legacyRepair.ok, true);
  const [projected] = projectEvidenceLibraryItems(legacyRepair.data);
  assert.equal(canCompleteEvidenceLibraryReview(projected, projectEvidenceLibraryCapabilities(legacyRepair.data)), true, "resolved queue + no decision head stays reviewable");
});
