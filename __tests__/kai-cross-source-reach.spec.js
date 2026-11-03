import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { profileLocalTrustedFile } from "../Backend/kai/profiling/localProfilingKernel.js";
import { reconcileLinkedReach } from "../Backend/kai/parsing/crossSourceReachReconciliation.js";
import { createCrossSourceReconciliationWorker } from "../Backend/kai/parsing/crossSourceReconciliationWorker.js";
import * as D from "../Backend/kai/validators/kaiDerivedMeasurementValidators.js";
import { composeEvidenceSummaryMeasurementDisclosures, validateGeneratedContentDraft } from "../Backend/kai/validators/kaiGeneratedContentValidators.js";

/**
 * Measurement MVP: cross-source linked reach, pure. Synthetic service events
 * and a synthetic register with generic field names; every expected value is
 * recomputed here by a calculation that shares no code with KAI. The
 * connected proof on the original Cedar Bridge bytes is the six-source
 * acceptance.
 */

// Events: E01 copied exactly (excess copy), E02 copied with a different
// participant (conflicting identity), a blank event identifier, a cancelled
// event, the period's first and last days and the days just outside it, an
// invalid date, a blank participant, an unmatched participant (P99), and two
// groups with one person (P01) in both.
const EVENT_ROWS = [
  ["ref", "person_ref", "track", "held_on", "state", "minutes"],
  ["E01", "P01", "AA", "2025-04-01", "done", "30"],
  ["E01", "P01", "AA", "2025-04-01", "done", "30"],
  ["E02", "P02", "AA", "2025-05-01", "done", "30"],
  ["E02", "P03", "AA", "2025-05-01", "done", "30"],
  ["", "P02", "AA", "2025-05-02", "done", "30"],
  ["E03", "P02", "AA", "2025-06-01", "dropped", "30"],
  ["E04", "P01", "BB", "2026-03-31", "done", "45"],
  ["E05", "P03", "BB", "2025-03-31", "done", "45"],
  ["E06", "P03", "BB", "2026-04-01", "done", "45"],
  ["E07", "P04", "BB", "2025-02-30", "done", "45"],
  ["E08", "", "BB", "2025-07-01", "done", "45"],
  ["E09", "P99", "AA", "2025-08-01", "done", "45"],
  ["E10", "P02", "AA", "2025-09-01", "done", "45"],
  ["E11", "P02", "AA", "2025-09-15", "done", "45"],
  ["E12", "P04", "BB", "2025-10-01", "done", "45"],
  ["E13", "P05", "AA", "2025-10-01", "dropped", "45"],
  ["E14", "P05", "BB", "2025-11-01", "dropped", "45"],
  // Dropped sessions of other people, so the participant field has the
  // cardinality the profiler needs to propose it as an identifier.
  ...Array.from({ length: 15 }, (_, index) => [`E${index + 20}`, `P${index + 20}`, "AA", "2025-06-15", "dropped", "30"]),
];
const REGISTER_ROWS = [
  ["person_ref", "joined_on", "status"],
  ["P01", "2025-04-01", "open"], ["P02", "2025-04-02", "open"], ["P03", "2025-04-03", "closed"],
  ["P04", "2025-04-04", "closed"], ["P05", "2025-04-05", "open"], ["P05", "2025-04-05", "open"],
];
const PERIOD = { start: "2025-04-01", end: "2026-03-31" };
const csv = (rows) => `${rows.map((row) => row.join(",")).join("\n")}\n`;
const bytesOf = (rows) => new TextEncoder().encode(csv(rows));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function profile(rows) {
  const bytes = bytesOf(rows);
  return profileLocalTrustedFile({ extension: ".csv", declaredMime: "text/csv", byteSize: bytes.byteLength, bytes });
}

// Independent calculation over the same rows.
function independent() {
  const events = EVENT_ROWS.slice(1);
  const ids = new Map();
  for (const row of events) if (row[0]) ids.set(row[0], [...(ids.get(row[0]) || []), row]);
  const consistent = [...ids.values()].filter((copies) => new Set(copies.map((row) => row.slice(1, 5).join("|"))).size === 1).map((copies) => copies[0]);
  const completed = consistent.filter((row) => row[4] === "done");
  const valid = (day) => /^\d{4}-\d{2}-\d{2}$/.test(day) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
  const inPeriod = completed.filter((row) => valid(row[3]) && row[3] >= PERIOD.start && row[3] <= PERIOD.end);
  const register = new Set(REGISTER_ROWS.slice(1).map((row) => row[0]));
  const eligible = inPeriod.filter((row) => row[1] && register.has(row[1]));
  const people = (list) => new Set(list.map((row) => row[1]));
  const aa = eligible.filter((row) => row[2] === "AA");
  const bb = eligible.filter((row) => row[2] === "BB");
  return {
    physical: events.length,
    distinctEvents: ids.size,
    excess: [...ids.values()].reduce((total, copies) => total + copies.length - 1, 0),
    completed: completed.length,
    withoutDate: completed.filter((row) => !valid(row[3])).length,
    outside: completed.filter((row) => valid(row[3]) && (row[3] < PERIOD.start || row[3] > PERIOD.end)).length,
    inPeriod: inPeriod.length,
    unmatched: inPeriod.filter((row) => row[1] && !register.has(row[1])).length,
    blankParticipant: inPeriod.filter((row) => !row[1]).length,
    eligible: eligible.length,
    people: people(eligible).size,
    aa: [aa.length, people(aa).size],
    bb: [bb.length, people(bb).size],
    both: [...people(aa)].filter((id) => people(bb).has(id)).length,
  };
}

const MAPPING = Object.freeze({
  events: {
    event_identifier_field_key: "field_1", participant_identifier_field_key: "field_2", status_field_key: "field_5",
    completed_value_key: "value_1", date_field_key: "field_4", group_field_key: "field_3",
  },
  register: { participant_identifier_field_key: "field_1" },
});

async function resolvedMapping() {
  const [eventsProfile, registerProfile] = [await profile(EVENT_ROWS), await profile(REGISTER_ROWS)];
  const mapping = D.validateCrossSourceReachMapping(MAPPING);
  assert.equal(mapping.ok, true, JSON.stringify(mapping.blockers));
  const resolved = D.resolveCrossSourceReachMapping({ eventsProfile, registerProfile, mapping: mapping.mapping, reportingPeriod: PERIOD });
  assert.equal(resolved.ok, true, JSON.stringify(resolved.blockers));
  return { eventsProfile, registerProfile, mapping: mapping.mapping, resolved };
}

const REFERENCE = Object.freeze({ sourceVersionId: "5a000000-0000-4000-8000-000000000002", profileCanonicalSha256: "b".repeat(64) });
const PRIMARY_VERSION = "5a000000-0000-4000-8000-000000000001";

function rowOf(measurement, { interpretation = null, sources = "current" } = {}) {
  const contributing = sources === "current"
    ? [
      { source_role: "primary", source_version_id: PRIMARY_VERSION, profile_canonical_sha256: "a".repeat(64), bound_profile_canonical_sha256: "a".repeat(64), is_current: true },
      { source_role: "reference", source_version_id: REFERENCE.sourceVersionId, profile_canonical_sha256: REFERENCE.profileCanonicalSha256, bound_profile_canonical_sha256: REFERENCE.profileCanonicalSha256, is_current: true },
    ]
    : sources;
  return {
    measurement_family: measurement.family, calculation_method: measurement.calculationMethod, worksheet_key: null, definition: measurement.definition,
    field_keys: measurement.fieldKeys, measured_value: measurement.measuredValue, numerator: measurement.numerator, denominator: measurement.denominator ?? null, percentage: measurement.percentage ?? null,
    component_counts: measurement.componentCounts, exclusions: measurement.exclusions, measurement_source_version_id: PRIMARY_VERSION, contributing_sources: contributing,
    ...(interpretation ? { interpretation_id: "i1", current_interpretation_id: "i1", ...interpretation } : { interpretation_id: null, current_interpretation_id: null }),
  };
}

async function measurements() {
  const { resolved } = await resolvedMapping();
  const reconciliation = reconcileLinkedReach({ eventRecords: EVENT_ROWS, registerRecords: REGISTER_ROWS, mapping: D.crossSourceWorkerMapping(resolved.resolved) });
  return { reconciliation, measurements: D.deriveCrossSourceReachMeasurements({ resolved: resolved.resolved, eventFieldKeys: resolved.eventFieldKeys, reconciliation, reference: REFERENCE }) };
}

const metric = (list, name, groupLabel = null) => list.find((m) => m.definition.metric === name && (m.definition.group?.value_label ?? null) === groupLabel);

test("the reconciliation agrees with an independent calculation, decision by decision", async () => {
  const { reconciliation, measurements: list } = await measurements();
  const c = reconciliation.counts;
  const expected = independent();
  assert.deepEqual(
    [c.physical_record_count, c.distinct_event_count, c.excess_copy_record_count, c.completed_event_count, c.completed_without_date_count,
      c.completed_outside_period_count, c.in_period_completed_event_count, c.unmatched_event_count, c.blank_participant_identifier_event_count, c.eligible_encounter_count, c.distinct_person_count],
    [expected.physical, expected.distinctEvents, expected.excess, expected.completed, expected.withoutDate,
      expected.outside, expected.inPeriod, expected.unmatched, expected.blankParticipant, expected.eligible, expected.people],
  );
  // Physical rows, duplicate-group members and excess copies are separate concepts.
  assert.deepEqual([c.duplicate_group_count, c.duplicate_member_record_count, c.excess_copy_record_count], [2, 4, 2]);
  // E02's copies disagree: excluded whole, never resolved by choosing one.
  assert.deepEqual([c.conflicting_event_identity_count, c.conflicting_record_count], [1, 2]);
  assert.deepEqual(reconciliation.row_exclusions.conflicting_event_identities.rows, [4, 5]);
  // Day precision: the first and last days are in, the days just outside are out, and 2025-02-30 has no valid date.
  assert.deepEqual(reconciliation.row_exclusions.completed_outside_period.rows, [9, 10]);
  assert.deepEqual(reconciliation.row_exclusions.completed_without_date.rows, [11]);
  assert.deepEqual(reconciliation.row_exclusions.unmatched_participant_identifier.rows, [13]);
  assert.deepEqual(reconciliation.row_exclusions.excess_duplicate_copies.rows, [3]);
  assert.equal(c.unmatched_identity_count, 1);
  // Groups and overlap: P01 has encounters in both groups and is counted once overall.
  assert.deepEqual(reconciliation.groups.map((g) => [g.label, g.encounter_count, g.distinct_person_count]), [["AA", ...expected.aa], ["BB", ...expected.bb]]);
  assert.equal(c.multi_group_person_count, expected.both);
  assert.equal(c.distinct_person_count, expected.aa[1] + expected.bb[1] - expected.both);
  // The register: repeated identifiers do not double a match.
  assert.deepEqual([c.register_record_count, c.register_distinct_identifier_count, c.register_repeated_identifier_count], [6, 5, 1]);
  // Seven measurements, each with its own value and the shared funnel.
  assert.deepEqual(list.map((m) => [m.definition.metric, m.definition.group?.value_label ?? null, m.measuredValue]), [
    ["eligible_linked_encounters", null, expected.eligible],
    ["distinct_people_served", null, expected.people],
    ["group_linked_encounters", "AA", expected.aa[0]],
    ["group_distinct_people_served", "AA", expected.aa[1]],
    ["group_linked_encounters", "BB", expected.bb[0]],
    ["group_distinct_people_served", "BB", expected.bb[1]],
    ["people_in_more_than_one_group", null, expected.both],
  ]);
  for (const m of list) assert.equal(D.derivedMeasurementArithmeticHolds(rowOf(m)), true, m.definition.metric);
  assert.equal(new Set(list.map((m) => m.measurementKey)).size, list.length);
  // Nothing calculated carries an identifier or a date.
  const serialized = JSON.stringify({ reconciliation, list });
  for (const raw of ["E01", "E09", "P01", "P99", "2025-04-01T", "2025-08-01", "2026-03-31\"", "minutes"]) {
    if (raw === "2026-03-31\"") continue; // the period end is the engagement's recorded period, not a cell value
    assert.ok(!serialized.includes(raw), raw);
  }
});

test("the arithmetic CHECK mirror refuses a tampered funnel, a wrong measured component and a lost overlap", async () => {
  const { measurements: list } = await measurements();
  const people = metric(list, "distinct_people_served");
  const tamper = (patch) => D.derivedMeasurementArithmeticHolds(rowOf({ ...people, ...patch }));
  assert.equal(tamper({ measuredValue: people.measuredValue + 1, numerator: people.measuredValue + 1 }), false);
  assert.equal(tamper({ componentCounts: { ...people.componentCounts, eligible_encounter_count: people.componentCounts.eligible_encounter_count + 1 } }), false);
  assert.equal(tamper({ componentCounts: { ...people.componentCounts, excess_copy_record_count: 0 } }), false);
  assert.equal(tamper({ componentCounts: { ...people.componentCounts, multi_group_person_count: 0 } }), false, "overall people must equal people per group minus overlap");
  assert.equal(tamper({ definition: { ...people.definition, measured_component: "eligible_encounter_count" } }), false);
  assert.equal(tamper({ denominator: 5 }), false);
});

test("mapping refusals: shape, roles KAI did not propose, unlisted or withheld values, the period, CSV only", async () => {
  const { eventsProfile, registerProfile } = await resolvedMapping();
  const reason = (mapping, { period = PERIOD, events = eventsProfile, register = registerProfile } = {}) => {
    const shaped = D.validateCrossSourceReachMapping(mapping);
    if (!shaped.ok) return shaped.blockers[0].blocking_reason;
    const resolved = D.resolveCrossSourceReachMapping({ eventsProfile: events, registerProfile: register, mapping: shaped.mapping, reportingPeriod: period });
    return resolved.ok ? "ok" : resolved.blockers[0].blocking_reason;
  };
  const withEvents = (patch) => ({ ...MAPPING, events: { ...MAPPING.events, ...patch } });
  assert.equal(reason(MAPPING), "ok");
  assert.equal(reason({ events: MAPPING.events }), "cross_source_mapping_invalid");
  assert.equal(reason(withEvents({ extra: "field_6" })), "cross_source_mapping_invalid");
  assert.equal(reason(withEvents({ participant_identifier_field_key: "field_1" })), "cross_source_mapping_fields_not_distinct");
  assert.equal(reason(withEvents({ event_identifier_field_key: "field_6" })), "cross_source_field_role_not_proposed", "a number field is not an identifier");
  assert.equal(reason(withEvents({ date_field_key: "field_6" })), "cross_source_field_role_not_proposed");
  assert.equal(reason(withEvents({ completed_value_key: "value_9" })), "cross_source_value_not_listed");
  assert.equal(reason({ ...MAPPING, register: { participant_identifier_field_key: "field_3" } }), "cross_source_field_role_not_proposed");
  assert.equal(reason(MAPPING, { period: null }), "cross_source_reporting_period_not_recorded");
  assert.equal(reason(MAPPING, { period: { start: "2026-03-31", end: "2025-04-01" } }), "cross_source_reporting_period_invalid");
  assert.equal(reason(MAPPING, { period: { start: "2025-02-30", end: "2026-03-31" } }), "cross_source_reporting_period_invalid");
  // Day-level periods are supported here (the worker reads day-level dates), unlike the month-level profile basis.
  assert.equal(reason(MAPPING, { period: { start: "2025-04-15", end: "2026-03-30" } }), "ok");
  // A group field whose vocabulary the profiler withheld cannot group people.
  const withheld = await profile(EVENT_ROWS.map((row, index) => (index === 0 ? ["ref", "person_ref", "Gender", "held_on", "state", "minutes"] : row)));
  assert.equal(reason(MAPPING, { events: withheld }), "cross_source_group_vocabulary_withheld");
  assert.equal(reason(MAPPING, { events: { ...eventsProfile, format: "xlsx" } }), "cross_source_source_not_csv");
  const { tabular_measurement_basis: _removed, ...legacy } = registerProfile;
  assert.equal(reason(MAPPING, { register: legacy }), "cross_source_basis_not_committed");
});

test("statements say encounters are not people, cite both versions and every exclusion; contributing-source currentness fails closed", async () => {
  const { measurements: list } = await measurements();
  for (const m of list) {
    const row = rowOf(m);
    assert.equal(D.validateDerivedStatements({ measurementRow: row }).ok, true, m.definition.metric);
    const statement = D.composeDerivedMeasurementEvidenceStatement({ measurementRow: row });
    assert.ok(statement.includes(REFERENCE.sourceVersionId), "the linked register version is cited");
    assert.match(statement, /in reporting period 2025-04-01 to 2026-03-31 by day/);
    // A typical stated meaning still fits the statement limit.
    assert.equal(D.validateDerivedStatements({ measurementRow: row, interpretation: { indicator_label: "People served in the programme year", meaning_text: "x", evidence_basis: "organization_record" } }).ok, true, m.definition.metric);
    assert.ok(!/\bP0\d\b|\bE\d\d\b/.test(statement));
  }
  const encounters = D.composeDerivedMeasurementEvidenceStatement({ measurementRow: rowOf(metric(list, "eligible_linked_encounters")) });
  assert.match(encounters, /^Derived measurement: \d+ eligible service encounters \(encounters, not people\)/);
  assert.match(encounters, /2 duplicate copies counted once; excluded 2 outside period, 1 unmatched, 1 conflicting/);
  assert.match(D.composeDerivedMeasurementEvidenceStatement({ measurementRow: rowOf(metric(list, "distinct_people_served")) }), /3 distinct register participants served, each counted once, among 5 eligible encounters: field_1 events/);
  const codes = D.derivedMeasurementLimitationCodes({ measurementRow: rowOf(metric(list, "eligible_linked_encounters")) });
  for (const code of ["derived.cross_source_linked", "derived.encounters_not_people", "derived.unmatched_identifiers_excluded", "derived.conflicting_event_identities_excluded",
    "derived.duplicate_event_copies_counted_once", "derived.records_without_date_excluded", "derived.engagement_period_applied", "derived.values_not_verified"]) {
    assert.ok(codes.includes(code), code);
  }
  assert.ok(D.derivedMeasurementLimitationCodes({ measurementRow: rowOf(metric(list, "distinct_people_served")) }).includes("derived.people_counted_once_across_groups"));
  assert.ok(D.composeDerivedMeasurementDisclosure(codes));
  // Currentness of both sources.
  const people = metric(list, "distinct_people_served");
  assert.equal(D.derivedContributingSourcesCurrent(rowOf(people)), true);
  const current = rowOf(people).contributing_sources;
  const variants = {
    "reference superseded": current.map((s) => (s.source_role === "reference" ? { ...s, is_current: false } : s)),
    "reference re-bound to another profile": current.map((s) => (s.source_role === "reference" ? { ...s, bound_profile_canonical_sha256: "c".repeat(64) } : s)),
    "primary superseded": current.map((s) => (s.source_role === "primary" ? { ...s, is_current: false } : s)),
    "reference missing": current.filter((s) => s.source_role === "primary"),
    "other reference": current.map((s) => (s.source_role === "reference" ? { ...s, source_version_id: "5a000000-0000-4000-8000-000000000009" } : s)),
  };
  for (const [name, sources] of Object.entries(variants)) assert.equal(D.derivedContributingSourcesCurrent(rowOf(people, { sources })), false, name);
  // A single-source measurement names no other source; a stale cross-source row is not a valid coverage basis.
  assert.equal(D.derivedContributingSourcesCurrent({ measurement_family: "tabular_count", contributing_sources: [] }), true);
  assert.equal(D.derivedContributingSourcesCurrent({ measurement_family: "tabular_count", contributing_sources: current }), false);
  const stale = D.applyDerivedMeasurementCoverageDimensions({}, rowOf(people, { sources: variants["reference superseded"] }));
  assert.equal(stale.definition_clarity.evidence.assessment_status, "unresolved");
  assert.match(stale.definition_clarity.message, /no longer the current version/);
});

test("generator conformance: cited linked-reach blocks pass with the server disclosure; people for encounters, verification and causality are refused", async () => {
  const { measurements: list } = await measurements();
  const claims = [metric(list, "eligible_linked_encounters"), metric(list, "distinct_people_served")].map((m, index) => {
    const row = rowOf(m, { interpretation: { indicator_label: index === 0 ? "Service encounters" : "People served", meaning_text: "Completed sessions in the register.", evidence_basis: "organization_record" } });
    return {
      claimId: `c1000000-0000-4000-8000-00000000000${index + 1}`, evidenceItemId: `e1000000-0000-4000-8000-00000000000${index + 1}`,
      claimStatement: D.composeDerivedClaimStatementFromRow(row), limitationCodes: D.derivedMeasurementLimitationCodes({ measurementRow: row }),
    };
  });
  const run = (texts, chosen = claims) => {
    const generationClaims = chosen.map((claim) => ({ ...claim, requestedAudience: "internal", revalidatedForGeneration: true, audienceAuthority: { internal: true } }));
    const blocks = chosen.map((claim, index) => ({ ordinal: index + 1, text: texts[index], citations: [{ claimId: claim.claimId, evidenceItemId: claim.evidenceItemId }] }));
    const composed = composeEvidenceSummaryMeasurementDisclosures({ blocks, claims: generationClaims });
    assert.equal(composed.ok, true);
    return validateGeneratedContentDraft({ requestedAudience: "internal", generationClaims, blocks: composed.blocks, contentType: "evidence_summary" })
      .blockers.map((blocker) => [blocker.validator_key, blocker.blocking_reason]);
  };
  assert.deepEqual(run(claims.map((claim) => claim.claimStatement)), []);
  const [encounters] = claims;
  assert.ok(run([`${encounters.claimStatement} That is 4 people.`], [encounters]).some(([key, reasonCode]) => key === "VAL-GEN-008" && reasonCode === "material_limitation_not_disclosed"));
  assert.deepEqual(run([`${encounters.claimStatement} These are verified records.`], [encounters]), [["VAL-GEN-008", "material_limitation_not_disclosed"]]);
  assert.deepEqual(run([`${encounters.claimStatement} The programme causes more sessions.`], [encounters]), [["VAL-GEN-004", "unsupported_numeric_or_causal_assertion"]]);
});

test("the reconciliation worker reads only verified, eligible bytes and returns no cell value", async () => {
  const files = new Map([
    ["events", { bytes: bytesOf(EVENT_ROWS), object: "obj-events" }],
    ["register", { bytes: bytesOf(REGISTER_ROWS), object: "obj-register" }],
  ]);
  const facts = (key, overrides = {}) => ({
    organization_id: "o1", intake_file_id: key, object_version_id: files.get(key).object, verified_checksum: sha256(files.get(key).bytes),
    verified_size_bytes: files.get(key).bytes.byteLength, file_extension: ".csv", mime_type: "text/csv", storage_provider: "local", storage_object_key: key, ...overrides,
  });
  const make = ({ eligible = () => true, factOverrides = {}, bytes = (key) => files.get(key).bytes } = {}) => createCrossSourceReconciliationWorker({
    storageAdapter: { async readObjectVersion({ objectVersionId }) { const key = objectVersionId.replace("obj-", ""); return { ok: true, data: { bytes: bytes(key) } }; } },
    readEligibilityFacts: async ({ intakeFileId }) => facts(intakeFileId, factOverrides[intakeFileId]),
    lockEligibleIntakeFile: async ({ intakeFileId }) => eligible(intakeFileId),
  });
  const { resolved } = await resolvedMapping();
  const input = {
    organizationId: "o1",
    events: { intakeFileId: "events", checksum: sha256(files.get("events").bytes) },
    register: { intakeFileId: "register", checksum: sha256(files.get("register").bytes) },
    mapping: D.crossSourceWorkerMapping(resolved.resolved),
  };
  const result = await make().reconcile(null, input);
  assert.equal(result.ok, true);
  assert.equal(result.reconciliation.counts.eligible_encounter_count, independent().eligible);
  assert.deepEqual(Object.keys(result).sort(), ["ok", "reconciliation"]);
  assert.ok(!/P0\d|E0\d|person_ref/.test(JSON.stringify(result)));
  assert.equal((await make({ eligible: (key) => key !== "register" }).reconcile(null, input)).reason, "cross_source_upload_not_eligible");
  assert.equal((await make({ bytes: (key) => (key === "events" ? bytesOf(EVENT_ROWS.slice(0, 5)) : files.get(key).bytes) }).reconcile(null, input)).reason, "cross_source_bytes_unavailable");
  assert.equal((await make({ factOverrides: { events: { file_extension: ".xlsx" } } }).reconcile(null, input)).reason, "cross_source_upload_not_eligible");
});

test("only the reconciliation worker reads source bytes: the measurement repository, service and validators never do", () => {
  for (const path of [
    "Backend/kai/dictionary/postgresDerivedMeasurementRepository.js",
    "Backend/kai/services/kaiSourceMeasurementService.js",
    "Backend/kai/validators/kaiDerivedMeasurementValidators.js",
  ]) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    for (const forbidden of ["p1ObjectVersionByteSource", "readTrustedCsvRecords", "readObjectVersion", "reconcileLinkedReach", "storageAdapter"]) {
      assert.ok(!source.includes(forbidden), `${path} references ${forbidden}`);
    }
  }
  const service = readFileSync(new URL("../Backend/kai/services/kaiSourceMeasurementService.js", import.meta.url), "utf8");
  assert.equal((service.match(/createCrossSourceReconciliationWorker\(/g) || []).length, 1, "the worker is composed in one place");
});
