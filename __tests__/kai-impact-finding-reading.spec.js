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
  composeFreeImpactAssessmentBlocks,
  parseFreeImpactAssessment,
  withAssessmentSection as W,
} from "../Backend/kai/services/kaiFreeImpactAssessmentComposition.js";
import { composeImpactFindingReading } from "../Backend/kai/services/kaiImpactFindingReading.js";

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
