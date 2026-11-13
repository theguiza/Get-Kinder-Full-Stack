import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { readFactualReviewMeasurementsInTransaction } from "../Backend/kai/dictionary/postgresOrganizationFactualReviewRepository.js";
import { evaluateOrdinaryMeasurementAuthorityInTransaction, HIGH_RISK_SENSITIVITY_FIELDS } from "../Backend/kai/dictionary/postgresOrdinaryInternalFactAuthority.js";
import * as D from "../Backend/kai/validators/kaiDerivedMeasurementValidators.js";
import { MEASUREMENT_XLSX_SELECTED_CALCULATION_METHOD } from "../Backend/kai/validators/kaiSourceMeasurementValidators.js";
import { getOrganizationFactualReview } from "../Backend/kai/services/kaiOrganizationFactualReviewService.js";
import { STORED_ORGANIZATION_MEMBERSHIP_SOURCE } from "../Backend/kai/auth/kaiOrganizationMembershipSource.js";
import router, { __testables as routeTests } from "../Backend/kai/routes/sprint2IntakeApi.js";
import { requireKaiSprint2Authenticated } from "../Backend/kai/middleware/kaiSprint2Authentication.js";

// Synthetic rows only. The two arithmetic cases match the established paired-outcome results;
// this exercises existing scoped SQL readers and response projections without a database target.
const ORG = "11000000-0000-4000-8000-000000000001";
const VERSION = "12000000-0000-4000-8000-000000000001";
const EVIDENCE = "13000000-0000-4000-8000-000000000001";
const CLAIM = "14000000-0000-4000-8000-000000000001";
const PRIVATE = "PRIVATE_PARTICIPANT_CONTENT_MUST_NOT_BE_PROJECTED";
const dimensions = {
  missingness: { assessment_status: "resolved_risk_flagged", internal_limitation_accepted: false },
  conflicting_source_indicators: { assessment_status: "unresolved", internal_limitation_accepted: false },
  requirement_alignment: { assessment_status: "unresolved", internal_limitation_accepted: false },
};
const cleared = {
  organization_id: ORG, decision_outcome: "reviewed", reviewed_allowed_use_status: "allowed", reviewed_llm_processing_allowed: true,
  ...Object.fromEntries(Object.keys(HIGH_RISK_SENSITIVITY_FIELDS).map(k => [k, "absent"])),
};
function fixture(field = "field_6", interpreted = false) {
  const six = field === "field_6";
  const row = {
    organization_id: ORG, evidence_item_id: EVIDENCE, source_version_id: VERSION, measurement_source_version_id: VERSION,
    source_derived_measurement_id: "15000000-0000-4000-8000-000000000001", measurement_family: D.DERIVED_MEASUREMENT_FAMILIES.PAIRED_OUTCOME,
    calculation_method: D.DERIVED_MEASUREMENT_METHODS.PAIRED_OUTCOME, worksheet_key: "sheet_1",
    definition: { outcome_field_key: field, outcome_column: six ? "F" : "G", participant_field_key: "field_2", stage_field_key: "field_4", instrument_version_field_key: "field_5" },
    field_keys: ["field_2", "field_4", "field_5", field], measured_value: six ? 25 : 23, numerator: six ? 25 : 23, denominator: six ? 38 : 40, percentage: six ? "65.79" : "57.50",
    component_counts: { participant_count: 62, comparable_pair_count: six ? 38 : 40, increased_count: six ? 25 : 23, unchanged_count: six ? 10 : 13, decreased_count: six ? 3 : 4, excluded_participant_count: six ? 24 : 22 },
    exclusions: { participants: [
      { reason: "no_baseline_observation", participant_count: 5, rows: [PRIVATE] },
      { reason: "no_followup_observation", participant_count: 7, rows: [PRIVATE] },
      { reason: "instrument_version_mismatch", participant_count: 8, rows: [PRIVATE] },
      { reason: six ? "missing_followup_value" : "missing_baseline_value", participant_count: six ? 4 : 2, rows: [PRIVATE] },
    ], rows: [{ reason: "blank_participant_identifier", row_count: 0, rows: [PRIVATE] }] },
    row_locators: { comparable_pairs: [PRIVATE] }, profile_canonical_sha256: "a".repeat(64),
    interpretation_id: interpreted ? "16000000-0000-4000-8000-000000000001" : null,
    current_interpretation_id: interpreted ? "16000000-0000-4000-8000-000000000001" : null,
    ...(interpreted ? { indicator_label: "Self rating", meaning_text: "The organization describes a self rating.", score_direction: "higher_is_better", evidence_basis: "self_reported" } : {}),
    raw_participants: [PRIVATE], contributing_sources: [],
  };
  return {
    row,
    evidenceItemRow: { organization_id: ORG, evidence_item_id: EVIDENCE, source_version_id: VERSION, evidence_type: D.DERIVED_MEASUREMENT_EVIDENCE_TYPE, data_class: D.DERIVED_MEASUREMENT_DATA_CLASS, statement: D.composeDerivedMeasurementEvidenceStatement({ measurementRow: row, interpretation: D.interpretationOf(row) }) },
    locatorRow: { locator_type: D.DERIVED_MEASUREMENT_LOCATOR_TYPE, coordinates: D.derivedMeasurementLocatorCoordinates({ sheetKey: "sheet_1", fieldKeys: row.field_keys }) },
    sourceVersionRow: { organization_id: ORG, source_version_id: VERSION, is_current: true, profile_canonical_sha256: row.profile_canonical_sha256, intake_sensitivity_profile_id: "17000000-0000-4000-8000-000000000001" },
  };
}
function transaction(f, { record = null, sourceDecision = cleared, evidenceHead = null, claimHead = null, versions = {}, decisionsByProfile = {}, worksheetName = "Participant assessments" } = {}) {
  const calls = [];
  return { calls, async query(sql, params) {
    calls.push({ sql, params });
    assert.match(sql.trim(), /^SELECT\b/, "review projection must never mutate");
    assert.equal(params[0], ORG, "every read stays organization scoped");
    // The screened worksheet name from the exact profile the measurement was calculated from.
    if (/FROM kai\.intake_file_profiles p/.test(sql)) {
      assert.deepEqual(params.slice(1), [VERSION, f.row?.profile_canonical_sha256, f.row?.worksheet_key]);
      return { rows: [{ worksheet_name: worksheetName }] };
    }
    if (/FROM kai\.evidence_review_decisions/.test(sql)) return { rows: evidenceHead ? [evidenceHead] : [] };
    if (/FROM kai\.claim_review_decisions/.test(sql)) return { rows: claimHead ? [claimHead] : [] };
    if (/FROM kai\.source_versions/.test(sql) && versions[params[1]]) return { rows: [versions[params[1]]] };
    if (/FROM kai\.intake_sensitivity_review_decisions/.test(sql) && Object.hasOwn(decisionsByProfile, params[1])) {
      return { rows: decisionsByProfile[params[1]] ? [decisionsByProfile[params[1]]] : [] };
    }
    if (/FROM kai\.evidence_measurements m/.test(sql)) { assert.deepEqual(params[1], [EVIDENCE]); return { rows: record ? [record] : [] }; }
    if (/FROM kai\.source_measurement_definitions/.test(sql)) return { rows: [{ definition_text: "A recorded session.", inclusion_rule: "Nonblank records.", exclusion_rule: "Blank records." }] };
    if (/FROM kai\.evidence_derived_measurements l/.test(sql)) { assert.equal(params[1], EVIDENCE); return { rows: f.row ? [f.row] : [] }; }
    if (/FROM kai\.source_versions/.test(sql)) return { rows: [f.sourceVersionRow] };
    if (/FROM kai\.intake_sensitivity_review_decisions/.test(sql)) return { rows: sourceDecision ? [sourceDecision] : [] };
    assert.fail(`Unexpected SQL read: ${sql}`);
  } };
}
async function project(f, tx = transaction(f)) {
  return readFactualReviewMeasurementsInTransaction(tx, { organizationId: ORG, ...f, dimensions });
}

for (const field of ["field_6", "field_7"]) {
  test(`${field}: current paired review exposes persisted ratios, counts, exclusions and limitations without raw records`, async () => {
    const f = fixture(field);
    const result = await project(f);
    assert.equal(result.ok, true);
    assert.equal(result.data.measurement, null, "record-count DTO is not overloaded");
    const p = result.data.derived_measurement;
    assert.equal(p.measurement_type, "paired_outcome_change");
    assert.equal(p.source_version_id, VERSION); assert.equal(p.evidence_item_id, EVIDENCE); assert.equal(p.is_current, true);
    assert.deepEqual([p.numerator, p.denominator, p.percentage, p.increased_count, p.unchanged_count, p.decreased_count, p.comparable_pair_count, p.excluded_participant_count],
      field === "field_6" ? [25, 38, "65.79", 25, 10, 3, 38, 24] : [23, 40, "57.50", 23, 13, 4, 40, 22]);
    assert.equal(p.participant_count, 62); assert.equal(p.interpretation, null); assert.equal(p.score_direction, "not_established"); assert.equal(p.reporting_period, null);
    assert.equal(p.exclusions.participants[3].reason, field === "field_6" ? "missing_followup_value" : "missing_baseline_value");
    assert.deepEqual(p.exclusions.rows, [{ reason: "blank_participant_identifier", row_count: 0 }]);
    const codes = result.data.limitations.map(l => l.code);
    for (const code of ["derived.direction_not_established", "derived.matched_subset_only", "derived.meaning_proposed", "derived.no_reporting_period", "derived.observations_excluded", "derived.values_not_verified", "coverage.requirement_alignment.unresolved"]) assert.ok(codes.includes(code), code);
    assert.ok(result.data.limitations.every(l => typeof l.description === "string" && l.description.length > 0));
    assert.doesNotMatch(JSON.stringify(result), new RegExp(PRIVATE));
    assert.equal(Object.hasOwn(p, "row_locators"), false);
    // A readable, version-bound location: the profile's screened worksheet name and the persisted column letter.
    assert.deepEqual([p.worksheet_key, p.worksheet_name, p.outcome_field_key, p.outcome_column], ["sheet_1", "Participant assessments", field, field === "field_6" ? "F" : "G"]);
  });
}

test("paired location: no screened worksheet name is reported as unknown, never guessed", async () => {
  const f = fixture("field_7");
  const unnamed = await project(f, transaction(f, { worksheetName: null }));
  assert.equal(unnamed.data.derived_measurement.worksheet_name, null);
  const blank = await project(f, transaction(f, { worksheetName: "  " }));
  assert.equal(blank.data.derived_measurement.worksheet_name, null);
  assert.equal(blank.data.derived_measurement.outcome_column, "G", "the persisted column letter is still served");
});
test("current recorded interpretation is reported without inventing independent verification", async () => {
  const result = await project(fixture("field_6", true));
  assert.equal(result.data.derived_measurement.interpretation.meaning_text, "The organization describes a self rating.");
  assert.equal(result.data.derived_measurement.score_direction, "higher_is_better");
  assert.ok(result.data.limitations.some(l => l.code === "derived.direction_human_stated"));
  assert.ok(result.data.limitations.some(l => l.code === "derived.self_reported"));
  assert.ok(result.data.limitations.some(l => l.code === "derived.values_not_verified"));
});
test("stale version, superseded interpretation, mismatched lineage and invalid arithmetic fail closed", async () => {
  for (const mutate of [
    f => { f.sourceVersionRow.is_current = false; },
    f => { f.row.current_interpretation_id = "16000000-0000-4000-8000-000000000099"; },
    f => { f.row.organization_id = "11000000-0000-4000-8000-000000000099"; },
    f => { f.row.measurement_source_version_id = "12000000-0000-4000-8000-000000000099"; },
    f => { f.row.component_counts.increased_count = 24; },
    f => { f.row = null; },
  ]) {
    const f = fixture(); mutate(f);
    const result = await project(f);
    assert.deepEqual(result, { ok: false, error: { code: "conflict_current_state_changed", status: 409 } });
  }
});
test("record-count response keeps its established measurement schema and disclosures", async () => {
  const f = fixture(); f.evidenceItemRow.evidence_type = "source_record_count_measurement";
  const record = { calculation_method: MEASUREMENT_XLSX_SELECTED_CALCULATION_METHOD, worksheet_key: "sheet_1", worksheet_name: "Sessions", measured_value: 5, unit_label: "sessions", counted_unit: "session", total_record_count: 6, blank_record_count: 1, duplicate_record_count: 0, period_start: null, period_end: null, source_measurement_definition_id: "18000000-0000-4000-8000-000000000001" };
  const result = await project(f, transaction(f, { record }));
  assert.equal(result.ok, true); assert.equal(result.data.derived_measurement, null);
  const { source_measurement_definition_id, ...expected } = record;
  assert.deepEqual(result.data.measurement, { ...expected, definition_text: "A recorded session.", inclusion_rule: "Nonblank records.", exclusion_rule: "Blank records." });
  assert.ok(result.data.limitations.some(l => l.code === "measurement.blank_records_excluded"));
  assert.ok(result.data.limitations.every(l => !l.code.startsWith("derived.")));
});
test("ordinary paired drafting authority is independent of client-admin review powers and records exact source reasons", async () => {
  const f = fixture();
  const claimRow = { claim_id: CLAIM, claim_type: "finding", evidence_item_id: EVIDENCE, statement: D.composeDerivedClaimStatementFromRow(f.row) };
  const evaluate = sourceDecision => evaluateOrdinaryMeasurementAuthorityInTransaction(transaction(f, { sourceDecision }), { organizationId: ORG, ...f, claimRow });
  const allowed = await evaluate(cleared);
  assert.equal(allowed.ordinary, true); assert.deepEqual(allowed.reasons, []); assert.equal(allowed.basis, "all_sensitive_categories_absent");
  for (const [key, reason] of Object.entries(HIGH_RISK_SENSITIVITY_FIELDS)) {
    for (const value of ["present", "unknown"]) {
      // A recorded 'present' story/testimonial category alone is answered by the numerical basis (next tests).
      if (key === "reviewed_story_testimonial_status" && value === "present") continue;
      const denied = await evaluate({ ...cleared, [key]: value });
      assert.equal(denied.ordinary, false); assert.deepEqual(denied.reasons, [reason]);
    }
  }
  assert.deepEqual((await evaluate({ ...cleared, reviewed_llm_processing_allowed: false })).reasons, ["processing_permission_not_established"]);
  assert.deepEqual((await evaluate(null)).reasons, ["sensitivity_review_not_complete"]);
});

// Owner prompt 2026-11-05: the reported production case. Source 89013b3f... records
// stories/testimonials 'present' and every other category 'absent', use allowed and AI
// processing permitted; claims 702df414... (field_6, 25/38) and a5fe898a... (field_7, 23/40)
// restate their paired measurements exactly and use no testimonial content.
const STORY_PRESENT = { ...cleared, reviewed_story_testimonial_status: "present" };
const paired = (field, overrides = {}) => {
  const f = fixture(field);
  const claimRow = { claim_id: CLAIM, claim_type: "finding", evidence_item_id: EVIDENCE, statement: D.composeDerivedClaimStatementFromRow(f.row) };
  const tx = transaction(f, { sourceDecision: STORY_PRESENT, ...overrides.tx });
  return { f, claimRow, tx, run: (extra = {}) => evaluateOrdinaryMeasurementAuthorityInTransaction(tx, { organizationId: ORG, ...f, claimRow, ...extra }) };
};

for (const field of ["field_6", "field_7"]) {
  test(`A/B ${field}: a story-present source no longer refuses its permitted numerical paired claim, and the claim stays descriptive`, async () => {
    const { f, claimRow, tx, run } = paired(field);
    const rule = await run();
    assert.deepEqual([rule.ordinary, rule.reasons, rule.basis], [true, [], "all_sensitive_categories_absent"]);
    // The recorded classification stays visible as source context; nothing is rewritten.
    assert.equal(rule.sourcePermissions.recorded.categories.reviewed_story_testimonial_status, "present");
    assert.equal(rule.sourcePermissions.recorded.categories.reviewed_personal_data_status, "absent");
    assert.equal(rule.sourcePermissions.is_current, true);
    assert.ok(tx.calls.every(call => /^\s*SELECT\b/.test(call.sql)), "the rule writes nothing");
    // B: the governed statement is the persisted arithmetic, with no improvement, meaning or period invented.
    const [n, d] = field === "field_6" ? [25, 38] : [23, 40];
    assert.match(claimRow.statement, new RegExp(`\\b${n}\\b[^.]*\\b${d}\\b`));
    assert.match(claimRow.statement, /whether higher is better is not established/);
    assert.match(claimRow.statement, /no reporting period/);
    assert.doesNotMatch(claimRow.statement, /improv|success|because|caused|testimon|stor(y|ies)|["\u201C\u201D]/i);
    const projection = (await project(f)).data;
    const p = projection.derived_measurement;
    assert.deepEqual([p.numerator, p.denominator, p.percentage], field === "field_6" ? [25, 38, "65.79"] : [23, 40, "57.50"]);
    assert.deepEqual([p.score_direction, p.reporting_period, p.interpretation], ["not_established", null, null]);
    assert.equal(p.exclusions.participants.reduce((sum, e) => sum + e.participant_count, 0), p.excluded_participant_count);
    assert.deepEqual(p.exclusions.participants.map(e => e.reason).slice(0, 3), ["no_baseline_observation", "no_followup_observation", "instrument_version_mismatch"]);
    for (const code of ["derived.direction_not_established", "derived.no_reporting_period", "derived.observations_excluded", "derived.matched_subset_only"]) {
      assert.ok(projection.limitations.some(l => l.code === code), code);
    }
    assert.deepEqual([p.source_version_id, p.evidence_item_id, p.is_current], [VERSION, EVIDENCE, true]);
    assert.ok(f.locatorRow.coordinates, "the locator citation is unchanged");
  });
}

test("C: restricted, identifying or testimonial use stays protected; the basis never answers anything else", async () => {
  const cases = {
    "personal information also present": [{ tx: { sourceDecision: { ...STORY_PRESENT, reviewed_personal_data_status: "present" } } }, ["personal_information_not_cleared"]],
    "minors also present": [{ tx: { sourceDecision: { ...STORY_PRESENT, reviewed_minor_data_status: "present" } } }, ["minor_information_not_cleared"]],
    "small-cell risk also unknown": [{ tx: { sourceDecision: { ...STORY_PRESENT, reviewed_small_cell_risk_status: "unknown" } } }, ["small_cell_risk_not_cleared"]],
  };
  for (const [label, [overrides, reasons]] of Object.entries(cases)) {
    const rule = await paired("field_6", overrides).run();
    assert.deepEqual([rule.ordinary, rule.reasons, rule.basis], [false, reasons, null], label);
  }
  // A claim that adds testimonial wording is not the measurement's restatement.
  const quoted = paired("field_6");
  const withQuote = await quoted.run({ claimRow: { ...quoted.claimRow, statement: `${quoted.claimRow.statement} One participant said "this changed my life."` } });
  assert.deepEqual([withQuote.ordinary, withQuote.reasons], [false, ["claim_not_measurement_restatement"]]);
  // A narrative or other claim type on the same evidence is not covered either.
  const story = await quoted.run({ claimRow: { ...quoted.claimRow, claim_type: "story" } });
  assert.deepEqual(story.reasons, ["claim_not_measurement_restatement"]);
  // Evidence without a claim uses the same ordinary source classification.
  const evidenceOnly = await quoted.run({ claimRow: null });
  assert.deepEqual([evidenceOnly.ordinary, evidenceOnly.reasons], [true, []]);
  // Positive recorded decisions keep the basis (the ordinary rule never overrides a decision).
  const reviewed = await paired("field_6", { tx: { evidenceHead: { decision_outcome: "supported" }, claimHead: { decision_outcome: "approved" } } }).run();
  assert.equal(reviewed.basis, "all_sensitive_categories_absent");
});

test("C: a paired measurement that names another contributing source fails closed and is never covered", async () => {
  const REF_VERSION = "12000000-0000-4000-8000-000000000002";
  const REF_PROFILE = "17000000-0000-4000-8000-000000000002";
  for (const referenceDecision of [cleared, STORY_PRESENT]) {
    const f = fixture("field_6");
    f.row.contributing_sources = [{ source_role: "reference", source_version_id: REF_VERSION, is_current: true }];
    const claimRow = { claim_id: CLAIM, claim_type: "finding", evidence_item_id: EVIDENCE, statement: D.composeDerivedClaimStatementFromRow(f.row) };
    const versions = { [REF_VERSION]: { organization_id: ORG, source_version_id: REF_VERSION, is_current: true, intake_sensitivity_profile_id: REF_PROFILE } };
    const tx = transaction(f, { sourceDecision: STORY_PRESENT, versions, decisionsByProfile: { [REF_PROFILE]: referenceDecision } });
    const rule = await evaluateOrdinaryMeasurementAuthorityInTransaction(tx, { organizationId: ORG, ...f, claimRow });
    assert.deepEqual([rule.ordinary, rule.basis], [false, null]);
    assert.deepEqual(rule.reasons, ["measurement_definition_not_confirmed"]);
  }
});

test("D: stale lineage, prohibited use, AI-processing denial, another tenant's decision and invalid arithmetic still fail", async () => {
  const stale = paired("field_6"); stale.f.sourceVersionRow.is_current = false;
  const staleRule = await evaluateOrdinaryMeasurementAuthorityInTransaction(
    transaction(stale.f, { sourceDecision: STORY_PRESENT, versions: { [VERSION]: { ...stale.f.sourceVersionRow } } }),
    { organizationId: ORG, ...stale.f, claimRow: stale.claimRow });
  assert.deepEqual([staleRule.ordinary, staleRule.reasons], [false, ["source_version_not_current"]]);
  const cases = {
    "use not allowed": [{ ...STORY_PRESENT, reviewed_allowed_use_status: "not_allowed" }, ["processing_permission_not_established"]],
    "AI processing denied": [{ ...STORY_PRESENT, reviewed_llm_processing_allowed: false }, ["processing_permission_not_established"]],
    "another organization's decision": [{ ...STORY_PRESENT, organization_id: "11000000-0000-4000-8000-000000000099" }, ["sensitivity_review_not_complete"]],
    "review not complete": [{ ...STORY_PRESENT, decision_outcome: "deferred" }, ["sensitivity_review_not_complete"]],
  };
  for (const [label, [sourceDecision, reasons]] of Object.entries(cases)) {
    const rule = await paired("field_6", { tx: { sourceDecision } }).run();
    assert.deepEqual([rule.ordinary, rule.reasons, rule.basis], [false, reasons, null], label);
  }
  const broken = paired("field_6"); broken.f.row.component_counts.increased_count = 24;
  const brokenRule = await broken.run();
  assert.equal(brokenRule.ordinary, false); assert.ok(brokenRule.reasons.includes("measurement_definition_not_confirmed"));
});

test("authenticated factual-review API retains the paired projection through the real service and role checks", async t => {
  const originalFlag = process.env.KAI_SPRINT2_ENABLED; process.env.KAI_SPRINT2_ENABLED = "true";
  const f = fixture("field_7");
  const projection = (await project(f)).data;
  const actor = role => ({ actorType: "human", actorUserId: "19000000-0000-4000-8000-000000000001", organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: role, source: STORED_ORGANIZATION_MEMBERSHIP_SOURCE }] });
  let context = actor("client_admin"), authenticated = true, reads = 0;
  const restore = routeTests.setIntakeServiceForTest({ async getOrganizationFactualReview(input) {
    return getOrganizationFactualReview(input, { env: { KAI_SPRINT2_ENABLED: "true" }, organizationFactualReviewRepository: { async getOrganizationFactualReview(payload) {
      reads++; assert.deepEqual(payload, { organizationId: ORG, claimId: CLAIM });
      return { ok: true, data: { claim_id: CLAIM, evidence_item_id: EVIDENCE, ...projection } };
    } } });
  } });
  const app = express();
  app.use((req, res, next) => { req.isAuthenticated = () => authenticated; req.kaiSprint2ActorContext = context; next(); });
  app.use("/api/kai/sprint2/intake", requireKaiSprint2Authenticated, router);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => { restore(); if (originalFlag === undefined) delete process.env.KAI_SPRINT2_ENABLED; else process.env.KAI_SPRINT2_ENABLED = originalFlag; await new Promise(resolve => server.close(resolve)); });
  const path = `http://127.0.0.1:${server.address().port}/api/kai/sprint2/intake/admin/organizations/${ORG}/claims/${CLAIM}/organization-factual-review`;
  for (const [role, viewer] of [["client_admin", "organization_administrator"], ["gk_reviewer", "get_kinder_reviewer"]]) {
    context = actor(role);
    const response = await fetch(path); const body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.data.viewer, viewer); assert.deepEqual(body.data.derived_measurement, projection.derived_measurement);
    assert.equal(body.data.measurement, null); assert.deepEqual(body.data.limitations, projection.limitations);
    assert.doesNotMatch(JSON.stringify(body), new RegExp(PRIVATE));
  }
  const before = reads;
  context = actor("client_contributor"); assert.equal((await fetch(path)).status, 403);
  context = actor("client_admin"); context.organizationMemberships[0].organization_id = "11000000-0000-4000-8000-000000000099";
  assert.equal((await fetch(path)).status, 403);
  authenticated = false; assert.equal((await fetch(path)).status, 401);
  assert.equal(reads, before);
});

// The real generation repository, with P2-06 stubbed to the eligible result it now returns for
// the reported claims: source metadata cannot restrict the generated content type.
test("generation: source story metadata does not restrict internal content types", async () => {
  const { createPostgresGeneratedContentRepository } = await import("../Backend/kai/dictionary/postgresGeneratedContentRepository.js");
  const { attachOrdinaryInternalAuthority } = await import("../Backend/kai/dictionary/postgresOrdinaryInternalFactAuthority.js");
  const f = fixture("field_6");
  const run = async (method, basis) => {
    const writes = []; const modelCalls = [];
    const tx = { async query(sql, params) {
      if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) {
        writes.push(sql.trim().split(/\s+/).slice(0, 3).join(" "));
        return { rows: sql.includes("INTO kai.generation_runs") ? [{ generation_run_id: "1a000000-0000-4000-8000-000000000001" }] : [] };
      }
      if (sql.includes("JOIN kai.claim_evidence_links")) return { rows: [{ claim_id: CLAIM, intake_sensitivity_profile_id: f.sourceVersionRow.intake_sensitivity_profile_id }] };
      if (sql.includes("FROM kai.intake_sensitivity_review_decisions")) return { rows: [{ intake_sensitivity_profile_id: f.sourceVersionRow.intake_sensitivity_profile_id, ...STORY_PRESENT }] };
      if (sql.includes("FROM kai.intake_sensitivity_profiles")) return { rows: params[1].map(id => ({ intake_sensitivity_profile_id: id, allowed_use_status: "unknown" })) };
      if (sql.includes("FROM kai.evidence_derived_measurements l")) return { rows: [f.row] };
      if (sql.includes("FROM kai.claims c")) {
        return { rows: [{ claim_id: CLAIM, claim_statement: D.composeDerivedClaimStatementFromRow(f.row), claim_type: "finding", evidence_item_id: EVIDENCE,
          evidence_type: D.DERIVED_MEASUREMENT_EVIDENCE_TYPE, internal_only: true, funder_use_allowed: false, public_use_allowed: false,
          source_id: "1b000000-0000-4000-8000-000000000001", source_version_id: VERSION, intake_file_id: "1c000000-0000-4000-8000-000000000001", upload_state: "confirmed" }] };
      }
      return { rows: [] };
    } };
    const repository = createPostgresGeneratedContentRepository({
      runInTransaction: callback => callback(tx),
      evaluator: async (_tx, { claimId, requestedAudience }) => ({ ok: true, data: attachOrdinaryInternalAuthority({
        requestedAudience, claim: { claim_id: claimId, claim_strength: "unassessed" }, evidence: { evidence_item_id: EVIDENCE },
        eligible: true, blockerCodes: [], dimensions: {},
      }, { basis, reliedOn: true }) }),
    });
    const result = await repository[method]({
      organizationId: ORG, engagementId: "1d000000-0000-4000-8000-000000000001", requestedAudience: "internal", claimIds: [CLAIM],
      idempotencyKey: `numerical-${method}`, actorContext: { actorType: "human" }, now: "2026-11-05T12:00:00.000Z",
    }, {
      draftGenerator: async input => { modelCalls.push(input.claims.map(c => ({ id: c.claimId, statement: c.claimStatement, codes: c.limitationCodes }))); return { blocks: [] }; },
      metadataOnlyAudit: { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) },
    });
    return { result, writes, modelCalls };
  };
  const refused = await run("createImpactNarrativeDraft", "all_sensitive_categories_absent");
  assert.equal(refused.modelCalls.length, 1, "Impact Narrative reaches the model under the same authority");
  assert.notEqual(refused.result.blockers?.[0]?.blocking_reason, "story_testimonial_count_only_operation_not_permitted");
  // The Evidence Summary reaches the model with only the governed numerical statement and its limitations.
  const admitted = await run("createEvidenceSummaryDraft", "all_sensitive_categories_absent");
  assert.equal(admitted.modelCalls.length, 1, JSON.stringify(admitted.result));
  const [claim] = admitted.modelCalls[0];
  assert.equal(claim.statement, D.composeDerivedClaimStatementFromRow(f.row));
  for (const code of ["derived.direction_not_established", "derived.no_reporting_period", "derived.observations_excluded"]) assert.ok(claim.codes.includes(code), code);
  assert.doesNotMatch(JSON.stringify(admitted.modelCalls), new RegExp(PRIVATE));
  // The existing all-absent basis keeps its unrestricted internal drafting.
  const ordinary = await run("createImpactNarrativeDraft", "all_sensitive_categories_absent");
  assert.notEqual(ordinary.result.blockers?.[0]?.blocking_reason, "story_testimonial_count_only_operation_not_permitted");
  assert.equal(ordinary.modelCalls.length, 1);
});
