import test from "node:test";
import assert from "node:assert/strict";

import * as D from "../Backend/kai/validators/kaiDerivedMeasurementValidators.js";
import {
  ASSESSMENT_SELECTION_NOTE,
  composeCountOnlyAssessmentText,
  composeEvidenceSummaryMeasurementDisclosures,
  unsupportedAssertionViolations,
  validateGeneratedContentDraft,
  __generatedContentValidatorContract as V,
} from "../Backend/kai/validators/kaiGeneratedContentValidators.js";
import { describeDocumentLimitationCode } from "../Backend/kai/validators/kaiDocumentEvidenceValidators.js";
import { describeMeasurementLimitationCode } from "../Backend/kai/validators/kaiSourceMeasurementValidators.js";
import {
  ASSESSMENT_SECTIONS,
  buildAssessmentModelContext,
  composeFreeImpactAssessmentBlocks,
  parseFreeImpactAssessment,
  withAssessmentSection,
  __freeImpactAssessmentCompositionTestables as C,
} from "../Backend/kai/services/kaiFreeImpactAssessmentComposition.js";
import { createProductionFreeImpactAssessmentDraftGenerator } from "../Backend/kai/services/kaiFreeImpactAssessmentDraftGenerator.js";
import { createPostgresGeneratedContentRepository } from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";
import { attachOrdinaryInternalAuthority } from "../Backend/kai/dictionary/postgresOrdinaryInternalFactAuthority.js";
import { __testables as routeTests } from "../Backend/kai/routes/sprint2IntakeApi.js";
import { errorText } from "../frontend/impactEvidenceLibraryLogic.js";

// Owner prompt 2026-11-05: production returned VAL-GEN-004
// unsupported_numeric_or_causal_assertion with evidence {} for a Free Impact
// Assessment over the paired outcome claims (field_6 25/38, field_7 23/40).
// Synthetic rows only; the statements are composed by the production code.
const ORG = "21000000-0000-4000-8000-000000000001";
const ENGAGEMENT = "21000000-0000-4000-8000-000000000002";
const VERSION = "22000000-0000-4000-8000-000000000001";
const SOURCE = "23000000-0000-4000-8000-000000000001";
const PROFILE = "24000000-0000-4000-8000-000000000001";
const INTAKE_FILE = "25000000-0000-4000-8000-000000000001";
const PRIVATE = "PRIVATE_PARTICIPANT_CONTENT_MUST_NOT_REACH_THE_MODEL";

function pairedRow(six) {
  return {
    organization_id: ORG, evidence_item_id: six ? "26000000-0000-4000-8000-000000000006" : "26000000-0000-4000-8000-000000000007",
    source_version_id: VERSION, measurement_source_version_id: VERSION,
    source_derived_measurement_id: six ? "27000000-0000-4000-8000-000000000006" : "27000000-0000-4000-8000-000000000007",
    measurement_family: D.DERIVED_MEASUREMENT_FAMILIES.PAIRED_OUTCOME, calculation_method: D.DERIVED_MEASUREMENT_METHODS.PAIRED_OUTCOME, worksheet_key: "sheet_1",
    definition: { outcome_field_key: six ? "field_6" : "field_7", outcome_column: six ? "F" : "G", participant_field_key: "field_2", stage_field_key: "field_4", instrument_version_field_key: "field_5" },
    field_keys: ["field_2", "field_4", "field_5", six ? "field_6" : "field_7"], measured_value: six ? 25 : 23, numerator: six ? 25 : 23, denominator: six ? 38 : 40, percentage: six ? "65.79" : "57.50",
    component_counts: { participant_count: 62, comparable_pair_count: six ? 38 : 40, increased_count: six ? 25 : 23, unchanged_count: six ? 10 : 13, decreased_count: six ? 3 : 4, excluded_participant_count: six ? 24 : 22 },
    exclusions: { participants: [
      { reason: "no_baseline_observation", participant_count: 5, rows: [PRIVATE] },
      { reason: "no_followup_observation", participant_count: 7, rows: [PRIVATE] },
      { reason: "instrument_version_mismatch", participant_count: 8, rows: [PRIVATE] },
      { reason: six ? "missing_followup_value" : "missing_baseline_value", participant_count: six ? 4 : 2, rows: [PRIVATE] },
    ], rows: [] },
    row_locators: { comparable_pairs: [PRIVATE] }, profile_canonical_sha256: "a".repeat(64),
    interpretation_id: null, current_interpretation_id: null, contributing_sources: [], raw_participants: [PRIVATE],
  };
}
const ROWS = [pairedRow(true), pairedRow(false)];
const DIMENSIONS = {
  missingness: { assessment_status: "resolved_risk_flagged" },
  conflicting_source_indicators: { assessment_status: "unresolved", internal_limitation_accepted: true },
  requirement_alignment: { assessment_status: "unresolved", internal_limitation_accepted: true },
};
const CLAIMS = ROWS.map((row, index) => ({
  claimId: `28000000-0000-4000-8000-00000000000${index + 6}`,
  evidenceItemId: row.evidence_item_id,
  claimStatement: D.composeDerivedClaimStatementFromRow(row),
  evidenceType: D.DERIVED_MEASUREMENT_EVIDENCE_TYPE,
  limitationCodes: D.derivedMeasurementLimitationCodes({ measurementRow: row, dimensions: DIMENSIONS }),
  claimType: "finding",
}));
const [F6, F7] = CLAIMS;
const cite = (...claims) => claims.map((c) => ({ claimId: c.claimId, evidenceItemId: c.evidenceItemId }));
const generationClaims = () => CLAIMS.map((c) => ({ ...c, requestedAudience: "internal", revalidatedForGeneration: true, audienceAuthority: { internal: true } }));
const MEASURED = new Map([[F6.claimId, 25], [F7.claimId, 23]]);
const W = withAssessmentSection;

// A substantive model result that keeps every rule: numbers copied from the
// claim each block cites, no causal wording, column names instead of keys.
const CLEAN_MODEL = [
  { ordinal: 1, text: W("executive_snapshot", "Two paired outcome measurements are recorded: for the numeric outcome in column F, 25 of 38 comparable participant pairs (65.79%) have a numerically higher follow-up value; for column G, 23 of 40 comparable participant pairs (57.50%) do. Whether higher is better is not established."), citations: cite(F6, F7) },
  { ordinal: 2, text: W("evidence_findings", "Numeric outcome in column F: 25 of 38 comparable participant pairs (65.79%) have a numerically higher follow-up value, 10 the same, 3 lower; 24 of 62 participants were excluded as not comparable."), citations: cite(F6) },
  { ordinal: 3, text: W("evidence_findings", "Numeric outcome in column G: 23 of 40 comparable participant pairs (57.50%) have a numerically higher follow-up value, 13 the same, 4 lower; 22 of 62 participants were excluded as not comparable."), citations: cite(F7) },
  { ordinal: 4, text: W("impact_stories", "The cited evidence is two baseline-to-follow-up comparisons from one selected worksheet. It records changes in recorded values only and contains no participant account."), citations: cite(F6, F7) },
];
// The same result as a model plausibly writes it under the old context.
const SLIPPED_MODEL = CLEAN_MODEL.map((block) => (block.ordinal === 1
  ? { ...block, text: W("executive_snapshot", "The programme shows a positive impact: about 66% of pairs in column F and 58% in column G improve."), citations: cite(F6) }
  : block));

function assemble(modelBlocks) {
  const composed = composeFreeImpactAssessmentBlocks({ modelBlocks, claims: CLAIMS });
  assert.equal(composed.ok, true, composed.reason);
  const disclosed = composeEvidenceSummaryMeasurementDisclosures({ blocks: composed.blocks, claims: CLAIMS, measuredValueByClaimId: MEASURED });
  assert.equal(disclosed.ok, true);
  return { composed: composed.blocks, final: disclosed.blocks };
}

test("root cause: with the 25/38 and 23/40 claims, server-composed blocks and disclosures pass VAL-GEN-004; only model-authored text fails it", () => {
  assert.match(F6.claimStatement, /^Numeric outcome field_6 \(column F\).*25 of 38 comparable participant pairs \(65\.79%\)/);
  assert.match(F7.claimStatement, /23 of 40 comparable participant pairs \(57\.50%\)/);
  const clean = assemble(CLEAN_MODEL);
  const validation = validateGeneratedContentDraft({ requestedAudience: "internal", contentType: "evidence_summary", generationClaims: generationClaims(), blocks: clean.final });
  assert.deepEqual(validation.blockers, []);
  assert.ok(parseFreeImpactAssessment(clean.final), "six sections after disclosures");
  // Every server-composed block (everything after the model's four) and every appended disclosure is clean on its own.
  assert.deepEqual(unsupportedAssertionViolations({ blocks: clean.final, generationClaims: CLAIMS }), []);

  const slipped = assemble(SLIPPED_MODEL);
  const refused = validateGeneratedContentDraft({ requestedAudience: "internal", contentType: "evidence_summary", generationClaims: generationClaims(), blocks: slipped.final });
  const blocker = refused.blockers.find((b) => b.validator_key === "VAL-GEN-004");
  assert.equal(blocker.blocking_reason, "unsupported_numeric_or_causal_assertion");
  assert.deepEqual(blocker.evidence, { violation_count: 4, assertion_classes: ["causal_language", "numeric_literal"], block_ordinals: [1], block_sections: ["executive_snapshot"] });
  // Block 1 is the model's executive snapshot: the refusal is attributed to model text, proven on that text alone.
  const modelOnly = unsupportedAssertionViolations({ blocks: SLIPPED_MODEL, generationClaims: CLAIMS });
  assert.deepEqual([...new Set(modelOnly.map((v) => v.block_ordinal))], [1]);
  assert.deepEqual(modelOnly.map((v) => v.literal).sort(), ["58%", "66%", "impact", "improve"].sort());
});

test("every fixed server-composed sentence and disclosure contains no digit and no VAL-GEN-004 causal term", () => {
  const strings = [ASSESSMENT_SELECTION_NOTE];
  for (const entry of C.GAP_CATALOGUE) strings.push(...[entry.gap, entry.recommendation, entry.nextStep].filter((value) => value !== undefined));
  for (const key of ASSESSMENT_SECTIONS.map((s) => s.key)) {
    strings.push(composeCountOnlyAssessmentText({ measured_value: "N", blank_record_count: "N", duplicate_record_count: "N", calculation_method: "x", worksheet_key: "sheet_a" }, key).replace(/\bN\b/g, ""));
  }
  for (const code of Object.values(D.DERIVED_LIMITATION_CODES)) strings.push(D.describeDerivedLimitationCode(code) || "");
  for (const code of ["document.source_reported_not_verified", "document.contains_interpretation_or_guidance", "document.contains_uncertainty", "document.self_reported"]) strings.push(describeDocumentLimitationCode(code));
  for (const dim of ["missingness", "duplicates", "definition_clarity", "denominator_clarity", "time_period_clarity", "entity_level_clarity", "small_cell_risk", "conflicting_source_indicators", "requirement_alignment", "coverage_gaps"]) {
    for (const status of ["resolved_risk_flagged", "unresolved", "accepted_internal_limitation"]) strings.push(describeMeasurementLimitationCode(`coverage.${dim}.${status}`));
  }
  for (const text of strings) {
    assert.deepEqual([...text.matchAll(V.NUMERIC_LITERAL_PATTERN)].map((m) => m[0]), [], text);
    assert.deepEqual([...text.matchAll(V.CAUSAL_PATTERN)].map((m) => m[0]), [], text);
  }
});

test("model-facing context no longer hands the model 'Impact' titles; customer section titles are unchanged", () => {
  const context = buildAssessmentModelContext(CLAIMS);
  for (const section of context.modelSections) assert.deepEqual([...section.title.matchAll(V.CAUSAL_PATTERN)], [], section.title);
  assert.deepEqual(ASSESSMENT_SECTIONS.map((s) => s.title), ["Executive Impact Snapshot", "What Your Evidence Tells Us", "Impact Stories", "Gaps and Opportunities", "Three Recommended Improvements", "Your Next Steps"]);
  const { assessment } = { assessment: context };
  assert.doesNotMatch(JSON.stringify(assessment), /Impact/);
});

const check = (text, claims) => unsupportedAssertionViolations({ blocks: [{ ordinal: 1, text, citations: cite(...claims) }], generationClaims: CLAIMS });

test("benign report terminology is a label inside assessment blocks; unsupported causal impact is still refused", () => {
  assert.deepEqual(check(W("impact_stories", "This Impact Stories section and the Free Impact Assessment draw on Impact Evidence only."), [F6]), []);
  assert.deepEqual(check(W("executive_snapshot", "The Executive Impact Snapshot lists what is recorded."), [F6]), []);
  for (const text of ["The programme's impact on confidence is clear.", "Participation impacted confidence.", "It has had an impact.", "Impact Stories show the programme improves lives."]) {
    assert.ok(check(W("executive_snapshot", text), [F6]).some((v) => v.type === "causal_language"), text);
  }
  // Outside a marked assessment block the label exemption does not apply at all.
  assert.ok(check("This Impact Assessment section lists what is recorded.", [F6]).some((v) => v.type === "causal_language"));
});

test("numbers: exact attribution per block; presentation-only formatting accepted; rounding, units and signs refused", () => {
  const section = (t) => W("evidence_findings", t);
  assert.deepEqual(check(section("25 of 38 pairs (65.79%)."), [F6]), []);
  assert.deepEqual(check(section("23 of 40 pairs (57.5%)."), [F7]), [], "57.50% and 57.5% are the same value and unit");
  assert.deepEqual(unsupportedAssertionViolations({ blocks: [{ ordinal: 1, text: "1200 records", citations: [{ claimId: "c", evidenceItemId: "e" }] }],
    generationClaims: [{ claimId: "c", evidenceItemId: "e", claimStatement: "1,200 records were counted." }] }), [], "grouping commas are presentation");
  for (const [text, literal] of [["about 66% of pairs", "66%"], ["65.8% of pairs", "65.8%"], ["65.79 of pairs", "65.79"], ["-3 pairs", "-3"], ["Outcome 6 shows 25 of 38.", "6"]]) {
    assert.deepEqual(check(section(text), [F6]).map((v) => v.literal), [literal], text);
  }
  // Block-level attribution: F7's figures in a block citing only F6 are refused; citing both is allowed.
  assert.deepEqual(check(section("25 of 38 and 23 of 40."), [F6]).map((v) => v.literal).sort(), ["23", "40"]);
  assert.deepEqual(check(section("25 of 38 and 23 of 40."), [F6, F7]), []);
});

// ---------------------------------------------------------------------------
// The real generation repository with an in-memory transaction: P2-06 stubbed
// eligible, the persisted rows read back through the repository's own reread.

function memoryTransaction() {
  const store = { runs: [], drafts: [], blocks: [], citations: [], queues: [], audits: [] };
  let seq = 0;
  const uuid = () => `29000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
  const tx = { store, async query(sql, params = []) {
    const s = sql.replace(/\s+/g, " ").trim();
    if (s.startsWith("INSERT INTO kai.generation_runs")) {
      if (store.runs.some((r) => r.idempotency_key === params[2])) return { rows: [] };
      const row = { generation_run_id: uuid(), organization_id: params[0], engagement_id: params[1], idempotency_key: params[2], request_fingerprint: params[3], content_type: params[4], requested_audience: params[5], created_by_type: "system", created_at: params[6] };
      store.runs.push(row); return { rows: [{ generation_run_id: row.generation_run_id }] };
    }
    if (s.startsWith("INSERT INTO kai.generated_content_drafts")) {
      const row = { generated_content_draft_id: uuid(), generation_run_id: params[0], organization_id: params[1], content_type: params[2], requested_audience: params[3], draft_status: params[4], review_status: params[5], validator_results: JSON.parse(params[6]), created_by_type: "system", created_at: params[7] };
      store.drafts.push(row); return { rows: [{ generated_content_draft_id: row.generated_content_draft_id }] };
    }
    if (s.startsWith("INSERT INTO kai.generated_content_blocks")) {
      const row = { generated_content_block_id: uuid(), generated_content_draft_id: params[0], organization_id: params[1], ordinal: params[2], text: params[3] };
      store.blocks.push(row); return { rows: [{ generated_content_block_id: row.generated_content_block_id }] };
    }
    if (s.startsWith("INSERT INTO kai.generated_content_citations")) {
      store.citations.push({ generated_content_citation_id: uuid(), generated_content_block_id: params[0], organization_id: params[1], claim_id: params[2], evidence_item_id: params[3], evidence_type: D.DERIVED_MEASUREMENT_EVIDENCE_TYPE });
      return { rows: [] };
    }
    if (s.startsWith("INSERT INTO kai.review_queue_items")) {
      const row = { review_queue_item_id: uuid(), organization_id: params[0], queue_type: params[1], target_object_type: params[2], target_object_id: params[3], priority: "medium", queue_status: "open", review_status: params[4], assigned_to: null, due_at: null, summary: params[5], required_action: params[6], created_by_type: "system" };
      store.queues.push(row); return { rows: [{ review_queue_item_id: row.review_queue_item_id }] };
    }
    if (/^(INSERT|UPDATE|DELETE)/i.test(s)) { store.audits.push(s.split(" ").slice(0, 3).join(" ")); return { rows: [] }; }
    if (s.includes("FROM kai.generation_runs")) return { rows: store.runs.filter((r) => r.organization_id === params[0] && r.idempotency_key === params[1]) };
    if (s.includes("FROM kai.generated_content_drafts")) return { rows: store.drafts.filter((d) => d.organization_id === params[0] && d.generation_run_id === params[1]) };
    if (s.includes("FROM kai.generated_content_citations")) {
      const blockIds = new Set(store.blocks.filter((b) => b.generated_content_draft_id === params[1]).map((b) => b.generated_content_block_id));
      return { rows: store.citations.filter((c) => c.organization_id === params[0] && blockIds.has(c.generated_content_block_id)) };
    }
    if (s.includes("FROM kai.generated_content_blocks")) return { rows: store.blocks.filter((b) => b.organization_id === params[0] && b.generated_content_draft_id === params[1]).sort((a, b) => a.ordinal - b.ordinal) };
    if (s.includes("FROM kai.review_queue_items")) return { rows: store.queues.filter((q) => q.organization_id === params[0] && q.target_object_id === params[3]) };
    if (s.includes("JOIN kai.claim_evidence_links")) return { rows: CLAIMS.map((c) => ({ claim_id: c.claimId, intake_sensitivity_profile_id: PROFILE })) };
    if (s.includes("FROM kai.intake_sensitivity_review_decisions")) {
      return { rows: [{ intake_sensitivity_profile_id: PROFILE, organization_id: ORG, decision_outcome: "reviewed", reviewed_allowed_use_status: "allowed", reviewed_llm_processing_allowed: true,
        reviewed_story_testimonial_status: "present", reviewed_personal_data_status: "absent", reviewed_minor_data_status: "absent", reviewed_small_cell_risk_status: "absent" }] };
    }
    if (s.includes("FROM kai.intake_sensitivity_profiles")) return { rows: params[1].map((id) => ({ intake_sensitivity_profile_id: id, allowed_use_status: "unknown" })) };
    if (s.includes("FROM kai.evidence_derived_measurements l")) return { rows: ROWS.filter((r) => r.evidence_item_id === params[1]) };
    if (s.includes("FROM kai.claims c")) {
      return { rows: CLAIMS.map((c) => ({ claim_id: c.claimId, claim_statement: c.claimStatement, claim_type: "finding", evidence_item_id: c.evidenceItemId,
        evidence_type: D.DERIVED_MEASUREMENT_EVIDENCE_TYPE, internal_only: true, funder_use_allowed: false, public_use_allowed: false,
        source_id: SOURCE, source_version_id: VERSION, intake_file_id: INTAKE_FILE, upload_state: "confirmed" })) };
    }
    return { rows: [] };
  } };
  return tx;
}

async function generate(responses, { idempotencyKey = "assessment-reliability" } = {}) {
  const tx = memoryTransaction();
  const calls = [];
  const repository = createPostgresGeneratedContentRepository({
    runInTransaction: async (callback) => {
      // Roll back on any refusal, as PostgreSQL does: nothing persists.
      const snapshot = structuredClone(tx.store);
      try { return await callback(tx); } catch (error) { Object.assign(tx.store, snapshot); throw error; }
    },
    evaluator: async (_tx, { claimId, requestedAudience }) => ({ ok: true, data: attachOrdinaryInternalAuthority({
      requestedAudience, claim: { claim_id: claimId, claim_strength: "unassessed" },
      evidence: { evidence_item_id: CLAIMS.find((c) => c.claimId === claimId).evidenceItemId }, eligible: true, blockerCodes: [], dimensions: {},
    }, { basis: "numerical_measurement_story_testimonial_present", reliedOn: true }) }),
  });
  // The production adapter, with only the provider call stubbed.
  const draftGenerator = createProductionFreeImpactAssessmentDraftGenerator({
    createMessage: async (payload) => {
      calls.push({ system: payload.system, user: JSON.parse(payload.messages[0].content) });
      const blocks = responses[Math.min(calls.length - 1, responses.length - 1)];
      return { content: [{ type: "text", text: JSON.stringify({ blocks: blocks.map((b) => {
        const parsed = /^\[\[assessment:([a-z_]+)\]\]\n([\s\S]*)$/.exec(b.text);
        return { section: parsed[1], text: parsed[2], citations: b.citations };
      }) }) }] };
    },
  });
  const result = await repository.createFreeImpactAssessmentDraft({
    organizationId: ORG, engagementId: ENGAGEMENT, requestedAudience: "internal", claimIds: CLAIMS.map((c) => c.claimId),
    idempotencyKey, actorContext: { actorType: "human" }, now: "2026-11-05T12:00:00.000Z",
  }, { draftGenerator, metadataOnlyAudit: { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) } });
  return { result, calls, store: tx.store };
}

function assertPersistedAssessment({ result, store }, attempts) {
  assert.equal(result.ok, true, JSON.stringify(result.blockers || result.error));
  // Readback is the repository's own reread of the persisted rows.
  const sections = parseFreeImpactAssessment(result.data.blocks);
  assert.ok(sections, "the persisted draft reads back as a six-section assessment");
  assert.deepEqual(sections.map((s) => s.key), ASSESSMENT_SECTIONS.map((s) => s.key));
  // Owner direction 2026-11-11: these outcomes have no stated direction, so
  // the first proposal is the one clarification they need; with the two
  // follow-up and exclusion proposals they ground three, none invented.
  assert.equal(sections[4].title, "Three Recommended Improvements");
  const proposals = sections[4].blocks.filter((b) => b.body.startsWith("Proposed change:"));
  assert.equal(proposals.length, 3);
  assert.match(proposals[0].body, /^Proposed change: Record, on each outcome measure that does not yet state it, whether a higher value is better/);
  // The clarification is also stated in the analysis, and the change is never read as progress.
  assert.match(sections[3].blocks.map((b) => b.body).join("\n"), /Clarification needed: state what the value in column F measures and whether a higher value is better\./);
  assert.doesNotMatch(result.data.blocks.map((b) => b.text).join("\n"), /\bimprov(?:ed|ement|ing)\b|favourable/);
  assert.equal(store.drafts.length, 1);
  assert.equal(store.blocks.length, result.data.blocks.length);
  assert.ok(result.data.blocks.every((b) => b.citations.length > 0 && b.citations.every((c) => CLAIMS.some((x) => x.claimId === c.claimId && x.evidenceItemId === c.evidenceItemId))));
  assert.equal(result.data.reviewStatus, store.drafts[0].review_status, "the draft enters the existing review queue unchanged");
  assert.equal(store.queues.length, 1);
  const assessmentResult = store.drafts[0].validator_results.find((r) => r.validator_key === "VAL-GEN-ASSESSMENT-001");
  assert.equal(assessmentResult.evidence.model_generation_attempts, attempts);
  assert.ok(store.drafts[0].validator_results.some((r) => r.validator_key === "VAL-GEN-004" && r.severity === "pass"));
  const text = result.data.blocks.map((b) => b.text).join("\n");
  assert.match(text, /25 of 38 comparable participant pairs \(65\.79%\)/);
  assert.match(text, /23 of 40 comparable participant pairs \(57\.50%\)/);
  assert.match(text, /Measurement disclosure for the cited measurement/);
  assert.doesNotMatch(text, new RegExp(PRIVATE));
}

test("workflow: a rule-keeping model result persists as a six-section assessment with one model call", async () => {
  const run = await generate([CLEAN_MODEL]);
  assertPersistedAssessment(run, 1);
  assert.equal(run.calls.length, 1);
  assert.equal(run.calls[0].user.correction, undefined);
  assert.doesNotMatch(JSON.stringify(run.calls[0].user), new RegExp(PRIVATE));
  assert.doesNotMatch(JSON.stringify(run.calls[0].user.assessment), /Impact/);
});

test("workflow: a model slip gets exactly one correction with block-level diagnostics, and the corrected draft persists", async () => {
  const run = await generate([SLIPPED_MODEL, CLEAN_MODEL]);
  assertPersistedAssessment(run, 2);
  assert.equal(run.calls.length, 2);
  assert.deepEqual(run.calls[1].user.correction, {
    reason: "unsupported_numeric_or_causal_assertion",
    // Owner direction 2026-11-12: "a positive impact" for outcomes whose
    // better direction is not stated is also named (outcome_interpretation).
    blocks: [{ block: 1, section: "executive_snapshot", assertionClasses: ["causal_language", "numeric_literal", "outcome_interpretation"], unsupportedTerms: ["66%", "58%", "impact", "improve", "positive"] }],
  });
  // The correction call is the same governed input plus the correction only.
  const { correction, ...rest } = run.calls[1].user;
  assert.deepEqual(rest, run.calls[0].user);
  assert.match(run.calls[1].system, /If the input includes correction/);
});

test("workflow: a second slip is restated from the cited claims (never saved), with no third model call; the assessment is not failed", async () => {
  const run = await generate([SLIPPED_MODEL, SLIPPED_MODEL]);
  // Owner direction 2026-11-10 (before: refused, nothing persisted).
  assert.equal(run.result.ok, true, JSON.stringify(run.result.blockers));
  assert.equal(run.calls.length, 2, "still one correction, never a third call");
  assert.equal(run.store.drafts.length, 1);
  const saved = run.store.blocks.map((block) => block.text).join("\n");
  assert.doesNotMatch(saved, /positive impact|66%|58%/, "the slipped wording is not saved");
  const snapshot = run.store.blocks.find((block) => block.text.startsWith("[[assessment:executive_snapshot]]\n"));
  // Owner direction 2026-11-11: a refused snapshot becomes the composed
  // headline results (no disclosure repeated: the findings section carries it).
  assert.ok(snapshot.text.startsWith(W("executive_snapshot", "The most important findings from the selected evidence:\n- The numeric outcome in column F: values changed between baseline and follow-up")),
    "the refused summary section keeps its section, restated as the selected findings' headline results");
  assert.doesNotMatch(snapshot.text, /Measurement disclosure for/);
  assert.ok(run.store.blocks.some((block) => block.text.startsWith(W("evidence_findings", "Numeric outcome in column F"))), "the model's passing findings are kept");
  const assessmentResult = run.store.drafts[0].validator_results.find((r) => r.validator_key === "VAL-GEN-ASSESSMENT-001");
  assert.deepEqual(assessmentResult.evidence.restated_model_block_ordinals, [1]);
  assert.ok(run.store.drafts[0].validator_results.some((r) => r.validator_key === "KAI-GEN-WORDING-FALLBACK-001"));
  // The route boundary still sanitizes such a diagnostic (a composed-draft refusal can still occur).
  const blocker = { validator_key: "VAL-GEN-004", blocking_reason: "unsupported_numeric_or_causal_assertion",
    evidence: { violation_count: 4, assertion_classes: ["causal_language", "numeric_literal"], block_ordinals: [1], block_sections: ["executive_snapshot"], origin: "model_authored", generation_attempts: 2 } };
  // The API boundary keeps the safe fields and nothing else.
  const [sanitized] = routeTests.sanitizeServiceBlockers([{ ...blocker, evidence: { ...blocker.evidence, literal: "66%", text: "The programme shows a positive impact", block_sections: ["executive_snapshot", "<script>"] } }]);
  assert.deepEqual(sanitized.evidence, { violation_count: 4, assertion_classes: ["causal_language", "numeric_literal"], block_ordinals: [1], block_sections: ["executive_snapshot"], origin: "model_authored", generation_attempts: 2 });
  assert.doesNotMatch(JSON.stringify(sanitized), /66%|programme|impact/);
  assert.match(errorText({ body: { blockers: [sanitized] } }), /after one automatic correction.*a number not stated in its cited evidence.*nothing was saved/);
});

test("API boundary: a composed-draft refusal is labelled server-side and other blockers gain no assertion fields", () => {
  const [composed] = routeTests.sanitizeServiceBlockers([{ validator_key: "VAL-GEN-004", blocking_reason: "unsupported_numeric_or_causal_assertion",
    evidence: { violation_count: 1, assertion_classes: ["numeric_literal"], block_ordinals: [7, 99, "x"], block_sections: ["next_steps"], origin: "composed_draft", generation_attempts: 1 } }]);
  assert.deepEqual(composed.evidence, { violation_count: 1, assertion_classes: ["numeric_literal"], block_ordinals: [7], block_sections: ["next_steps"], origin: "composed_draft", generation_attempts: 1 });
  assert.match(errorText({ body: { blockers: [composed] } }), /report it to Get Kinder/);
  const [other] = routeTests.sanitizeServiceBlockers([{ validator_key: "VAL-GEN-002", blocking_reason: "missing_or_unresolved_exact_citation", evidence: { violation_count: 3, origin: "model_authored" } }]);
  assert.deepEqual(other.evidence, {});
});

test("the correction contract refuses anything beyond bounded block diagnostics", async () => {
  const run = await generate([SLIPPED_MODEL, CLEAN_MODEL], { idempotencyKey: "assessment-reliability-contract" });
  const { correction } = run.calls[1].user;
  for (const block of correction.blocks) {
    assert.deepEqual(Object.keys(block).sort(), ["assertionClasses", "block", "section", "unsupportedTerms"]);
    assert.ok(block.unsupportedTerms.every((term) => term.length <= 40));
    assert.ok(block.unsupportedTerms.every((term) => !CLAIMS.some((c) => c.claimStatement.includes(term) && term.length > 5)), "no claim text is echoed");
  }
});

test("workflow: model wording that contradicts a limitation (VAL-GEN-008) restates the model sections instead of refusing the assessment, and is never saved", async () => {
  // Owner direction 2026-11-11: before, this 422'd the whole assessment
  // (VAL-GEN-008 limitation_contradicted), because the wording fallback
  // covered only VAL-GEN-004.
  const CONTRADICTING = CLEAN_MODEL.map((block) => (block.ordinal === 1
    ? { ...block, text: W("executive_snapshot", "These figures were verified by staff against every participant record.") }
    : block));
  const run = await generate([CONTRADICTING, CONTRADICTING]);
  assert.equal(run.result.ok, true, JSON.stringify(run.result.blockers));
  const saved = run.store.blocks.map((block) => block.text).join("\n");
  assert.doesNotMatch(saved, /verified by staff/);
  assert.ok(parseFreeImpactAssessment(run.result.data.blocks), "still a six-section assessment");
  const fallback = run.store.drafts[0].validator_results.find((r) => r.validator_key === "KAI-GEN-WORDING-FALLBACK-001");
  assert.equal(fallback.evidence.restated_model_block_ordinals, "all");
  assert.ok(run.store.drafts[0].validator_results.some((r) => r.validator_key === "VAL-GEN-008" && r.severity === "pass"));
});
