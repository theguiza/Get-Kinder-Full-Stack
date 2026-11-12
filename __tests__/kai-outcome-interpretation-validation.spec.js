import test from "node:test";
import assert from "node:assert/strict";

import * as D from "../Backend/kai/validators/kaiDerivedMeasurementValidators.js";
import {
  composeEvidenceSummaryWithWordingFallback,
  unsupportedAssertionViolations,
  validateGeneratedContentDraft,
} from "../Backend/kai/validators/kaiGeneratedContentValidators.js";
import { composeImpactFindingReading } from "../Backend/kai/services/kaiImpactFindingReading.js";
import { __internalReportMarkdownSerializerTestables as REPORT } from "../Backend/kai/services/kaiInternalReportMarkdownSerializer.js";

// Owner direction 2026-11-12 ("Close the remaining impact-interpretation
// integrity gap"): a model's own wording about a paired outcome is checked
// against that outcome's governed split and recorded direction at VAL-GEN-004.
// Each case below is a sentence an independently writing model could produce;
// whether it may be saved follows from the counts written next to it, never
// from the words alone.

const ORG = "31000000-0000-4000-8000-000000000001";
const VERSION = "32000000-0000-4000-8000-000000000001";
const COMMUNITY = Object.freeze({ indicator_label: "Community-connection confidence", score_direction: "higher_is_better", evidence_basis: "self_reported",
  meaning_text: "the participant's community-connection confidence on a five-point self-report scale (1 = very low, 5 = very high)" });
const NAVIGATION = Object.freeze({ indicator_label: "Resource-navigation confidence", score_direction: "not_established", evidence_basis: "self_reported",
  meaning_text: "a five-point self-report question asking how ready the respondent feels to find relevant assistance" });
const DIGITAL = Object.freeze({ indicator_label: "Digital confidence", score_direction: "higher_is_better", evidence_basis: "self_reported",
  meaning_text: "the participant's self-rated digital confidence on a 1 to 5 scale, where 5 means very high confidence" });

function claim(n, interpretation, { higher, same, lower }) {
  const pairs = higher + same + lower;
  const row = {
    organization_id: ORG, evidence_item_id: `36000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    source_version_id: VERSION, measurement_source_version_id: VERSION, source_derived_measurement_id: `37000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    measurement_family: D.DERIVED_MEASUREMENT_FAMILIES.PAIRED_OUTCOME, calculation_method: D.DERIVED_MEASUREMENT_METHODS.PAIRED_OUTCOME, worksheet_key: "sheet_1",
    definition: { outcome_field_key: "field_6", outcome_column: "F", participant_field_key: "field_2", stage_field_key: "field_4", instrument_version_field_key: "field_5" },
    field_keys: ["field_2", "field_4", "field_5", "field_6"], measured_value: higher, numerator: higher, denominator: pairs,
    percentage: (Math.round((higher / pairs) * 10000) / 100).toFixed(2),
    component_counts: { participant_count: pairs + 20, comparable_pair_count: pairs, increased_count: higher, unchanged_count: same, decreased_count: lower, excluded_participant_count: 20 },
    exclusions: { participants: [], rows: [] }, row_locators: {}, profile_canonical_sha256: "a".repeat(64),
    interpretation_id: `38000000-0000-4000-8000-${String(n).padStart(12, "0")}`, current_interpretation_id: `38000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    contributing_sources: [], ...interpretation,
  };
  const reading = composeImpactFindingReading(row);
  return {
    claimId: `39000000-0000-4000-8000-${String(n).padStart(12, "0")}`, evidenceItemId: row.evidence_item_id,
    claimStatement: D.composeDerivedClaimStatementFromRow(row), evidenceType: D.DERIVED_MEASUREMENT_EVIDENCE_TYPE,
    limitationCodes: D.derivedMeasurementLimitationCodes({ measurementRow: row, dimensions: {} }), claimType: "finding",
    plainReading: reading.text, impactReading: reading,
    requestedAudience: "internal", revalidatedForGeneration: true, audienceAuthority: { internal: true },
  };
}

// Project B scenario O (15/18/3 of 36; 15/17/5 of 37, direction not stated) and Cedar (25/10/3 of 38).
const CC = claim(1, COMMUNITY, { higher: 15, same: 18, lower: 3 });
const RA = claim(2, NAVIGATION, { higher: 15, same: 17, lower: 5 });
const DC = claim(3, DIGITAL, { higher: 25, same: 10, lower: 3 });
const MOSTLY_SAME = claim(4, COMMUNITY, { higher: 8, same: 26, lower: 2 });
const cite = (...claims) => claims.map((c) => ({ claimId: c.claimId, evidenceItemId: c.evidenceItemId }));

function violationsOf(text, claims) {
  return unsupportedAssertionViolations({ blocks: [{ ordinal: 1, text: `[[assessment:evidence_findings]]\n${text}`, citations: cite(...claims) }], generationClaims: claims });
}

const REFUSED = [
  // The owner's five incorrect interpretations.
  ["Most comparable participants did not report a change.", [CC], "18 of 36 unchanged is exactly half, not most"],
  ["A majority of participants improved their Community-connection confidence.", [CC], "15 of 36 moved in the better direction"],
  ["The programme produced an overall favourable improvement in Community-connection confidence.", [CC], "fewer than half moved in the better direction; and no comparison group"],
  ["Resource-navigation confidence improved for participants.", [RA], "no direction is stated for this outcome"],
  ["Both measured outcomes show that the programme improved participant outcomes.", [CC, RA], "programme causation; one direction unresolved; a minority"],
  // Majority versus plurality.
  ["Most comparable participants had the same Resource-navigation confidence score.", [RA], "17 of 37 is the largest group, not a majority"],
  // Exactly half versus more than half.
  ["More than half of comparable participants had the same Community-connection confidence score.", [CC], "18 of 36 is exactly half"],
  // Unchanged versus not increased.
  ["21 of 36 had unchanged Community-connection confidence scores.", [CC], "18 were unchanged; 21 did not increase"],
  // Numerical increase versus favourable change, for an unresolved direction.
  ["15 of 37 improved their Resource-navigation confidence.", [RA], "higher is not known to be better"],
  // Favourable change versus causal programme impact, even for the favourable Cedar result.
  ["The programme improved Digital confidence for most participants.", [DC], "25 of 38 is favourable, but no comparison group is cited"],
  // A comparison the counts contradict.
  ["Fewer participants reported higher Community-connection scores than lower scores.", [CC], "15 higher, 3 lower"],
  // A wrong count for a derived group is neither a supported number nor a supported reading.
  ["A majority, 22 of 36, did not report an increase in Community-connection confidence.", [CC], "21 did not increase"],
];

const ACCEPTED = [
  // The owner's accurate statements.
  ["Exactly half of the 36 comparable participants had unchanged Community-connection confidence scores.", [CC]],
  ["More participants reported higher scores than lower scores, but fewer than half reported higher scores.", [CC]],
  ["A majority, 21 of 36, did not report an increase in Community-connection confidence.", [CC]],
  ["The largest Resource-navigation group was unchanged: 17 of 37, fewer than half of comparable participants.", [RA]],
  // An appropriately qualified favourable statement for the Cedar outcome.
  ["Most comparable participants, 25 of 38, reported higher Digital confidence at follow-up, a favourable observed change; without a comparison group this does not show that the programme was responsible for it.", [DC]],
  ["Digital confidence improved for most comparable participants.", [DC]],
  // "Most" is not banned: it holds for a real majority.
  ["Most comparable participants had the same Community-connection confidence score.", [MOSTLY_SAME]],
  // A numerical change for an unresolved direction, stated as numbers only.
  ["15 of 37 gave a higher Resource-navigation rating at follow-up; whether a higher rating is better has not been stated.", [RA]],
  // An improvement count where the direction is stated.
  ["Community-connection confidence improved for 15 of 36 comparable participants.", [CC]],
  // Some progress, said as some progress.
  ["Community-connection confidence shows some progress: more participants moved in the better direction than the worse, but fewer than half did so.", [CC]],
];

test("VAL-GEN-004 refuses a model interpretation the cited outcome's counts or recorded direction contradict, even though the block cites correct figures", () => {
  for (const [text, claims, why] of REFUSED) {
    const found = violationsOf(text, claims).filter((v) => v.type === "outcome_interpretation");
    assert.ok(found.length > 0, `${why}: ${text}`);
  }
  // The refusal is VAL-GEN-004's, with the class and section, never the text.
  const validation = validateGeneratedContentDraft({ requestedAudience: "internal", generationClaims: [CC],
    blocks: [{ ordinal: 1, text: "Most comparable participants did not report a change.", citations: cite(CC) }] });
  const blocker = validation.blockers.find((b) => b.validator_key === "VAL-GEN-004");
  assert.deepEqual(blocker.evidence.assertion_classes, ["outcome_interpretation"]);
  assert.doesNotMatch(JSON.stringify(blocker.evidence), /Most comparable/);
});

test("accurate interpretations, including qualified favourable ones, are not refused", () => {
  for (const [text, claims] of ACCEPTED) assert.deepEqual(violationsOf(text, claims), [], text);
});

test("a count for a derived group is supported only when the split confirms it, and only in that statement", () => {
  // 21 = 18 unchanged + 3 lower: allowed where it is stated as not increased...
  assert.deepEqual(violationsOf("A majority, 21 of 36, did not report an increase in Community-connection confidence.", [CC]), []);
  // ...never as another group, and never as an unattributed number.
  assert.ok(violationsOf("21 of 36 had unchanged Community-connection confidence scores.", [CC]).some((v) => v.type === "numeric_literal" && v.literal === "21"));
  assert.ok(violationsOf("Community-connection confidence was recorded for 21 people.", [CC]).some((v) => v.type === "numeric_literal" && v.literal === "21"));
  // A bare negated statement with no verified share or count keeps the existing causal-word rule,
  // also beside a verified one in the same block, and a cause added to a verified clause is still caught.
  assert.ok(violationsOf("Participants did not report an increase.", [CC]).some((v) => v.type === "causal_language"));
  assert.ok(violationsOf("A majority, 21 of 36, did not report an increase in Community-connection confidence. Participants did not report an increase.", [CC]).some((v) => v.type === "causal_language"));
  assert.ok(violationsOf("A majority, 21 of 36, did not report an increase because of scheduling.", [CC]).some((v) => v.type === "causal_language" && v.literal === "because"));
});

test("the server's own readings, composed analysis and gap wording pass the new check for every split", () => {
  const splits = [[25, 10, 3], [15, 18, 3], [8, 26, 2], [12, 16, 8], [15, 15, 6], [18, 12, 6], [5, 20, 11], [0, 30, 0], [15, 17, 5]];
  splits.forEach(([higher, same, lower], index) => {
    for (const interpretation of [COMMUNITY, NAVIGATION, { ...COMMUNITY, score_direction: "lower_is_better" }]) {
      const c = claim(40 + index, interpretation, { higher, same, lower });
      // The reading is governed text; a model that paraphrases its headline is checked like any other wording.
      const headline = c.impactReading.headline;
      if (headline) assert.deepEqual(violationsOf(`${headline}.`, [c]).filter((v) => v.type === "outcome_interpretation"), [], `${headline} (${higher}/${same}/${lower})`);
    }
  });
});

test("the Evidence Summary wording fallback replaces only the refused block, with the outcome's own accurate reading", () => {
  const result = composeEvidenceSummaryWithWordingFallback({
    modelBlocks: [
      { ordinal: 1, text: "Most comparable participants did not report a change in Community-connection confidence.", citations: cite(CC) },
      { ordinal: 2, text: "The largest Resource-navigation group was unchanged: 17 of 37, fewer than half of comparable participants.", citations: cite(RA) },
    ],
    claims: [CC, RA],
    measuredValueByClaimId: new Map([[CC.claimId, 15], [RA.claimId, 15]]),
    validate: (blocks) => validateGeneratedContentDraft({ requestedAudience: "internal", generationClaims: [CC, RA], blocks, contentType: "evidence_summary" }),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.evidence.replaced_model_block_ordinals, [1]);
  assert.ok(result.evidence.refused_classes.includes("outcome_interpretation"));
  const text = result.blocks.map((b) => b.text).join("\n");
  assert.doesNotMatch(text, /Most comparable participants did not report a change/);
  assert.ok(text.includes("Exactly half of the comparable participants, 18 of 36, had the same value at follow-up."), "the useful finding survives");
  assert.ok(text.includes("The largest Resource-navigation group was unchanged: 17 of 37"), "the accurate model block is kept");
});

test("the report attaches an unresolved direction only to the outcome it concerns", () => {
  const fact = (ref, indicator, stated) => ({ citationRefs: [ref], derivedMeasurement: { reading: { indicator } },
    limitationCodes: stated ? [D.DERIVED_LIMITATION_CODES.DIRECTION_HUMAN_STATED] : [] });
  const community = fact("CIT-004", "Community-connection confidence", true);
  const navigation = fact("CIT-005", "Resource-navigation confidence", false);
  const other = fact("CIT-006", "Employment readiness", false);
  // One paired outcome: "the measured change" is unambiguous (wording unchanged).
  assert.equal(REPORT.unresolvedDirectionClause([navigation]), ", and the beneficial direction of the measured change is not established");
  assert.equal(REPORT.unresolvedDirectionClause([community]), "");
  // Several: the unresolved one is named; the stated one is not covered by it.
  assert.equal(REPORT.unresolvedDirectionClause([community, navigation]),
    ", and whether a higher value is better has not been established for Resource-navigation confidence [CIT-005] (the organization has stated it for the other measured outcome)");
  assert.equal(REPORT.unresolvedDirectionClause([navigation, other]),
    ", and whether a higher value is better has not been established for Resource-navigation confidence [CIT-005] and Employment readiness [CIT-006]");
  assert.equal(REPORT.unresolvedDirectionClause([community, { ...community, citationRefs: ["CIT-007"] }]), "");
});
