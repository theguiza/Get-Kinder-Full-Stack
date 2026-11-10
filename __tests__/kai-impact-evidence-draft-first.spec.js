import test from "node:test";
import assert from "node:assert/strict";
import { makeStoryEvidenceFixture } from "./fixtures/kai-story-evidence-memory.js";
import { evaluateClaimTraceabilityInTransaction } from "../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js";
import { createPostgresGeneratedContentRepository } from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";
import { createPostgresClientInternalReportRepository } from "../Backend/kai/dictionary/postgresClientInternalReportRepository.js";
import {
  evaluateInternalReportAvailabilityInTransaction,
  evaluateOrganizationInternalReleaseInTransaction,
  evaluateOrganizationInternalReviewInTransaction,
} from "../Backend/kai/dictionary/postgresOrganizationInternalReviewRepository.js";
import { createFreeImpactAssessmentDraft, createImpactNarrativeDraft, createEvidenceSummaryDraft } from "../Backend/kai/services/kaiGeneratedContentService.js";
import { getClientInternalDraft, getClientInternalReportMarkdown } from "../Backend/kai/services/kaiClientGeneratedContentService.js";
import { STORED_ORGANIZATION_MEMBERSHIP_SOURCE } from "../Backend/kai/auth/kaiOrganizationMembershipSource.js";
import { composeEvidenceSummaryMeasurementDisclosures, ASSESSMENT_SELECTION_NOTE } from "../Backend/kai/validators/kaiGeneratedContentValidators.js";
import { MINOR_SMALL_CELL_ALERT, PROVISIONAL_REPORT_STATUS } from "../shared/kaiReportInformation.js";

// Owner direction 2026-11-06 ("impact evidence first", draft first). Only SQL
// storage and the model provider are synthetic: P2-06, the AI-processing
// prohibition, generation admission, validators, the assessment composition,
// persistence, the review packet, report availability, the report repository,
// the client service and the Markdown serializer are the production code.

const ORG = "00000000-0000-4000-8000-000000000001";
const ENGAGEMENT = "71000000-0000-4000-8000-000000000001";
const ACTOR = { actorType: "human", actorUserId: "72000000-0000-4000-8000-000000000001", organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_admin", source: STORED_ORGANIZATION_MEMBERSHIP_SOURCE }] };
const GK_ACTOR = { actorType: "human", actorUserId: "72000000-0000-4000-8000-000000000002", globalRoles: ["gk_admin"], organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_admin", source: STORED_ORGANIZATION_MEMBERSHIP_SOURCE }] };
const ENV = { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" };
const NOW = "2026-11-06T12:00:00.000Z";

// An ordinary NPO: programme activity records (a record count), participant
// feedback (a document statement) and an outcome follow-up with no baseline
// for a large share of participants (a paired outcome with exclusions).
const ACTIVITY = { kind: "count" };
const FEEDBACK = { kind: "document", excerpt: "Participants told staff the weekly sessions helped them feel more confident about finding work." };
const OUTCOME = { kind: "derived" };

function harness(specs, { sensitivity = {} } = {}) {
  const fixtures = specs.map((spec, index) => makeStoryEvidenceFixture({ sensitivity, ...spec, offset: index * 65536 }));
  const store = { runs: [], drafts: [], blocks: [], citations: [], queues: [], audits: [] };
  let seq = 0;
  const uuid = () => `73000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
  const select = (sql, rows) => ({ rows: rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => new RegExp(`\\b${key}\\b`).test(sql)))) });
  const byClaims = (params) => fixtures.filter((f) => !Array.isArray(params[1]) || params[1].includes(f.claimId));
  const tx = { async query(raw, params = []) {
    const sql = raw.replace(/\s+/g, " ").trim();
    if (sql.startsWith("SET TRANSACTION")) return { rows: [] };
    if (sql.startsWith("INSERT INTO kai.generation_runs")) {
      if (store.runs.some((r) => r.idempotency_key === params[2])) return { rows: [] };
      const row = { generation_run_id: uuid(), organization_id: params[0], engagement_id: params[1], idempotency_key: params[2], request_fingerprint: params[3], content_type: params[4], requested_audience: params[5], created_by_type: "system", created_at: params[6] };
      store.runs.push(row); return { rows: [{ generation_run_id: row.generation_run_id }] };
    }
    if (sql.startsWith("INSERT INTO kai.generated_content_drafts")) {
      const row = { generated_content_draft_id: uuid(), generation_run_id: params[0], organization_id: params[1], content_type: params[2], requested_audience: params[3], draft_status: params[4], review_status: params[5], validator_results: JSON.parse(params[6]), created_by_type: "system", created_at: params[7] };
      store.drafts.push(row); return { rows: [{ generated_content_draft_id: row.generated_content_draft_id }] };
    }
    if (sql.startsWith("INSERT INTO kai.generated_content_blocks")) {
      const row = { generated_content_block_id: uuid(), generated_content_draft_id: params[0], organization_id: params[1], ordinal: params[2], text: params[3] };
      store.blocks.push(row); return { rows: [{ generated_content_block_id: row.generated_content_block_id }] };
    }
    if (sql.startsWith("INSERT INTO kai.generated_content_citations")) {
      store.citations.push({ generated_content_citation_id: uuid(), generated_content_block_id: params[0], organization_id: params[1], claim_id: params[2], evidence_item_id: params[3], block_ordinal: store.blocks.find((b) => b.generated_content_block_id === params[0]).ordinal, evidence_type: fixtures.find((f) => f.claimId === params[2]).evidenceItemRow.evidence_type });
      return { rows: [] };
    }
    if (sql.startsWith("INSERT INTO kai.review_queue_items")) {
      const row = { review_queue_item_id: uuid(), organization_id: params[0], queue_type: params[1], target_object_type: params[2], target_object_id: params[3], priority: "medium", queue_status: "open", review_status: params[4], assigned_to: null, due_at: null, summary: params[5], required_action: params[6], created_by_type: "system", updated_at: NOW };
      store.queues.push(row); return { rows: [{ review_queue_item_id: row.review_queue_item_id }] };
    }
    if (/^(INSERT|UPDATE|DELETE)/.test(sql)) { assert.match(sql, /kai\.(?:upload_lifecycle_audit|audit_events)/); store.audits.push(sql); return { rows: [] }; }
    if (sql.includes("r.engagement_id::text AS engagement_id, e.engagement_code")) return { rows: [{ engagement_id: ENGAGEMENT, engagement_code: "synthetic", organization_name: "Synthetic Organization" }] };
    if (sql.includes("FROM kai.generated_content_drafts")) return select(sql, store.drafts.filter((d) => params.includes(d.generated_content_draft_id) || params.includes(d.generation_run_id)));
    if (sql.includes("FROM kai.generation_runs")) return select(sql, store.runs.filter((r) => params.includes(r.generation_run_id) || params.includes(r.idempotency_key)));
    if (sql.includes("FROM kai.generated_content_blocks")) return select(sql, store.blocks.filter((b) => params.includes(b.generated_content_draft_id)));
    if (sql.includes("FROM kai.generated_content_citations")) {
      const ids = Array.isArray(params[0]) ? params[0] : store.blocks.filter((b) => params.includes(b.generated_content_draft_id)).map((b) => b.generated_content_block_id);
      return select(sql, store.citations.filter((c) => ids.includes(c.generated_content_block_id)));
    }
    if (sql.includes("FROM kai.review_queue_items") && !/queue_type = '(?:evidence_review|claim_review|client_followup|conflict_resolution)'/.test(sql)) {
      if (params.includes("export_review")) return { rows: [] };
      return select(sql, store.queues.filter((q) => params.includes(q.target_object_id)));
    }
    if (sql.includes("JOIN kai.claim_evidence_links")) return { rows: byClaims(params).map((f) => ({ claim_id: f.claimId, intake_sensitivity_profile_id: f.profileId, evidence_type: f.evidenceItemRow.evidence_type })) };
    if (sql.includes("source_role = 'reference'")) return { rows: [] };
    if (sql.includes("c.statement AS claim_statement")) return { rows: byClaims(params).map((f) => ({ claim_id: f.claimId, claim_statement: f.claimRow.statement, claim_type: "finding", evidence_item_id: f.evidenceItemId,
      evidence_type: f.evidenceItemRow.evidence_type, internal_only: true, funder_use_allowed: false, public_use_allowed: false, source_id: f.sourceId, source_version_id: f.sourceVersionId,
      intake_file_id: f.candidateRow.intake_file_id, upload_state: "confirmed" })) };
    if (sql.includes("FROM kai.intake_sensitivity_profiles") && Array.isArray(params[1])) return { rows: fixtures.filter((f) => params[1].includes(f.profileId)).map((f) => f.profileRow) };
    if (sql.includes("FROM kai.intake_sensitivity_review_decisions") && Array.isArray(params[1])) return { rows: fixtures.filter((f) => params[1].includes(f.profileId)).map((f) => f.head) };
    // Free Impact Assessment display context (labels only).
    if (sql.includes("reporting_period_start")) return { rows: [{ period_start: "2026-01-01", period_end: "2026-06-30", report_identity: null }] };
    if (sql.includes("to_regclass('kai.evidence_derived_measurements')")) return { rows: [{ present: false }] };
    if (sql.includes("SELECT DISTINCT c.claim_id::text AS claim_id, e.evidence_type, f.file_extension")) {
      const cited = new Set(store.citations.filter((c) => store.blocks.some((b) => b.generated_content_block_id === c.generated_content_block_id && b.generated_content_draft_id === params[1])).map((c) => c.claim_id));
      return { rows: fixtures.filter((f) => cited.has(f.claimId)).map((f) => ({ claim_id: f.claimId, evidence_type: f.evidenceItemRow.evidence_type, file_extension: f.evidenceItemRow.evidence_type === "source_document_statement" ? ".txt" : ".csv", locator_type: f.locatorRow.locator_type, coordinates: f.locatorRow.coordinates, indicator_label: null })) };
    }
    if (sql.includes("FROM kai.engagements")) return { rows: [{ engagement_type: "impact_assessment" }] };
    if (sql.includes("FROM kai.source_measurement_definitions")) return { rows: [fixtures.find((f) => f.row.source_measurement_definition_id === params[1]).row] };
    if (sql.includes("FROM kai.evidence_items") && Array.isArray(params[1])) return { rows: fixtures.filter((f) => params[1].includes(f.evidenceItemId)).map((f) => f.evidenceItemRow) };
    if (sql.includes("FROM kai.source_versions") && sql.includes("created_at, profile_canonical_sha256")) return { rows: [fixtures.find((f) => f.sourceVersionId === params[1]).sourceVersionRow] };
    const f = fixtures.find((f) => [f.claimId, f.evidenceItemId, f.sourceVersionId, f.profileId, ...Object.values(f.claimRow), ...Object.values(f.evidenceItemRow), ...Object.values(f.sourceVersionRow), ...Object.values(f.candidateRow), ...Object.values(f.locatorRow)].includes(params[1])) || fixtures[0];
    return f.tx.query(raw, params);
  } };
  const runInTransaction = async (callback) => {
    const snapshot = structuredClone(store);
    try { return await callback(tx); } catch (e) { Object.assign(store, snapshot); throw e; }
  };
  const repository = createPostgresGeneratedContentRepository({ runInTransaction, evaluator: evaluateClaimTraceabilityInTransaction });
  const reportRepository = createPostgresClientInternalReportRepository({ runInTransaction });
  const providerInputs = [];
  const dependencies = {
    env: ENV, generatedContentRepository: repository,
    getEngagementForOrganization: async () => ({ organization_id: ORG, engagement_id: ENGAGEMENT }),
    reconcileClaimGapsForGeneration: async () => null,
    metadataOnlyAudit: { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) },
  };
  const readDependencies = { ...dependencies, internalReportRepository: reportRepository, readGeneratedDraftEngagementId: async () => ENGAGEMENT,
    organizationReviewRepository: {
      evaluate: async ({ packet }) => evaluateOrganizationInternalReviewInTransaction(tx, { organizationId: ORG, packet }),
      evaluateInternalReport: async ({ packet }) => evaluateInternalReportAvailabilityInTransaction(tx, { organizationId: ORG, packet }),
      readCompletedReviewer: async () => null,
    } };
  const input = (claimIds, key, audience = "internal") => ({ organizationId: ORG, engagementId: ENGAGEMENT, requestedAudience: audience, claimIds, idempotencyKey: key, actorContext: ACTOR, now: NOW });
  return { fixtures, tx, store, repository, reportRepository, dependencies, readDependencies, input, providerInputs };
}

// A deterministic stand-in for the model: it writes per-claim findings in the
// shape the production prompt asks for. It is a test stub, not AI; it proves
// what the server admits, composes, validates, persists and reports.
function claimText(claim) {
  return claim.claimStatement;
}
// Like the production prompt asks, a block citing a measured claim discloses
// that claim's material limitations (VAL-GEN-008 checks it independently).
function disclosed(h, claim, ordinal) {
  const f = h.fixtures.find((fixture) => fixture.claimId === claim.claimId);
  const citations = [{ claimId: claim.claimId, evidenceItemId: claim.evidenceItemId }];
  if (!f.row) return { ordinal, text: claimText(claim), citations };
  return composeEvidenceSummaryMeasurementDisclosures({ blocks: [{ ordinal, text: claimText(claim), citations }], claims: [claim], measuredValueByClaimId: new Map([[claim.claimId, f.row.measured_value]]) }).blocks[0];
}
function narrativeGenerator(h) {
  return async (generatorInput) => {
    h.providerInputs.push(generatorInput);
    return { blocks: generatorInput.claims.map((claim, index) => disclosed(h, claim, index + 1)) };
  };
}
function assessmentGenerator(h, interpretationClaimIds) {
  return async (generatorInput) => {
    h.providerInputs.push(generatorInput);
    const cite = (claim) => [{ claimId: claim.claimId, evidenceItemId: claim.evidenceItemId }];
    const claims = generatorInput.claims;
    const document = claims.find((claim) => claim.claimStatement.startsWith("Source-reported"));
    const blocks = [
      { text: "[[assessment:executive_snapshot]]\nThe evidence records regular programme activity and participant accounts of growing confidence about finding work. Taken together this suggests the programme may be supporting participants toward employment; a comparison with participants who did not take part would be needed to confirm it.",
        citations: claims.filter((claim) => interpretationClaimIds.includes(claim.claimId)).flatMap(cite) },
      ...claims.map((claim) => ({ text: `[[assessment:evidence_findings]]\n${claimText(claim)}`, citations: cite(claim) })),
      { text: "[[assessment:impact_stories]]\nParticipants describe feeling more confident about finding work after the weekly sessions. This is a source-reported account and is consistent with the activity records.",
        citations: document ? cite(document) : cite(claims[0]) },
    ];
    return { blocks: blocks.map((block, index) => ({ ordinal: index + 1, ...block })) };
  };
}

async function readReport(h, draftId) {
  const readInput = { organizationId: ORG, engagementId: ENGAGEMENT, generatedContentDraftId: draftId, actorContext: ACTOR };
  const detail = await getClientInternalDraft(readInput, h.readDependencies);
  assert.equal(detail.ok, true, JSON.stringify(detail));
  const markdown = await getClientInternalReportMarkdown(readInput, h.readDependencies);
  return { detail, markdown };
}

test("1 qualitative: an unreviewed source-reported observation drafts a provisional internal narrative with no claim approval", async () => {
  const h = harness([FEEDBACK]);
  const [feedback] = h.fixtures;
  const trace = await evaluateClaimTraceabilityInTransaction(h.tx, { organizationId: ORG, claimId: feedback.claimId, requestedAudience: "internal" });
  assert.equal(trace.data.eligible, false, "no review has happened");
  assert.ok(trace.data.blockerCodes.includes("claim_review_unresolved"));
  const result = await createImpactNarrativeDraft(h.input([feedback.claimId], "qualitative"), { ...h.dependencies, draftGenerator: narrativeGenerator(h) });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(h.providerInputs.length, 1);
  assert.ok(h.providerInputs[0].claims[0].limitationCodes.includes("claim_review_unresolved"), "review state travels as a limitation");
  const { detail, markdown } = await readReport(h, result.data.generatedContentDraftId);
  assert.equal(detail.data.internalReport.available, true, JSON.stringify(detail.data.internalReport));
  assert.deepEqual(detail.data.internalReport.informationReasons, ["cited_claims_not_currently_eligible"]);
  assert.equal(markdown.ok, true, JSON.stringify(markdown));
  const md = markdown.data.markdown;
  assert.ok(md.includes(PROVISIONAL_REPORT_STATUS));
  assert.match(md, /weekly sessions helped them feel more confident about finding work/);
  assert.match(md, /Review for final use complete: no \(provisional finding\)/);
  assert.match(md, /open review items: `claim_review_unresolved`/);
});

test("2 measured + 7 minors/small cells: unreviewed counts and paired outcomes from flagged sources draft with exact values, citations and a heightened informational alert", async () => {
  const h = harness([ACTIVITY, OUTCOME], { sensitivity: { reviewed_minor_data_status: "present", reviewed_small_cell_risk_status: "present" } });
  for (const f of h.fixtures) {
    const trace = await evaluateClaimTraceabilityInTransaction(h.tx, { organizationId: ORG, claimId: f.claimId, requestedAudience: "internal" });
    assert.equal(trace.data.eligible, false, "flags plus no review: not eligible for final use");
  }
  const result = await createImpactNarrativeDraft(h.input(h.fixtures.map((f) => f.claimId), "measured"), { ...h.dependencies, draftGenerator: narrativeGenerator(h) });
  assert.equal(result.ok, true, JSON.stringify(result));
  const { detail, markdown } = await readReport(h, result.data.generatedContentDraftId);
  assert.equal(detail.data.internalReport.available, true);
  assert.deepEqual(detail.data.internalReport.getKinderReviewReasons, [], "flags inform; no review stage is added");
  assert.deepEqual(detail.data.internalReport.informationReasons, ["minor_information_not_cleared", "small_cell_risk_not_cleared", "cited_claims_not_currently_eligible"]);
  const md = markdown.data.markdown;
  assert.ok(md.includes(`**${MINOR_SMALL_CELL_ALERT}**`), "combined alert leads the Information section");
  assert.match(md, /37 nonblank data rows/);
  assert.match(md, /25 of 38/);
  assert.match(md, /65\.79%/);
  for (const f of h.fixtures) {
    assert.ok(md.includes(f.claimId) && md.includes(f.evidenceItemId) && md.includes(f.sourceVersionId), "every finding traces to claim, evidence and source version");
  }
  const facts = (await h.reportRepository.readInternalReport({ organizationId: ORG, generatedContentDraftId: result.data.generatedContentDraftId })).data.facts;
  assert.deepEqual(facts.map((fact) => fact.currentlyEligible), [false, false]);
});

test("3+4 impact discovery and limitations: the end-to-end ordinary NPO assessment is substantive, qualified, cited and provisional", async () => {
  const h = harness([ACTIVITY, FEEDBACK, OUTCOME]);
  const [activity, feedback, outcome] = h.fixtures;
  const result = await createFreeImpactAssessmentDraft(h.input(h.fixtures.map((f) => f.claimId), "assessment"),
    { ...h.dependencies, draftGenerator: assessmentGenerator(h, [activity.claimId, feedback.claimId]) });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(h.providerInputs.length, 1, "first attempt passes");
  assert.deepEqual(new Set(h.providerInputs[0].claims.map((claim) => claim.claimId)), new Set(h.fixtures.map((f) => f.claimId)), "no unreviewed claim is dropped");
  const gapKeys = h.providerInputs[0].assessment.documentedGaps.map((gap) => gap.key);
  assert.ok(gapKeys.includes("provisional_findings") && gapKeys.includes("follow_up_evidence_limited"), JSON.stringify(gapKeys));
  const { detail, markdown } = await readReport(h, result.data.generatedContentDraftId);
  assert.equal(detail.data.internalReport.available, true, JSON.stringify(detail.data.internalReport));
  const md = markdown.data.markdown;
  // Opt-in inspection copy of the synthetic demonstration report.
  if (process.env.KAI_DRAFT_FIRST_DEMO_OUT) (await import("node:fs")).writeFileSync(process.env.KAI_DRAFT_FIRST_DEMO_OUT, md);
  // Evidence-backed activity, qualitative observation, qualified interpretation.
  assert.match(md, /37 nonblank data rows/);
  assert.match(md, /feel more confident about finding work/);
  assert.match(md, /suggests the programme may be supporting participants toward employment/);
  assert.match(md, /25 of 38/);
  // Useful limitations, not refusal: uncertain outcome coverage and provisional status.
  assert.match(md, /Follow-up information describes only the people who were reached/);
  assert.match(md, /presented as provisional interpretations for internal planning and drafting/);
  assert.match(md, /Proposed change:/);
  // Citations and provenance for every cited finding.
  for (const f of [activity, feedback, outcome]) assert.ok(md.includes(f.claimId) && md.includes(f.sourceVersionId));
  // No unnecessary approval request and no story-review stage.
  assert.doesNotMatch(md, /Get Kinder's story review|Read this internal draft with Get Kinder|Review the evidence gaps with Get Kinder/);
  assert.ok(md.includes(PROVISIONAL_REPORT_STATUS));
  assert.doesNotMatch(md, /\bis approved for\b/);
});

test("5 mixed evidence: a claim a recorded review rejected is left out of the assessment and the rest is kept; other generators keep refusing it", async () => {
  const rejectedHead = { decision_id: "74000000-0000-4000-8000-000000000001", decision_outcome: "rejected", approved_audiences: [], decided_by_role: "gk_reviewer" };
  const h = harness([ACTIVITY, FEEDBACK, { ...OUTCOME, claimHead: rejectedHead, claimStrength: "reviewed_not_supported" }]);
  const [activity, feedback, outcome] = h.fixtures;
  const result = await createFreeImpactAssessmentDraft(h.input(h.fixtures.map((f) => f.claimId), "mixed-evidence"),
    { ...h.dependencies, draftGenerator: assessmentGenerator(h, [activity.claimId, feedback.claimId]) });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(h.providerInputs[0].claims.map((claim) => claim.claimId).sort(), [activity.claimId, feedback.claimId].sort(), "rejected claim text never reaches the model");
  const cited = new Set(result.data.blocks.flatMap((block) => block.citations.map((citation) => citation.claimId)));
  assert.equal(cited.has(outcome.claimId), false);
  assert.ok(result.data.blocks.some((block) => block.text.endsWith(ASSESSMENT_SELECTION_NOTE)));
  const narrative = await createImpactNarrativeDraft(h.input([activity.claimId, outcome.claimId], "mixed-narrative"), { ...h.dependencies, draftGenerator: narrativeGenerator(h) });
  assert.equal(narrative.ok, false);
  assert.equal(narrative.error.code, "claim_reviewed_not_supported");
});

test("8 permissions: a recorded AI-processing prohibition stops generation before the provider; the same evidence still yields its deterministic traceability", async () => {
  const h = harness([ACTIVITY, FEEDBACK], { sensitivity: { reviewed_llm_processing_allowed: false } });
  const result = await createFreeImpactAssessmentDraft(h.input(h.fixtures.map((f) => f.claimId), "prohibited"),
    { ...h.dependencies, draftGenerator: assessmentGenerator(h, []) });
  assert.equal(result.ok, false);
  assert.equal(h.providerInputs.length, 0, "no prohibited content is sent to an AI provider");
  assert.equal(h.store.drafts.length, 0);
  const trace = await evaluateClaimTraceabilityInTransaction(h.tx, { organizationId: ORG, claimId: h.fixtures[0].claimId, requestedAudience: "internal" });
  assert.equal(trace.ok, true, "deterministic, non-AI evidence reads continue");
});

test("9 integrity: a measurement that no longer matches its claim is not drafted from (refused for a narrative, left out of an assessment)", async () => {
  const h = harness([ACTIVITY, FEEDBACK]);
  const [activity, feedback] = h.fixtures;
  activity.claimRow.statement = activity.claimRow.statement.replace("37", "73");
  const narrative = await createImpactNarrativeDraft(h.input([activity.claimId], "tampered-measurement"), { ...h.dependencies, draftGenerator: narrativeGenerator(h) });
  assert.equal(narrative.ok, false);
  assert.equal(narrative.blockers?.[0]?.blocking_reason, "measured_claim_not_currently_eligible", JSON.stringify(narrative));
  const assessment = await createFreeImpactAssessmentDraft(h.input([activity.claimId, feedback.claimId], "tampered-assessment"),
    { ...h.dependencies, draftGenerator: assessmentGenerator(h, [feedback.claimId]) });
  assert.equal(assessment.ok, true, JSON.stringify(assessment));
  assert.deepEqual(h.providerInputs.at(-1).claims.map((claim) => claim.claimId), [feedback.claimId]);
});

test("12 draft versus release: a provisional draft is readable but not released, not organization-releasable while flagged, and not funder-eligible", async () => {
  const h = harness([ACTIVITY, FEEDBACK], { sensitivity: { reviewed_minor_data_status: "present" } });
  const result = await createImpactNarrativeDraft(h.input(h.fixtures.map((f) => f.claimId), "draft-versus-release"), { ...h.dependencies, draftGenerator: narrativeGenerator(h) });
  assert.equal(result.ok, true, JSON.stringify(result));
  const draftId = result.data.generatedContentDraftId;
  const release = await evaluateOrganizationInternalReleaseInTransaction(h.tx, { organizationId: ORG, generatedContentDraftId: draftId });
  assert.equal(release.organizationMayRelease, false);
  assert.ok(release.blockedReasons.includes("factual_review_not_complete"));
  assert.ok(release.blockedReasons.includes("cited_claims_not_currently_eligible"));
  const { detail } = await readReport(h, draftId);
  assert.equal(detail.data.internalReport.available, true);
  assert.equal(detail.data.release.state === "released_for_internal_use", false, "reading is not release");
  // Funder generation still requires current eligibility, before any provider call.
  const calls = h.providerInputs.length;
  const funder = await createEvidenceSummaryDraft({ ...h.input([h.fixtures[0].claimId], "funder-request", "funder"), actorContext: GK_ACTOR }, { ...h.dependencies, draftGenerator: narrativeGenerator(h) });
  assert.equal(funder.ok, false);
  assert.equal(funder.error.code, "funder_use_not_currently_eligible", JSON.stringify(funder));
  assert.equal(h.providerInputs.length, calls);
});

// Report composition across evidence types (2026-11-06 completion): the
// deterministic sections describe every cited evidence type on its own terms
// and never negate a finding the report presents elsewhere.
function sectionOf(md, from, to) {
  const start = md.indexOf(`\n## ${from}\n`);
  const end = md.indexOf(`\n## ${to}\n`, start + 1);
  assert.ok(start >= 0 && end > start, `${from} section present`);
  return md.slice(start, end);
}
function sectionsOf(md) {
  return {
    limits: sectionOf(md, "What this evidence does not establish", "Analysis"),
    analysis: sectionOf(md, "Analysis", "Generated narrative"),
    conclusion: sectionOf(md, "Conclusion", "References"),
  };
}
async function dumpScenario(name, md) {
  if (process.env.KAI_DRAFT_FIRST_DEMO_DIR) (await import("node:fs")).writeFileSync(`${process.env.KAI_DRAFT_FIRST_DEMO_DIR}/${name}.md`, md);
}
// Statements that would contradict a cited observation or paired outcome.
const BLANKET_NEGATIONS = [
  /Any outcome for participants or the community, or any change over time/,
  /no comparison, baseline or attribution evidence is cited/,
  /no measured value is (?:cited|available)/i,
  /volume-of-activity/,
  /not evidence of the number of people reached, of distinct sessions, of outcomes, or of impact/,
];
// Over the deterministic sections only (an assessment's model-authored
// "Recommended Improvements" heading is about the programme, not a result).
function assertNoUnqualifiedImprovement(md) {
  const { limits, analysis, conclusion } = sectionsOf(md);
  for (const line of [limits, analysis, conclusion].join("\n").split("\n").filter((entry) => /improv/i.test(entry))) {
    assert.match(line, /not (?:an established |)improvement|is an improvement: whether a higher value is better has not been established|not presented as a better result|a comparison[^.]*would be needed/, `qualified: ${line}`);
  }
}

test("A mixed evidence: activity rows, a participant observation and a paired outcome are each analysed and concluded on their own terms, with no contradiction", async () => {
  const h = harness([ACTIVITY, FEEDBACK, OUTCOME]);
  const [activity, feedback, outcome] = h.fixtures;
  const result = await createFreeImpactAssessmentDraft(h.input(h.fixtures.map((f) => f.claimId), "composition-mixed"),
    { ...h.dependencies, draftGenerator: assessmentGenerator(h, [activity.claimId, feedback.claimId]) });
  assert.equal(result.ok, true, JSON.stringify(result));
  const md = (await readReport(h, result.data.generatedContentDraftId)).markdown.data.markdown;
  await dumpScenario("A-mixed", md);
  const { limits, analysis, conclusion } = sectionsOf(md);
  // Analysis: all three findings, each in its own analytical context.
  assert.match(analysis, /\[CIT-001\] 37 of the 37 data rows after the header .* were nonblank and counted/);
  assert.match(analysis, /\[CIT-002\] \*\*Source-reported observation \(qualitative\):\*\* the source records that "Participants told staff the weekly sessions helped them feel more confident about finding work\."/);
  assert.match(analysis, /\[CIT-003\] \*\*Outcome measurement \(derived baseline and follow-up comparison\):\*\* 25 of 38 comparable participant pairs \(65\.79%\) recorded a numerically higher follow-up value than baseline, 10 the same and 3 lower\. 24 of 62 participants lacked comparable baseline and follow-up observations/);
  assert.match(analysis, /The row count \[CIT-001\] describes what was recorded, not who took part or what changed/);
  assert.match(analysis, /neither confirms the other/);
  // Limitations: specific to the evidence, not blanket denials.
  assert.match(limits, /That the numerical change \[CIT-003\] is an improvement: whether a higher value is better has not been established\./);
  assert.match(limits, /only the 38 comparable pairs are compared; 24 of 62 participants lacked comparable/);
  assert.match(limits, /That the programme caused any result: the baseline and follow-up comparison \[CIT-003\] follows the same participants over time, with no comparison group/);
  assert.match(limits, /That the source-reported observation \[CIT-002\] is verified or representative/);
  assert.match(limits, /How many distinct people the counted records represent \[CIT-001\]: .* no participant count was measured from them\./);
  // Conclusion: substantive, qualified, covers every finding.
  assert.match(conclusion, /37 nonblank data rows in the source version's CSV data records \[CIT-001\]/);
  assert.match(conclusion, /"Participants told staff the weekly sessions helped them feel more confident about finding work\." \[CIT-002\]/);
  assert.match(conclusion, /25 of 38 comparable participant pairs \(65\.79%\) recorded a numerically higher follow-up value than baseline, 10 the same and 3 lower \[CIT-003\]; 24 of 62 participants/);
  assert.match(conclusion, /this is an observed numerical change, not an established improvement/);
  assert.match(conclusion, /Taken together, these findings are relevant to the programme's potential impact and may be used internally as qualified evidence of it/);
  assert.match(conclusion, /They do not establish that the programme caused any change/);
  // No contradiction with the cited findings or the generated narrative.
  for (const negation of BLANKET_NEGATIONS) assert.doesNotMatch(md, negation);
  assert.doesNotMatch(md, /\b(?:caused|causes) (?:the|this|an?) (?:change|improvement|increase)\b(?![^.]*not)/i);
  assertNoUnqualifiedImprovement(md);
  assert.match(md, /suggests the programme may be supporting participants toward employment/, "the generated narrative is kept");
  // Exact citations and source versions.
  for (const [index, f] of [activity, feedback, outcome].entries()) {
    assert.ok(md.includes(`| CIT-00${index + 1} | \`${f.claimId}\` | \`${f.evidenceItemId}\` |`), "traceability row");
    assert.ok(md.includes(`\`${f.sourceVersionId}\``));
  }
});

test("B count-only evidence: rows stay rows in the analysis, limitations and conclusion", async () => {
  const h = harness([ACTIVITY]);
  const result = await createImpactNarrativeDraft(h.input([h.fixtures[0].claimId], "composition-count"), { ...h.dependencies, draftGenerator: narrativeGenerator(h) });
  assert.equal(result.ok, true, JSON.stringify(result));
  const md = (await readReport(h, result.data.generatedContentDraftId)).markdown.data.markdown;
  await dumpScenario("B-count-only", md);
  const { limits, analysis, conclusion } = sectionsOf(md);
  assert.match(analysis, /37 of the 37 data rows after the header .* were nonblank and counted/);
  assert.match(analysis, /A count-only figure is a number of worksheet rows\. It is not a measure of activity, reach or results/);
  assert.doesNotMatch(analysis, /Source-reported observation|Outcome measurement|Derived measurement|volume-of-activity/);
  assert.match(limits, /Any outcome for participants or the community, or any change over time\./, "no outcome evidence is cited, so none is claimed");
  assert.match(limits, /That the source is complete: activity not recorded in this source is not reflected\./);
  assert.doesNotMatch(limits, /reporting period is verified/, "no period was defined, so none is described as stated");
  assert.match(conclusion, /^On the available evidence, the promoted source contains 37 nonblank data rows .* It is not evidence of the number of people reached, of distinct sessions, of outcomes, or of impact\.$/m);
  assert.doesNotMatch(md, /\b37 (?:service events|people|participants|sessions|outcomes)\b/, "rows never become people, events or outcomes");
});

test("C document-only evidence: a source-reported observation is analysed and concluded as qualified qualitative evidence, not dismissed", async () => {
  const h = harness([FEEDBACK]);
  const result = await createImpactNarrativeDraft(h.input([h.fixtures[0].claimId], "composition-document"), { ...h.dependencies, draftGenerator: narrativeGenerator(h) });
  assert.equal(result.ok, true, JSON.stringify(result));
  const md = (await readReport(h, result.data.generatedContentDraftId)).markdown.data.markdown;
  await dumpScenario("C-document-only", md);
  const { limits, analysis, conclusion } = sectionsOf(md);
  assert.match(analysis, /\[CIT-001\] \*\*Source-reported observation \(qualitative\):\*\* the source records that "Participants told staff the weekly sessions helped them feel more confident about finding work\." This is qualitative evidence as the source reports it\. It is not a measurement, KAI did not verify it, and how many people it reflects is not recorded\./);
  assert.match(limits, /That the observation \[CIT-001\] is a measured outcome or a measured change over time: no baseline and follow-up comparison is cited\./);
  assert.match(conclusion, /the source reports an observation: "Participants told staff the weekly sessions helped them feel more confident about finding work\." \[CIT-001\]\. This is qualitative, source-reported evidence/);
  assert.match(conclusion, /This finding is relevant to the programme's potential impact and may be used internally as qualified evidence of it, with the limitations above kept with it\. It does not establish that the programme caused any change/);
  // No baseline or comparison is cited here, so that statement stays true.
  assert.match(limits, /That the programme caused any result: no comparison, baseline or attribution evidence is cited\./);
  // "No measured value is cited" stays true in the method sections; the
  // analysis and conclusion still describe the observation.
  for (const negation of BLANKET_NEGATIONS.filter((entry) => !/baseline|measured value/.test(entry.source))) assert.doesNotMatch(md, negation);
  assert.doesNotMatch(analysis + conclusion, /no measured value/i);
  assert.doesNotMatch(md, /nonblank data row|Outcome measurement/);
});

test("D derived-outcome evidence: a paired outcome without a row count is recognised as a measured change with its own limitations", async () => {
  const h = harness([OUTCOME]);
  const result = await createImpactNarrativeDraft(h.input([h.fixtures[0].claimId], "composition-derived"), { ...h.dependencies, draftGenerator: narrativeGenerator(h) });
  assert.equal(result.ok, true, JSON.stringify(result));
  const md = (await readReport(h, result.data.generatedContentDraftId)).markdown.data.markdown;
  await dumpScenario("D-derived-outcome", md);
  const { limits, analysis, conclusion } = sectionsOf(md);
  assert.match(analysis, /\[CIT-001\] \*\*Outcome measurement \(derived baseline and follow-up comparison\):\*\* 25 of 38 comparable participant pairs \(65\.79%\)/);
  assert.match(analysis, /Whether a higher value is better has not been established, so this is an observed numerical change, not an established improvement\./);
  assert.match(limits, /That the numerical change \[CIT-001\] is an improvement/);
  assert.match(limits, /24 of 62 participants lacked comparable/);
  assert.match(md, /- No reporting period was applied to the derived measurement \[CIT-001\]\./);
  assert.match(md, /#### \[CIT-001\] Derived measurement/);
  assert.match(conclusion, /in the baseline and follow-up comparison, 25 of 38 comparable participant pairs \(65\.79%\) recorded a numerically higher follow-up value/);
  assert.match(conclusion, /It does not establish that the programme caused any change: no comparison with people who did not take part is cited, and the beneficial direction of the measured change is not established\./);
  for (const negation of BLANKET_NEGATIONS) assert.doesNotMatch(md, negation);
  assert.doesNotMatch(md, /nonblank data row|activity volume/);
  assertNoUnqualifiedImprovement(md);
});

// Owner Package 1 (2026-11-10): measurement-to-claim factual integrity. The
// exact wording the pre-repair composer persisted for this fixture's count,
// which asserted the person's label as the counted entity.
const PRE_REPAIR_COUNT_STATEMENT = "The promoted source records 37 service events with no reporting period defined (record count: one service event per CSV data record; 0 blank records excluded, 0 exact-duplicate records included).";

test("Package 1: a persisted pre-repair record-count claim is not drafted from, is left out of an assessment, and withholds an earlier draft that cites it; the current claim stays usable", async () => {
  const h = harness([ACTIVITY, FEEDBACK]);
  const [activity, feedback] = h.fixtures;
  assert.match(activity.claimRow.statement, /^The promoted source has 37 source records \(record count: one record per CSV data record;/);
  // The current, truthful record count drafts provisionally with no review.
  const earlier = await createImpactNarrativeDraft(h.input([activity.claimId, feedback.claimId], "package-1-before"), { ...h.dependencies, draftGenerator: narrativeGenerator(h) });
  assert.equal(earlier.ok, true, JSON.stringify(earlier));
  assert.match(h.providerInputs[0].claims.find((claim) => claim.claimId === activity.claimId).claimStatement, /^37 nonblank data rows were counted/,
    "the model sees the row count, never the label");
  assert.equal((await readReport(h, earlier.data.generatedContentDraftId)).detail.data.internalReport.available, true);

  // The same lineage holding the pre-repair wording (stored, never rewritten).
  activity.claimRow.statement = PRE_REPAIR_COUNT_STATEMENT;
  const trace = await evaluateClaimTraceabilityInTransaction(h.tx, { organizationId: ORG, claimId: activity.claimId, requestedAudience: "internal" });
  assert.equal(trace.data.eligible, false);
  assert.ok(trace.data.blockerCodes.includes("measured_claim_integrity_not_established"), JSON.stringify(trace.data.blockerCodes));
  const calls = h.providerInputs.length;
  const narrative = await createImpactNarrativeDraft(h.input([activity.claimId], "package-1-narrative"), { ...h.dependencies, draftGenerator: narrativeGenerator(h) });
  assert.equal(narrative.ok, false);
  assert.equal(narrative.blockers?.[0]?.blocking_reason, "measured_claim_not_currently_eligible", JSON.stringify(narrative));
  const summary = await createEvidenceSummaryDraft(h.input([activity.claimId], "package-1-summary"), { ...h.dependencies, draftGenerator: narrativeGenerator(h) });
  assert.equal(summary.ok, false);
  assert.equal(h.providerInputs.length, calls, "the provider is never called for it");
  const assessment = await createFreeImpactAssessmentDraft(h.input([activity.claimId, feedback.claimId], "package-1-assessment"),
    { ...h.dependencies, draftGenerator: assessmentGenerator(h, [feedback.claimId]) });
  assert.equal(assessment.ok, true, JSON.stringify(assessment));
  assert.deepEqual(h.providerInputs.at(-1).claims.map((claim) => claim.claimId), [feedback.claimId], "left out of the assessment; the rest is kept");
  assert.ok(assessment.data.blocks.some((block) => block.text.endsWith(ASSESSMENT_SELECTION_NOTE)));

  // The earlier draft citing it is kept as generated but withheld as a report.
  const { detail } = await readReport(h, earlier.data.generatedContentDraftId);
  assert.equal(detail.data.internalReport.available, false);
  assert.ok(detail.data.internalReport.blockedReasons.includes("cited_measured_claim_integrity_not_established"), JSON.stringify(detail.data.internalReport));
  assert.equal(h.store.drafts.find((draft) => draft.generated_content_draft_id === earlier.data.generatedContentDraftId).draft_status, "draft", "the stored draft is unchanged");
});
