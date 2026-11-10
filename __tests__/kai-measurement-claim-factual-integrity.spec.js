import test from "node:test";
import assert from "node:assert/strict";

import { profileLocalTrustedFile } from "../Backend/kai/profiling/localProfilingKernel.js";
import * as M from "../Backend/kai/validators/kaiSourceMeasurementValidators.js";
import * as D from "../Backend/kai/validators/kaiDerivedMeasurementValidators.js";
import { validateGeneratedContentDraft } from "../Backend/kai/validators/kaiGeneratedContentValidators.js";
import { evaluateClaimTraceabilityInTransaction } from "../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js";
import {
  admitsProvisionalInternalUseInTransaction,
  evaluateMeasuredClaimIntegrityInTransaction,
  evaluateOrdinaryMeasurementAuthorityInTransaction,
  measuredFactIntegrityHoldsInTransaction,
  ordinaryInternalAuthorityOf,
} from "../Backend/kai/dictionary/postgresOrdinaryInternalFactAuthority.js";
import { classifyDraftPacket } from "../Backend/kai/dictionary/postgresOrganizationInternalReviewRepository.js";
import { makeStoryEvidenceFixture } from "./fixtures/kai-story-evidence-memory.js";

/**
 * Owner Package 1 (2026-11-10): measurement-to-claim factual integrity.
 * A numerical claim never asserts a population, status, reporting period,
 * denominator, counted entity, deduplication, inclusion or exclusion rule
 * that its calculation did not establish. Synthetic data only. Every
 * expected value is computed here from the generated rows by plain code that
 * shares nothing with KAI (the independent oracle), never from KAI's output.
 */

// ---------------------------------------------------------------------------
// Synthetic Community Project B service log.
// 215 distinct contacts + 2 exact copies of eligible contacts = 217 physical
// rows. 190 distinct contacts are completed and in FY 2025-26, involving 67
// people; 25 are cancelled, no-show, or completed outside the FY.

const FY = Object.freeze({ start: "2025-04-01", end: "2026-03-31" });
const person = (index) => `P${String(index).padStart(3, "0")}`;
const day = (year, month, dayOfMonth) => `${year}-${String(month).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;
const FY_MONTHS = [[2025, 4], [2025, 5], [2025, 6], [2025, 7], [2025, 8], [2025, 9], [2025, 10], [2025, 11], [2025, 12], [2026, 1], [2026, 2], [2026, 3]];

function projectBRows() {
  const rows = [];
  let contact = 0;
  const add = (personIndex, date, status) => {
    contact += 1;
    rows.push([`C${String(contact).padStart(4, "0")}`, person(personIndex), date, status, "Synthetic service contact"]);
  };
  for (let index = 0; index < 190; index += 1) {
    const [year, month] = FY_MONTHS[index % 12];
    add((index % 67) + 1, day(year, month, (index % 27) + 1), "Completed");
  }
  for (let index = 0; index < 10; index += 1) add((index % 67) + 1, day(2025, 6, index + 1), "Cancelled");
  for (let index = 0; index < 7; index += 1) add((index % 67) + 1, day(2025, 9, index + 1), "No show");
  for (let index = 0; index < 4; index += 1) add(68 + index, day(2025, 3, index + 10), "Completed");
  for (let index = 0; index < 4; index += 1) add(72 + index, day(2026, 4, index + 10), "Completed");
  // Two exact duplicate copies (a re-entered row each) of eligible contacts.
  rows.push([...rows[4]], [...rows[100]]);
  return rows;
}

const HEADER = ["contact_id", "person_id", "contact_date", "status", "notes"];
const ROWS = projectBRows();
const CSV = `${[HEADER, ...ROWS].map((row) => row.join(",")).join("\n")}\n`;

// Independent oracle: plain arithmetic over the same rows.
const ORACLE = (() => {
  const groups = new Map();
  for (const row of ROWS) groups.set(row.join("|"), (groups.get(row.join("|")) ?? 0) + 1);
  const repeated = [...groups.values()].filter((count) => count > 1);
  const distinctContacts = new Map(ROWS.map((row) => [row[0], row]));
  const eligible = [...distinctContacts.values()].filter((row) => row[3] === "Completed" && row[2] >= FY.start && row[2] <= FY.end);
  return Object.freeze({
    physicalRows: ROWS.length,
    duplicateGroupMembers: repeated.reduce((total, count) => total + count, 0),
    excessCopies: repeated.reduce((total, count) => total + count - 1, 0),
    completedFyRowsWithCopies: ROWS.filter((row) => row[3] === "Completed" && row[2] >= FY.start && row[2] <= FY.end).length,
    completedFyContacts: eligible.length,
    completedFyPeople: new Set(eligible.map((row) => row[1])).size,
  });
})();

// The human definition someone typed into Count records for that file.
const PROJECT_B_DEFINITION = Object.freeze({
  counted_unit: "completed contact",
  unit_label: "completed FY contacts",
  definition_text: "Each row is one completed service contact in fiscal year 2025-26.",
  inclusion_rule: "Contacts with status Completed dated in the fiscal year.",
  exclusion_rule: "Cancelled and no-show contacts, duplicate entries and contacts outside the fiscal year.",
  period_start: FY.start,
  period_end: FY.end,
});

async function profile(text = CSV) {
  const bytes = new TextEncoder().encode(text);
  return profileLocalTrustedFile({ extension: ".csv", declaredMime: "text/csv", byteSize: bytes.byteLength, bytes });
}

// The persisted rows a recorded Project B count has (the measurement row as
// the scoped query reads it, with its definition columns).
function projectBMeasurementRow(measurement, definition = PROJECT_B_DEFINITION, tabular = null) {
  return {
    measured_value: measurement.measuredValue, total_record_count: measurement.totalRecordCount,
    blank_record_count: measurement.blankRecordCount, duplicate_record_count: measurement.duplicateRecordCount,
    calculation_method: measurement.calculationMethod, unit_label: definition.unit_label, counted_unit: definition.counted_unit,
    period_start: definition.period_start ?? null, period_end: definition.period_end ?? null,
    profile_tabular_duplicates: tabular,
  };
}

const ASSERTED_STRONGER = /\b(completed|FY|fiscal|contacts?|people|persons?|participants?|unique|distinct|deduplicated|eligible|for the reporting period)\b/i;

test("the synthetic Project B oracle matches the accepted evidence (217 rows, 190 completed FY contacts, 67 people, 4 group members, 2 excess copies)", () => {
  assert.deepEqual({ ...ORACLE }, {
    physicalRows: 217, duplicateGroupMembers: 4, excessCopies: 2, completedFyRowsWithCopies: 192, completedFyContacts: 190, completedFyPeople: 67,
  });
});

test("1+4 the 217-row source yields a truthful raw count of 217 source records, with blanks, duplicates and method stated", async () => {
  const committed = await profile();
  assert.equal(committed.counts.row_count, ORACLE.physicalRows);
  const derived = M.deriveRecordCountMeasurement(committed);
  assert.equal(derived.ok, true, JSON.stringify(derived.blockers));
  assert.equal(derived.measurement.measuredValue, ORACLE.physicalRows);
  assert.equal(derived.measurement.calculationMethod, M.MEASUREMENT_CALCULATION_METHOD);
  const definition = M.validateRecordCountDefinition(PROJECT_B_DEFINITION);
  assert.equal(definition.ok, true);
  const evidence = M.composeMeasurementEvidenceStatement({ measurement: derived.measurement, definition: definition.definition });
  assert.equal(evidence,
    "Source version record count: 217 source records (each CSV data record after the header row; 0 blank records excluded; "
    + "4 in exact-duplicate groups (2 excess copies), not removed). "
    + "Not applied by KAI: the organization's description of each record as one completed contact, its stated period 2025-04-01 to 2026-03-31, "
    + "and its inclusion and exclusion rules.");
  assert.equal(M.validateComposedStatement(evidence).ok, true);
  const claim = M.composeMeasurementClaimStatement({
    measurementRow: projectBMeasurementRow(derived.measurement, PROJECT_B_DEFINITION, committed.tabular_measurement_basis),
    definitionRow: projectBMeasurementRow(derived.measurement, PROJECT_B_DEFINITION),
  });
  assert.equal(claim,
    "The promoted source has 217 source records (record count: one record per CSV data record; 0 blank records excluded; "
    + "4 in exact-duplicate groups (2 excess copies), not removed). "
    + "Not applied by KAI: the organization's description of each record as one completed contact, its stated period 2025-04-01 to 2026-03-31, "
    + "and its inclusion and exclusion rules.");
  assert.equal(M.validateComposedStatement(claim).ok, true);
});

test("2 the raw count can never become a verified 217 completed FY contacts claim", async () => {
  const committed = await profile();
  const { measurement } = M.deriveRecordCountMeasurement(committed);
  const row = projectBMeasurementRow(measurement, PROJECT_B_DEFINITION, committed.tabular_measurement_basis);
  const claim = M.composeMeasurementClaimStatement({ measurementRow: row, definitionRow: row });
  const parsed = M.parseMeasuredCountStatement(claim);
  assert.deepEqual({ ...parsed }, {
    value: String(ORACLE.physicalRows), unitLabel: "source records",
    assertedText: claim.slice(0, claim.indexOf(" Not applied by KAI:")), legacy: false,
  });
  // What the claim asserts names only source records and the method's own handling.
  assert.doesNotMatch(parsed.assertedText, ASSERTED_STRONGER);
  assert.doesNotMatch(claim, /217 completed|completed FY contacts|\b190\b|\b67\b|\b192\b/);
  // The human meaning stays traceable, explicitly attributed and not applied.
  assert.equal(claim.slice(parsed.assertedText.length), " Not applied by KAI: the organization's description of each record as one completed contact, its stated period 2025-04-01 to 2026-03-31, and its inclusion and exclusion rules.");
  // The figure differs from every stronger measurement the definition names.
  assert.notEqual(measurement.measuredValue, ORACLE.completedFyContacts);
  assert.notEqual(measurement.measuredValue, ORACLE.completedFyPeople);
});

test("3 typing a period or an exclusion rule does not execute it: the counted value and the asserted text never change", async () => {
  const committed = await profile();
  const { measurement } = M.deriveRecordCountMeasurement(committed);
  const variants = [
    PROJECT_B_DEFINITION,
    { ...PROJECT_B_DEFINITION, period_start: "2025-07-01", period_end: "2025-07-31" },
    { ...PROJECT_B_DEFINITION, exclusion_rule: "Every row except completed contacts with person P001." },
    { ...PROJECT_B_DEFINITION, inclusion_rule: "Only unique people.", counted_unit: "unique person", unit_label: "unique people" },
    (({ period_start: _start, period_end: _end, ...rest }) => rest)(PROJECT_B_DEFINITION),
  ];
  const asserted = new Set();
  for (const variant of variants) {
    const definition = M.validateRecordCountDefinition(variant);
    assert.equal(definition.ok, true, JSON.stringify(definition.blockers));
    const row = projectBMeasurementRow(measurement, variant, committed.tabular_measurement_basis);
    const claim = M.composeMeasurementClaimStatement({ measurementRow: row, definitionRow: row });
    asserted.add(M.parseMeasuredCountStatement(claim).assertedText);
    assert.match(claim, / Not applied by KAI: the organization's description of each record as one /);
    assert.doesNotMatch(claim, /\bfor the reporting period\b/, "a typed period is never worded as applied");
    const evidence = M.composeMeasurementEvidenceStatement({ measurement, definition: definition.definition });
    assert.match(evidence, /^Source version record count: 217 source records \(/);
  }
  assert.equal(asserted.size, 1, "the asserted measurement is the same whatever was typed");
  // The derivation reads only the committed profile: no definition argument exists.
  assert.equal(M.deriveRecordCountMeasurement.length, 1);
  // The definition fingerprint still records exactly what was typed.
  const typed = M.validateRecordCountDefinition(PROJECT_B_DEFINITION).definition;
  assert.notEqual(
    M.computeDefinitionFingerprint({ organizationId: "o", sourceVersionId: "v", definition: typed }),
    M.computeDefinitionFingerprint({ organizationId: "o", sourceVersionId: "v", definition: { ...typed, exclusionRule: "Nothing." } }),
  );
});

test("4 a legitimate record count stays available with accurate wording, including the longest permitted labels", async () => {
  const csv = "session_ref,topic\nS1,Budgeting\nS2,Budgeting\n,\nS3,Housing\n";
  const committed = await profile(csv);
  const derived = M.deriveRecordCountMeasurement(committed);
  assert.equal(derived.ok, true);
  assert.deepEqual([derived.measurement.totalRecordCount, derived.measurement.blankRecordCount, derived.measurement.measuredValue], [4, 1, 3]);
  const definition = { counted_unit: "service log record", unit_label: "service log records", definition_text: "Each row is one log entry.", inclusion_rule: "Every row.", exclusion_rule: "Blank rows." };
  const row = projectBMeasurementRow(derived.measurement, definition, committed.tabular_measurement_basis);
  const claim = M.composeMeasurementClaimStatement({ measurementRow: row, definitionRow: row });
  assert.equal(claim, "The promoted source has 3 source records (record count: one record per CSV data record; 1 blank record excluded; no exact duplicates). "
    + "Not applied by KAI: the organization's description of each record as one service log record and its inclusion and exclusion rules; no reporting period was defined.");
  // The longest labels a definition accepts still compose within the statement limit, for the longest method wording.
  const long = "L".repeat(80);
  const worst = M.composeMeasurementEvidenceStatement({
    measurement: { measuredValue: 999999, blankRecordCount: 99999, duplicateRecordCount: 99999, countedDuplicates: null,
      calculationMethod: M.MEASUREMENT_XLSX_SELECTED_CALCULATION_METHOD, sheetKey: "sheet_9999" },
    definition: { countedUnit: long, unitLabel: long, periodStart: "2025-04-01", periodEnd: "2026-03-31" },
  });
  assert.equal(M.validateComposedStatement(worst).ok, true, `${worst.length} characters`);
});

test("5 duplicate-group members are never confused with excess copies; an inconsistent or missing basis says the excess is not recorded", async () => {
  const committed = await profile();
  const derived = M.deriveRecordCountMeasurement(committed);
  assert.equal(derived.measurement.duplicateRecordCount, ORACLE.duplicateGroupMembers, "the P1 profile's count is group members");
  assert.deepEqual({ ...derived.measurement.countedDuplicates }, { memberRecordCount: ORACLE.duplicateGroupMembers, excessCopyCount: ORACLE.excessCopies });
  assert.notEqual(ORACLE.duplicateGroupMembers, ORACLE.excessCopies);
  // A basis for a different number of records, or with impossible counts, is not used.
  const basis = committed.tabular_measurement_basis;
  assert.equal(M.countedDuplicateGroups(basis, ORACLE.physicalRows - 1), null);
  assert.equal(M.countedDuplicateGroups({ ...basis, exact_duplicates: { group_count: 2, member_record_count: 4, excess_copy_count: 3 } }, ORACLE.physicalRows), null);
  assert.equal(M.countedDuplicateGroups({ ...basis, status: "too_large" }, ORACLE.physicalRows), null);
  // A profile without the basis (committed before it existed) states members only.
  const { tabular_measurement_basis: _omitted, ...legacyProfile } = committed;
  const legacy = M.deriveRecordCountMeasurement(legacyProfile);
  assert.equal(legacy.measurement.countedDuplicates, null);
  const definition = M.validateRecordCountDefinition(PROJECT_B_DEFINITION).definition;
  assert.match(M.composeMeasurementEvidenceStatement({ measurement: legacy.measurement, definition }),
    /; 4 data records in exact-duplicate groups \(excess copies not recorded\), not removed\)\./);
  // The record count applies no duplicate policy: duplicates are counted, and that is disclosed.
  assert.ok(M.measurementLimitationCodes({ measurementRow: { period_start: FY.start, blank_record_count: 0, duplicate_record_count: 4 }, dimensions: null })
    .includes(M.MEASUREMENT_LIMITATION_CODES.DUPLICATE_RECORDS_INCLUDED));
});

test("9 the existing derived methods, which execute the conditions, give the stronger measurements the definition only described", async () => {
  const committed = await profile();
  const basis = committed.tabular_measurement_basis;
  const field = (key) => basis.fields.find((candidate) => candidate.field_key === key);
  const completed = field("field_4").categorical.values.findIndex((value) => value.label === "Completed");
  assert.ok(completed >= 0, JSON.stringify(field("field_4").categorical));
  const status = { kind: "category", field_key: "field_4", value_key: `value_${completed + 1}` };
  const inFy = { kind: "period", field_key: "field_3", period_source: D.PERIOD_SOURCE_ENGAGEMENT, scope: "within" };
  const derive = (input) => {
    const definition = D.validateTabularMeasurementDefinition(input);
    assert.equal(definition.ok, true, JSON.stringify(definition.blockers));
    return D.deriveTabularMeasurement(committed, null, definition.definition, { reportingPeriod: FY });
  };
  const rows = derive({ operation: "count", conditions: [status, inFy] });
  assert.equal(rows.ok, true, JSON.stringify(rows.blockers));
  assert.equal(rows.measurement.measuredValue, ORACLE.completedFyRowsWithCopies, "records with the status in the period, copies included");
  const contacts = derive({ operation: "count", unit: { kind: "distinct_key", field_key: "field_1", duplicate_policy: D.DUPLICATE_POLICY_COUNT_EACH_KEY_ONCE }, conditions: [status, inFy] });
  assert.equal(contacts.ok, true, JSON.stringify(contacts.blockers));
  assert.equal(contacts.measurement.measuredValue, ORACLE.completedFyContacts);
  // Distinct people across several months is refused rather than approximated (the basis keeps months only).
  const people = derive({ operation: "count", unit: { kind: "distinct_key", field_key: "field_2", duplicate_policy: D.DUPLICATE_POLICY_COUNT_EACH_KEY_ONCE }, conditions: [status, inFy] });
  assert.equal(people.ok, false);
  assert.equal(people.blockers[0].blocking_reason, "tabular_distinct_not_exact_for_period");
});

test("6 generated text from a new record-count claim cannot restate the attributed label as the counted entity", async () => {
  const committed = await profile();
  const { measurement } = M.deriveRecordCountMeasurement(committed);
  const row = projectBMeasurementRow(measurement, PROJECT_B_DEFINITION, committed.tabular_measurement_basis);
  const claimStatement = M.composeMeasurementClaimStatement({ measurementRow: row, definitionRow: row });
  const claim = {
    claimId: "c0000000-0000-4000-8000-000000000217", evidenceItemId: "e0000000-0000-4000-8000-000000000217", claimStatement,
    requestedAudience: "internal", revalidatedForGeneration: true, audienceAuthority: { internal: true },
    limitationCodes: M.measurementLimitationCodes({ measurementRow: { ...row }, dimensions: null }),
  };
  const disclosure = "It is a count of source records only under a human-defined record meaning. The reporting period is attested in the definition and was not verified. "
    + "Exact-duplicate records are included in the count.";
  const validate = (text) => validateGeneratedContentDraft({
    requestedAudience: "internal", contentType: "evidence_summary", generationClaims: [claim],
    blocks: [{ ordinal: 1, text: `${text} ${disclosure}`, citations: [{ claimId: claim.claimId, evidenceItemId: claim.evidenceItemId }] }],
  });
  const val008 = (text) => validate(text).blockers.filter((item) => item.validator_key === "VAL-GEN-008");
  for (const misleading of ["The programme delivered 217 completed FY contacts.", "217 completed contacts were recorded.", "The service completed 217 records in the year."]) {
    assert.notDeepEqual(val008(misleading), [], misleading);
  }
  assert.deepEqual(val008("The service log holds 217 source records."), []);
  // Stronger figures the calculation never produced are unsupported numbers.
  for (const invented of ["The log shows 190 records.", "The log shows 67 records."]) {
    assert.ok(validate(invented).blockers.some((item) => item.validator_key === "VAL-GEN-004"), invented);
  }
});

// ---------------------------------------------------------------------------
// Persisted claims: the shared integrity rule at P2-06, ordinary authority and
// provisional admission, on the synthetic in-memory lineage (production code
// with only SQL storage simulated).

// Exactly what the pre-repair composer wrote for the fixture's measurement.
const PRE_REPAIR_STATEMENT = "The promoted source records 37 service events with no reporting period defined (record count: one service event per CSV data record; 0 blank records excluded, 0 exact-duplicate records included).";
const APPROVED_HEAD = { decision_id: "75000000-0000-4000-8000-000000000001", decision_outcome: "approved", approved_audiences: ["internal", "funder"], decided_by_role: "gk_reviewer" };
const SUPPORTED_HEAD = { decision_id: "75000000-0000-4000-8000-000000000002", decision_outcome: "supported", decided_by_role: "gk_reviewer" };

// A count whose claim and evidence a person reviewed: recorded decisions,
// supported strengths and resolved review queue items.
function reviewedCount() {
  const fixture = makeStoryEvidenceFixture({
    kind: "count", claimHead: APPROVED_HEAD, evidenceHead: SUPPORTED_HEAD, claimStrength: "reviewed_supported", supportStrength: "reviewed_supported",
  });
  const query = fixture.tx.query.bind(fixture.tx);
  fixture.tx.query = async (sql, params) => {
    const result = await query(sql, params);
    const text = typeof sql === "string" ? sql : sql?.text ?? "";
    if (text.includes("kai.review_queue_items") && /queue_type = '(?:evidence_review|claim_review)'/.test(text)) {
      return { rows: result.rows.map((row) => ({ ...row, queue_status: "resolved", review_status: "resolved" })) };
    }
    return result;
  };
  return fixture;
}

const trace = (f, requestedAudience = "internal") => evaluateClaimTraceabilityInTransaction(f.tx, { organizationId: f.organizationId, claimId: f.claimId, requestedAudience });

test("7+8 a current record-count claim is usable; the same lineage holding a pre-repair claim is blocked however it was reviewed, for every audience and use", async () => {
  // Current composition, no review: ordinary internal authority applies.
  const ordinary = makeStoryEvidenceFixture({ kind: "count" });
  assert.match(ordinary.claimRow.statement, /^The promoted source has 37 source records /);
  const fresh = await trace(ordinary);
  assert.equal(fresh.ok, true, JSON.stringify(fresh.error));
  assert.equal(fresh.data.eligible, true, JSON.stringify(fresh.data.blockerCodes));
  assert.equal(ordinaryInternalAuthorityOf(fresh.data).basis, "all_sensitive_categories_absent");

  // Reviewed and approved current claim: eligible.
  const reviewed = reviewedCount();
  const before = await trace(reviewed);
  assert.equal(before.data.eligible, true, JSON.stringify(before.data.blockerCodes));

  // The same reviewed lineage with the pre-repair wording persisted.
  reviewed.claimRow.statement = PRE_REPAIR_STATEMENT;
  const statementBefore = reviewed.claimRow.statement;
  for (const audience of ["internal", "funder", "public"]) {
    const result = await trace(reviewed, audience);
    assert.equal(result.ok, true, "the lineage stays readable and auditable");
    assert.equal(result.data.eligible, false, audience);
    assert.ok(result.data.blockerCodes.includes("measured_claim_integrity_not_established"), `${audience}: ${result.data.blockerCodes}`);
    assert.ok(result.data.affectedObjectIds.includes(reviewed.claimId) && result.data.affectedObjectIds.includes(reviewed.evidenceItemId));
    assert.equal(result.data.claim.statement, PRE_REPAIR_STATEMENT, "the stored claim is reported exactly as recorded");
    assert.equal(result.data.claim_review_decision.decision_outcome, "approved", "the recorded review decision is preserved, not rewritten");
  }
  assert.equal(reviewed.claimRow.statement, statementBefore, "nothing rewrote the stored claim");

  // Ordinary authority, provisional admission and the shared rule agree.
  const rows = { organizationId: reviewed.organizationId, evidenceItemRow: reviewed.evidenceItemRow, locatorRow: reviewed.locatorRow, sourceVersionRow: reviewed.sourceVersionRow, claimRow: reviewed.claimRow };
  assert.equal((await evaluateMeasuredClaimIntegrityInTransaction(reviewed.tx, rows)).reason, "claim_not_measurement_restatement");
  const authority = await evaluateOrdinaryMeasurementAuthorityInTransaction(reviewed.tx, rows);
  assert.equal(authority.ordinary, false);
  assert.ok(authority.reasons.includes("claim_not_measurement_restatement"));
  assert.equal(await measuredFactIntegrityHoldsInTransaction(reviewed.tx, { organizationId: reviewed.organizationId, claimId: reviewed.claimId, evidenceItemId: reviewed.evidenceItemId }), false);
  const internal = await trace(reviewed);
  assert.equal(await admitsProvisionalInternalUseInTransaction(reviewed.tx, { organizationId: reviewed.organizationId, requestedAudience: "internal", data: internal.data }), false,
    "provisional drafting does not establish measurement correctness");
});

test("7 a favorable review cannot establish a measurement that no longer matches its basis", async () => {
  const reviewed = reviewedCount();
  reviewed.row.measured_value = 38; // arithmetic no longer total - blank
  const result = await trace(reviewed);
  assert.equal(result.data.eligible, false);
  assert.ok(result.data.blockerCodes.includes("measured_claim_integrity_not_established"));
});

test("10 a draft citing a claim whose measured integrity fails is withheld, not treated as a provisional finding", () => {
  const citation = (blockerCodes) => ({ claimId: "c1", evidenceItemId: "e1", sourceVersionId: "v1", blockerCodes });
  const packet = (blockerCodes) => ({ contentType: "evidence_summary", requestedAudience: "internal", currentUseEligible: false, blocks: [{ citations: [citation(blockerCodes)] }] });
  assert.deepEqual(classifyDraftPacket(packet(["claim_review_unresolved"])).blockedReasons, ["cited_claims_not_currently_eligible"]);
  assert.deepEqual(classifyDraftPacket(packet(["measured_claim_integrity_not_established"])).blockedReasons,
    ["cited_claims_not_currently_eligible", "cited_measured_claim_integrity_not_established"]);
});

test("8 derived measurements keep working under the same shared rule; a derived claim that is not its measurement's restatement is blocked", async () => {
  const derived = makeStoryEvidenceFixture({ kind: "derived" });
  const ok = await trace(derived);
  assert.equal(ok.ok, true);
  assert.ok(!ok.data.blockerCodes.includes("measured_claim_integrity_not_established"), JSON.stringify(ok.data.blockerCodes));
  assert.equal(ok.data.eligible, true, JSON.stringify(ok.data.blockerCodes));
  derived.claimRow.statement = `${derived.claimRow.statement} All participants improved.`;
  const altered = await trace(derived);
  assert.ok(altered.data.blockerCodes.includes("measured_claim_integrity_not_established"));
  // Evidence that is not a measurement is outside the rule.
  const document = makeStoryEvidenceFixture({ kind: "document" });
  const documentTrace = await trace(document);
  assert.ok(!documentTrace.data.blockerCodes.includes("measured_claim_integrity_not_established"));
});
