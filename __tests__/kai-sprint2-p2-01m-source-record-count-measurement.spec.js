import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import express from "express";

import { profileLocalTrustedFile } from "../Backend/kai/profiling/localProfilingKernel.js";
import {
  composeMeasurementClaimStatement,
  composeMeasurementEvidenceStatement,
  computeDefinitionFingerprint,
  deriveRecordCountMeasurement,
  validateComposedStatement,
  validateMeasurementClaimBasis,
  validateRecordCountDefinition,
} from "../Backend/kai/validators/kaiSourceMeasurementValidators.js";
import { recordSourceRecordCountMeasurement } from "../Backend/kai/services/kaiSourceMeasurementService.js";
import {
  MEASUREMENT_ANSWERED_DIMENSION_KEYS,
  applyMeasurementCoverageDimensions,
} from "../Backend/kai/validators/kaiSourceMeasurementValidators.js";
import { measurementLimitationCodes } from "../Backend/kai/validators/kaiSourceMeasurementValidators.js";
import { validateGeneratedContentDraft } from "../Backend/kai/validators/kaiGeneratedContentValidators.js";
import { createProductionEvidenceSummaryDraftGenerator } from "../Backend/kai/services/kaiEvidenceSummaryDraftGenerator.js";
import { __claimGapFollowupRepositoryTestables } from "../Backend/kai/dictionary/postgresClaimGapFollowupRepository.js";
import { proposeClaim } from "../Backend/kai/services/kaiClaimProposalService.js";
import sprint2IntakeApiRouter, { __testables as routeTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";

/**
 * KAI P2-01M pure and boundary behavior: the P1 blank-record count, the
 * fail-closed definition, measurement derivation, statement composition, the
 * claim basis, the service gates, and the route. The real-PostgreSQL proof is
 * kai-sprint2-p2-01m-source-record-count-measurement.integration.spec.js.
 */

const ORG = "0e000000-0000-4000-8000-000000000a01";
const VERSION = "3e000000-0000-4000-8000-000000000001";
const NOW = "2026-10-22T12:00:00.000Z";
const ENV = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });
const DEFINITION = Object.freeze({
  counted_unit: "programme session",
  unit_label: "programme sessions",
  definition_text: "Each row records one delivered programme session.",
  inclusion_rule: "Every data row after the header row that has at least one value.",
  exclusion_rule: "The header row and empty rows.",
});
const ADMIN = Object.freeze({
  actorType: "human",
  actorUserId: "9e000000-0000-4000-8000-000000000001",
  kaiRoles: [],
  organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_admin" }],
});

async function profile(text) {
  const bytes = new TextEncoder().encode(text);
  return profileLocalTrustedFile({ extension: ".csv", declaredMime: "text/csv", byteSize: bytes.byteLength, bytes });
}

test("P1 counts records whose every field is empty, and nothing else", async () => {
  assert.equal((await profile("a,b\n1,2\n3,4\n")).counts.blank_record_count, 0, "a trailing newline is not a record");
  const withBlanks = await profile("a,b\n1,2\n\n,\n , \n3,\n");
  assert.deepEqual([withBlanks.counts.row_count, withBlanks.counts.blank_record_count], [5, 3], "an empty line, ',' and ' , ' carry no value; '3,' does");
  assert.equal((await profile("a,b\n")).counts.blank_record_count, 0);
});

test("the definition is required, complete, plain text, and its optional period is a real range", () => {
  assert.equal(validateRecordCountDefinition(DEFINITION).ok, true);
  assert.equal(validateRecordCountDefinition({ ...DEFINITION, period_start: "2026-09-01", period_end: "2026-09-30" }).ok, true);
  for (const [definition, reason] of [
    [null, "measurement_definition_required"],
    [[], "measurement_definition_required"],
    [{ ...DEFINITION, unit_label: "  " }, "measurement_definition_incomplete"],
    [{ ...DEFINITION, extra: "x" }, "measurement_definition_unknown_field"],
    [{ ...DEFINITION, counted_unit: "1 session" }, "measurement_definition_label_invalid"],
    [{ ...DEFINITION, unit_label: "api token rows" }, "measurement_definition_label_invalid"],
    [{ ...DEFINITION, definition_text: "x".repeat(301) }, "measurement_definition_text_invalid"],
    [{ ...DEFINITION, exclusion_rule: " leading space" }, "measurement_definition_text_invalid"],
    [{ ...DEFINITION, inclusion_rule: "rows\u0007" }, "measurement_definition_text_invalid"],
    [{ ...DEFINITION, period_start: "2026-09-01" }, "measurement_period_incomplete"],
    [{ ...DEFINITION, period_start: "2026-09-31", period_end: "2026-10-01" }, "measurement_period_invalid"],
    [{ ...DEFINITION, period_start: "2026-09-30", period_end: "2026-09-01" }, "measurement_period_invalid"],
  ]) {
    const result = validateRecordCountDefinition(definition);
    assert.equal(result.ok, false, reason);
    assert.equal(result.blockers[0].blocking_reason, reason);
  }
});

test("the measurement is the committed record count minus blank records; duplicates are counted and reported; anything uncommitted is refused", async () => {
  const derived = deriveRecordCountMeasurement(await profile("d,p\n1,a\n\n2,b\n2,b\n"));
  assert.deepEqual(derived.measurement, { totalRecordCount: 4, blankRecordCount: 1, duplicateRecordCount: 2, measuredValue: 3 });
  const csv = { status: "profiled", format: "csv", structural_metadata: { header_row_assumed: true } };
  for (const [candidate, reason] of [
    [{ ...csv, format: "xlsx" }, "measurement_source_not_single_table_csv"],
    [{ ...csv, status: "failed" }, "measurement_source_not_single_table_csv"],
    [{ ...csv, structural_metadata: {} , counts: { row_count: 1, duplicate_row_count: 0, blank_record_count: 0 } }, "measurement_header_not_established"],
    [{ ...csv, counts: { row_count: 3, duplicate_row_count: 0 } }, "measurement_blank_record_count_not_committed"],
    [{ ...csv, counts: { row_count: 2.5, duplicate_row_count: 0, blank_record_count: 0 } }, "measurement_counts_not_committed"],
    [{ ...csv, counts: { row_count: 1, duplicate_row_count: 0, blank_record_count: 2 } }, "measurement_counts_inconsistent"],
  ]) {
    const result = deriveRecordCountMeasurement(candidate);
    assert.equal(result.ok, false, reason);
    assert.equal(result.blockers[0].blocking_reason, reason);
  }
});

test("statements state only the counted value, its definition, period, and arithmetic", () => {
  const definition = validateRecordCountDefinition({ ...DEFINITION, period_start: "2026-09-01", period_end: "2026-09-30" }).definition;
  const measurement = { totalRecordCount: 4, blankRecordCount: 1, duplicateRecordCount: 0, measuredValue: 3 };
  const evidence = composeMeasurementEvidenceStatement({ measurement, definition });
  assert.equal(evidence, "Source version record count: 3 programme sessions for the reporting period 2026-09-01 to 2026-09-30, counting each CSV data record after the header row as one programme session; 1 blank record excluded; 0 exact-duplicate records included.");
  const claim = composeMeasurementClaimStatement({
    measurementRow: { measured_value: 3, blank_record_count: 1, duplicate_record_count: 0 },
    definitionRow: { unit_label: "programme sessions", counted_unit: "programme session", period_start: null, period_end: null },
  });
  assert.equal(claim, "The promoted source records 3 programme sessions with no reporting period defined (record count: one programme session per CSV data record; 1 blank record excluded, 0 exact-duplicate records included).");
  for (const statement of [evidence, claim]) {
    assert.equal(validateComposedStatement(statement).ok, true);
    assert.doesNotMatch(statement, /because|caused|improv|impact|increase|%|per cent|rate|participants/i);
  }
  assert.equal(validateComposedStatement("x".repeat(501)).ok, false);
  // The definition identity covers every meaning-bearing field.
  const base = computeDefinitionFingerprint({ organizationId: ORG, sourceVersionId: VERSION, definition });
  assert.notEqual(base, computeDefinitionFingerprint({ organizationId: ORG, sourceVersionId: VERSION, definition: { ...definition, exclusionRule: "Header row only." } }));
  assert.notEqual(base, computeDefinitionFingerprint({ organizationId: ORG, sourceVersionId: VERSION, definition: { ...definition, periodEnd: "2026-09-29" } }));
});

test("a measurement claim needs an exactly matching persisted measurement, definition, locator, and current profile", () => {
  const evidenceItemRow = { evidence_item_id: "e1", organization_id: ORG, source_version_id: VERSION, evidence_type: "source_record_count_measurement", data_class: "source_derived_aggregate" };
  const locatorRow = { locator_type: "source_data_records", coordinates: { scope: "data_records_after_header" } };
  const sourceVersionRow = { profile_canonical_sha256: "a".repeat(64) };
  const measurementRow = {
    evidence_item_id: "e1", organization_id: ORG, source_version_id: VERSION, definition_source_version_id: VERSION,
    measurement_type: "source_record_count", definition_status: "human_confirmed", calculation_method: "p1_csv_profile_data_records_excluding_blank_v1",
    unit_label: "sessions", definition_unit_label: "sessions", measured_value: 3, total_record_count: 4, blank_record_count: 1,
    profile_canonical_sha256: "a".repeat(64),
  };
  assert.equal(validateMeasurementClaimBasis({ evidenceItemRow, locatorRow, sourceVersionRow, measurementRow }).ok, true);
  for (const [label, change] of [
    ["missing measurement", { measurementRow: null }],
    ["another evidence item", { measurementRow: { ...measurementRow, evidence_item_id: "e2" } }],
    ["another version's definition", { measurementRow: { ...measurementRow, definition_source_version_id: "v2" } }],
    ["broken arithmetic", { measurementRow: { ...measurementRow, measured_value: 4 } }],
    ["profile changed", { sourceVersionRow: { profile_canonical_sha256: "b".repeat(64) } }],
    ["column locator", { locatorRow: { locator_type: "column", coordinates: { column_name: "x" } } }],
    ["field-presence evidence", { evidenceItemRow: { ...evidenceItemRow, evidence_type: "dictionary_field_presence_fact" } }],
  ]) {
    const result = validateMeasurementClaimBasis({ evidenceItemRow, locatorRow, sourceVersionRow, measurementRow, ...change });
    assert.equal(result.ok, false, label);
    assert.equal(result.blockers[0].blocking_reason, "measurement_claim_basis_invalid", label);
  }
});

test("service: feature gate, actor, role, tenant, and definition are checked before the repository is touched", async () => {
  let calls = 0;
  const repository = { async recordSourceRecordCountMeasurement() { calls += 1; return { ok: true, data: { replayed: false } }; } };
  const call = (overrides = {}, env = ENV) => recordSourceRecordCountMeasurement(
    { organizationId: ORG, sourceVersionId: VERSION, definition: DEFINITION, actorContext: ADMIN, now: NOW, ...overrides },
    { env, sourceMeasurementRepository: repository },
  );
  assert.equal((await call({}, { KAI_SPRINT2_ENABLED: "false" })).error.code, "feature_disabled");
  assert.equal((await call({ actorContext: { ...ADMIN, actorType: "system" } })).error.code, "authorization_denied");
  for (const role of ["client_reviewer", "client_contributor"]) {
    assert.equal((await call({ actorContext: { ...ADMIN, organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: role }] } })).error.code, "authorization_denied", role);
  }
  assert.equal((await call({ actorContext: { ...ADMIN, kaiRoles: ["client_admin"], organizationMemberships: [] } })).error.code, "authorization_denied", "a global client_admin role is not organization authority");
  assert.equal((await call({ actorContext: { ...ADMIN, organizationMemberships: [{ organization_id: ORG, membership_status: "inactive", role_name: "client_admin" }] } })).error.code, "authorization_denied");
  assert.equal((await call({ definition: { ...DEFINITION, counted_unit: "" } })).blockers[0].blocking_reason, "measurement_definition_incomplete");
  assert.equal((await call({ extra: true })).error.code, "validation_blocker");
  assert.equal(calls, 0);
  assert.equal((await call()).ok, true);
  assert.equal(calls, 1);
});

test("route: one authenticated POST that forwards only the path ids, the body as the definition, and server-resolved actor and time", async (t) => {
  const path = "/admin/organizations/:organizationId/source-versions/:sourceVersionId/record-count-measurement";
  assert.equal(sprint2IntakeApiRouter.stack.filter((layer) => layer.route?.path === path && layer.route?.methods?.post).length, 1);
  const calls = [];
  const restore = routeTestables.setIntakeServiceForTest({
    async recordSourceRecordCountMeasurement(input) {
      calls.push(input);
      return { ok: true, data: { replayed: false }, error: null };
    },
  });
  const previous = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.kaiSprint2ActorContext = ADMIN; req.user = { id: 1 }; req.isAuthenticated = () => true; next(); });
  app.use(sprint2IntakeApiRouter);
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  t.after(async () => {
    restore();
    if (previous === undefined) delete process.env.KAI_SPRINT2_ENABLED; else process.env.KAI_SPRINT2_ENABLED = previous;
    await new Promise((resolve) => server.close(resolve));
  });
  const post = (url, body) => new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const request = http.request({ hostname: "127.0.0.1", port: server.address().port, path: url, method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ statusCode: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
    });
    request.on("error", reject);
    request.end(data);
  });
  const ok = await post(`/admin/organizations/${ORG}/source-versions/${VERSION}/record-count-measurement`, DEFINITION);
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.deepEqual(Object.keys(calls[0]).sort(), ["actorContext", "definition", "now", "organizationId", "sourceVersionId"]);
  assert.deepEqual([calls[0].organizationId, calls[0].sourceVersionId, calls[0].definition], [ORG, VERSION, DEFINITION]);
  assert.match(calls[0].now, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const bad = await post(`/admin/organizations/NOT-A-UUID/source-versions/${VERSION}/record-count-measurement`, DEFINITION);
  assert.equal(bad.statusCode, 422);
  assert.equal(calls.length, 1, "a malformed path never reaches the service");
});

test("migration: additive only - widens three vocabularies, keeps every other governance pin, and its rollback refuses while measurements exist", () => {
  const migration = readFileSync("migrations/kai_sprint2_p2_01m_source_record_count_measurement.sql", "utf8");
  assert.match(migration, /CHECK \(evidence_type IN \('dictionary_field_presence_fact', 'source_record_count_measurement'\)\)/);
  assert.match(migration, /CHECK \(data_class IN \('organization_committed_metadata', 'source_derived_aggregate'\)\)/);
  assert.match(migration, /CHECK \(locator_type IN \('column', 'source_data_records'\)\)/);
  assert.match(migration, /evidence_items_p2_01m_type_class_pairing_check/);
  assert.doesNotMatch(migration, /\b(UPDATE|DELETE)\b\s+(FROM\s+)?kai\./i, "no existing row is rewritten");
  for (const pinned of ["sensitivity_level_check", "support_strength_check", "review_status_check", "internal_only_check", "public_use_check", "funder_use_check", "llm_processing_check"]) {
    assert.doesNotMatch(migration, new RegExp(`evidence_items_p2_01_${pinned}`), `${pinned} is untouched`);
  }
  const rollback = readFileSync("migrations/kai_sprint2_p2_01m_source_record_count_measurement.rollback.sql", "utf8");
  assert.match(rollback, /rollback refused: source record-count measurement evidence exists/);
});

test("measured-claim dimensions: zero counts clear, positive counts flagged, unknown counts unresolved; definition, entity, denominator, and coverage answered; period an attested limitation", () => {
  const base = Object.fromEntries(["missingness", "duplicates", "definition_clarity", "denominator_clarity", "time_period_clarity",
    "entity_level_clarity", "small_cell_risk", "conflicting_source_indicators", "requirement_alignment", "coverage_gaps"]
    .map((key) => [key, { validator_key: `base-${key}`, evidence: { assessment_status: "unresolved" } }]));
  const row = (overrides = {}) => ({
    measurement_type: "source_record_count", definition_status: "human_confirmed", blank_record_count: 1,
    duplicate_record_count: 0, profile_field_missing_counts: [1, 1, 1], period_start: "2026-09-01", period_end: "2026-09-30", ...overrides,
  });
  const status = (dims) => Object.fromEntries(Object.entries(dims).map(([key, value]) => [key, value.evidence.assessment_status]));
  assert.deepEqual(status(applyMeasurementCoverageDimensions(base, row())), {
    missingness: "resolved_clear", duplicates: "resolved_clear", definition_clarity: "resolved_clear", denominator_clarity: "resolved_clear",
    time_period_clarity: "resolved_risk_flagged", entity_level_clarity: "resolved_clear", coverage_gaps: "resolved_clear",
    small_cell_risk: "unresolved", conflicting_source_indicators: "unresolved", requirement_alignment: "unresolved",
  });
  // Source-level dimensions are passed through untouched.
  assert.equal(applyMeasurementCoverageDimensions(base, row()).small_cell_risk, base.small_cell_risk);
  const flagged = applyMeasurementCoverageDimensions(base, row({ profile_field_missing_counts: [1, 3, 1], duplicate_record_count: 2 }));
  assert.deepEqual([flagged.missingness.evidence.assessment_status, flagged.missingness.evidence.open_finding_count], ["resolved_risk_flagged", 1]);
  assert.deepEqual([flagged.duplicates.evidence.assessment_status, flagged.duplicates.evidence.open_finding_count], ["resolved_risk_flagged", 2]);
  for (const counts of [null, [], [0, 1, 1], [1, "2"], [1.5]]) {
    assert.equal(applyMeasurementCoverageDimensions(base, row({ profile_field_missing_counts: counts })).missingness.evidence.assessment_status, "unresolved", JSON.stringify(counts));
  }
  assert.equal(applyMeasurementCoverageDimensions(base, row({ duplicate_record_count: null })).duplicates.evidence.assessment_status, "unresolved");
  assert.match(applyMeasurementCoverageDimensions(base, row()).time_period_clarity.message, /not verified against record dates/);
  assert.match(applyMeasurementCoverageDimensions(base, row({ period_start: null, period_end: null })).time_period_clarity.message, /no reporting period/);
  // A missing or unconfirmed measurement leaves every measurement-decided dimension unresolved.
  for (const measurement of [null, row({ definition_status: "proposed" }), row({ measurement_type: "other" })]) {
    const dims = applyMeasurementCoverageDimensions(base, measurement);
    for (const key of ["missingness", "duplicates", "definition_clarity", "denominator_clarity", "time_period_clarity", "entity_level_clarity", "coverage_gaps"]) {
      assert.equal(dims[key].evidence.assessment_status, "unresolved", key);
    }
  }
});

test("follow-up routing: answered dimensions keep their gap but are never sent to the client; other claims route exactly as before", () => {
  const { buildExpectedFollowupDimensionKeys, measurementCoverageDimensions } = __claimGapFollowupRepositoryTestables;
  const plans = ["definition_clarity", "denominator_clarity", "time_period_clarity", "entity_level_clarity", "small_cell_risk"].map((dimension_key) => ({ dimension_key }));
  assert.deepEqual(buildExpectedFollowupDimensionKeys(plans), ["definition_clarity", "denominator_clarity", "time_period_clarity", "entity_level_clarity"]);
  assert.deepEqual(buildExpectedFollowupDimensionKeys(plans, MEASUREMENT_ANSWERED_DIMENSION_KEYS), []);
  assert.deepEqual(measurementCoverageDimensions({}, null).answeredDimensionKeys, [], "without a measurement nothing counts as answered");
});

test("proposal service: only a measured claim gets its gap state in the same command, through P2-04 by the same actor; a P2-04 refusal never undoes the claim", async () => {
  const calls = [];
  const claim = { claim_id: "4e000000-0000-4000-8000-000000000001" };
  const repository = (data) => ({ async proposeClaim() { return { ok: true, data }; } });
  const generate = async (input) => { calls.push(input); return { ok: true, data: { replayed: false, gapItems: [1, 2, 3, 4, 5, 6], clientFollowupItems: [] } }; };
  const deps = (data, extra = {}) => ({ env: ENV, claimProposalRepository: repository(data), metadataOnlyAudit: {}, generateClaimGapFollowups: generate, claimGapFollowupMetadataOnlyAudit: {}, ...extra });
  const input = { organizationId: ORG, evidenceItemId: "5e000000-0000-4000-8000-000000000001", actorContext: ADMIN, now: NOW };

  const legacy = await proposeClaim(input, deps({ claim, replayed: false }));
  assert.equal(legacy.ok, true);
  assert.equal(legacy.data.claim_gap_state, undefined);
  assert.equal(calls.length, 0, "a field-presence claim's P2-04 stays explicit");

  const measured = await proposeClaim(input, deps({ claim, replayed: false, measurementClaim: true }));
  assert.deepEqual(measured.data.claim_gap_state, { status: "generated", gap_item_count: 6, client_followup_item_count: 0, error_code: null });
  assert.deepEqual(calls, [{ organizationId: ORG, claimId: claim.claim_id, actorContext: ADMIN, now: NOW }]);

  const refused = await proposeClaim(input, deps({ claim, replayed: false, measurementClaim: true }, {
    generateClaimGapFollowups: async () => ({ ok: false, error: { code: "authorization_denied" } }),
  }));
  assert.equal(refused.ok, true, "the committed claim stands");
  assert.deepEqual(refused.data.claim_gap_state, { status: "not_generated", gap_item_count: null, client_followup_item_count: null, error_code: "authorization_denied" });
  const thrown = await proposeClaim(input, deps({ claim, replayed: false, measurementClaim: true }, {
    generateClaimGapFollowups: async () => { throw new Error("boom"); },
  }));
  assert.equal(thrown.data.claim_gap_state.error_code, "system_error");
});

test("measured-claim limitation codes: always the human-defined meaning, the period basis, nonzero blanks and duplicates, and every non-clear dimension", () => {
  const dimensions = {
    definition_clarity: { assessment_status: "resolved_clear", internal_limitation_accepted: false },
    duplicates: { assessment_status: "resolved_risk_flagged", internal_limitation_accepted: false },
    small_cell_risk: { assessment_status: "unresolved", internal_limitation_accepted: true },
    requirement_alignment: { assessment_status: "unresolved", internal_limitation_accepted: false },
  };
  assert.deepEqual(measurementLimitationCodes({ measurementRow: { period_start: "2026-09-01", blank_record_count: 1, duplicate_record_count: 2 }, dimensions }), [
    "coverage.duplicates.resolved_risk_flagged",
    "coverage.requirement_alignment.unresolved",
    "coverage.small_cell_risk.accepted_internal_limitation",
    "measurement.blank_records_excluded",
    "measurement.duplicate_records_included",
    "measurement.period_human_attested_not_row_verified",
    "measurement.record_meaning_human_defined",
  ]);
  assert.deepEqual(measurementLimitationCodes({ measurementRow: { period_start: null, blank_record_count: 0, duplicate_record_count: 0 }, dimensions: null }),
    ["measurement.no_reporting_period", "measurement.record_meaning_human_defined"]);
});

const MEASURED = Object.freeze({
  claimId: "11111111-1111-4111-8111-111111111111",
  evidenceItemId: "22222222-2222-4222-8222-222222222222",
  claimStatement: "The promoted source records 5 programme sessions for the reporting period 2026-09-01 to 2026-09-30 (record count: one programme session per CSV data record; 1 blank record excluded, 2 exact-duplicate records included).",
  requestedAudience: "internal",
  revalidatedForGeneration: true,
  currentEligible: true,
  audienceAuthority: { internal: true, funder: false, public: false },
  limitationCodes: [
    "coverage.small_cell_risk.accepted_internal_limitation",
    "measurement.blank_records_excluded",
    "measurement.duplicate_records_included",
    "measurement.period_human_attested_not_row_verified",
    "measurement.record_meaning_human_defined",
  ],
});
const GOOD = "The promoted source records 5 programme sessions for the reporting period 2026-09-01 to 2026-09-30, a count of source records each counted as one programme session under the human-confirmed definition. "
  + "The period is attested in that definition and not verified against record dates. 1 blank record was excluded and 2 exact-duplicate records were included. Internal limitation: small-cell risk.";
const val008 = (text, claims = [MEASURED]) => validateGeneratedContentDraft({
  requestedAudience: "internal",
  generationClaims: claims,
  blocks: [{ ordinal: 1, text, citations: [{ claimId: claims[0].claimId, evidenceItemId: claims[0].evidenceItemId }] }],
}).results.find((item) => item.validator_key === "VAL-GEN-008");

test("VAL-GEN-008: a block citing a measured claim must disclose each limitation and must not call the records distinct or the period verified", () => {
  assert.equal(val008(GOOD).severity, "pass");
  for (const [label, text] of [
    ["record meaning", GOOD.replace(", a count of source records each counted as one programme session under the human-confirmed definition", "")],
    ["period basis", GOOD.replace("The period is attested in that definition and not verified against record dates. ", "")],
    ["period verified", GOOD.replace("is attested in that definition and not verified against record dates", "is verified against record dates")],
    ["blanks", GOOD.replace("1 blank record was excluded and ", "")],
    ["duplicates", GOOD.replace(" and 2 exact-duplicate records were included", "")],
    ["distinct", `${GOOD} They are distinct sessions.`],
    ["coverage", GOOD.replace(" Internal limitation: small-cell risk.", "")],
  ]) {
    const result = val008(text);
    assert.equal(result.severity, "blocker", label);
    assert.equal(result.blocking_reason, "material_limitation_not_disclosed", label);
    assert.deepEqual(result.evidence.block_ordinals, [1], label);
  }
  // Not evaluated at all when no claim carries a measurement code.
  const legacy = { ...MEASURED, limitationCodes: ["coverage_dimension_unresolved"] };
  const results = validateGeneratedContentDraft({
    requestedAudience: "internal",
    generationClaims: [legacy],
    blocks: [{ ordinal: 1, text: "The promoted source records 5 programme sessions.", citations: [{ claimId: legacy.claimId, evidenceItemId: legacy.evidenceItemId }] }],
  });
  const keys = results.results.map((item) => item.validator_key);
  assert.equal(keys.includes("VAL-GEN-008"), false, JSON.stringify(results));
});

test("the evidence-summary prompt adds the measurement instruction only for measured claims", async () => {
  const systems = [];
  const generator = createProductionEvidenceSummaryDraftGenerator({
    createMessage: async (payload) => { systems.push(payload.system); return { content: [{ type: "text", text: "{\"blocks\":[]}" }] }; },
  });
  const claim = { claimId: MEASURED.claimId, claimStatement: "x", claimType: "finding", evidenceItemId: MEASURED.evidenceItemId, sourceId: MEASURED.claimId, sourceVersionId: MEASURED.claimId };
  await generator({ contentType: "evidence_summary", requestedAudience: "internal", claims: [{ ...claim, limitationCodes: [] }] });
  await generator({ contentType: "evidence_summary", requestedAudience: "internal", claims: [{ ...claim, limitationCodes: MEASURED.limitationCodes }] });
  assert.equal(systems[0], "You generate internal evidence summaries for Get Kinder. Use only the supplied governed claim projection. Every block must cite at least one supplied claim/evidence pair. Do not add numbers or causal language unless it appears in a cited claim statement.");
  assert.equal(systems[1].startsWith(systems[0]), true);
  assert.match(systems[1], /never call the records distinct or the period verified/);
});
