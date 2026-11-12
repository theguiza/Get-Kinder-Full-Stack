import test from "node:test";
import assert from "node:assert/strict";

import * as D from "../Backend/kai/validators/kaiDerivedMeasurementValidators.js";
import {
  composeEvidenceSummaryMeasurementDisclosures,
  composeEvidenceSummaryWithWordingFallback,
  unsupportedAssertionViolations,
  validateGeneratedContentDraft,
} from "../Backend/kai/validators/kaiGeneratedContentValidators.js";
import {
  composeAssessmentSnapshot,
  composeFreeImpactAssessmentBlocks,
  parseFreeImpactAssessment,
  withAssessmentSection as W,
} from "../Backend/kai/services/kaiFreeImpactAssessmentComposition.js";
import { composeImpactFindingReading } from "../Backend/kai/services/kaiImpactFindingReading.js";
import { __internalReportMarkdownSerializerTestables as REPORT } from "../Backend/kai/services/kaiInternalReportMarkdownSerializer.js";

// Owner direction 2026-11-11: a measured outcome is expressed through its
// organization-stated meaning and direction, interpreted only where that
// direction is stated. Synthetic rows shaped like the Cedar Bridge paired
// outcomes (25/38 and 23/40) and its self-reported follow-up rate (9/29).
const ORG = "31000000-0000-4000-8000-000000000001";
const VERSION = "32000000-0000-4000-8000-000000000001";

const CONFIDENCE = Object.freeze({ indicator_label: "Digital confidence", score_direction: "higher_is_better", evidence_basis: "self_reported",
  meaning_text: "the participant's self-rated digital confidence on a 1 to 5 scale, where 5 means very high confidence" });
const READINESS_UNRESOLVED = Object.freeze({ indicator_label: "Employment readiness", score_direction: "not_established", evidence_basis: "self_reported",
  meaning_text: "the participant's self-rated employment readiness" });

function pairedRow(six, interpretation) {
  return {
    organization_id: ORG, evidence_item_id: six ? "36000000-0000-4000-8000-000000000006" : "36000000-0000-4000-8000-000000000007",
    source_version_id: VERSION, measurement_source_version_id: VERSION,
    source_derived_measurement_id: six ? "37000000-0000-4000-8000-000000000006" : "37000000-0000-4000-8000-000000000007",
    measurement_family: D.DERIVED_MEASUREMENT_FAMILIES.PAIRED_OUTCOME, calculation_method: D.DERIVED_MEASUREMENT_METHODS.PAIRED_OUTCOME, worksheet_key: "sheet_1",
    definition: { outcome_field_key: six ? "field_6" : "field_7", outcome_column: six ? "F" : "G", participant_field_key: "field_2", stage_field_key: "field_4", instrument_version_field_key: "field_5" },
    field_keys: ["field_2", "field_4", "field_5", six ? "field_6" : "field_7"], measured_value: six ? 25 : 23, numerator: six ? 25 : 23, denominator: six ? 38 : 40, percentage: six ? "65.79" : "57.50",
    component_counts: { participant_count: 62, comparable_pair_count: six ? 38 : 40, increased_count: six ? 25 : 23, unchanged_count: six ? 10 : 13, decreased_count: six ? 3 : 4, excluded_participant_count: six ? 24 : 22 },
    exclusions: { participants: [], rows: [] }, row_locators: {}, profile_canonical_sha256: "a".repeat(64),
    interpretation_id: interpretation ? `38000000-0000-4000-8000-00000000000${six ? 6 : 7}` : null,
    current_interpretation_id: interpretation ? `38000000-0000-4000-8000-00000000000${six ? 6 : 7}` : null,
    contributing_sources: [], ...(interpretation || {}),
  };
}

function rateRow() {
  return {
    organization_id: ORG, evidence_item_id: "36000000-0000-4000-8000-000000000009", source_version_id: VERSION, measurement_source_version_id: VERSION,
    source_derived_measurement_id: "37000000-0000-4000-8000-000000000009",
    measurement_family: D.DERIVED_MEASUREMENT_FAMILIES.TABULAR_RATE, calculation_method: "p1_tabular_category_rate_v1", worksheet_key: "sheet_2",
    definition: { operation: "rate", conditions: [{ kind: "category", field_key: "field_6", value_key: "value_1", value_label: "started_paid_work" }],
      population: [{ kind: "category", field_key: "field_5", value_key: "value_2", value_label: "answered" }] },
    field_keys: ["field_5", "field_6"], measured_value: 9, numerator: 9, denominator: 29, percentage: "31.03",
    component_counts: { population_record_count: 29, other_population_record_count: 20 },
    exclusions: {}, row_locators: {}, profile_canonical_sha256: "b".repeat(64),
    interpretation_id: "38000000-0000-4000-8000-000000000009", current_interpretation_id: "38000000-0000-4000-8000-000000000009", contributing_sources: [],
    indicator_label: "Self-reported paid work among answers", score_direction: null, evidence_basis: "self_reported",
    meaning_text: "answered follow-ups reporting started paid work; not verified employment",
  };
}

const DIMENSIONS = { missingness: { assessment_status: "resolved_risk_flagged" } };

function claimOf(row, index) {
  const reading = composeImpactFindingReading(row);
  return {
    claimId: `39000000-0000-4000-8000-00000000000${index}`,
    evidenceItemId: row.evidence_item_id,
    claimStatement: D.composeDerivedClaimStatementFromRow(row),
    evidenceType: D.DERIVED_MEASUREMENT_EVIDENCE_TYPE,
    limitationCodes: D.derivedMeasurementLimitationCodes({ measurementRow: row, dimensions: DIMENSIONS }),
    claimType: "finding",
    ...(reading ? { plainReading: reading.text, impactReading: reading } : {}),
    requestedAudience: "internal", revalidatedForGeneration: true, audienceAuthority: { internal: true },
  };
}

const KNOWN = claimOf(pairedRow(true, CONFIDENCE), 1);
const UNRESOLVED = claimOf(pairedRow(false, READINESS_UNRESOLVED), 2);
const UNSTATED = claimOf(pairedRow(false, null), 3);
const RATE = claimOf(rateRow(), 4);
const cite = (...claims) => claims.map((c) => ({ claimId: c.claimId, evidenceItemId: c.evidenceItemId }));
const validate = (blocks, claims) => validateGeneratedContentDraft({ requestedAudience: "internal", generationClaims: claims, blocks, contentType: "evidence_summary" });

test("Case A, meaning and direction stated: the reading names the outcome, the organization's meaning, the change, an interpretation and an implication", () => {
  const text = KNOWN.plainReading;
  assert.match(text, /^Digital confidence: the participant's self-rated digital confidence on a 1 to 5 scale/);
  assert.match(text, /Among the 38 participants with a comparable baseline and follow-up value, 25 \(65\.79%\) had a higher value at follow-up, 10 had the same value and 3 had a lower value\./);
  assert.match(text, /states that a higher value is better, so 25 participants moved in the better direction and 3 in the worse direction: more than half of the comparable participants had a better value at follow-up, a favourable observed change/);
  assert.match(text, /self-reported\), not an independent assessment/);
  assert.match(text, /does not by itself show that the programme was responsible/);
  assert.match(text, /What this suggests: this is an encouraging signal for Digital confidence/);
  assert.doesNotMatch(text, /field_\d|column F|whether higher is better is not established/);
  assert.equal(KNOWN.impactReading.signal, "favourable");
  assert.equal(KNOWN.impactReading.clarification, null);
});

test("Case B, direction unresolved: the change is kept and described, never read as progress, and one clarification is asked", () => {
  const text = UNRESOLVED.plainReading;
  assert.match(text, /Among the 40 participants .*, 23 \(57\.50%\) had a higher value at follow-up, 13 had the same value and 4 had a lower value\./);
  assert.match(text, /Whether a higher value is better has not been stated, so this is reported as an observed numerical change, not as progress or decline\./);
  assert.match(text, /Clarification needed: confirm whether a higher Employment readiness value is better\./);
  assert.doesNotMatch(text, /favourable|better direction|improv|encouraging/);
  assert.equal(UNRESOLVED.impactReading.signal, "unresolved");
  // No meaning recorded at all: named by its column, never by field key, and the meaning is asked for.
  assert.match(UNSTATED.plainReading, /^The numeric outcome in column G, recorded at baseline and at follow-up\. What it measures has not yet been stated by the organization\./);
  assert.match(UNSTATED.plainReading, /Clarification needed: state what the value in column G measures and whether a higher value is better\./);
  assert.doesNotMatch(UNSTATED.plainReading, /field_\d/);
});

test("Case C, self-reported follow-up result: stated as what respondents reported, for the measured population only", () => {
  const text = RATE.plainReading;
  assert.match(text, /^Self-reported paid work among answers: 9 of 29 \(31\.03%\) in the measured population; 20 of the 29 do not\./);
  assert.match(text, /not verified employment/);
  assert.match(text, /self-reported\), not an independent assessment/);
  assert.match(text, /not everyone the organization served/);
  assert.doesNotMatch(text, /(?<!not )\bverified employment\b(?! )/);
});

test("every reading passes the generated-content validators with its disclosure, and an invented figure is still refused", () => {
  const claims = [KNOWN, UNRESOLVED, UNSTATED, RATE];
  for (const claim of claims) {
    const composed = composeEvidenceSummaryMeasurementDisclosures({ blocks: [{ ordinal: 1, text: claim.plainReading, citations: cite(claim) }], claims, measuredValueByClaimId: new Map() });
    assert.equal(composed.ok, true);
    const result = validate(composed.blocks, claims);
    assert.equal(result.ok, true, JSON.stringify(result.blockers));
  }
  // The organization's own "1 to 5" is supported only through the claim that carries it.
  assert.deepEqual(unsupportedAssertionViolations({ blocks: [{ ordinal: 1, text: "Ratings ran from 1 to 5.", citations: cite(KNOWN) }], generationClaims: claims }), []);
  assert.deepEqual(unsupportedAssertionViolations({ blocks: [{ ordinal: 1, text: "Ratings ran from 1 to 5.", citations: cite(RATE) }], generationClaims: claims }).map((v) => v.literal), ["1", "5"]);
  // Unsupported model numbers and causal wording are still refused.
  const invented = unsupportedAssertionViolations({ blocks: [{ ordinal: 1, text: "Confidence rose by 2.8 points because of the workshops.", citations: cite(KNOWN) }], generationClaims: claims });
  assert.deepEqual(invented.map((v) => v.type).sort(), ["causal_language", "numeric_literal"]);
});

test("the Evidence Summary wording fallback restates a refused block in the plain reading, never the refused text", () => {
  const claims = [KNOWN, UNRESOLVED];
  const result = composeEvidenceSummaryWithWordingFallback({
    modelBlocks: [{ ordinal: 1, text: "The programme improves employment readiness by 40%.", citations: cite(UNRESOLVED) }, { ordinal: 2, text: KNOWN.plainReading, citations: cite(KNOWN) }],
    claims,
    validate: (blocks) => validate(blocks, claims),
  });
  assert.equal(result.ok, true);
  const texts = result.blocks.map((block) => block.text);
  assert.ok(texts.some((t) => t.startsWith(UNRESOLVED.plainReading)), "restated in its reading");
  assert.ok(!texts.some((t) => /improves employment readiness by 40%/.test(t)), "refused wording is never saved");
  assert.deepEqual(result.evidence.replaced_model_block_ordinals, [1]);
});

test("the assessment composes what the results suggest, the outcome clarification and an outcome recommendation, and discloses each figure once", () => {
  const claims = [KNOWN, UNRESOLVED, RATE];
  const modelBlocks = [
    { ordinal: 1, text: W("executive_snapshot", "Participants with comparable ratings mostly rated their digital confidence higher at follow-up."), citations: cite(KNOWN) },
    { ordinal: 2, text: W("evidence_findings", KNOWN.plainReading), citations: cite(KNOWN) },
    { ordinal: 3, text: W("impact_stories", "No participant account is stated beyond the cited findings."), citations: cite(KNOWN) },
  ];
  const composed = composeFreeImpactAssessmentBlocks({ modelBlocks, claims });
  assert.equal(composed.ok, true, composed.reason);
  const sections = parseFreeImpactAssessment(composed.blocks);
  const body = (key) => sections.find((s) => s.key === key).blocks.map((b) => b.body).join("\n");
  // Every selected measured claim is stated in the findings section, in its reading.
  assert.match(body("evidence_findings"), /Employment readiness: the participant's self-rated employment readiness/);
  assert.match(body("evidence_findings"), /Self-reported paid work among answers: 9 of 29/);
  assert.match(body("gaps_opportunities"), /What the results suggest:\n- Working well: Digital confidence: more than half of participants with comparable values had a better value at follow-up/);
  assert.match(body("gaps_opportunities"), /- Clarification needed: confirm whether a higher Employment readiness value is better\./);
  const recommendations = sections.find((s) => s.key === "recommended_improvements").blocks.map((b) => b.body);
  assert.match(recommendations[0], /^Proposed change: Record, on each outcome measure that does not yet state it, whether a higher value is better/);
  assert.match(recommendations[1], /^Proposed change: Build on the outcome that is moving in the right direction/);

  // Disclosures are appended to the findings blocks only (as the repository does).
  const findings = composed.blocks.filter((b) => b.text.startsWith("[[assessment:evidence_findings]]"));
  const disclosed = composeEvidenceSummaryMeasurementDisclosures({ blocks: findings, claims, measuredValueByClaimId: new Map([[KNOWN.claimId, 25], [UNRESOLVED.claimId, 23], [RATE.claimId, 9]]) });
  assert.equal(disclosed.ok, true);
  const byOrdinal = new Map(disclosed.blocks.map((b) => [b.ordinal, b]));
  const draft = composed.blocks.map((b) => byOrdinal.get(b.ordinal) ?? b);
  const result = validate(draft, claims);
  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  const disclosures = draft.filter((b) => /Measurement disclosure for/.test(b.text));
  assert.ok(disclosures.every((b) => b.text.startsWith("[[assessment:evidence_findings]]")), "no summary block repeats a disclosure");
  assert.ok(draft.reduce((n, b) => n + b.text.length, 0) < 20000);

  // Without the findings disclosure, the summary blocks citing those claims must disclose again.
  const undisclosed = validate(composed.blocks, claims);
  assert.equal(undisclosed.ok, false);
  assert.ok(undisclosed.blockers.some((b) => b.validator_key === "VAL-GEN-008"));
  // A summary block may still never contradict a limitation.
  const contradicting = draft.map((b) => (b.ordinal === 1 ? { ...b, text: W("executive_snapshot", "Every participant had higher digital confidence, verified by the organization.") } : b));
  assert.equal(validate(contradicting, claims).ok, false);
});

test("an unresolved outcome is never called an improvement anywhere in the composed assessment", () => {
  const composed = composeFreeImpactAssessmentBlocks({
    modelBlocks: [
      { ordinal: 1, text: W("executive_snapshot", "Employment readiness values changed between baseline and follow-up."), citations: cite(UNRESOLVED) },
      { ordinal: 2, text: W("evidence_findings", UNRESOLVED.plainReading), citations: cite(UNRESOLVED) },
      { ordinal: 3, text: W("impact_stories", "No participant account is stated beyond the cited findings."), citations: cite(UNRESOLVED) },
    ],
    claims: [UNRESOLVED],
  });
  assert.equal(composed.ok, true);
  const text = composed.blocks.map((b) => b.text).join("\n");
  assert.doesNotMatch(text, /\bimprov(?:ed|ement|ing)\b|favourable|Working well/);
  assert.match(text, /Clarification needed/);
});

test("reach without any outcome measure: the assessment names the outcome-evidence gap instead of treating reach as a result for participants", () => {
  // A linked-reach finding as the Project B measurement states it (190
  // encounters, 67 distinct people); the reading is the composed shape.
  const reach = {
    claimId: "39000000-0000-4000-8000-000000000009", evidenceItemId: "36000000-0000-4000-8000-000000000019",
    claimStatement: "People served: 67 distinct register participants served, each counted once, among 190 eligible encounters.",
    evidenceType: D.DERIVED_MEASUREMENT_EVIDENCE_TYPE, claimType: "finding",
    limitationCodes: ["derived.cross_source_linked", "derived.each_identifier_counted_once", "derived.meaning_human_stated", "derived.values_not_verified"],
    plainReading: "People served: 67 distinct people on the participant register received at least one completed service in the reporting period 2024-04-01 to 2025-03-31, across 190 eligible service encounters.",
    impactReading: { kind: "reach", signal: "descriptive", headline: "People served: 67 distinct people received at least one completed service in the reporting period 2024-04-01 to 2025-03-31" },
  };
  const composed = composeFreeImpactAssessmentBlocks({
    modelBlocks: [
      { ordinal: 1, text: W("executive_snapshot", "The organization reached people on its participant register."), citations: cite(reach) },
      { ordinal: 2, text: W("evidence_findings", reach.plainReading), citations: cite(reach) },
      { ordinal: 3, text: W("impact_stories", "No participant account is stated beyond the cited findings."), citations: cite(reach) },
    ],
    claims: [reach],
  });
  assert.equal(composed.ok, true, composed.reason);
  const gaps = parseFreeImpactAssessment(composed.blocks).find((s) => s.key === "gaps_opportunities").blocks.map((b) => b.body).join("\n");
  assert.match(gaps, /No baseline and follow-up outcome measure is among the selected evidence, so these results show the organization's activity and reach, not yet what changed for the people it served\./);
  assert.doesNotMatch(gaps, /Working well|favourable/);
});

test("a record count whose exact-duplicate rows equal its measured value: the server's own count-only finding is not read as a contradicted unit", () => {
  // Captured from the customer measured-report browser acceptance (story
  // source, 2 rows, 2 in exact-duplicate groups): before, the assessment was
  // refused VAL-GEN-008 limitation_contradicted on the server's own text.
  const id = "39000000-0000-4000-8000-000000000021";
  const evidence = "36000000-0000-4000-8000-000000000021";
  const serverFinding = "2 nonblank data rows were counted in the CSV data records of the cited source version, with 0 blank rows excluded and 2 exact-duplicate rows included in the count. This is a count of data records in that source version only: what one record represents is human-defined by the organization and was not verified by KAI, so the number is a row count and nothing more. The reporting period 2026-09-01 to 2026-09-30 is attested in that definition and was not verified against dates in the rows. Any coverage limitations recorded for the claim apply and are listed with the report's limitations.";
  const claim = {
    claimId: id, evidenceItemId: evidence, claimType: "finding", evidenceType: "source_record_count_measurement",
    claimStatement: "The promoted source has 2 source records (record count: one record per CSV data record; 0 blank records excluded; 2 in exact-duplicate groups (1 excess copy), not removed). Not applied by KAI: the organization's description of each record as one record, its stated period 2026-09-01 to 2026-09-30, and its inclusion and exclusion rules.",
    modelClaimStatement: serverFinding,
    limitationCodes: ["coverage.conflicting_source_indicators.unresolved", "coverage.duplicates.resolved_risk_flagged", "coverage.requirement_alignment.unresolved",
      "coverage.time_period_clarity.resolved_risk_flagged", "measurement.duplicate_records_included", "measurement.period_human_attested_not_row_verified", "measurement.record_meaning_human_defined"],
    requestedAudience: "internal", revalidatedForGeneration: true, audienceAuthority: { internal: true },
  };
  const disclosed = composeEvidenceSummaryMeasurementDisclosures({ blocks: [{ ordinal: 1, text: W("evidence_findings", serverFinding), citations: cite(claim) }], claims: [claim], measuredValueByClaimId: new Map([[id, 2]]) });
  assert.equal(disclosed.ok, true);
  assert.equal(validate(disclosed.blocks, [claim]).ok, true, JSON.stringify(validate(disclosed.blocks, [claim]).blockers));
  // Model wording that re-counts the 2 as something else is still refused.
  const modelText = composeEvidenceSummaryMeasurementDisclosures({ blocks: [{ ordinal: 1, text: W("evidence_findings", "The programme delivered 2 sessions."), citations: cite(claim) }], claims: [claim], measuredValueByClaimId: new Map([[id, 2]]) });
  assert.equal(validate(modelText.blocks, [claim]).ok, false);
});

test("monthly activity and recorded minutes read in plain language, without the register version identifier, and pass the validators", () => {
  const base = {
    organization_id: ORG, source_version_id: VERSION, measurement_source_version_id: VERSION, measurement_family: D.DERIVED_MEASUREMENT_FAMILIES.CROSS_SOURCE_REACH,
    worksheet_key: null, profile_canonical_sha256: "c".repeat(64), interpretation_id: "38000000-0000-4000-8000-000000000031", current_interpretation_id: "38000000-0000-4000-8000-000000000031",
    contributing_sources: [], score_direction: null, evidence_basis: "organization_record", meaning_text: "recorded service activity in the reporting period",
  };
  const period = { period_start: "2025-04-01", period_end: "2026-03-31" };
  const reference = "3c000000-0000-4000-8000-000000000001";
  const monthly = composeImpactFindingReading({ ...base, indicator_label: "Monthly eligible encounters", measured_value: 223,
    definition: { metric: "monthly_eligible_encounters", period, reference_source_version_id: reference },
    component_counts: { eligible_encounter_count: 223, monthly_activity: [{ month: "2025-04", encounter_count: 20 }, { month: "2025-05", encounter_count: 203 }] } });
  assert.equal(monthly.text, "Monthly eligible encounters: 223 completed service encounters in the reporting period 2025-04-01 to 2026-03-31, by the month they took place: 2025-04 20, 2025-05 203. These are encounters, not people.");
  const minutes = composeImpactFindingReading({ ...base, indicator_label: "Known recorded minutes", measured_value: 16815,
    definition: { metric: "known_recorded_service_minutes", period, reference_source_version_id: reference },
    component_counts: { known_recorded_minutes: 16815, duration_known_count: 220, eligible_encounter_count: 223, duration_missing_count: 3, duration_invalid_count: 0 } });
  assert.equal(minutes.text, "Known recorded minutes: 16815 minutes of service time are recorded for 220 of the 223 eligible encounters in the reporting period 2025-04-01 to 2026-03-31; 3 have no duration and 0 an invalid or conflicting one, so this is a known subtotal, not the complete service time.");
  for (const reading of [monthly, minutes]) {
    assert.doesNotMatch(reading.text, new RegExp(reference));
    assert.deepEqual(unsupportedAssertionViolations({ blocks: [{ ordinal: 1, text: reading.text, citations: [{ claimId: "c1", evidenceItemId: "e1" }] }],
      generationClaims: [{ claimId: "c1", evidenceItemId: "e1", claimStatement: "statement", plainReading: reading.text, limitationCodes: [] }] }), []);
  }
  // The subtotal is never presented as the complete service time.
  const rule = D.DERIVED_DISCLOSURE_RULES.find((entry) => entry.code === D.DERIVED_LIMITATION_CODES.RECORDED_MINUTES_SUBTOTAL);
  assert.ok(rule.requires.test(minutes.text));
  assert.ok(!rule.forbids.test(minutes.text));
});

test("a minority moved in the better direction and exactly half stayed the same (15/18/3 of 36): the reading and the assessment say exactly half, never most, and propose asking what would help", () => {
  const row = { ...pairedRow(true, CONFIDENCE), numerator: 15, measured_value: 15, denominator: 36, percentage: "41.67",
    component_counts: { participant_count: 59, comparable_pair_count: 36, increased_count: 15, unchanged_count: 18, decreased_count: 3, excluded_participant_count: 23 } };
  const claim = claimOf(row, 5);
  assert.equal(claim.impactReading.signal, "favourable_minority");
  assert.match(claim.plainReading, /15 \(41\.67%\) had a higher value at follow-up, 18 had the same value and 3 had a lower value/);
  // 18 of 36 is exactly half: not "most", and not merely "the largest group".
  assert.match(claim.plainReading, /Exactly half of the comparable participants, 18 of 36, had the same value at follow-up\./);
  assert.match(claim.plainReading, /but fewer than half of the comparable participants moved that way and exactly half did not report a change\./);
  assert.doesNotMatch(claim.plainReading, /\bmost\b/i);
  assert.doesNotMatch(claim.plainReading, /a favourable observed change/);
  assert.match(claim.impactReading.headline, /though exactly half of comparable participants reported no change$/);
  const composed = composeFreeImpactAssessmentBlocks({
    modelBlocks: [
      { ordinal: 1, text: W("executive_snapshot", "Digital confidence ratings were compared at baseline and follow-up."), citations: cite(claim) },
      { ordinal: 2, text: W("evidence_findings", claim.plainReading), citations: cite(claim) },
      { ordinal: 3, text: W("impact_stories", "No participant account is stated beyond the cited findings."), citations: cite(claim) },
    ],
    claims: [claim],
  });
  assert.equal(composed.ok, true, composed.reason);
  const recommendations = parseFreeImpactAssessment(composed.blocks).find((s) => s.key === "recommended_improvements").blocks.map((b) => b.body);
  assert.ok(recommendations.some((body) => body.startsWith("Proposed change: Ask participants at the follow-up rating what would help them move further")), recommendations.join("\n"));
  assert.ok(!recommendations.some((body) => body.includes("Build on the outcome")), "a minority result is not presented as a favourable outcome to build on");
  const analysis = parseFreeImpactAssessment(composed.blocks).find((s) => s.key === "gaps_opportunities").blocks.map((b) => b.body).join("\n");
  assert.match(analysis, /- Some progress: Digital confidence: more participants moved in the better direction than the worse, though exactly half of comparable participants reported no change\./);
  assert.doesNotMatch(analysis, /Working well/);
  const disclosed = composeEvidenceSummaryMeasurementDisclosures({ blocks: composed.blocks.filter((b) => b.text.startsWith("[[assessment:evidence_findings]]")), claims: [claim], measuredValueByClaimId: new Map([[claim.claimId, 15]]) });
  const byOrdinal = new Map(disclosed.blocks.map((b) => [b.ordinal, b]));
  assert.equal(validate(composed.blocks.map((b) => byOrdinal.get(b.ordinal) ?? b), [claim]).ok, true);
});

// ---------------------------------------------------------------------------
// Owner direction 2026-11-12 ("Correct and prove the remaining impact
// interpretation defect"): every proportion word in the saved assessment is
// decided by the counts. Each case's expected wording is written here by hand
// from its own arithmetic (noted beside it), not derived from the reading
// module, and is checked in every customer-facing section of the composed
// assessment: the snapshot, the findings, the analysis, the documented gaps
// and the recommendations.

const UNKNOWN_DIRECTION = Object.freeze({ ...READINESS_UNRESOLVED, indicator_label: "Resource-navigation confidence",
  meaning_text: "a five-point self-report question asking how ready the respondent feels to find relevant assistance" });
const LOWER_BETTER = Object.freeze({ indicator_label: "Social isolation score", score_direction: "lower_is_better", evidence_basis: "self_reported",
  meaning_text: "the participant's self-rated isolation on a 1 to 5 scale, where 5 means very isolated" });

function caseClaim(n, interpretation, { higher, same, lower }) {
  const pairs = higher + same + lower;
  const row = { ...pairedRow(true, interpretation), numerator: higher, measured_value: higher, denominator: pairs,
    percentage: (Math.round((higher / pairs) * 10000) / 100).toFixed(2),
    component_counts: { participant_count: pairs + 10, comparable_pair_count: pairs, increased_count: higher, unchanged_count: same, decreased_count: lower, excluded_participant_count: 10 } };
  const claim = claimOf(row, 9);
  return { ...claim, claimId: `39000000-0000-4000-8000-${String(100 + n).padStart(12, "0")}` };
}

function assessmentOf(claim) {
  const snapshot = composeAssessmentSnapshot([claim]);
  const composed = composeFreeImpactAssessmentBlocks({
    modelBlocks: [
      { ordinal: 1, text: W("executive_snapshot", snapshot.body), citations: snapshot.citations },
      { ordinal: 2, text: W("evidence_findings", claim.plainReading), citations: cite(claim) },
      { ordinal: 3, text: W("impact_stories", "No participant account is stated beyond the cited findings."), citations: cite(claim) },
    ],
    claims: [claim],
  });
  assert.equal(composed.ok, true, composed.reason);
  const sections = parseFreeImpactAssessment(composed.blocks);
  const body = (key) => (sections.find((s) => s.key === key)?.blocks || []).map((b) => b.body).join("\n");
  // The saved blocks pass the same validators as any generated draft.
  const disclosed = composeEvidenceSummaryMeasurementDisclosures({ blocks: composed.blocks.filter((b) => b.text.startsWith("[[assessment:evidence_findings]]")), claims: [claim], measuredValueByClaimId: new Map([[claim.claimId, claim.impactReading ? Number(claim.claimStatement.match(/(\d+) of \d+/)?.[1]) : 0]]) });
  const byOrdinal = new Map(disclosed.blocks.map((b) => [b.ordinal, b]));
  const validation = validate(composed.blocks.map((b) => byOrdinal.get(b.ordinal) ?? b), [claim]);
  assert.equal(validation.ok, true, JSON.stringify(validation.blockers));
  return {
    snapshot: body("executive_snapshot"), findings: body("evidence_findings"), analysis: body("gaps_opportunities"),
    recommendations: body("recommended_improvements"), all: sections.flatMap((s) => s.blocks.map((b) => b.body)).join("\n"),
  };
}

// No section may call the unchanged group "most"/a majority unless it is more
// than half, nor present a result as working or favourable unless more than
// half moved in the stated better direction.
function assertNoUnsupportedShare(all, { sameIsMajority, betterIsMajority }) {
  if (!sameIsMajority) {
    assert.doesNotMatch(all, /\bmost\b[^.\n]*(?:same value|no change|not report a change|did not change)/i, "the unchanged group is called most");
    assert.doesNotMatch(all, /\bmajority\b/i);
  }
  if (!betterIsMajority) {
    assert.doesNotMatch(all, /Working well|a favourable observed change|encouraging signal|Build on the outcome that is moving in the right direction|moving in the right direction/);
    assert.doesNotMatch(all, /\bmost\b[^.\n]*better (?:direction|value)/i);
  }
}

test("interpretation cases: less than half unchanged with a majority better (25/10/3 of 38) is working well and says nothing about an unchanged majority", () => {
  // 25*2 = 50 > 38: majority better. 10*2 = 20 < 38 and 10 < 25: unchanged is neither half, most nor largest.
  const claim = caseClaim(1, CONFIDENCE, { higher: 25, same: 10, lower: 3 });
  assert.equal(claim.impactReading.signal, "favourable");
  const a = assessmentOf(claim);
  assert.match(a.findings, /more than half of the comparable participants had a better value at follow-up, a favourable observed change/);
  assert.doesNotMatch(a.findings, /Exactly half|Most comparable|The largest group|All \d+ comparable/);
  assert.match(a.analysis, /- Working well: Digital confidence: more than half of participants with comparable values had a better value at follow-up/);
  assert.match(a.recommendations, /Proposed change: Build on the outcome that is moving in the right direction/);
  assertNoUnsupportedShare(a.all, { sameIsMajority: false, betterIsMajority: true });
});

test("interpretation cases: exactly half unchanged (Project B, 15/18/3 of 36) is exactly half and some progress, never most or working well", () => {
  // 18*2 = 36: exactly half unchanged. 15*2 = 30 < 36: fewer than half better. 15 > 3: more better than worse.
  const claim = caseClaim(2, CONFIDENCE, { higher: 15, same: 18, lower: 3 });
  assert.equal(claim.impactReading.signal, "favourable_minority");
  const a = assessmentOf(claim);
  assert.match(a.findings, /15 \(41\.67%\) had a higher value at follow-up, 18 had the same value and 3 had a lower value\./);
  assert.match(a.findings, /Exactly half of the comparable participants, 18 of 36, had the same value at follow-up\./);
  assert.match(a.findings, /more participants moved in the better direction \(15\) than in the worse direction \(3\), although fewer than half of the comparable participants did so\./);
  assert.match(a.snapshot, /though exactly half of comparable participants reported no change/);
  assert.match(a.analysis, /- Some progress: Digital confidence: .* though exactly half of comparable participants reported no change\./);
  assert.match(a.analysis, /no more than half of the comparable participants moved in the direction the organization states is better; the others had the same value at follow-up or moved the other way\./);
  assert.match(a.recommendations, /Proposed change: Ask participants at the follow-up rating what would help them move further/);
  assertNoUnsupportedShare(a.all, { sameIsMajority: false, betterIsMajority: false });
});

test("interpretation cases: more than half unchanged (8/26/2 of 36) is most, and the movement is some progress only", () => {
  // 26*2 = 52 > 36: most unchanged. 8 > 2: more better than worse; 8*2 < 36.
  const claim = caseClaim(3, CONFIDENCE, { higher: 8, same: 26, lower: 2 });
  assert.equal(claim.impactReading.signal, "favourable_minority");
  const a = assessmentOf(claim);
  assert.match(a.findings, /Most comparable participants, 26 of 36, had the same value at follow-up\./);
  assert.match(a.findings, /moved that way and most did not report a change\./);
  assert.match(a.analysis, /- Some progress: Digital confidence: .* though most comparable participants reported no change\./);
  assertNoUnsupportedShare(a.all, { sameIsMajority: true, betterIsMajority: false });
});

test("interpretation cases: a plurality that is not a majority (12/16/8 of 36) is the largest group, said to be fewer than half; a tie (15/15/6) is no largest group", () => {
  // 16 > 12 and 16 > 8, but 16*2 = 32 < 36: largest group, not most, not half.
  const plurality = assessmentOf(caseClaim(4, CONFIDENCE, { higher: 12, same: 16, lower: 8 }));
  assert.match(plurality.findings, /The largest group, 16 participants, had the same value at follow-up, although they are fewer than half of the comparable participants\./);
  assert.match(plurality.analysis, /though the largest group reported no change\./);
  assertNoUnsupportedShare(plurality.all, { sameIsMajority: false, betterIsMajority: false });
  // 15 = 15: neither group is the largest; 15*2 = 30 < 36.
  const tie = assessmentOf(caseClaim(5, CONFIDENCE, { higher: 15, same: 15, lower: 6 }));
  assert.doesNotMatch(tie.all, /largest group|Exactly half|Most comparable/);
  assert.match(tie.analysis, /though fewer than half of comparable participants did so\./);
  assertNoUnsupportedShare(tie.all, { sameIsMajority: false, betterIsMajority: false });
  // Exactly half moving in the better direction (18/12/6 of 36) is not a majority either.
  const halfBetter = caseClaim(6, CONFIDENCE, { higher: 18, same: 12, lower: 6 });
  assert.equal(halfBetter.impactReading.signal, "favourable_minority");
  const h = assessmentOf(halfBetter);
  assert.match(h.findings, /although exactly half of the comparable participants did so\./);
  assertNoUnsupportedShare(h.all, { sameIsMajority: false, betterIsMajority: false });
});

test("interpretation cases: more participants declining than improving needs attention, whichever direction the organization states is better", () => {
  // Higher is better; 5 higher < 11 lower.
  const higherBetter = caseClaim(7, CONFIDENCE, { higher: 5, same: 20, lower: 11 });
  assert.equal(higherBetter.impactReading.signal, "unfavourable");
  const a = assessmentOf(higherBetter);
  assert.match(a.findings, /more participants moved in the worse direction \(11\) than in the better direction \(5\): an unfavourable observed change that needs attention\./);
  assert.match(a.findings, /Most comparable participants, 20 of 36, had the same value at follow-up\./);
  assert.match(a.analysis, /- Needs attention: Digital confidence: more participants moved in the worse direction than the better/);
  assert.doesNotMatch(a.all, /Some progress/);
  assertNoUnsupportedShare(a.all, { sameIsMajority: true, betterIsMajority: false });
  // Lower is better; 11 higher (worse) > 5 lower (better).
  const lowerBetter = caseClaim(8, LOWER_BETTER, { higher: 11, same: 20, lower: 5 });
  assert.equal(lowerBetter.impactReading.signal, "unfavourable");
  assert.match(lowerBetter.plainReading, /a lower value is better, so more participants moved in the worse direction \(11\) than in the better direction \(5\)/);
  assertNoUnsupportedShare(assessmentOf(lowerBetter).all, { sameIsMajority: true, betterIsMajority: false });
});

test("interpretation cases: meaning unknown keeps the exact split, states shares exactly, and never reads progress or decline", () => {
  // Project B resource navigation shape (15/17/5 of 37): 17 largest, 17*2 = 34 < 37.
  const navigation = caseClaim(9, UNKNOWN_DIRECTION, { higher: 15, same: 17, lower: 5 });
  assert.equal(navigation.impactReading.signal, "unresolved");
  const a = assessmentOf(navigation);
  assert.match(a.findings, /Among the 37 participants with a comparable baseline and follow-up value, 15 \(40\.54%\) had a higher value at follow-up, 17 had the same value and 5 had a lower value\./);
  assert.match(a.findings, /The largest group, 17 participants, had the same value at follow-up, although they are fewer than half of the comparable participants\./);
  assert.match(a.findings, /Whether a higher value is better has not been stated, so this is reported as an observed numerical change, not as progress or decline\./);
  assert.match(a.all, /Clarification needed: confirm whether a higher Resource-navigation confidence value is better\./);
  assert.doesNotMatch(a.all, /better direction|worse direction|favourable|Some progress|Needs attention|Working well|encouraging/);
  assertNoUnsupportedShare(a.all, { sameIsMajority: false, betterIsMajority: false });
  // Exactly half unchanged and more lower than higher, direction unknown: still no decline is read.
  const declining = assessmentOf(caseClaim(10, UNKNOWN_DIRECTION, { higher: 3, same: 18, lower: 15 }));
  assert.match(declining.findings, /Exactly half of the comparable participants, 18 of 36, had the same value at follow-up\./);
  assert.doesNotMatch(declining.all, /better direction|worse direction|unfavourable|Needs attention/);
  // Nobody changed: all, not most, and no change is claimed.
  const still = caseClaim(11, CONFIDENCE, { higher: 0, same: 30, lower: 0 });
  assert.match(still.plainReading, /All 30 comparable participants had the same value at follow-up\./);
  assert.match(still.plainReading, /no comparable participant's value changed between baseline and follow-up/);
  assert.doesNotMatch(still.plainReading, /the 0 whose|as many participants moved/);
});

test("interpretation cases: the internal report's conclusion calls a paired outcome favourable only when more than half moved in the better direction", () => {
  const conclusionOf = (claim, counts) => REPORT.pairedConclusion(claim.impactReading.signal, {
    increased_count: counts.higher, unchanged_count: counts.same, decreased_count: counts.lower, comparable_pair_count: counts.higher + counts.same + counts.lower,
  });
  const cases = [
    // [interpretation, counts, expected conclusion] - expectations from each case's own arithmetic.
    [CONFIDENCE, { higher: 25, same: 10, lower: 3 }, "a favourable observed change"], // 25*2 > 38
    [CONFIDENCE, { higher: 15, same: 18, lower: 3 }, "some progress rather than an overall favourable change: more participants moved in the better direction than the worse, but fewer than half of the comparable participants did so"], // 15*2 < 36
    [CONFIDENCE, { higher: 18, same: 12, lower: 6 }, "some progress rather than an overall favourable change: more participants moved in the better direction than the worse, but exactly half of the comparable participants did so"], // 18*2 = 36
    [LOWER_BETTER, { higher: 4, same: 20, lower: 12 }, "some progress rather than an overall favourable change: more participants moved in the better direction than the worse, but fewer than half of the comparable participants did so"], // lower better: 12*2 < 36
    [CONFIDENCE, { higher: 5, same: 20, lower: 11 }, "an unfavourable observed change"],
    [CONFIDENCE, { higher: 6, same: 24, lower: 6 }, "a mixed result, with as many participants moving in the better direction as in the worse"],
    [CONFIDENCE, { higher: 0, same: 30, lower: 0 }, "no change in either direction"],
  ];
  cases.forEach(([interpretation, counts, expected], index) => {
    assert.equal(conclusionOf(caseClaim(20 + index, interpretation, counts), counts), expected, JSON.stringify(counts));
  });
});
