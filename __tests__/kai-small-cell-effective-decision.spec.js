import test from "node:test";
import assert from "node:assert/strict";
import { effectiveSmallCellRiskStatus, findCurrentSensitivityAllowedUseDecisions, AmbiguousSensitivityDecisionLineageError } from "../Backend/kai/dictionary/postgresSensitivityAllowedUseDecisionRepository.js";
import { assessSmallCellRisk } from "../Backend/kai/validators/kaiEvidenceCoverageAssessmentValidators.js";
import { __evidenceCoverageAssessmentRepositoryTestables, createPostgresEvidenceCoverageAssessmentRepository } from "../Backend/kai/dictionary/postgresEvidenceCoverageAssessmentRepository.js";
import { __claimGapFollowupRepositoryTestables } from "../Backend/kai/dictionary/postgresClaimGapFollowupRepository.js";
import { computeCoverageReviewDecisionFingerprint } from "../Backend/kai/validators/kaiCoverageReviewDecisionValidators.js";
import { classifySourceDecision } from "../Backend/kai/dictionary/postgresOrdinaryInternalFactAuthority.js";
import { validateSensitivityReviewedSnapshot } from "../Backend/kai/dictionary/sensitivityAllowedUseDecisionContract.js";

const profile = { organization_id: "org", intake_sensitivity_profile_id: "profile", small_cell_risk_status: "unknown" };
const decision = {
  organization_id: "org", intake_sensitivity_profile_id: "profile", decision_outcome: "reviewed",
  decided_by: "actor", decided_by_role: "gk_reviewer", created_by_type: "human",
  reviewed_personal_data_status: "unknown", reviewed_minor_data_status: "unknown",
  reviewed_health_housing_justice_immigration_status: "unknown", reviewed_indigenous_governance_status: "unknown",
  reviewed_staff_notes_status: "unknown", reviewed_story_testimonial_status: "unknown",
  reviewed_small_cell_risk_status: "absent", reviewed_financial_records_status: "unknown",
  reviewed_consent_basis_status: "unknown", reviewed_allowed_use_status: "unknown",
  reviewed_llm_processing_allowed: false, reviewed_product_learning_allowed: false,
  reviewed_public_use_allowed: false, reviewed_funder_use_allowed: false,
};

test("effective small-cell projection respects a complete scoped decision", () => {
  for (const [original, reviewed, expected] of [
    ["unknown", "absent", "resolved_clear"], ["present", "absent", "resolved_clear"],
    ["absent", "present", "resolved_risk_flagged"], ["unknown", "present", "resolved_risk_flagged"],
    ["absent", "unknown", "unresolved"],
  ]) {
    const status = effectiveSmallCellRiskStatus({ ...profile, small_cell_risk_status: original }, { ...decision, reviewed_small_cell_risk_status: reviewed });
    assert.equal(assessSmallCellRisk({ small_cell_risk_status: status }).evidence.assessment_status, expected);
  }
});

test("actual coverage profile read uses current decision and preserves independent allowed-use prohibition", async () => {
  const org = "00000000-0000-4000-8000-000000000001";
  const id = "00000000-0000-4000-8000-000000000002";
  const original = { ...profile, organization_id: org, intake_sensitivity_profile_id: id, allowed_use_status: "not_allowed" };
  const head = { ...decision, organization_id: org, intake_sensitivity_profile_id: id, decision_id: "head", created_at: new Date() };
  const tx = { async query(sql) {
    if (sql.includes("FROM kai.intake_sensitivity_profiles") && sql.includes("ANY(")) return { rows: [original] };
    if (sql.includes("FROM kai.intake_sensitivity_profiles")) return { rows: [original] };
    if (sql.includes("FROM kai.intake_sensitivity_review_decisions")) return { rows: [head] };
    throw new Error(`Unexpected query ${sql}`);
  } };
  const row = await __evidenceCoverageAssessmentRepositoryTestables.readSensitivityProfileForAssessment({ organizationId: org, intakeSensitivityProfileId: id }, tx);
  assert.equal(row.small_cell_risk_status, "absent");
  assert.equal(row.small_cell_review_decision_id, "head");
  assert.equal(row.effective_allowed_use_prohibition, "intake_allowed_use_not_allowed");
  assert.equal(assessSmallCellRisk(row).evidence.assessment_status, "resolved_clear");
  assert.equal(original.small_cell_risk_status, "unknown");
});

test("direct coverage uses one repeatable snapshot compatible with existing locking reads", async () => {
  const calls = [];
  const tx = { async query(sql) { calls.push(sql); return { rows: [] }; } };
  const repository = createPostgresEvidenceCoverageAssessmentRepository({ runInTransaction: (callback) => callback(tx) });
  const result = await repository.readEvidenceCoverageAssessmentFacts({ organizationId: "org", sourceVersionId: "version" });
  assert.equal(result.ok, true);
  assert.equal(calls[0], "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
  assert.doesNotMatch(calls[0], /READ ONLY/);
});

test("historical small-cell gap is projected without mutating independent gaps and cannot revive acceptance across heads", () => {
  const { projectSmallCellGapRows, gapRowsMatchExpectation } = __claimGapFollowupRepositoryTestables;
  const row = { gap_log_item_id: "gap", evidence_item_id: "evidence", source_version_id: "version", dimension_key: "small_cell_risk",
    assessment_status: "unresolved", validator_key: "VAL-KAI-P2-02-small_cell_risk", safe_summary: "Claim gap requires review for dimension: small_cell_risk.",
    open_finding_count: null, field_count: null, undefined_field_count: null, uncovered_field_count: null };
  const other = { ...row, gap_log_item_id: "other", dimension_key: "missingness" };
  const identity = { evidenceItemId: "evidence", sourceVersionId: "version" };
  const context = { small_cell_review_decision_id: "head-a" };
  assert.deepEqual(projectSmallCellGapRows([row, other], [], context, identity), [other]);
  assert.equal(row.assessment_status, "unresolved");
  const plan = { ...row, assessment_status: "resolved_risk_flagged" };
  const projected = projectSmallCellGapRows([row], [plan], context, identity);
  assert.equal(projected[0].assessment_status, "resolved_risk_flagged");
  assert.equal(gapRowsMatchExpectation(projected, [plan], identity), true);
  assert.equal(projectSmallCellGapRows([{ ...row, source_version_id: "stale" }], [plan], context, identity), null);
  const fingerprint = (head) => computeCoverageReviewDecisionFingerprint({ claimId: "claim", dimensionKey: "small_cell_risk", gapLogItemId: "gap", smallCellDecisionId: head });
  assert.notEqual(fingerprint("head-a"), fingerprint("head-b"));
  assert.notEqual(fingerprint(undefined), fingerprint("head-a"), "legacy acceptances do not establish which reviewed head they applied to");
});

test("effective small-cell projection does not accept incomplete or out-of-scope decisions", () => {
  for (const head of [null, { ...decision, decision_outcome: "needs_more_information" },
    { ...decision, organization_id: "other" }, { ...decision, intake_sensitivity_profile_id: "other" },
    { ...decision, reviewed_minor_data_status: null }, { ...decision, created_by_type: "system" },
    { ...decision, decided_by_role: "client_reviewer" }]) {
    assert.equal(effectiveSmallCellRiskStatus(profile, head), "unknown");
  }
});

test("batch head lookup scopes identities and rejects ambiguous heads", async () => {
  const org = "00000000-0000-4000-8000-000000000001";
  const id = "00000000-0000-4000-8000-000000000002";
  const absentId = "00000000-0000-4000-8000-000000000003";
  const row = { ...decision, organization_id: org, intake_sensitivity_profile_id: id };
  let queryCount = 0;
  const tx = { async query(sql, params) {
    queryCount += 1;
    assert.match(sql, /NOT EXISTS/);
    assert.deepEqual(params, [org, [id, absentId]]);
    return { rows: [row] };
  } };
  const result = await findCurrentSensitivityAllowedUseDecisions(tx, { organizationId: org, intakeSensitivityProfileIds: [id, absentId, id] });
  assert.equal(queryCount, 1);
  assert.equal(result.get(id), row);
  assert.equal(result.get(absentId), null);
  await assert.rejects(findCurrentSensitivityAllowedUseDecisions({ query: async () => ({ rows: [row, row] }) },
    { organizationId: org, intakeSensitivityProfileIds: [id] }), AmbiguousSensitivityDecisionLineageError);
  await assert.rejects(findCurrentSensitivityAllowedUseDecisions({ query: async () => ({ rows: [{ ...row, organization_id: absentId }] }) },
    { organizationId: org, intakeSensitivityProfileIds: [id] }), /outside requested scope/);
});

test("story metadata does not establish public consent", () => {
  const reviewed = { ...decision, reviewed_story_testimonial_status: "present", reviewed_small_cell_risk_status: "absent" };
  assert.ok(!classifySourceDecision(reviewed).getKinderReviewReasons.includes("story_testimonial_not_cleared"));
  const snapshot = Object.fromEntries(Object.entries(reviewed).filter(([key]) => key.startsWith("reviewed_")));
  snapshot.reviewed_allowed_use_status = "allowed";
  snapshot.reviewed_public_use_allowed = true;
  assert.equal(validateSensitivityReviewedSnapshot(snapshot).ok, false);
});
