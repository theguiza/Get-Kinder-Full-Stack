import test from "node:test";
import assert from "node:assert/strict";

import {
  EXCEL_DATE_SYSTEM_1900,
  EXCEL_DATE_SYSTEM_1904,
  excelSerialCalendarDay,
  numberFormatIsCalendarDate,
  profileLocalTrustedFile,
} from "../Backend/kai/profiling/localProfilingKernel.js";
import { EXACT_PERIOD_AGGREGATES_VERSION, TABULAR_MEASUREMENT_BASIS_VERSION } from "../Backend/kai/profiling/tabularMeasurementBasis.js";
import * as D from "../Backend/kai/validators/kaiDerivedMeasurementValidators.js";
import { composeImpactFindingReading } from "../Backend/kai/services/kaiImpactFindingReading.js";
import { EMPTY_TABULAR_FORM, tabularDefinitionBody, tabularFormProblem } from "../frontend/knowledgeStudio/clientDerivedMeasurementLogic.js";
import { syntheticXlsxWorkbook, SYNTHETIC_XLSX_MIME } from "./support/kaiSyntheticXlsxWorkbook.js";

/**
 * Remaining measurement capabilities: Excel date cells, period-filtered
 * rates (all dated records, and a category-value population), distinct
 * identifiers counted once across months, and the set arithmetic of a rate
 * in distinct identifiers. Synthetic records only. Every expected number is
 * computed here from the explicit records below with plain set/filter
 * arithmetic that shares no code with KAI; the negative controls show that
 * the plausible wrong calculations (month sums of keys, marginal products,
 * ignoring the period, the wrong date system) give different answers.
 */

// ---------------------------------------------------------------------------
// Explicit records: [event_ref, learner_id, status, cohort, visit_date]

const HEADER = ["event_ref", "learner_id", "status", "cohort", "visit_date"];
const ROWS = [
  ["E01", "L01", "completed", "active", "2025-01-15"],
  ["E02", "L01", "completed", "active", "2025-03-02"],
  ["E03", "L01", "waiting", "active", "2025-06-20"],
  ["E04", "L02", "completed", "exited", "2025-02-11"],
  ["E05", "L02", "waiting", "exited", "2025-02-28"],
  ["E06", "L03", "completed", "active", "2025-04-01"],
  ["E07", "L03", "completed", "active", "2025-04-30"],
  ["E08", "L03", "completed", "active", "2025-07-07"],
  ["E09", "L04", "waiting", "active", "2025-05-05"],
  ["E10", "L04", "completed", "active", "2025-08-31"],
  ["E11", "L05", "completed", "exited", "2025-03-15"],
  ["E12", "L05", "completed", "exited", "2025-03-16"],
  ["E13", "L06", "waiting", "exited", "2025-06-01"],
  ["E14", "L06", "completed", "active", "2025-01-31"],
  ["E15", "L07", "completed", "active", ""],
  ["E16", "L02", "completed", "exited", "2025-09-09"],
  ["E17", "L08", "waiting", "active", "2025-04-12"],
  ["E18", "L09", "completed", "exited", "2025-05-20"],
  ["E19", "L10", "completed", "active", "2025-02-14"],
  ["E06", "L03", "completed", "active", "2025-04-01"], // exact duplicate of E06
  ["E20", "L11", "waiting", "exited", "2025-08-01"],
];
const CSV = `${[HEADER, ...ROWS].map((row) => row.join(",")).join("\n")}\n`;
// Field keys by column, and the listed value keys (labels in sorted order).
const F = { event: "field_1", learner: "field_2", status: "field_3", cohort: "field_4", date: "field_5" };
const COMPLETED = { kind: "category", field_key: F.status, value_key: "value_1" };
const ACTIVE = { kind: "category", field_key: F.cohort, value_key: "value_1" };
const within = { kind: "period", field_key: F.date, period_source: "engagement_reporting_period", scope: "within" };
const outside = { ...within, scope: "outside" };
const eachLearner = { kind: "distinct_key", field_key: F.learner, duplicate_policy: "count_each_key_once" };

async function csvProfile(text = CSV) {
  const bytes = new TextEncoder().encode(text);
  return profileLocalTrustedFile({ extension: ".csv", declaredMime: "text/csv", byteSize: bytes.byteLength, bytes });
}

function derive(profile, input, period, worksheetKey = null) {
  const validated = D.validateTabularMeasurementDefinition(input);
  assert.equal(validated.ok, true, JSON.stringify(validated.blockers));
  return D.deriveTabularMeasurement(profile, worksheetKey, validated.definition, { reportingPeriod: period });
}

function lastDay(month) {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);
}
function wholeMonths(first, last) {
  return { start: `${first}-01`, end: lastDay(last) };
}
function monthsBetween(first, last) {
  const months = [];
  for (let [year, month] = first.split("-").map(Number); `${year}-${String(month).padStart(2, "0")}` <= last; month === 12 ? (year += 1, month = 1) : (month += 1)) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
  }
  return months;
}

// Independent oracle over the explicit records.
const oracle = {
  dated: (rows) => rows.filter((row) => row[4] !== ""),
  inPeriod: (row, period) => row[4] !== "" && row[4] >= period.start && row[4] <= period.end,
  outPeriod: (row, period) => row[4] !== "" && (row[4] < period.start || row[4] > period.end),
  learners: (rows) => new Set(rows.map((row) => row[1])).size,
  completed: (row) => row[2] === "completed",
  active: (row) => row[3] === "active",
};

const asRow = (measurement, interpretation = null) => ({
  measurement_family: measurement.family, calculation_method: measurement.calculationMethod, worksheet_key: measurement.sheetKey,
  definition: measurement.definition, field_keys: measurement.fieldKeys, measured_value: measurement.measuredValue, numerator: measurement.numerator,
  denominator: measurement.denominator, percentage: measurement.percentage, component_counts: measurement.componentCounts, exclusions: measurement.exclusions,
  ...(interpretation ? { interpretation_id: "i1", current_interpretation_id: "i1", ...interpretation } : { interpretation_id: null, current_interpretation_id: null }),
});

test("fixture roles: two identifiers, two listed categories and one date field, with a cross-month learner key", async () => {
  const basis = (await csvProfile()).tabular_measurement_basis;
  const roles = Object.fromEntries(basis.fields.map((field) => [field.field_key, field.roles]));
  assert.deepEqual(roles, { [F.event]: ["identifier"], [F.learner]: ["identifier"], [F.status]: ["categorical"], [F.cohort]: ["categorical"], [F.date]: ["date"] });
  assert.deepEqual(basis.fields.find((field) => field.field_key === F.status).categorical.values.map((value) => [value.value_key, value.label]), [["value_1", "completed"], ["value_2", "waiting"]]);
  assert.deepEqual(basis.fields.find((field) => field.field_key === F.cohort).categorical.values.map((value) => [value.value_key, value.label]), [["value_1", "active"], ["value_2", "exited"]]);
  assert.equal(basis.basis_version, TABULAR_MEASUREMENT_BASIS_VERSION, "the basis keeps the recorded measurement's basis identity");
  assert.equal(basis.exact_period_aggregates.version, EXACT_PERIOD_AGGREGATES_VERSION);
  assert.ok(!basis.single_valued_in[F.learner].includes(F.date), "a learner has records in several months");
  assert.ok(basis.single_valued_in[F.event].includes(F.date), "the duplicated event stays in one month");
  // Windows are kept only where a month sum is not exact.
  assert.deepEqual(Object.keys(basis.exact_period_aggregates.distinct_month_windows.fields[F.date].by_identifier), [F.learner]);
  // Only counts: no identifier, no day.
  const committed = JSON.stringify(basis);
  for (const raw of ["L01", "E06", "2025-01-15", "2025-04-30"]) assert.ok(!committed.includes(raw), raw);
});

test("distinct learners within and outside every whole-month period equal a set calculation; month sums do not", async () => {
  const profile = await csvProfile();
  const months = monthsBetween("2024-12", "2025-10"); // includes months with no record at both ends
  let windowsChecked = 0;
  let monthSumDiffers = 0;
  for (let a = 0; a < months.length; a += 1) {
    for (let b = a; b < months.length; b += 1) {
      const period = wholeMonths(months[a], months[b]);
      for (const [condition, keep] of [[null, () => true], [COMPLETED, oracle.completed], [ACTIVE, oracle.active]]) {
        for (const [scope, inScope] of [[within, oracle.inPeriod], [outside, oracle.outPeriod]]) {
          const rows = ROWS.filter((row) => keep(row) && inScope(row, period));
          const derived = derive(profile, { operation: "count", unit: eachLearner, conditions: [...(condition ? [condition] : []), scope] }, period);
          assert.equal(derived.ok, true, JSON.stringify(derived.blockers));
          assert.equal(derived.measurement.measuredValue, oracle.learners(rows), `${scope.scope} ${period.start}..${period.end} ${condition?.field_key ?? "all"}`);
          assert.equal(derived.measurement.componentCounts.matching_record_count, rows.length);
          const monthSum = [...new Set(rows.map((row) => row[4].slice(0, 7)))].reduce((total, month) => total + oracle.learners(rows.filter((row) => row[4].startsWith(month))), 0);
          if (monthSum !== oracle.learners(rows)) monthSumDiffers += 1;
          windowsChecked += 1;
        }
      }
    }
  }
  assert.equal(windowsChecked, 66 * 6);
  assert.ok(monthSumDiffers > 50, `month sums of keys are wrong for ${monthSumDiffers} of the checked definitions`);
  // The statement and arithmetic of one of them.
  const period = wholeMonths("2025-01", "2025-03");
  const derived = derive(profile, { operation: "count", unit: eachLearner, conditions: [COMPLETED, within] }, period);
  const expected = oracle.learners(ROWS.filter((row) => oracle.completed(row) && oracle.inPeriod(row, period)));
  assert.equal(expected, 5); // L01 (Jan, Mar), L02, L05 (twice in Mar), L06, L10
  assert.equal(D.derivedMeasurementArithmeticHolds(asRow(derived.measurement)), true);
  assert.equal(D.composeDerivedMeasurementEvidenceStatement({ measurementRow: asRow(derived.measurement) }),
    // 15 completed records, one (E15) without a date: it is excluded and stated.
    `Derived measurement: 5 distinct field_2 identifiers, each counted once, among the 7 records in the CSV data records with field_3 = completed and field_5 within the engagement reporting period 2025-01-01 to 2025-03-31; 1 record without a date excluded.`);
});

test("period-filtered rates: completed among all dated records, and among active records, for every whole-month period", async () => {
  const profile = await csvProfile();
  const months = monthsBetween("2025-01", "2025-09");
  let marginalDiffers = 0;
  let periodIgnoredDiffers = 0;
  for (let a = 0; a < months.length; a += 1) {
    for (let b = a; b < months.length; b += 1) {
      const period = wholeMonths(months[a], months[b]);
      // Case 1: the population is every record dated in the period.
      const population1 = ROWS.filter((row) => oracle.inPeriod(row, period));
      const rate1 = derive(profile, { operation: "rate", conditions: [COMPLETED, within] }, period);
      assert.equal(rate1.ok, true, JSON.stringify(rate1.blockers));
      assert.deepEqual([rate1.measurement.numerator, rate1.measurement.denominator], [population1.filter(oracle.completed).length, population1.length]);
      assert.equal(rate1.measurement.componentCounts.records_without_date, 1, "E15 has no date");
      // Case 2: the population is the active records dated in the period.
      const population2 = ROWS.filter((row) => oracle.active(row) && oracle.inPeriod(row, period));
      const numerator2 = population2.filter(oracle.completed).length;
      const rate2 = derive(profile, { operation: "rate", conditions: [COMPLETED, within], population: [ACTIVE] }, period);
      if (population2.length === 0) {
        assert.equal(rate2.blockers[0].blocking_reason, "tabular_counts_inconsistent", "an empty population is refused, not reported as 0%");
        continue;
      }
      assert.equal(rate2.ok, true, JSON.stringify(rate2.blockers));
      assert.deepEqual([rate2.measurement.numerator, rate2.measurement.denominator], [numerator2, population2.length]);
      assert.ok(rate2.measurement.numerator <= rate2.measurement.denominator);
      assert.equal(D.derivedMeasurementArithmeticHolds(asRow(rate2.measurement)), true);
      // Negative controls: a marginal product, and the all-dates rate.
      const marginal = (population1.filter(oracle.completed).length / population1.length) * population2.length;
      if (Math.abs(marginal - numerator2) > 1e-9) marginalDiffers += 1;
      const allDates = ROWS.filter(oracle.active);
      if (allDates.filter(oracle.completed).length !== numerator2 || allDates.length !== population2.length) periodIgnoredDiffers += 1;
    }
  }
  assert.ok(marginalDiffers > 10 && periodIgnoredDiffers > 10, `${marginalDiffers} ${periodIgnoredDiffers}`);
  // Outside the period, and the statement and limitation codes of a recorded period rate.
  const period = wholeMonths("2025-02", "2025-04");
  const out = derive(profile, { operation: "rate", conditions: [COMPLETED, outside], population: [ACTIVE] }, period);
  const outsidePopulation = ROWS.filter((row) => oracle.active(row) && oracle.outPeriod(row, period));
  assert.deepEqual([out.measurement.numerator, out.measurement.denominator], [outsidePopulation.filter(oracle.completed).length, outsidePopulation.length]);
  const rate = derive(profile, { operation: "rate", conditions: [COMPLETED, within], population: [ACTIVE] }, period);
  const population = ROWS.filter((row) => oracle.active(row) && oracle.inPeriod(row, period));
  assert.deepEqual([population.length, population.filter(oracle.completed).length], [6, 5]); // E02, E06, E06 copy, E07, E17 (waiting), E19
  const row = asRow(rate.measurement);
  assert.equal(rate.measurement.percentage, "83.33");
  assert.deepEqual(rate.measurement.fieldKeys, [F.status, F.cohort, F.date]);
  assert.deepEqual(rate.measurement.definition.conditions[1], { ...within, period_start: period.start, period_end: period.end });
  assert.equal(D.composeDerivedMeasurementEvidenceStatement({ measurementRow: row }),
    "Derived measurement: among the 6 records with field_4 = active and field_5 within the engagement reporting period 2025-02-01 to 2025-04-30 in the CSV data records (the measured population), 5 have field_3 = completed: 5 of 6 (83.33%); 1 of the 6 do not; 1 record without a date excluded from the population.");
  const codes = D.derivedMeasurementLimitationCodes({ measurementRow: row, dimensions: null });
  for (const code of [D.DERIVED_LIMITATION_CODES.ENGAGEMENT_PERIOD_APPLIED, D.DERIVED_LIMITATION_CODES.RECORDS_WITHOUT_DATE_EXCLUDED, D.DERIVED_LIMITATION_CODES.MEASURED_POPULATION_ONLY]) assert.ok(codes.includes(code), code);
  assert.ok(!codes.includes(D.DERIVED_LIMITATION_CODES.NO_REPORTING_PERIOD));
  // A partial-month Project period is refused for rates as for counts (the profile keeps months).
  assert.equal(derive(profile, { operation: "rate", conditions: [COMPLETED, within] }, { start: "2025-02-11", end: "2025-04-30" }).blockers[0].blocking_reason, "tabular_period_not_whole_months");
});

test("a rate without a period keeps its exact earlier statement; a profile committed before the pair table keeps the all-record period rate and refuses only the population period rate", async () => {
  const profile = await csvProfile();
  const plain = derive(profile, { operation: "rate", conditions: [COMPLETED], population: [ACTIVE] }, null);
  // The wording of the template that recorded every existing rate (unchanged).
  assert.equal(D.composeDerivedMeasurementEvidenceStatement({ measurementRow: asRow(plain.measurement) }),
    "Derived measurement: among the 13 records with field_4 = active in the CSV data records (the measured population), 10 have field_3 = completed: 10 of 13 (76.92%); 3 of the 13 do not.");
  assert.deepEqual(plain.measurement.exclusions, { records_outside_population: 8 });
  assert.equal("records_without_date" in plain.measurement.componentCounts, false);
  const { exact_period_aggregates: _removed, ...legacyBasis } = profile.tabular_measurement_basis;
  const legacy = { ...profile, tabular_measurement_basis: legacyBasis };
  const period = wholeMonths("2025-02", "2025-04");
  const allRecords = derive(legacy, { operation: "rate", conditions: [COMPLETED, within] }, period);
  assert.equal(allRecords.ok, true, "the month aggregates every committed v1 profile has support an all-record period rate");
  assert.deepEqual([allRecords.measurement.numerator, allRecords.measurement.denominator], [
    ROWS.filter((row) => oracle.inPeriod(row, period) && oracle.completed(row)).length, ROWS.filter((row) => oracle.inPeriod(row, period)).length]);
  const refused = derive(legacy, { operation: "rate", conditions: [COMPLETED, within], population: [ACTIVE] }, period);
  assert.equal(refused.blockers[0].blocking_reason, "tabular_rate_period_population_not_committed");
  assert.match(refused.blockers[0].required_fix, /new intake version/);
  // The same definitions on the legacy and the new profile give the same identity and arithmetic where both are available.
  const fresh = derive(profile, { operation: "rate", conditions: [COMPLETED, within] }, period);
  assert.equal(fresh.measurement.measurementKey, allRecords.measurement.measurementKey);
  assert.deepEqual([fresh.measurement.numerator, fresh.measurement.denominator], [allRecords.measurement.numerator, allRecords.measurement.denominator]);
});

test("aggregates over their bound are omitted with a reason, never truncated; the rest of the basis still measures", async () => {
  // 200 months; keys recur across months, so windows would need 200 x 201 numbers.
  const rows = [["ref", "member_ref", "visit_date"]];
  for (let index = 0; index < 400; index += 1) {
    const month = index % 200;
    rows.push([`R${index}`, `M${index % 150}`, `${2000 + Math.floor(month / 12)}-${String((month % 12) + 1).padStart(2, "0")}-10`]);
  }
  const profile = await csvProfile(`${rows.map((row) => row.join(",")).join("\n")}\n`);
  const basis = profile.tabular_measurement_basis;
  assert.equal(basis.status, "assessed");
  assert.deepEqual(basis.exact_period_aggregates.distinct_month_windows, { status: "not_assessed", reason: "exceeds_limit" });
  const period = wholeMonths("2001-01", "2003-12");
  const refused = derive(profile, { operation: "count", unit: { kind: "distinct_key", field_key: "field_2", duplicate_policy: "count_each_key_once" }, conditions: [{ ...within, field_key: "field_3" }] }, period);
  assert.equal(refused.blockers[0].blocking_reason, "tabular_distinct_windows_exceed_limit");
  const records = derive(profile, { operation: "count", conditions: [{ ...within, field_key: "field_3" }] }, period);
  assert.equal(records.measurement.measuredValue, rows.slice(1).filter((row) => row[2] >= period.start && row[2] <= period.end).length);
  assert.equal(D.describeTabularMeasurementOptions(profile, null).period_support.distinct_month_windows, "exceeds_limit");
});

test("rates in distinct identifiers: both population kinds are exact key sets with the numerator a subset; they are calculated but not recordable", async () => {
  const profile = await csvProfile();
  const EXITED = { kind: "category", field_key: F.cohort, value_key: "value_2" };
  // Oracle: P and N as sets of learners from the explicit records ("has a record" = at least one).
  const sets = ({ population = null, period = null }) => {
    const inScope = ROWS.filter((row) => (!period || oracle.inPeriod(row, period)) && (!population || population(row)));
    return { P: new Set(inScope.map((row) => row[1])), N: new Set(inScope.filter(oracle.completed).map((row) => row[1])) };
  };
  const rateOf = (input, period = null) => D.deriveTabularDistinctKeyRate(profile, null, { identifierFieldKey: F.learner, category: COMPLETED, ...input }, { reportingPeriod: period });
  const months = monthsBetween("2025-01", "2025-09");
  let checked = 0;
  for (let a = 0; a < months.length; a += 1) {
    for (let b = a; b < months.length; b += 1) {
      const period = wholeMonths(months[a], months[b]);
      for (const [population, keep] of [[[], null], [[ACTIVE], oracle.active], [[EXITED], (row) => row[3] === "exited"]]) {
        const expected = sets({ population: keep, period });
        const rate = rateOf({ period: within, population }, period);
        if (expected.P.size === 0) {
          assert.equal(rate.ok, false, "an empty population is refused, never 0%");
          continue;
        }
        assert.equal(rate.ok, true, JSON.stringify(rate.blockers));
        assert.ok([...expected.N].every((key) => expected.P.has(key)));
        assert.deepEqual([rate.measurement.numerator, rate.measurement.denominator], [expected.N.size, expected.P.size], `${period.start}..${period.end} ${population[0]?.value_key ?? "all"}`);
        assert.equal(D.derivedMeasurementArithmeticHolds(asRow(rate.measurement)), true);
        checked += 1;
      }
    }
  }
  assert.ok(checked > 100, String(checked));
  // All dates, category population: N needs one record carrying both values. L06 is exited only on a waiting record and
  // completed only on an active one, so it is in P but not N; requiring the two values on separate records would count it.
  const exited = rateOf({ population: [EXITED] });
  const expected = sets({ population: (row) => row[3] === "exited" });
  const separateRecords = new Set([...expected.P].filter((key) => ROWS.some((row) => row[1] === key && oracle.completed(row))));
  assert.deepEqual([exited.measurement.numerator, exited.measurement.denominator, exited.measurement.percentage], [expected.N.size, expected.P.size, "60.00"]);
  assert.notEqual(separateRecords.size, expected.N.size, "the same-record rule is what is calculated");
  assert.deepEqual([exited.recordable, exited.measurement.calculationMethod], [false, "kai_tabular_conditional_distinct_key_rate_v1"]);
  assert.equal(D.SCHEMA_ADMITTED_DERIVED_METHODS.has(exited.measurement.calculationMethod), false);
  assert.equal(D.composeDerivedMeasurementEvidenceStatement({ measurementRow: asRow(exited.measurement) }),
    "Derived measurement: among the 5 distinct field_2 identifiers with a record with field_4 = exited in the CSV data records (the measured population, each identifier counted once), 3 have at least one record with field_3 = completed on a record that also has field_4 = exited: 3 of 5 (60.00%); 2 of the 5 do not.");
  // Negative arithmetic control: a tampered numerator fails the persisted-arithmetic check.
  assert.equal(D.derivedMeasurementArithmeticHolds({ ...asRow(exited.measurement), numerator: 4, measured_value: 4 }), false);
  // All identifiers, all dates.
  const all = rateOf({});
  assert.deepEqual([all.measurement.numerator, all.measurement.denominator], [sets({}).N.size, sets({}).P.size]);
  // A profile committed before the category-pair keys refuses the population kind only.
  const { category_pair_distinct: _removed, ...olderAggregates } = profile.tabular_measurement_basis.exact_period_aggregates;
  const older = { ...profile, tabular_measurement_basis: { ...profile.tabular_measurement_basis, exact_period_aggregates: olderAggregates } };
  assert.equal(D.deriveTabularDistinctKeyRate(older, null, { identifierFieldKey: F.learner, category: COMPLETED, population: [EXITED] }, {}).blockers[0].blocking_reason, "tabular_distinct_key_rate_population_not_committed");
  assert.equal(D.deriveTabularDistinctKeyRate(older, null, { identifierFieldKey: F.learner, category: COMPLETED }, {}).ok, true);
  // The record route refuses the unit before any calculation.
  assert.equal(D.validateTabularMeasurementDefinition({ operation: "rate", unit: eachLearner, conditions: [COMPLETED] }).blockers[0].blocking_reason, "tabular_distinct_key_rate_not_recordable");
});

test("readings: a distinct count reads as identifiers counted once, a period rate names its period; record counts read as before", async () => {
  const profile = await csvProfile();
  const period = wholeMonths("2025-01", "2025-03");
  const interpretation = { indicator_label: "Learners with a completed visit", meaning_text: "Learners with at least one completed visit.", score_direction: null, evidence_basis: "organization_record" };
  const distinct = composeImpactFindingReading(asRow(derive(profile, { operation: "count", unit: eachLearner, conditions: [COMPLETED, within] }, period).measurement, interpretation));
  assert.match(distinct.text, /^Learners with a completed visit: 5 distinct field_2 identifiers, each counted once\./);
  assert.doesNotMatch(distinct.text, /\b5 records\b/);
  const records = composeImpactFindingReading(asRow(derive(profile, { operation: "count", conditions: [COMPLETED, within] }, period).measurement, { ...interpretation, indicator_label: "Completed visits" }));
  assert.match(records.text, /^Completed visits: 7 records\./);
  // Active records dated February to April: E02, E06 (twice), E07, E19 completed; E17 waiting.
  const rate = composeImpactFindingReading(asRow(derive(profile, { operation: "rate", conditions: [COMPLETED, within], population: [ACTIVE] }, wholeMonths("2025-02", "2025-04")).measurement, { ...interpretation, indicator_label: "Completion rate" }));
  assert.match(rate.text, /^Completion rate: 5 of 6 \(83\.33%\) in the measured population \(records dated within the reporting period 2025-02-01 to 2025-04-30\); 1 of the 6 do not\./);
});

test("the measurement form sends period-filtered rates and exact cross-month distinct counts, and explains what an older profile cannot do", async () => {
  const profile = await csvProfile();
  const tabular = D.describeTabularMeasurementOptions(profile, null);
  const ready = { tabular, reporting_period: wholeMonths("2025-01", "2025-03") };
  const rateForm = { ...EMPTY_TABULAR_FORM, operation: "rate", categoryFieldKey: F.status, categoryValueKey: "value_1", populationFieldKey: F.cohort, populationValueKey: "value_1", periodFieldKey: F.date };
  assert.equal(tabularFormProblem(rateForm, ready), null);
  assert.deepEqual(tabularDefinitionBody(rateForm), { operation: "rate", conditions: [COMPLETED, within], population: [ACTIVE] });
  const countForm = { ...EMPTY_TABULAR_FORM, identifierFieldKey: F.learner, categoryFieldKey: F.status, categoryValueKey: "value_1", periodFieldKey: F.date };
  assert.equal(tabularFormProblem(countForm, ready), null);
  assert.match(tabularFormProblem(rateForm, { ...ready, reporting_period: { start: "2025-01-02", end: "2025-03-31" } }), /calendar month/);
  assert.match(tabularFormProblem({ ...rateForm, identifierFieldKey: F.learner }, ready), /distinct identifiers cannot be recorded yet/);
  const { exact_period_aggregates: _removed, ...legacyBasis } = profile.tabular_measurement_basis;
  const legacy = { tabular: D.describeTabularMeasurementOptions({ ...profile, tabular_measurement_basis: legacyBasis }, null), reporting_period: ready.reporting_period };
  assert.match(tabularFormProblem(rateForm, legacy), /predates period-filtered rates.*new intake version/);
  assert.equal(tabularFormProblem({ ...rateForm, populationFieldKey: "", populationValueKey: "" }, legacy), null, "an all-record period rate needs no new aggregates");
  assert.match(tabularFormProblem(countForm, legacy), /new intake version/);
});

// ---------------------------------------------------------------------------
// Excel date cells.

// Independent serial oracle: whole days from each system's documented
// origin (1900: serial 61 is 1900-03-01, Lotus leap day 60; 1904: serial 0 is
// 1904-01-01), with documented anchors checked first.
const serial1900 = (iso) => (Date.parse(`${iso}T00:00:00Z`) - Date.parse("1899-12-30T00:00:00Z")) / 86400000;
const serial1904 = (iso) => (Date.parse(`${iso}T00:00:00Z`) - Date.parse("1904-01-01T00:00:00Z")) / 86400000;

test("Excel serial conversion: documented anchors, the 1900 leap-day defect, the 1904 system, time fractions and impossible serials", () => {
  assert.equal(serial1900("2025-01-01"), 45658);
  assert.equal(serial1904("2025-01-01"), 45658 - 1462);
  for (const [serial, iso] of [["1", "1900-01-01"], ["31", "1900-01-31"], ["59", "1900-02-28"], ["61", "1900-03-01"], ["45658", "2025-01-01"], ["45658.99", "2025-01-01"], ["2958465", "9999-12-31"]]) {
    assert.equal(excelSerialCalendarDay(serial, EXCEL_DATE_SYSTEM_1900), iso, serial);
  }
  for (const serial of ["0", "60", "2958466", "-1", "abc", "", "1e400", "45658,5"]) assert.equal(excelSerialCalendarDay(serial, EXCEL_DATE_SYSTEM_1900), null, serial);
  for (const [serial, iso] of [["0", "1904-01-01"], ["59", "1904-02-29"], [String(45658 - 1462), "2025-01-01"], ["2957003", "9999-12-31"]]) {
    assert.equal(excelSerialCalendarDay(serial, EXCEL_DATE_SYSTEM_1904), iso, serial);
  }
  assert.equal(excelSerialCalendarDay("2957004", EXCEL_DATE_SYSTEM_1904), null);
  assert.equal(excelSerialCalendarDay("45658", "unknown"), null);
});

test("number formats: calendar dates are recognized; times, durations, numbers, percentages and text are not", () => {
  for (const code of ["yyyy-mm-dd", "m/d/yyyy", "dd/mm/yyyy;@", "d-mmm-yy", "mmm-yy", "mmmm", "[$-409]m/d/yy h:mm AM/PM", "[Red]yyyy\\-mm\\-dd", "yyyy\"年\"m\"月\"d\"日\""]) {
    assert.equal(numberFormatIsCalendarDate(code), true, code);
  }
  for (const code of ["General", "0", "0.00", "#,##0", "0%", "@", "h:mm", "h:mm:ss AM/PM", "mm:ss", "[h]:mm:ss", "[mm]:ss", "\"Day \"0", "0.00E+00", "# ?/?", "", "y".repeat(300)]) {
    assert.equal(numberFormatIsCalendarDate(code), false, code);
  }
});

// The intended calendar dates of one worksheet, written into Excel as each
// cell kind; scores and other numbers share the dates' magnitude.
const VISITS = ["2026-01-05", "2026-01-20", "2026-02-02", "2026-02-27", "2026-03-15", "2025-12-31", "2026-01-31", "2026-02-14", "2026-03-01", "2026-01-11"];
const BUILT_IN_SHORT_DATE = 2; // cellXfs index of numFmtId 14
const CUSTOM_DATE = 3; // numFmtId 164 "yyyy-mm-dd"
const TWO_DECIMALS = 4; // numFmtId 2 "0.00"
const TIME_OF_DAY = 5; // numFmtId 20 "h:mm"
const ELAPSED = 6; // numFmtId 165 "[h]:mm:ss"
const CELL_FORMATS = [{ numFmtId: 14 }, { numFmtId: 164, formatCode: "yyyy-mm-dd" }, { numFmtId: 2 }, { numFmtId: 20 }, { numFmtId: 165, formatCode: "[h]:mm:ss" }];

function visitWorkbook({ date1904 = false } = {}) {
  const serial = date1904 ? serial1904 : serial1900;
  const rows = [["visit_ref", "visit_date", "score", "amount", "start_time", "duration", "status"]];
  VISITS.forEach((iso, index) => {
    const dateCell = index === 3 ? { isoDate: iso } : index === 4 ? iso : { number: serial(iso), style: index % 2 ? CUSTOM_DATE : BUILT_IN_SHORT_DATE };
    rows.push([`V${String(index + 1).padStart(2, "0")}`, dateCell, serial1900(iso), { number: serial1900(iso), style: TWO_DECIMALS },
      { number: 0.375, style: TIME_OF_DAY }, { number: 1.5, style: ELAPSED }, index % 3 ? "completed" : "missed"]);
  });
  // Serial 60 is Lotus's nonexistent 1900-02-29: a date-styled cell that is no date.
  rows.push(["V11", { number: date1904 ? -1 : 60, style: BUILT_IN_SHORT_DATE }, 60, { number: 60, style: TWO_DECIMALS }, { number: 0.5, style: TIME_OF_DAY }, { number: 2, style: ELAPSED }, "completed"]);
  return syntheticXlsxWorkbook({ sheets: [{ name: "Visits", rows }], cellFormats: CELL_FORMATS, date1904 });
}

async function xlsxProfile(bytes) {
  return profileLocalTrustedFile({ extension: ".xlsx", declaredMime: SYNTHETIC_XLSX_MIME, byteSize: bytes.byteLength, bytes });
}

function monthHistogram(isoDays) {
  const counts = new Map();
  for (const iso of isoDays) counts.set(iso.slice(0, 7), (counts.get(iso.slice(0, 7)) ?? 0) + 1);
  return [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
}

test("date-formatted serials, ISO date cells and ISO text are dates by the workbook's own date system; plain numbers, times and durations are not", async () => {
  const expected = monthHistogram(VISITS);
  for (const date1904 of [false, true]) {
    const profile = await xlsxProfile(visitWorkbook({ date1904 }));
    assert.equal(profile.status, "profiled");
    const basis = profile.sheets[0].tabular_measurement_basis;
    const field = (key) => basis.fields.find((candidate) => candidate.field_key === key);
    assert.deepEqual(field("field_2").roles, ["date"], `date1904=${date1904}`);
    assert.deepEqual(field("field_2").date, {
      date_count: 10, non_date_count: 1, earliest_month: "2025-12", latest_month: "2026-03",
      excel_date_cell_count: 9, excel_date_system: date1904 ? EXCEL_DATE_SYSTEM_1904 : EXCEL_DATE_SYSTEM_1900,
    });
    assert.deepEqual(basis.date_cells.field_2.map(([month, records]) => [month, records]), expected);
    for (const key of ["field_3", "field_4", "field_5", "field_6"]) assert.deepEqual(field(key).roles, [], `${key} stays a number`);
    // Negative control: reading these serials under the other system moves every date by 1,462 days.
    const wrong = VISITS.map((iso) => excelSerialCalendarDay(String((date1904 ? serial1904 : serial1900)(iso)), date1904 ? EXCEL_DATE_SYSTEM_1900 : EXCEL_DATE_SYSTEM_1904));
    assert.notDeepEqual(monthHistogram(wrong), expected);
    // Only months are committed: no day, serial or format code.
    const committed = JSON.stringify(profile);
    for (const raw of [...VISITS, String(serial1900("2026-01-05")), "yyyy-mm-dd", "[h]:mm:ss"]) assert.ok(!committed.includes(raw), raw);
  }
});

test("a whole-month Project period counts Excel-dated records exactly; the period is applied by month and partial months are refused", async () => {
  const profile = await xlsxProfile(visitWorkbook());
  const period = wholeMonths("2026-01", "2026-02");
  const count = derive(profile, { operation: "count", conditions: [{ ...within, field_key: "field_2" }] }, period, "sheet_1");
  assert.equal(count.measurement.measuredValue, VISITS.filter((iso) => iso >= period.start && iso <= period.end).length);
  assert.equal(count.measurement.componentCounts.records_without_date, 1, "the serial-60 cell is not a date");
  const missed = { kind: "category", field_key: "field_7", value_key: "value_2" };
  const rate = derive(profile, { operation: "rate", conditions: [missed, { ...within, field_key: "field_2" }] }, period, "sheet_1");
  const inPeriod = VISITS.map((iso, index) => [iso, index % 3 ? "completed" : "missed"]).filter(([iso]) => iso >= period.start && iso <= period.end);
  assert.deepEqual([rate.measurement.numerator, rate.measurement.denominator], [inPeriod.filter(([, status]) => status === "missed").length, inPeriod.length]);
  assert.equal(derive(profile, { operation: "count", conditions: [{ ...within, field_key: "field_2" }] }, { start: "2026-01-05", end: "2026-02-28" }, "sheet_1").blockers[0].blocking_reason, "tabular_period_not_whole_months");
  // The date's Excel origin is visible to the person choosing the field.
  const options = D.describeTabularMeasurementOptions(profile, "sheet_1");
  assert.equal(options.fields.find((field) => field.field_key === "field_2").date.excel_date_cell_count, 9);
});

test("a workbook without date-formatted cells profiles as before apart from the additive aggregates", async () => {
  const rows = [["record_ref", "date_serial", "visit_day"], ["R01", 46053, "2026-01-31"], ["R02", 46054, "2026-02-01"], ["R03", 46023, "2026-01-01"]];
  const profile = await xlsxProfile(syntheticXlsxWorkbook({ sheets: [{ name: "Serials", rows }] }));
  const basis = profile.sheets[0].tabular_measurement_basis;
  assert.deepEqual(basis.fields.find((field) => field.field_key === "field_2").roles, [], "an unformatted number is never a date, whatever its magnitude");
  assert.deepEqual(basis.fields.find((field) => field.field_key === "field_3").date, { date_count: 3, non_date_count: 0, earliest_month: "2026-01", latest_month: "2026-02" });
  assert.deepEqual(Object.keys(basis).sort(), ["basis_version", "category_cells", "date_cells", "exact_duplicates", "exact_period_aggregates", "fields", "record_count", "single_valued_in", "status"]);
});

// ---------------------------------------------------------------------------
// Partial-month Project periods: exact only when no measured record falls in
// a partly covered month (the month aggregates show that); otherwise refused.

test("a partial-month period gives the exact day-range answer when its partly covered months hold none of the measured records", async () => {
  const profile = await csvProfile();
  const EXITED = { kind: "category", field_key: F.cohort, value_key: "value_2" };
  const exited = (row) => row[3] === "exited";
  // 2025-02-01 to 2025-04-15: April 2025 is covered only in part; it holds active records (E06, E07, E17) but no exited one.
  const period = { start: "2025-02-01", end: "2025-04-15" };
  const dayRange = (row) => row[4] !== "" && row[4] >= period.start && row[4] <= period.end;
  const count = derive(profile, { operation: "count", conditions: [EXITED, within] }, period);
  assert.equal(count.measurement.measuredValue, ROWS.filter((row) => exited(row) && dayRange(row)).length);
  assert.equal(count.measurement.measuredValue, 4); // E04, E05, E11, E12
  assert.deepEqual(count.measurement.definition.conditions[1], { ...within, period_start: "2025-02-01", period_end: "2025-04-15" });
  assert.deepEqual([count.measurement.componentCounts.partially_covered_months, count.measurement.componentCounts.partially_covered_month_records], [["2025-04"], 0]);
  const codes = D.derivedMeasurementLimitationCodes({ measurementRow: asRow(count.measurement), dimensions: null });
  assert.ok(codes.includes(D.DERIVED_LIMITATION_CODES.PARTLY_COVERED_MONTHS_EMPTY));
  assert.match(D.describeDerivedLimitationCode(D.DERIVED_LIMITATION_CODES.PARTLY_COVERED_MONTHS_EMPTY), /actual dates were applied exactly/);
  const rate = derive(profile, { operation: "rate", conditions: [COMPLETED, within], population: [EXITED] }, period);
  const population = ROWS.filter((row) => exited(row) && dayRange(row));
  assert.deepEqual([rate.measurement.numerator, rate.measurement.denominator], [population.filter(oracle.completed).length, population.length]);
  const learners = derive(profile, { operation: "count", unit: eachLearner, conditions: [EXITED, within] }, period);
  assert.equal(learners.measurement.measuredValue, oracle.learners(population));
  // Negative controls: rounding to whole months (February to April) or (February to March) gives other answers for all records.
  const roundedUp = ROWS.filter((row) => row[4] >= "2025-02-01" && row[4] <= "2025-04-30").length;
  const dayExact = ROWS.filter(dayRange).length;
  assert.notEqual(roundedUp, dayExact);
  // The same period over all records, or over active records, needs April's days: refused, never rounded.
  for (const input of [{ operation: "count", conditions: [within] }, { operation: "count", conditions: [ACTIVE, within] }, { operation: "rate", conditions: [COMPLETED, within], population: [ACTIVE] }]) {
    const refused = derive(profile, input, period);
    assert.equal(refused.blockers[0].blocking_reason, "tabular_period_not_whole_months", JSON.stringify(input));
    assert.match(refused.blockers[0].message, /2025-04 only in part/);
  }
  // A period inside one month without records: exactly zero records, and an empty rate population is refused.
  const quiet = { start: "2025-10-05", end: "2025-10-20" };
  assert.equal(derive(profile, { operation: "count", conditions: [within] }, quiet).measurement.measuredValue, 0);
  assert.equal(derive(profile, { operation: "rate", conditions: [COMPLETED, within] }, quiet).blockers[0].blocking_reason, "tabular_counts_inconsistent");
  // The form reads the same coverage: exited is ready; all records and active are explained before any request.
  const coverage = D.describePeriodMonthCoverage(profile, null, period);
  assert.deepEqual(coverage.partially_covered_months, ["2025-04"]);
  assert.deepEqual([coverage.date_fields[F.date].records, coverage.date_fields[F.date].by_category[F.cohort].value_1, coverage.date_fields[F.date].by_category[F.cohort].value_2],
    [ROWS.filter((row) => row[4].startsWith("2025-04")).length, ROWS.filter((row) => active(row) && row[4].startsWith("2025-04")).length, 0]);
  const basis = { tabular: D.describeTabularMeasurementOptions(profile, null), reporting_period: period, period_month_coverage: coverage };
  const countForm = { ...EMPTY_TABULAR_FORM, categoryFieldKey: F.cohort, categoryValueKey: "value_2", periodFieldKey: F.date };
  assert.equal(tabularFormProblem(countForm, basis), null);
  assert.match(tabularFormProblem({ ...countForm, categoryValueKey: "value_1" }, basis), /calendar month.*2025-04 only in part, and 4 of the records/);
  assert.match(tabularFormProblem({ ...countForm, categoryFieldKey: "", categoryValueKey: "" }, basis), /calendar month/);
  assert.equal(tabularFormProblem({ ...EMPTY_TABULAR_FORM, operation: "rate", categoryFieldKey: F.status, categoryValueKey: "value_1", populationFieldKey: F.cohort, populationValueKey: "value_2", periodFieldKey: F.date }, basis), null);
});
function active(row) { return row[3] === "active"; }

// ---------------------------------------------------------------------------
// Workbooks authored by Microsoft Excel (Mac, 16.x): see fixtures/excel-authored.
// Excel wrote visit_date as serials with a custom "yyyy\-mm\-dd" format and,
// for ISO text typed into typed_date, converted it itself (built-in format
// 14) - so Excel's own conversion is the oracle for the serials. Only the
// package's author/company metadata and the saved folder path were replaced.

test("Excel-authored workbooks: Excel's custom and built-in date formats, its own typed-date conversion and the 1904 system are read as the same dates", async () => {
  const { readFileSync } = await import("node:fs");
  const typed = ["2026-01-05", "2026-01-20", "2026-02-02", "2026-02-27", "2026-03-16", "2025-12-31"]; // the text typed into Excel
  const expectedMonths = monthHistogram(typed);
  const profileOf = async (name) => xlsxProfile(new Uint8Array(readFileSync(new URL(`./fixtures/excel-authored/${name}`, import.meta.url))));
  const p1900 = await profileOf("synthetic-visits-excel-1900.xlsx");
  const b1900 = p1900.sheets[0].tabular_measurement_basis;
  const field = (basis, key) => basis.fields.find((candidate) => candidate.field_key === key);
  for (const key of ["field_2", "field_5"]) { // custom "yyyy\-mm\-dd" serials, and Excel-converted typed text
    assert.deepEqual(field(b1900, key).roles, ["date"], key);
    assert.deepEqual([field(b1900, key).date.excel_date_cell_count, field(b1900, key).date.excel_date_system], [6, EXCEL_DATE_SYSTEM_1900]);
    assert.deepEqual(b1900.date_cells[key].map(([month, records]) => [month, records]), expectedMonths, key);
  }
  assert.deepEqual(field(b1900, "field_4").roles, [], "the unformatted copy of the same serials is a number");
  const p1904 = await profileOf("synthetic-visits-excel-1904.xlsx");
  const b1904 = p1904.sheets[0].tabular_measurement_basis;
  assert.deepEqual([field(b1904, "field_2").date.excel_date_system, field(b1904, "field_2").date.date_count], [EXCEL_DATE_SYSTEM_1904, 6]);
  assert.deepEqual(b1904.date_cells.field_2.map(([month, records]) => [month, records]), expectedMonths, "Excel's 1904 serials give the same dates");
  assert.deepEqual(field(b1904, "field_3").roles, [], "plain numbers stay numbers");
  // Measurement over the Excel dates with a whole-month Project period.
  const period = wholeMonths("2026-01", "2026-02");
  const count = derive(p1900, { operation: "count", conditions: [{ ...within, field_key: "field_2" }] }, period, "sheet_1");
  assert.equal(count.measurement.measuredValue, typed.filter((iso) => iso >= period.start && iso <= period.end).length);
});
