import test from "node:test";
import assert from "node:assert/strict";

import {
  WORDING_FALLBACK_RESULT_KEY,
  composeEvidenceSummaryWithWordingFallback,
  validateGeneratedContentDraft,
} from "../Backend/kai/validators/kaiGeneratedContentValidators.js";

/**
 * Evidence Summary wording fallback (owner direction 2026-11-10): an
 * Evidence Summary gets one model attempt, and before this change any one
 * refused sentence failed the whole request ("Request failed KAI
 * validation."). Ordinary wording a model writes - a fiscal-year label, an
 * exclusion explained with "because", the word "impact" - was refused even
 * though the facts were right. Now refused blocks are restated from the
 * cited claims' own governed text with their disclosures, passing blocks keep
 * the model's wording, and nothing unsupported is ever saved.
 *
 * The claims are the persisted Project B claims (Package 4 acceptance: the
 * 190 contacts, the 67 people and the review's "at least 90" estimate) with
 * the exact limitation codes the generation projection sent.
 */

const PERSISTED = [
  {
    "statement": "Source-reported, not independently verified (page 2, blocks 3-5): \"Prepared before the export files were joined and checked Preliminary reach estimate requiring reconciliation During planning, a manager said that at least 90 different people received a direct CC or RA service in FY 2024-25. That number came from a rough tally of session lists and referral appointments, not a distinct-person calculation.\"",
    "codes": [
      "claim_review_unresolved",
      "coverage_dimension_unresolved",
      "document.contains_uncertainty",
      "document.source_estimate",
      "document.source_reported_not_verified",
      "evidence_review_unresolved",
      "support_strength_unassessed"
    ]
  },
  {
    "statement": "Eligible completed contacts (meaning stated by the organization; values are organization records): 190 eligible service encounters (encounters, not people): field_1 events, field_6 = completed, field_4 in reporting period 2024-04-01 to 2025-03-31 by day, field_2 in register 2f4adc16-3872-44c1-b09c-9cce56c38ae1 field_1; 2 duplicate copies counted once; excluded 5 outside period, 2 unmatched, 0 conflicting.",
    "codes": [
      "claim_review_unresolved",
      "coverage.conflicting_source_indicators.unresolved",
      "coverage.duplicates.resolved_risk_flagged",
      "coverage.missingness.resolved_risk_flagged",
      "coverage.requirement_alignment.unresolved",
      "coverage_dimension_unresolved",
      "derived.cross_source_linked",
      "derived.duplicate_event_copies_counted_once",
      "derived.encounters_not_people",
      "derived.engagement_period_applied",
      "derived.meaning_human_stated",
      "derived.organization_records",
      "derived.unmatched_identifiers_excluded",
      "derived.values_not_verified",
      "evidence_review_unresolved",
      "support_strength_unassessed"
    ]
  },
  {
    "statement": "People served (meaning stated by the organization; values are organization records): 67 distinct register participants served, each counted once, among 190 eligible encounters: field_1 events, field_6 = completed, field_4 in reporting period 2024-04-01 to 2025-03-31 by day, field_2 in register 2f4adc16-3872-44c1-b09c-9cce56c38ae1 field_1; 11 in several field_3 counted once; 2 duplicate copies counted once; excluded 5 outside period, 2 unmatched, 0 conflicting.",
    "codes": [
      "claim_review_unresolved",
      "coverage.conflicting_source_indicators.unresolved",
      "coverage.duplicates.resolved_risk_flagged",
      "coverage.missingness.resolved_risk_flagged",
      "coverage.requirement_alignment.unresolved",
      "coverage_dimension_unresolved",
      "derived.cross_source_linked",
      "derived.duplicate_event_copies_counted_once",
      "derived.each_identifier_counted_once",
      "derived.engagement_period_applied",
      "derived.meaning_human_stated",
      "derived.organization_records",
      "derived.people_counted_once_across_groups",
      "derived.unmatched_identifiers_excluded",
      "derived.values_not_verified",
      "evidence_review_unresolved",
      "support_strength_unassessed"
    ]
  }
];
const IDS = [
  ["c0000000-0000-4000-8000-000000000090", "e0000000-0000-4000-8000-000000000090"],
  ["c0000000-0000-4000-8000-000000000190", "e0000000-0000-4000-8000-000000000190"],
  ["c0000000-0000-4000-8000-000000000067", "e0000000-0000-4000-8000-000000000067"],
];
const claims = PERSISTED.map((claim, index) => ({ claimId: IDS[index][0], evidenceItemId: IDS[index][1], claimStatement: claim.statement, limitationCodes: claim.codes,
  revalidatedForGeneration: true, requestedAudience: "internal", audienceAuthority: { internal: true } }));
const [estimate, contacts, people] = claims;
const measured = new Map([[contacts.claimId, 190], [people.claimId, 67]]);
const cite = (...list) => list.map((claim) => ({ claimId: claim.claimId, evidenceItemId: claim.evidenceItemId }));
const validate = (generationClaims) => (blocks) => validateGeneratedContentDraft({ requestedAudience: "internal", generationClaims, blocks, contentType: "evidence_summary" });
const run = (modelBlocks, { modelResultUsable = true, generationClaims = claims } = {}) => composeEvidenceSummaryWithWordingFallback({
  modelBlocks: modelBlocks.map((block, index) => ({ ordinal: index + 1, ...block })), modelResultUsable, claims: generationClaims, measuredValueByClaimId: measured, validate: validate(generationClaims) });

test("ordinary model wording that the validators refuse no longer fails the draft; refused blocks are restated, passing blocks are kept", () => {
  const draft = [
    { text: "In FY 2024-25, the programme recorded 190 eligible completed service contacts.", citations: cite(contacts) },
    { text: "190 eligible service encounters were counted; 5 were excluded because they fell outside the reporting period.", citations: cite(contacts) },
    { text: "These 67 people show the reach of the programme's impact work.", citations: cite(people) },
    { text: "On average each of the 67 participants had about 2.8 eligible encounters.", citations: cite(contacts, people) },
    { text: "The management review reports a preliminary estimate of at least 90 different people from a rough tally; it was not a distinct-person calculation.", citations: cite(estimate) },
  ];
  // Before: the same blocks, validated whole as the route did, refuse the request.
  const before = validate(claims)(draft.map((block, index) => ({ ordinal: index + 1, ...block })));
  assert.equal(before.ok, false);
  const result = run(draft);
  assert.equal(result.ok, true);
  assert.equal(result.validation.ok, true, "the saved draft passes every validator");
  assert.deepEqual(result.evidence.replaced_model_block_ordinals, [2, 3, 4]);
  assert.equal(result.evidence.model_blocks_kept, 2);
  assert.ok(result.evidence.refused_classes.includes("causal_language") && result.evidence.refused_classes.includes("numeric_literal"), JSON.stringify(result.evidence));
  const text = result.blocks.map((block) => block.text).join("\n");
  assert.match(result.blocks[0].text, /^In FY 2024-25, the programme recorded 190 eligible completed service contacts\./, "the fiscal-year label is supported by the claim's period");
  assert.doesNotMatch(text, /\b2\.8\b/, "an invented figure is never saved");
  assert.doesNotMatch(text, /because they fell outside/);
  assert.ok(result.blocks.some((block) => block.text.startsWith(contacts.claimStatement)), "a refused block is restated from its claim");
  assert.ok(result.blocks.some((block) => block.text.startsWith(people.claimStatement)));
  result.blocks.forEach((block, index) => assert.equal(block.ordinal, index + 1));
  assert.equal(WORDING_FALLBACK_RESULT_KEY, "KAI-GEN-WORDING-FALLBACK-001");
});

test("an unusable model result is rebuilt from every selected claim instead of failing", () => {
  const result = run([], { modelResultUsable: false });
  assert.equal(result.ok, true);
  assert.equal(result.validation.ok, true);
  assert.deepEqual(result.blocks.map((block) => block.citations[0].claimId), claims.map((claim) => claim.claimId));
  assert.equal(result.evidence.model_blocks_kept, 0);
  assert.equal(result.evidence.fallback_block_count, 3);
});

test("a claim the model left out is still represented; a fully passing draft is unchanged", () => {
  const passing = [{ text: "The management review reports a preliminary estimate of at least 90 different people from a rough tally.", citations: cite(estimate) }];
  const result = run(passing);
  assert.equal(result.ok, true);
  assert.equal(result.blocks[0].text, passing[0].text);
  assert.deepEqual(result.blocks.slice(1).map((block) => block.citations[0].claimId), [contacts.claimId, people.claimId]);
});

test("the estimate written as KAI's result is never saved: its block is restated as source-reported", () => {
  const result = run([{ text: "KAI established that at least 90 distinct people were served in FY 2024-25.", citations: cite(estimate) }]);
  assert.equal(result.ok, true);
  assert.ok(result.evidence.refused_classes.includes("document_value_presented_as_established"));
  assert.equal(result.blocks[0].text, estimate.claimStatement);
  assert.doesNotMatch(result.blocks.map((block) => block.text).join("\n"), /KAI established/);
});

test("a refusal that is not about wording is never repaired (audience authority)", () => {
  const unauthorized = claims.map((claim) => (claim === people ? { ...claim, audienceAuthority: { internal: false } } : claim));
  const result = run([{ text: "67 distinct register participants were served.", citations: cite(people) }], { generationClaims: unauthorized });
  assert.equal(result.ok, false);
});
