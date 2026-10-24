import test from "node:test";
import assert from "node:assert/strict";

import { STORED_ORGANIZATION_MEMBERSHIP_SOURCE } from "../Backend/kai/auth/kaiOrganizationMembershipSource.js";
import {
  canRecordOrganizationFactualReview,
  recordClaimReviewDecision,
  recordEvidenceReviewDecision,
} from "../Backend/kai/services/kaiHumanReviewService.js";
import {
  acceptFunderCoverageLimitation,
  acceptInternalCoverageLimitation,
  acceptPublicCoverageLimitation,
} from "../Backend/kai/services/kaiCoverageReviewDecisionService.js";
import { __coverageReviewDecisionRepositoryTestables, createPostgresCoverageReviewDecisionRepository } from "../Backend/kai/dictionary/postgresCoverageReviewDecisionRepository.js";
import { getOrganizationFactualReview } from "../Backend/kai/services/kaiOrganizationFactualReviewService.js";
import { getOrganizationAccessCapabilities } from "../Backend/kai/services/kaiOrganizationAccessCapabilitiesService.js";
import {
  ORGANIZATION_ACCEPTABLE_LIMITATION_DIMENSION_KEYS,
  isConfirmedMeasurement,
  organizationFactualReviewRefusal,
} from "../Backend/kai/dictionary/postgresOrganizationFactualReviewRepository.js";
import {
  measuredClaimReviewFailureMessage,
  measuredClaimReviewPlan,
  measuredClaimReviewRequest,
  organizationFactualReviewPath,
  projectOrganizationFactualReview,
} from "../frontend/knowledgeStudio/clientMeasuredClaimReviewLogic.js";

/**
 * Organization factual review (owner authorization 2026-10-24, Operating
 * Model v0.2 section 11 exception): an active, verified client_admin records
 * the evidence review, the internal claim review, and the internal coverage
 * acceptance of an ordinary measurement as itself. GK authorization is
 * checked first and unchanged; every other client role, an unverified or
 * inactive administrator, and another organization are refused before any
 * repository; funder and public stay Get Kinder's. The per-claim admission
 * and the database scope are proven on PostgreSQL by the normal-chain and
 * assembled runners.
 */
const ENV = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });
const ORG_X = "11111111-2222-4333-8444-555555555555";
const ORG_Y = "99999999-8888-4777-8666-555555555555";
const EVIDENCE = "3c000000-0000-4000-8000-000000000001";
const CLAIM = "3d000000-0000-4000-8000-000000000001";
const QUEUE = "3e000000-0000-4000-8000-000000000001";
const NOW = "2026-10-24T12:00:00.000Z";
const noAudit = () => ({ prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } });

function actor(memberships, kaiRoles = []) {
  return { actorType: "human", actorUserId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", kaiRoles, platformSuperuser: false, organizationMemberships: memberships };
}
const membership = (roleName, extra = {}) => ({ organization_id: ORG_X, role_name: roleName, membership_status: "active", ...extra });
const ADMIN = actor([membership("client_admin", { source: STORED_ORGANIZATION_MEMBERSHIP_SOURCE })]);
const GK_REVIEWER = actor([membership("gk_reviewer")], ["gk_reviewer"]);

function probe() {
  const calls = [];
  const record = async (input) => { calls.push(input); return { ok: true, data: { probe: true }, error: null }; };
  return {
    calls,
    repository: {
      recordEvidenceReviewDecision: record,
      recordClaimReviewDecision: record,
      acceptInternalCoverageLimitation: record,
      acceptFunderCoverageLimitation: record,
      acceptPublicCoverageLimitation: record,
    },
  };
}

const evidenceInput = (actorContext, organizationId = ORG_X) => ({
  organizationId, evidenceItemId: EVIDENCE, reviewQueueItemId: QUEUE, expectedUpdatedAt: NOW, decision: "supported", actorContext, now: NOW,
});
const claimInput = (actorContext, approvedAudiences = ["internal"], decision = "approved") => ({
  organizationId: ORG_X, claimId: CLAIM, reviewQueueItemId: QUEUE, expectedUpdatedAt: NOW, decision,
  ...(decision === "approved" ? { approvedAudiences } : {}), actorContext, now: NOW,
});
const coverageInput = (actorContext, dimensionKey = "small_cell_risk") => ({ organizationId: ORG_X, claimId: CLAIM, dimensionKey, actorContext, now: NOW });

test("an active, verified organization administrator's evidence and claim decisions reach the ledgers as client_admin, each with its in-transaction admission", async () => {
  const p = probe();
  const evidence = await recordEvidenceReviewDecision(evidenceInput(ADMIN), { env: ENV, humanReviewRepository: p.repository, metadataOnlyAudit: noAudit() });
  const claim = await recordClaimReviewDecision(claimInput(ADMIN), { env: ENV, humanReviewRepository: p.repository, metadataOnlyAudit: noAudit() });
  const rejected = await recordClaimReviewDecision(claimInput(ADMIN, null, "rejected"), { env: ENV, humanReviewRepository: p.repository, metadataOnlyAudit: noAudit() });
  assert.deepEqual([evidence.ok, claim.ok, rejected.ok], [true, true, true]);
  assert.deepEqual(p.calls.map((input) => [input.actorRole, input.actorUserId, typeof input.reviewAdmission]), [
    ["client_admin", ADMIN.actorUserId, "function"],
    ["client_admin", ADMIN.actorUserId, "function"],
    ["client_admin", ADMIN.actorUserId, "function"],
  ]);
  assert.deepEqual(p.calls[1].approvedAudiences, ["internal"]);
});

test("GK authorization is checked first and unchanged: a GK reviewer is recorded as gk_reviewer with no organization admission, even when also an organization administrator", async () => {
  for (const actorContext of [GK_REVIEWER, actor([membership("gk_reviewer"), membership("client_admin", { source: STORED_ORGANIZATION_MEMBERSHIP_SOURCE })], ["gk_reviewer"])]) {
    const p = probe();
    await recordEvidenceReviewDecision(evidenceInput(actorContext), { env: ENV, humanReviewRepository: p.repository, metadataOnlyAudit: noAudit() });
    await recordClaimReviewDecision(claimInput(actorContext, ["internal", "funder"]), { env: ENV, humanReviewRepository: p.repository, metadataOnlyAudit: noAudit() });
    assert.deepEqual(p.calls.map((input) => [input.actorRole, input.reviewAdmission]), [["gk_reviewer", undefined], ["gk_reviewer", undefined]]);
    assert.equal(canRecordOrganizationFactualReview({ actorContext, organizationId: ORG_X }), false, "a GK-authorized actor's decisions are GK's");
  }
});

test("the organization administrator approves no funder or public audience: refused before any repository", async () => {
  for (const audiences of [["internal", "funder"], ["funder"], ["public"], ["internal", "public"], ["internal", "internal"]]) {
    const p = probe();
    const result = await recordClaimReviewDecision(claimInput(ADMIN, audiences), { env: ENV, humanReviewRepository: p.repository, metadataOnlyAudit: noAudit() });
    assert.equal(result.ok, false, audiences.join(","));
    assert.deepEqual(p.calls, [], audiences.join(","));
  }
  const p = probe();
  const funder = await recordClaimReviewDecision(claimInput(ADMIN, ["internal", "funder"]), { env: ENV, humanReviewRepository: p.repository, metadataOnlyAudit: noAudit() });
  assert.deepEqual([funder.error.code, funder.blockers.map((b) => b.blocking_reason)], ["authorization_denied", ["audience_requires_get_kinder_review"]]);
});

test("other client roles, an unverified or inactive administrator, another organization, and non-human actors never reach a ledger", async () => {
  const refused = {
    client_contributor: actor([membership("client_contributor")]),
    client_reviewer: actor([membership("client_reviewer")]),
    "client_admin without verified provenance": actor([membership("client_admin")]),
    "inactive client_admin": actor([membership("client_admin", { source: STORED_ORGANIZATION_MEMBERSHIP_SOURCE, membership_status: "inactive" })]),
    "global client_admin role only": actor([membership("client_contributor")], ["client_admin"]),
    "gk_operator": actor([membership("gk_operator")], ["gk_operator"]),
    "assistant": { ...ADMIN, actorType: "assistant" },
  };
  for (const [label, actorContext] of Object.entries(refused)) {
    const p = probe();
    const results = [
      await recordEvidenceReviewDecision(evidenceInput(actorContext), { env: ENV, humanReviewRepository: p.repository, metadataOnlyAudit: noAudit() }),
      await recordClaimReviewDecision(claimInput(actorContext), { env: ENV, humanReviewRepository: p.repository, metadataOnlyAudit: noAudit() }),
      await acceptInternalCoverageLimitation(coverageInput(actorContext), { env: ENV, coverageReviewDecisionRepository: p.repository, metadataOnlyAudit: noAudit() }),
      await getOrganizationFactualReview({ organizationId: ORG_X, claimId: CLAIM, actorContext }, { env: ENV, organizationFactualReviewRepository: { async getOrganizationFactualReview() { p.calls.push("read"); return { ok: true, data: {} }; } } }),
    ];
    for (const result of results) assert.equal(result.ok, false, label);
    assert.deepEqual(p.calls, [], label);
    assert.equal(canRecordOrganizationFactualReview({ actorContext, organizationId: ORG_X }), false, label);
  }
  const p = probe();
  const other = await recordEvidenceReviewDecision(evidenceInput(ADMIN, ORG_Y), { env: ENV, humanReviewRepository: p.repository, metadataOnlyAudit: noAudit() });
  assert.equal(other.error.code, "authorization_denied");
  assert.deepEqual(p.calls, []);
});

test("coverage: the administrator's internal acceptance reaches the ledger as client_admin with its admission; funder and public acceptance stay gk_reviewer only", async () => {
  const p = probe();
  assert.equal((await acceptInternalCoverageLimitation(coverageInput(ADMIN), { env: ENV, coverageReviewDecisionRepository: p.repository, metadataOnlyAudit: noAudit() })).ok, true);
  assert.deepEqual(p.calls.map((input) => [input.actorRole, typeof input.acceptanceAdmission]), [["client_admin", "function"]]);
  for (const accept of [acceptFunderCoverageLimitation, acceptPublicCoverageLimitation]) {
    const q = probe();
    const result = await accept(coverageInput(ADMIN), { env: ENV, coverageReviewDecisionRepository: q.repository, metadataOnlyAudit: noAudit() });
    assert.equal(result.error.code, "authorization_denied", accept.name);
    assert.deepEqual(q.calls, [], accept.name);
  }
  const gk = probe();
  await acceptInternalCoverageLimitation(coverageInput(GK_REVIEWER), { env: ENV, coverageReviewDecisionRepository: gk.repository, metadataOnlyAudit: noAudit() });
  assert.deepEqual(gk.calls.map((input) => [input.actorRole, input.acceptanceAdmission]), [["gk_reviewer", undefined]]);
  const gkAdmin = probe();
  const refused = await acceptInternalCoverageLimitation(coverageInput(actor([membership("gk_admin")], ["gk_admin"])), { env: ENV, coverageReviewDecisionRepository: gkAdmin.repository, metadataOnlyAudit: noAudit() });
  assert.equal(refused.ok, false, "P2-10 is unchanged: gk_admin still may not accept");
  assert.deepEqual(gkAdmin.calls, []);
});

test("coverage repository: client_admin only ever with an admission and only for the internal decision; gk_reviewer never with one", async () => {
  const { isAcceptInternalCoverageLimitationInput } = __coverageReviewDecisionRepositoryTestables;
  const base = { organizationId: ORG_X, claimId: CLAIM, dimensionKey: "small_cell_risk", actorUserId: ADMIN.actorUserId, now: NOW, metadataOnlyAudit: noAudit() };
  const admission = async () => null;
  assert.equal(isAcceptInternalCoverageLimitationInput({ ...base, actorRole: "gk_reviewer" }), true);
  assert.equal(isAcceptInternalCoverageLimitationInput({ ...base, actorRole: "client_admin", acceptanceAdmission: admission }), true);
  assert.equal(isAcceptInternalCoverageLimitationInput({ ...base, actorRole: "client_admin" }), false);
  assert.equal(isAcceptInternalCoverageLimitationInput({ ...base, actorRole: "gk_reviewer", acceptanceAdmission: admission }), false);
  assert.equal(isAcceptInternalCoverageLimitationInput({ ...base, actorRole: "gk_admin", acceptanceAdmission: admission }), false);
  const repository = createPostgresCoverageReviewDecisionRepository({ runInTransaction: async () => assert.fail("no transaction") });
  for (const method of ["acceptFunderCoverageLimitation", "acceptPublicCoverageLimitation"]) {
    const result = await repository[method]({ ...base, actorRole: "client_admin", acceptanceAdmission: admission });
    assert.equal(result.error.code, "validation_blocker", method);
  }
});

test("capabilities: reviewMeasuredClaimFactualContent is the organization path exactly; the GK review flags stay GK's", async () => {
  const flags = async (actorContext) => (await getOrganizationAccessCapabilities({ organizationId: ORG_X, actorContext }, { env: ENV })).data?.workflowOperations;
  const admin = await flags(ADMIN);
  assert.deepEqual([admin.reviewMeasuredClaimFactualContent, admin.recordEvidenceReview, admin.recordClaimReview, admin.acceptCoverageLimitation], [true, false, false, false]);
  const gk = await flags(GK_REVIEWER);
  assert.deepEqual([gk.reviewMeasuredClaimFactualContent, gk.recordEvidenceReview, gk.recordClaimReview, gk.acceptCoverageLimitation], [false, true, true, true]);
  assert.equal((await flags(actor([membership("client_reviewer")]))).reviewMeasuredClaimFactualContent, false);
});

test("pure scope helpers: the three supportable dimensions, a confirmed measurement of the same version, and a refusal that writes nothing", () => {
  assert.deepEqual([...ORGANIZATION_ACCEPTABLE_LIMITATION_DIMENSION_KEYS], ["small_cell_risk", "conflicting_source_indicators", "requirement_alignment"]);
  const evidence = { source_version_id: "v1" };
  const row = { measurement_type: "source_record_count", definition_status: "human_confirmed", source_version_id: "v1", definition_source_version_id: "v1" };
  assert.equal(isConfirmedMeasurement(row, evidence), true);
  assert.equal(isConfirmedMeasurement(null, evidence), false);
  assert.equal(isConfirmedMeasurement({ ...row, definition_source_version_id: "v0" }, evidence), false);
  assert.equal(isConfirmedMeasurement({ ...row, definition_status: "draft" }, evidence), false);
  const refusal = organizationFactualReviewRefusal({ getKinderReviewReasons: ["minor_information_not_cleared"], blockedReasons: ["source_version_not_current"] });
  assert.deepEqual([refusal.ok, refusal.error, refusal.blockers.map((b) => b.blocking_reason)],
    [false, { code: "blocked", status: 422 }, ["minor_information_not_cleared", "source_version_not_current"]]);
});

// ---------------------------------------------------------------------------
// Customer review panel logic
// ---------------------------------------------------------------------------

function reviewDto(overrides = {}) {
  return {
    claim_id: CLAIM,
    evidence_item_id: EVIDENCE,
    claim_statement: "The source records 5 programme sessions.",
    source: { source_code: "sessions", is_current: true },
    measurement: { measured_value: 5, unit_label: "programme sessions" },
    limitations: [{ code: "measurement.blank_records_excluded", description: "Blank records were excluded from the count." }],
    evidence_review: { review_queue_item_id: QUEUE, expected_updated_at: NOW, decision_outcome: null, decided_by: null, organization_may_decide: true, get_kinder_review_reasons: [], blocked_reasons: [] },
    claim_review: { review_queue_item_id: "3e000000-0000-4000-8000-000000000002", expected_updated_at: NOW, decision_outcome: null, decided_by: null, organization_may_decide: true, get_kinder_review_reasons: [], blocked_reasons: [] },
    coverage_limitations: [
      { dimension_key: "small_cell_risk", assessment_status: "unresolved", internal_limitation_accepted: false, organization_acceptable: true, organization_may_accept: false },
      { dimension_key: "missingness", assessment_status: "resolved_risk_flagged", internal_limitation_accepted: false, organization_acceptable: false, organization_may_accept: false },
      { dimension_key: "requirement_alignment", assessment_status: "unresolved", internal_limitation_accepted: false, organization_acceptable: false, organization_may_accept: false },
    ],
    internal_eligibility: { eligible: false, blocker_codes: ["evidence_review_unresolved"] },
    ...overrides,
  };
}

test("panel plan: a supported judgment records the evidence review, the internal claim review, then only the acceptable limitations", () => {
  const review = projectOrganizationFactualReview(reviewDto());
  assert.deepEqual(measuredClaimReviewPlan(review, "supported"), [
    { kind: "evidence", decision: "supported" },
    { kind: "claim", decision: "approved", approvedAudiences: ["internal"] },
    { kind: "coverage", dimensionKey: "small_cell_risk" },
  ]);
  assert.deepEqual(measuredClaimReviewPlan(review, "not_supported"), [{ kind: "evidence", decision: "not_supported" }, { kind: "claim", decision: "rejected" }]);
  assert.deepEqual(measuredClaimReviewPlan(review, "needs_more_information"), [{ kind: "evidence", decision: "needs_more_information" }]);
  const [evidence, claim, coverage] = measuredClaimReviewPlan(review, "supported").map((step) => measuredClaimReviewRequest(ORG_X, review, step));
  assert.match(evidence.path, /\/evidence-items\/3c000000-0000-4000-8000-000000000001\/evidence-review\/3e000000-0000-4000-8000-000000000001\/complete$/);
  assert.deepEqual(evidence.body, { expected_updated_at: NOW, decision: "supported" });
  assert.deepEqual(claim.body, { expected_updated_at: NOW, decision: "approved", approved_audiences: ["internal"] });
  assert.match(coverage.path, /\/coverage-dimensions\/small_cell_risk\/internal-acceptance$/);
  assert.equal(organizationFactualReviewPath(ORG_X, CLAIM), `/api/kai/sprint2/intake/admin/organizations/${ORG_X}/claims/${CLAIM}/organization-factual-review`);
});

test("panel plan: nothing the server does not admit is offered, and decisions already recorded are not repeated", () => {
  const gkDecided = projectOrganizationFactualReview(reviewDto({
    evidence_review: { ...reviewDto().evidence_review, decision_outcome: "supported", decided_by: "get_kinder", organization_may_decide: false, get_kinder_review_reasons: ["get_kinder_decision_recorded"] },
  }));
  assert.deepEqual(measuredClaimReviewPlan(gkDecided, "supported"), [
    { kind: "claim", decision: "approved", approvedAudiences: ["internal"] },
    { kind: "coverage", dimensionKey: "small_cell_risk" },
  ], "the organization's claim judgment on Get Kinder's supported evidence");
  assert.deepEqual(measuredClaimReviewPlan(gkDecided, "needs_more_information"), []);
  const sensitive = projectOrganizationFactualReview(reviewDto({
    evidence_review: { ...reviewDto().evidence_review, organization_may_decide: false, get_kinder_review_reasons: ["minor_information_not_cleared"] },
    claim_review: { ...reviewDto().claim_review, organization_may_decide: false, get_kinder_review_reasons: ["minor_information_not_cleared"] },
    coverage_limitations: [],
  }));
  for (const judgment of ["supported", "not_supported", "needs_more_information"]) assert.deepEqual(measuredClaimReviewPlan(sensitive, judgment), [], judgment);
  const done = projectOrganizationFactualReview(reviewDto({
    evidence_review: { ...reviewDto().evidence_review, decision_outcome: "supported", decided_by: "organization" },
    claim_review: { ...reviewDto().claim_review, decision_outcome: "approved", decided_by: "organization" },
    coverage_limitations: [{ dimension_key: "small_cell_risk", assessment_status: "unresolved", internal_limitation_accepted: true, organization_acceptable: false, organization_may_accept: false }],
  }));
  assert.deepEqual(measuredClaimReviewPlan(done, "supported"), []);
  const needsInfo = projectOrganizationFactualReview(reviewDto({ evidence_review: { ...reviewDto().evidence_review, decision_outcome: "needs_more_information", decided_by: "organization" } }));
  assert.deepEqual(measuredClaimReviewPlan(needsInfo, "not_supported"), [{ kind: "evidence", decision: "not_supported" }, { kind: "claim", decision: "rejected" }]);
});

test("panel failure messages name the server's reason and the step that was not recorded", () => {
  const message = measuredClaimReviewFailureMessage({ kind: "claim", decision: "approved" },
    { statusCode: 422, body: { ok: false, error: { code: "blocked", message: "x" }, blockers: [{ blocking_reason: "get_kinder_decision_recorded" }] } });
  assert.equal(message, "Claim review: approved for internal use only was not recorded. Get Kinder has already recorded this decision; only Get Kinder can change it.");
  assert.match(measuredClaimReviewFailureMessage({ kind: "coverage", dimensionKey: "small_cell_risk" }, { statusCode: 409, body: { ok: false, error: { message: "Changed." } } }),
    /Small-number \(small-cell\) risk was not recorded\. Changed\./);
});
