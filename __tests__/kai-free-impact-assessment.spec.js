import test from "node:test";
import { readFileSync } from "node:fs";
import { __generatedContentRepositoryTestables } from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";
import { assessmentBlockDisplay, createFreeImpactAssessmentPath, errorText } from "../frontend/impactEvidenceLibraryLogic.js";
import { internalDraftReadiness, internalDraftRequestBody } from "../frontend/knowledgeStudio/clientEvidenceWorkflowLogic.js";
import assert from "node:assert/strict";

import {
  ASSESSMENT_SECTIONS,
  buildAssessmentModelContext,
  composeFreeImpactAssessmentBlocks,
  detectAssessmentGaps,
  parseFreeImpactAssessment,
  withAssessmentSection,
} from "../Backend/kai/services/kaiFreeImpactAssessmentComposition.js";
import { createProductionFreeImpactAssessmentDraftGenerator } from "../Backend/kai/services/kaiFreeImpactAssessmentDraftGenerator.js";
import { composeFreeImpactAssessmentView, serializeFreeImpactAssessmentToMarkdown } from "../Backend/kai/services/kaiFreeImpactAssessmentRenderer.js";
import { serializeExportManifestRenderModelToMarkdown } from "../Backend/kai/services/kaiExportManifestMarkdownSerializer.js";
import { serializeExportManifestRenderModelToPdf } from "../Backend/kai/services/kaiExportManifestPdfSerializer.js";
import { composeEvidenceSummaryMeasurementDisclosures, validateGeneratedContentDraft } from "../Backend/kai/validators/kaiGeneratedContentValidators.js";
import {
  applyDocumentStatementCoverageDimensions,
  documentStatementLimitationCodes,
} from "../Backend/kai/validators/kaiDocumentEvidenceValidators.js";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DOC = "source_document_statement";
const DERIVED = "source_derived_measurement";
const REACH_CODES = ["coverage.conflicting_source_indicators.accepted_internal_limitation", "coverage.requirement_alignment.accepted_internal_limitation",
  "derived.cross_source_linked", "derived.duplicate_event_copies_counted_once", "derived.encounters_not_people", "derived.engagement_period_applied",
  "derived.meaning_human_stated", "derived.organization_records", "derived.values_not_verified"];
const MINUTES_CODES = ["derived.cross_source_linked", "derived.engagement_period_applied", "derived.known_recorded_minutes_subtotal", "derived.meaning_human_stated",
  "derived.organization_records", "derived.values_not_verified"];
const PAIRED_CODES = ["derived.direction_human_stated", "derived.matched_subset_only", "derived.meaning_human_stated", "derived.no_reporting_period",
  "derived.self_reported", "derived.values_not_verified"];

function claim(n, evidenceType, claimStatement, limitationCodes = []) {
  return { claimId: id(n), evidenceItemId: id(100 + n), claimStatement, evidenceType, limitationCodes, claimType: "finding", sourceId: id(200 + n), sourceVersionId: id(300 + n) };
}

const CLAIMS = [
  claim(1, DERIVED, "Eligible service encounters (meaning stated by the organization; values are organization records): 223 eligible service encounters (encounters, not people).", REACH_CODES),
  claim(2, DERIVED, "Known recorded minutes (meaning stated by the organization; values are organization records): 16815 known recorded minutes subtotal, from 220 of 223 eligible encounters.", MINUTES_CODES),
  claim(3, DERIVED, "Digital confidence (meaning stated by the organization; values self-reported): 25 of 38 comparable participant pairs (65.79%) have a numerically higher follow-up value.", PAIRED_CODES),
  claim(4, DOC, "Source-reported, not independently verified (line 10): \"When the duration field is missing, coordinators cannot reliably reconstruct the number of delivered minutes.\""),
  claim(5, DOC, "Source-reported, not independently verified (page 3, blocks 5-6): \"It is a convenience sample of attempted check-ins, not a census.\""),
  claim(6, DOC, "Source-reported, not independently verified (line 38): \"The register records that story/quote permission was not obtained.\""),
];

const cite = (...claims) => claims.map((c) => ({ claimId: c.claimId, evidenceItemId: c.evidenceItemId }));
const MODEL_BLOCKS = [
  { ordinal: 1, text: withAssessmentSection("executive_snapshot", "Eligible service encounters: 223 eligible service encounters (encounters, not people)."), citations: cite(CLAIMS[0]) },
  { ordinal: 2, text: withAssessmentSection("evidence_findings", "Digital confidence: 25 of 38 comparable participant pairs (65.79%) have a numerically higher follow-up value."), citations: cite(CLAIMS[2]) },
  { ordinal: 3, text: withAssessmentSection("impact_stories", "The documents describe the programme: \"It is a convenience sample of attempted check-ins, not a census.\" (page 3)"), citations: cite(CLAIMS[4]) },
];

function generationClaims() {
  return CLAIMS.map((c) => ({ ...c, requestedAudience: "internal", revalidatedForGeneration: true, audienceAuthority: { internal: true } }));
}

test("documented gaps come only from structural signals and are each grounded in cited claims", () => {
  const gaps = detectAssessmentGaps(CLAIMS);
  assert.deepEqual(gaps.map((gap) => gap.key), ["recorded_duration_incomplete", "follow_up_evidence_limited", "duplicate_records", "participant_story_missing", "external_use_alignment", "source_reported_statements"]);
  assert.deepEqual(gaps[0].documentGrounding.map((c) => c.claimId), [id(4)]);
  assert.deepEqual(gaps[0].measuredGrounding.map((c) => c.claimId), [id(2)]);
  assert.deepEqual(gaps[1].documentGrounding.map((c) => c.claimId), [id(5)]);
  assert.deepEqual(gaps[2].documentGrounding, []);
  assert.deepEqual(gaps[2].measuredGrounding.map((c) => c.claimId), [id(1)]);
  // No signal, no gap: without a duration claim or statement there is no duration recommendation.
  assert.ok(!detectAssessmentGaps(CLAIMS.filter((c) => ![id(2), id(4)].includes(c.claimId))).some((gap) => gap.key === "recorded_duration_incomplete"));
  const context = buildAssessmentModelContext(CLAIMS);
  assert.equal(context.participantStoryEvidence, "none_cited");
  assert.deepEqual(context.modelSections.filter((s) => s.required).map((s) => s.key), ["executive_snapshot", "evidence_findings", "impact_stories"]);
});

test("the composed assessment has six ordered sections and three grounded proposals, and passes the existing validators", () => {
  const composed = composeFreeImpactAssessmentBlocks({ modelBlocks: MODEL_BLOCKS, claims: CLAIMS });
  assert.equal(composed.ok, true, composed.reason);
  const sections = parseFreeImpactAssessment(composed.blocks);
  assert.deepEqual(sections.map((s) => s.title), ASSESSMENT_SECTIONS.map((s) => s.title));
  assert.deepEqual(composed.blocks.map((b) => b.ordinal), composed.blocks.map((_, index) => index + 1));
  const recommendations = sections[4].blocks;
  assert.equal(recommendations.length, 3);
  assert.match(recommendations[0].body, /^Proposed change: Make session duration a required entry/);
  assert.deepEqual(recommendations[0].citations, cite(CLAIMS[3]));
  assert.match(recommendations[1].body, /follow-up point/);
  assert.match(recommendations[2].body, /duplicate check/);
  assert.deepEqual(recommendations[2].citations, cite(CLAIMS[0]));
  for (const rec of recommendations) assert.match(rec.body, /This is a proposal for the organization to consider; it is not a measured or confirmed result\.$/);
  assert.match(sections[2].blocks.at(-1).body, /^Participant story evidence: none is available\./);
  assert.deepEqual(sections[2].blocks.at(-1).citations, cite(CLAIMS[5]));
  // The same disclosure composition and validators as any internal Evidence Summary.
  const measuredValueByClaimId = new Map([[id(1), 223], [id(2), 16815], [id(3), 25]]);
  const disclosed = composeEvidenceSummaryMeasurementDisclosures({ blocks: composed.blocks, claims: CLAIMS, measuredValueByClaimId });
  assert.equal(disclosed.ok, true);
  const validation = validateGeneratedContentDraft({ requestedAudience: "internal", generationClaims: generationClaims(), blocks: disclosed.blocks, contentType: "evidence_summary" });
  assert.deepEqual(validation.blockers, []);
  assert.ok(parseFreeImpactAssessment(disclosed.blocks), "still an assessment after the disclosures");
});

test("a model block that invents a quotation, omits a required section or is unmarked is refused before persistence", () => {
  const invented = MODEL_BLOCKS.map((b) => (b.ordinal === 3 ? { ...b, text: `${b.text} One participant said "it changed my life".` } : b));
  assert.deepEqual(composeFreeImpactAssessmentBlocks({ modelBlocks: invented, claims: CLAIMS }), { ok: false, reason: "assessment_quotation_not_in_cited_evidence" });
  assert.deepEqual(composeFreeImpactAssessmentBlocks({ modelBlocks: MODEL_BLOCKS.slice(0, 2), claims: CLAIMS }), { ok: false, reason: "assessment_model_section_missing" });
  const unmarked = [{ ...MODEL_BLOCKS[0], text: "Plain text." }, ...MODEL_BLOCKS.slice(1)];
  assert.deepEqual(composeFreeImpactAssessmentBlocks({ modelBlocks: unmarked, claims: CLAIMS }), { ok: false, reason: "assessment_model_section_invalid" });
  const recommends = [...MODEL_BLOCKS, { ...MODEL_BLOCKS[0], text: withAssessmentSection("recommended_improvements", "Do this.") }];
  assert.deepEqual(composeFreeImpactAssessmentBlocks({ modelBlocks: recommends, claims: CLAIMS }), { ok: false, reason: "assessment_model_section_invalid" });
});

test("the model adapter writes each block's section marker and refuses a request without the assessment context", async () => {
  let payload = null;
  const generator = createProductionFreeImpactAssessmentDraftGenerator({
    createMessage: async (sent) => {
      payload = sent;
      return { content: [{ type: "text", text: JSON.stringify({ blocks: [{ section: "executive_snapshot", text: "Snapshot.", citations: cite(CLAIMS[0]) }] }) }] };
    },
  });
  const input = { contentType: "evidence_summary", requestedAudience: "internal", claims: [], assessment: buildAssessmentModelContext(CLAIMS) };
  const result = await generator(input);
  assert.equal(result.blocks[0].text, "[[assessment:executive_snapshot]]\nSnapshot.");
  assert.match(payload.system, /do not write recommendations/);
  assert.match(payload.system, /never write internal field keys/);
  assert.equal(JSON.parse(payload.messages[0].content).assessment.composition, "free_impact_assessment");
  assert.deepEqual((await generator({ ...input, assessment: undefined })).blocks, []);
  assert.deepEqual((await generator({ ...input, requestedAudience: "funder" })).blocks, []);
});

test("a document statement's field-level dimensions are answered by its own form; source-level dimensions are kept", () => {
  const base = Object.fromEntries(["missingness", "duplicates", "definition_clarity", "denominator_clarity", "time_period_clarity", "entity_level_clarity",
    "small_cell_risk", "conflicting_source_indicators", "requirement_alignment", "coverage_gaps"].map((key) => [key, { evidence: { assessment_status: "unresolved" }, marker: key }]));
  const applied = applyDocumentStatementCoverageDimensions(base);
  const status = (key) => applied[key].evidence.assessment_status;
  assert.deepEqual(["missingness", "duplicates", "coverage_gaps"].map(status), ["resolved_clear", "resolved_clear", "resolved_clear"]);
  assert.deepEqual(["definition_clarity", "denominator_clarity", "time_period_clarity", "entity_level_clarity"].map(status), Array(4).fill("resolved_risk_flagged"));
  for (const key of ["small_cell_risk", "conflicting_source_indicators", "requirement_alignment"]) assert.equal(applied[key], base[key]);
  const codes = documentStatementLimitationCodes({
    statement: "Source-reported, not independently verified (line 10): \"Staff estimate that roughly half of the people found work.\"",
    dimensions: { definition_clarity: { assessment_status: "resolved_risk_flagged" }, requirement_alignment: { assessment_status: "unresolved", internal_limitation_accepted: true }, duplicates: { assessment_status: "resolved_clear" } },
  });
  assert.ok(codes.includes("document.source_reported_not_verified"));
  assert.ok(codes.includes("coverage.definition_clarity.resolved_risk_flagged"));
  assert.ok(codes.includes("coverage.requirement_alignment.accepted_internal_limitation"));
  assert.ok(!codes.some((code) => code.startsWith("coverage.duplicates")));
});

function renderModelFor(blocks) {
  const citations = [];
  const refs = new Map();
  const content = blocks.map((block) => ({
    ordinal: block.ordinal,
    text: block.text,
    citationRefs: block.citations.map((citation) => {
      if (!refs.has(citation.claimId)) {
        refs.set(citation.claimId, `CIT-${String(refs.size + 1).padStart(3, "0")}`);
        citations.push({ citationRef: refs.get(citation.claimId), claimId: citation.claimId, evidenceItemId: citation.evidenceItemId, sourceId: id(9), sourceVersionId: id(10) });
      }
      return refs.get(citation.claimId);
    }),
  }));
  const limitationEntries = citations.map((c) => ({ claimId: c.claimId, evidenceItemId: c.evidenceItemId, citationRef: c.citationRef,
    limitationCodes: CLAIMS.find((x) => x.claimId === c.claimId).evidenceType === DOC ? ["document.source_reported_not_verified"] : ["derived.values_not_verified"] }));
  return {
    renderModelContractVersion: "kai-sprint2-export-manifest-render-model-v1",
    manifest: { exportManifestId: id(50) },
    exportCandidate: { contentType: "evidence_summary", requestedAudience: "internal" },
    context: { organizationName: "Example Society", organizationId: id(60), engagementId: id(61), engagementCode: "E1", reportingPeriodStart: "2025-04-01", reportingPeriodEnd: "2026-03-31",
      citationLabels: Object.fromEntries(CLAIMS.map((c) => [c.claimId, { kind: c.evidenceType === DOC ? "document_statement" : "measurement", label: c.evidenceType === DOC ? "Source-reported statement (line 10)" : c.claimStatement.split(" (")[0], fileKind: "CSV" }])) },
    content: { blocks: content },
    citations,
    limitations: limitationEntries,
    methodNotes: { limitationEntries },
  };
}

test("a released assessment renders as six numbered sections with labelled references and each limitation once; other drafts keep the manifest layout", async () => {
  const composed = composeFreeImpactAssessmentBlocks({ modelBlocks: MODEL_BLOCKS, claims: CLAIMS });
  const model = renderModelFor(composed.blocks);
  const markdown = serializeExportManifestRenderModelToMarkdown(model);
  assert.match(markdown, /^# Free Impact Assessment\n/);
  ASSESSMENT_SECTIONS.forEach((section, index) => assert.ok(markdown.includes(`## ${index + 1}. ${section.title}`), section.title));
  assert.match(markdown, /\*\*Reporting period:\*\* 2025-04-01 to 2026-03-31/);
  assert.match(markdown, /\*\*Improvement 3\.\*\* Proposed change:/);
  assert.match(markdown, /- \[CIT-001\] Eligible service encounters \(CSV source\)/);
  assert.equal(markdown.match(/KAI did not check the recorded values against any other source\./g).length, 1);
  assert.doesNotMatch(markdown, /\[\[assessment:/);
  assert.equal(composeFreeImpactAssessmentView({ ...model, content: { blocks: model.content.blocks.slice(1) } }), null, "a draft missing a section is not laid out as an assessment");
  const plain = { ...model, content: { blocks: [{ ordinal: 1, text: "Plain block.", citationRefs: ["CIT-001"] }] } };
  assert.match(serializeExportManifestRenderModelToMarkdown(plain), /^# Export Manifest\n[\s\S]*### Block 1/);
  const pdf = await serializeExportManifestRenderModelToPdf(model);
  assert.ok((pdf.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) || []).length >= 1);
  assert.equal(serializeFreeImpactAssessmentToMarkdown(composeFreeImpactAssessmentView(model), { contractLine: "x" }).startsWith("# Free Impact Assessment"), true);
});


test("zero, one or two grounded improvements retain six sections without padding, and pass validation", () => {
  for (const codes of [[], ["derived.matched_subset_only"], ["derived.matched_subset_only", "derived.duplicate_event_copies_counted_once"]]) {
    const basis = claim(70, DERIVED, "Recorded observation: 25 observations.", ["derived.meaning_human_stated", ...codes]);
    const modelBlocks = ["executive_snapshot", "evidence_findings", "impact_stories"].map((key, index) => ({
      ordinal: index + 1, text: withAssessmentSection(key, "The cited evidence records observations."), citations: cite(basis),
    }));
    const composed = composeFreeImpactAssessmentBlocks({ modelBlocks, claims: [basis] });
    assert.equal(composed.ok, true, composed.reason);
    const sections = parseFreeImpactAssessment(composed.blocks);
    assert.equal(sections.length, 6);
    assert.equal(sections[4].title, "Recommended Improvements");
    assert.equal(sections[4].blocks.filter((block) => block.body.startsWith("Proposed change:")).length, codes.length);
    assert.match(sections[4].blocks.map((b) => b.body).join(" "), /[Nn]o (?:further )?recommendations have been invented/);
    assert.ok(composed.blocks.every((block) => block.citations.length > 0));
    const markdown = serializeFreeImpactAssessmentToMarkdown({ title: "Free Impact Assessment", references: [], limitations: [],
      sections: sections.map((section, index) => ({ ...section, number: index + 1, blocks: section.blocks.map((block) => ({ prose: block.body, citationRefs: [] })) })),
    }, { contractLine: "test" });
    assert.equal((markdown.match(/\*\*Improvement /g) || []).length, codes.length, "evidence-gap prose is not labelled as a proposal");
    const disclosed = composeEvidenceSummaryMeasurementDisclosures({ blocks: composed.blocks, claims: [basis], measuredValueByClaimId: new Map([[basis.claimId, 25]]) });
    assert.equal(disclosed.ok, true);
    const validation = validateGeneratedContentDraft({ requestedAudience: "internal", contentType: "evidence_summary",
      generationClaims: [{ ...basis, requestedAudience: "internal", revalidatedForGeneration: true, audienceAuthority: { internal: true } }], blocks: disclosed.blocks });
    assert.deepEqual(validation.blockers, []);
  }
});


test("the size contract refuses oversized output without modifying text or citations, with actionable UI feedback", () => {
  const { classifyGeneratorResult } = __generatedContentRepositoryTestables;
  const result = { blocks: Array.from({ length: 6 }, (_, index) => ({ ordinal: index + 1, text: "x".repeat(3400), citations: cite(CLAIMS[0]) })) };
  const before = structuredClone(result);
  assert.deepEqual(classifyGeneratorResult(result), { ok: false, reason: "generator_result_text_total_too_long" });
  assert.deepEqual(result, before);
  result.blocks[5].text = "x".repeat(3000);
  assert.equal(classifyGeneratorResult(result).ok, true, "exactly 20,000 characters fits");
  const composed = composeFreeImpactAssessmentBlocks({ modelBlocks: MODEL_BLOCKS, claims: CLAIMS });
  const padded = composed.blocks.map((block) => ({ ...block, text: block.text + " ".repeat(2700 - block.text.length) }));
  const disclosed = composeEvidenceSummaryMeasurementDisclosures({ blocks: padded, claims: CLAIMS, measuredValueByClaimId: new Map([[id(1), 223], [id(2), 16815], [id(3), 25]]) });
  assert.equal(disclosed.ok, true);
  assert.equal(classifyGeneratorResult({ blocks: disclosed.blocks }).ok, false, "server disclosures also pass through the final size gate");
  assert.match(errorText({ body: { blockers: [{ blocking_reason: "generator_result_text_total_too_long" }] } }), /Nothing was saved or shortened/);
});

test("the existing claim selection preserves twenty explicit claims, refuses twenty-one and allows changing the set", () => {
  const selected = Array.from({ length: 21 }, (_, i) => id(500 + i));
  const ready = (ids) => internalDraftReadiness({ canGenerate: true, engagementId: id(900), selectedClaimIds: ids });
  assert.deepEqual(ready(selected), { ready: false, reason: "too_many_claims" });
  assert.equal(ready(selected.slice(1)).ready, true);
  assert.deepEqual(internalDraftRequestBody({ claimIds: selected.slice(1), engagementId: id(900), idempotencyKey: "assessment-ui-selection" }).claim_ids, selected.slice(1));
});

test("existing client and GK controls connect to the assessment route, and review display preserves the cited text", () => {
  assert.equal(createFreeImpactAssessmentPath(id(1)), `/api/kai/sprint2/intake/admin/organizations/${id(1)}/generated-content-drafts/free-impact-assessment`);
  for (const file of ["frontend/knowledgeStudio/ClientEvidenceWorkflow.jsx", "frontend/ImpactEvidenceLibrary.jsx"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /createFreeImpactAssessmentPath/);
    assert.match(source, /Generate Free Impact Assessment/);
    assert.match(source, /20 claims selected/);
  }
  for (const file of ["frontend/ImpactEvidenceLibrary.jsx", "frontend/gkExportReviewDetail.jsx", "frontend/knowledgeStudio/ClientInternalDrafts.jsx", "frontend/knowledgeStudio/ClientGeneratedDrafts.jsx"]) {
    assert.match(readFileSync(file, "utf8"), /assessmentBlockDisplay\(block.text\)/);
  }
  assert.equal(assessmentBlockDisplay("[[assessment:evidence_findings]]\n223 encounters. [CIT-001]"), "What Your Evidence Tells Us\n223 encounters. [CIT-001]");
  assert.equal(assessmentBlockDisplay("Plain block."), "Plain block.");
  const client = readFileSync("frontend/knowledgeStudio/ClientInternalDrafts.jsx", "utf8");
  assert.doesNotMatch(client, /!draft.internalReport.available && draft.release/);
  assert.match(client, /canReadReleasedReports && draft.release.state === "released_for_internal_use"/);
});
