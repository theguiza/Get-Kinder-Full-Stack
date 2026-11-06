import test from "node:test";
import assert from "node:assert/strict";
import { makeStoryEvidenceFixture } from "./fixtures/kai-story-evidence-memory.js";
import { evaluateClaimTraceabilityInTransaction } from "../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js";
import { createPostgresGeneratedContentRepository, __generatedContentRepositoryTestables as R, evaluateGeneratedDraftReviewPacketInTransaction } from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";
import { createPostgresClientInternalReportRepository } from "../Backend/kai/dictionary/postgresClientInternalReportRepository.js";
import { evaluateOrganizationInternalReleaseInTransaction } from "../Backend/kai/dictionary/postgresOrganizationInternalReviewRepository.js";
import { evaluateOrganizationFactualReviewInTransaction, evaluateOrganizationCoverageAcceptanceInTransaction } from "../Backend/kai/dictionary/postgresOrganizationFactualReviewRepository.js";
import { createImpactNarrativeDraft } from "../Backend/kai/services/kaiGeneratedContentService.js";
import { getClientInternalDraft, getClientInternalReportMarkdown } from "../Backend/kai/services/kaiClientGeneratedContentService.js";
import { createProductionImpactNarrativeDraftGenerator } from "../Backend/kai/services/kaiImpactNarrativeDraftGenerator.js";
import { GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES } from "../Backend/kai/dictionary/generatedContentReviewQueueContract.js";
import { STORED_ORGANIZATION_MEMBERSHIP_SOURCE } from "../Backend/kai/auth/kaiOrganizationMembershipSource.js";
import { composeEvidenceSummaryMeasurementDisclosures } from "../Backend/kai/validators/kaiGeneratedContentValidators.js";
import { measurementLimitationCodes } from "../Backend/kai/validators/kaiSourceMeasurementValidators.js";
import { derivedMeasurementLimitationCodes } from "../Backend/kai/validators/kaiDerivedMeasurementValidators.js";
import { evaluateFinalExportEligibilityInTransaction } from "../Backend/kai/services/kaiFinalExportEligibilityGateService.js";
import { serializeExportManifestRenderModelToMarkdown } from "../Backend/kai/services/kaiExportManifestMarkdownSerializer.js";
import { sendServiceResult } from "../Backend/kai/routes/sprint2IntakeApi.js";
import { STORY_SOURCE_NOTE, STORY_SOURCE_NOTE_RESULT, LEGACY_STORY_LIMITATION_CODE, storySourceWarnings } from "../shared/kaiStorySourceInformation.js";

const FLAGS = ["absent", "present", "unknown"];
const ORG = "00000000-0000-4000-8000-000000000001";
const ENGAGEMENT = "71000000-0000-4000-8000-000000000001";
const ACTOR = { actorType: "human", actorUserId: "72000000-0000-4000-8000-000000000001", organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_admin", source: STORED_ORGANIZATION_MEMBERSHIP_SOURCE }] };
const ENV = { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" };
const NOW = "2026-11-06T12:00:00.000Z";

// Only SQL storage and the model provider are synthetic. Production services,
// P2-06, measurement/coverage calculations, generation, packet, availability,
// release admission, serialization, and the production model adapter run here.
function assembled(flag, kinds = ["derived"]) {
  const fixtures = kinds.map((kind, index) => makeStoryEvidenceFixture({ kind, flag, offset: index * 65536 }));
  const store = { runs: [], drafts: [], blocks: [], citations: [], queues: [], audits: [] };
  let seq = 0;
  const uuid = () => `73000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
  const select = (sql, rows) => ({ rows: rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => new RegExp(`\\b${key}\\b`).test(sql)))) });
  const tx = { async query(raw, params = []) {
    const sql = raw.replace(/\s+/g, " ").trim();
    if (sql.startsWith("SET TRANSACTION")) return { rows: [] };
    if (sql.startsWith("INSERT INTO kai.generation_runs")) {
      if (store.runs.some(r => r.idempotency_key === params[2])) return { rows: [] };
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
      store.citations.push({ generated_content_citation_id: uuid(), generated_content_block_id: params[0], organization_id: params[1], claim_id: params[2], evidence_item_id: params[3], block_ordinal: store.blocks.find(b => b.generated_content_block_id === params[0]).ordinal, evidence_type: fixtures.find(f => f.claimId === params[2]).evidenceItemRow.evidence_type });
      return { rows: [] };
    }
    if (sql.startsWith("INSERT INTO kai.review_queue_items")) {
      const row = { review_queue_item_id: uuid(), organization_id: params[0], queue_type: params[1], target_object_type: params[2], target_object_id: params[3], priority: "medium", queue_status: "open", review_status: params[4], assigned_to: null, due_at: null, summary: params[5], required_action: params[6], created_by_type: "system", updated_at: NOW };
      store.queues.push(row); return { rows: [{ review_queue_item_id: row.review_queue_item_id }] };
    }
    if (/^(INSERT|UPDATE|DELETE)/.test(sql)) { assert.match(sql, /kai\.(?:upload_lifecycle_audit|audit_events)/); store.audits.push(sql); return { rows: [] }; }
    if (sql.includes("r.engagement_id::text AS engagement_id, e.engagement_code")) return { rows: [{ engagement_id: ENGAGEMENT, engagement_code: "synthetic", organization_name: "Synthetic Organization" }] };
    if (sql.includes("FROM kai.generated_content_drafts")) {
      const rows = store.drafts.filter(d => params.includes(d.generated_content_draft_id) || params.includes(d.generation_run_id));
      return select(sql, rows);
    }
    if (sql.includes("FROM kai.generation_runs")) return select(sql, store.runs.filter(r => params.includes(r.generation_run_id) || params.includes(r.idempotency_key)));
    if (sql.includes("FROM kai.generated_content_blocks")) return select(sql, store.blocks.filter(b => params.includes(b.generated_content_draft_id)));
    if (sql.includes("FROM kai.generated_content_citations")) {
      const ids = Array.isArray(params[0]) ? params[0] : store.blocks.filter(b => params.includes(b.generated_content_draft_id)).map(b => b.generated_content_block_id);
      return select(sql, store.citations.filter(c => ids.includes(c.generated_content_block_id)));
    }
    if (sql.includes("FROM kai.review_queue_items") && !/queue_type = '(?:evidence_review|claim_review|client_followup|conflict_resolution)'/.test(sql)) {
      if (params.includes("export_review")) return { rows: [] };
      return select(sql, store.queues.filter(q => params.includes(q.target_object_id)));
    }
    if (sql.includes("JOIN kai.claim_evidence_links")) return { rows: fixtures.map(f => ({ claim_id: f.claimId, intake_sensitivity_profile_id: f.profileId, evidence_type: f.evidenceItemRow.evidence_type })) };
    if (sql.includes("source_role = 'reference'")) return { rows: [] };
    if (sql.includes("c.statement AS claim_statement")) return { rows: fixtures.map(f => ({ claim_id: f.claimId, claim_statement: f.claimRow.statement, claim_type: "finding", evidence_item_id: f.evidenceItemId,
      evidence_type: f.evidenceItemRow.evidence_type, internal_only: true, funder_use_allowed: false, public_use_allowed: false, source_id: f.sourceId, source_version_id: f.sourceVersionId,
      intake_file_id: f.candidateRow.intake_file_id, upload_state: "confirmed" })) };
    if (sql.includes("FROM kai.intake_sensitivity_profiles") && Array.isArray(params[1])) return { rows: fixtures.map(f => f.profileRow) };
    if (sql.includes("FROM kai.intake_sensitivity_review_decisions") && Array.isArray(params[1])) return { rows: fixtures.map(f => f.head) };
    if (sql.includes("FROM kai.engagements")) return { rows: [{ engagement_type: "impact_assessment" }] };
    if (sql.includes("FROM kai.source_measurement_definitions")) return { rows: [fixtures.find(f => f.row.source_measurement_definition_id === params[1]).row] };
    if (sql.includes("FROM kai.evidence_items") && Array.isArray(params[1])) return { rows: fixtures.filter(f => params[1].includes(f.evidenceItemId)).map(f => f.evidenceItemRow) };
    if (sql.includes("FROM kai.source_versions") && sql.includes("created_at, profile_canonical_sha256")) return { rows: [fixtures.find(f => f.sourceVersionId === params[1]).sourceVersionRow] };
    const f = fixtures.find(f => [f.claimId, f.evidenceItemId, f.sourceVersionId, f.profileId, ...Object.values(f.claimRow), ...Object.values(f.evidenceItemRow), ...Object.values(f.sourceVersionRow), ...Object.values(f.candidateRow), ...Object.values(f.locatorRow)].includes(params[1])) || fixtures[0];
    return f.tx.query(raw, params);
  } };
  const runInTransaction = async callback => {
    const snapshot = structuredClone(store);
    try { return await callback(tx); } catch (e) { Object.assign(store, snapshot); throw e; }
  };
  const evaluator = (tx, input) => evaluateClaimTraceabilityInTransaction(tx, input);
  const repository = createPostgresGeneratedContentRepository({ runInTransaction, evaluator });
  const reportRepository = createPostgresClientInternalReportRepository({ runInTransaction });
  const calls = [];
  const draftGenerator = createProductionImpactNarrativeDraftGenerator({ createMessage: async payload => {
    calls.push(payload);
    const claims = JSON.parse(payload.messages[0].content).claims;
    // This deterministic provider response discloses the actual limitations;
    // repository validation independently checks it before persistence.
    const blocks = claims.map((claim, index) => {
      const f = fixtures.find(f => f.claimId === claim.claimId);
      const disclosed = composeEvidenceSummaryMeasurementDisclosures({ blocks: [{ ordinal: index + 1, text: claim.claimStatement, citations: [{ claimId: claim.claimId, evidenceItemId: claim.evidenceItemId }] }], claims: [claim], measuredValueByClaimId: new Map([[claim.claimId, f.row.measured_value]]) });
      return disclosed.blocks[0];
    });
    return { content: [{ type: "text", text: JSON.stringify({ blocks }) }] };
  } });
  const input = { organizationId: ORG, engagementId: ENGAGEMENT, requestedAudience: "internal", claimIds: fixtures.map(f => f.claimId), idempotencyKey: "story-independent", actorContext: ACTOR, now: NOW };
  const dependencies = { env: ENV, generatedContentRepository: repository, draftGenerator,
    getEngagementForOrganization: async () => ({ organization_id: ORG, engagement_id: ENGAGEMENT }),
    // Fixtures already have the real pure P2-04 snapshot; do not invent another lifecycle.
    reconcileClaimGapsForGeneration: async () => null,
    metadataOnlyAudit: { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) },
  };
  return { fixtures, tx, store, calls, repository, reportRepository, input, dependencies, runInTransaction };
}

for (const kinds of [["count"], ["derived"], ["count", "derived"]]) {
  test(`assembled ${kinds.join("+")}: actual P2-06 → Impact Narrative service/adapter → saved detail → report/download → replay is flag independent`, async () => {
    const outcomes = [];
    for (const flag of FLAGS) {
      const h = assembled(flag, kinds);
      const result = await createImpactNarrativeDraft(h.input, h.dependencies);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(h.calls.length, 1);
      const draftId = result.data.generatedContentDraftId;
      assert.ok(h.store.drafts[0].validator_results.some(r => r.validator_key === STORY_SOURCE_NOTE_RESULT.validator_key));
      for (const f of h.fixtures) {
        const trace = await evaluateClaimTraceabilityInTransaction(h.tx, { organizationId: ORG, claimId: f.claimId, requestedAudience: "internal" });
        assert.equal(trace.ok, true, JSON.stringify(trace));
        assert.equal(R.validateTraceabilityData(trace.data, { claimId: f.claimId, requestedAudience: "internal" }), true, JSON.stringify(trace.data));
      }
      const report = await h.reportRepository.readInternalReport({ organizationId: ORG, generatedContentDraftId: draftId });
      assert.equal(report.ok, true, JSON.stringify(report)); assert.equal(report.data.available, true, JSON.stringify(report));
      const readDeps = { ...h.dependencies, internalReportRepository: h.reportRepository, readGeneratedDraftEngagementId: async () => ENGAGEMENT,
        organizationReviewRepository: { evaluate: async ({ packet }) => (await import("../Backend/kai/dictionary/postgresOrganizationInternalReviewRepository.js")).evaluateOrganizationInternalReviewInTransaction(h.tx, { organizationId: ORG, packet }),
          evaluateInternalReport: async ({ packet }) => (await import("../Backend/kai/dictionary/postgresOrganizationInternalReviewRepository.js")).evaluateInternalReportAvailabilityInTransaction(h.tx, { organizationId: ORG, packet }),
          readCompletedReviewer: async () => null } };
      const readInput = { organizationId: ORG, engagementId: ENGAGEMENT, generatedContentDraftId: draftId, actorContext: ACTOR };
      const detail = await getClientInternalDraft(readInput, readDeps);
      assert.equal(detail.ok, true, JSON.stringify(detail));
      const markdown = await getClientInternalReportMarkdown(readInput, readDeps);
      assert.equal(markdown.ok, true, JSON.stringify(markdown)); assert.ok(markdown.data.markdown.includes(STORY_SOURCE_NOTE));
      const replay = await createImpactNarrativeDraft(h.input, h.dependencies);
      assert.equal(replay.ok, true); assert.equal(replay.data.replayed, true); assert.equal(h.calls.length, 1);
      assert.deepEqual(result.warnings, storySourceWarnings()); assert.deepEqual(replay.warnings, result.warnings);
      // The same idempotency key also remains usable as the flag changes later.
      for (const f of h.fixtures) f.head.reviewed_story_testimonial_status = flag === "present" ? "unknown" : "present";
      const later = await createImpactNarrativeDraft(h.input, h.dependencies);
      assert.deepEqual(later, replay); assert.equal(h.calls.length, 1);
      const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
      sendServiceResult(res, result, 201);
      assert.equal(res.code, 201); assert.deepEqual(res.body.warnings, storySourceWarnings());
      outcomes.push({ result, detail, markdown, replay, provider: h.calls, stored: h.store.drafts[0].validator_results });
    }
    assert.deepEqual(outcomes[1], outcomes[0]); assert.deepEqual(outcomes[2], outcomes[0]);
  });
}

// Used by further cross-surface checks below; storage and provider seams remain synthetic.
export { assembled, ORG, ENGAGEMENT, ACTOR, ENV };

const METHODS = ["createEvidenceSummaryDraft", "createReadinessAssessmentDraft", "createDataGapMemoDraft", "createCaseForSupportDraft", "createBoardUpdateDraft", "createAnnualReportSectionDraft", "createFunderOutcomeTableDraft", "createGrantResponseParagraphDraft", "createFreeImpactAssessmentDraft"];
for (const method of METHODS) {
  test(`${method}: eligible selected findings, output, persisted validations and replay do not depend on any source story flag`, async () => {
    const outcomes = [];
    for (const flag of FLAGS) {
      const h = assembled(flag, ["count", "derived"]);
      let calls = 0;
      const generator = async input => {
        calls++;
        const blocks = input.claims.flatMap((claim, index) => {
          const citations = [{ claimId: claim.claimId, evidenceItemId: claim.evidenceItemId }];
          const f = h.fixtures[index];
          const codes = claim.limitationCodes;
          const disclosed = composeEvidenceSummaryMeasurementDisclosures({ blocks: [{ ordinal: index + 1, text: claim.claimStatement, citations }], claims: [{ ...claim, limitationCodes: codes }], measuredValueByClaimId: new Map([[claim.claimId, f.row.measured_value]]) }).blocks[0].text;
          return method === "createFreeImpactAssessmentDraft"
            ? ["executive_snapshot", "evidence_findings", "impact_stories"].map(section => ({ text: `[[assessment:${section}]]\n${disclosed}`, citations }))
            : [{ text: disclosed, citations }];
        });
        if (method === "createFreeImpactAssessmentDraft") {
          const order = { executive_snapshot: 0, evidence_findings: 1, impact_stories: 2 };
          blocks.sort((a, b) => order[/^\[\[assessment:([^\]]+)/.exec(a.text)[1]] - order[/^\[\[assessment:([^\]]+)/.exec(b.text)[1]]);
        }
        return { blocks: blocks.map((b, i) => ({ ordinal: i + 1, ...b })) };
      };
      const deps = { ...h.dependencies, draftGenerator: generator,
        authoritativeReadiness: { requirements: [{ requirement_key: "records", requirement_label: "Recorded information", assessed: false, assessment: null }] },
        authoritativeDataGaps: { items: [{ gap_log_item_id: "74000000-0000-4000-8000-000000000001", claim_id: h.fixtures[0].claimId, dimension_key: "requirement_alignment", assessment_status: "unresolved", validator_key: "VAL-KAI-P2-02-requirement_alignment" }] } };
      const result = await h.repository[method](h.input, deps);
      assert.equal(result.ok, true, `${method}/${flag}: ${JSON.stringify(result)}`);
      const replay = await h.repository[method](h.input, deps);
      assert.equal(replay.data.replayed, true); assert.equal(calls, 1);
      assert.deepEqual(new Set(result.data.blocks.flatMap(b => b.citations.map(c => c.claimId))), new Set(h.input.claimIds));
      outcomes.push({ result, replay, stored: h.store.drafts[0].validator_results });
    }
    assert.deepEqual(outcomes[1], outcomes[0]); assert.deepEqual(outcomes[2], outcomes[0]);
  });
}

test("review, coverage, organization release and final export authority decisions are flag independent; independent human release authority still governs", async () => {
  const outcomes = [];
  for (const flag of FLAGS) {
    const h = assembled(flag, ["count"]);
    const f = h.fixtures[0];
    const factual = await evaluateOrganizationFactualReviewInTransaction(h.tx, { organizationId: ORG, evidenceItemId: f.evidenceItemId });
    assert.equal(factual.organizationMayReview, true);
    const trace = await evaluateClaimTraceabilityInTransaction(h.tx, { organizationId: ORG, claimId: f.claimId, requestedAudience: "internal" });
    const coverage = await evaluateOrganizationCoverageAcceptanceInTransaction(h.tx, { organizationId: ORG,
      data: { ...trace.data, claim: { ...trace.data.claim, claim_strength: "reviewed_supported" }, evidence: { ...trace.data.evidence, support_strength: "reviewed_supported" } }, dimensionKey: "requirement_alignment" });
    assert.equal(coverage.organizationMayReview, true);
    const summary = await h.repository.createEvidenceSummaryDraft(h.input, { ...h.dependencies, draftGenerator: async input => {
      const c = input.claims[0]; return { blocks: [{ ordinal: 1, text: c.claimStatement, citations: [{ claimId: c.claimId, evidenceItemId: c.evidenceItemId }] }] };
    } });
    assert.equal(summary.ok, true, JSON.stringify(summary));
    const draftId = summary.data.generatedContentDraftId;
    Object.assign(h.store.queues[0], { queue_status: "resolved", review_status: "resolved" });
    const release = await evaluateOrganizationInternalReleaseInTransaction(h.tx, { organizationId: ORG, generatedContentDraftId: draftId });
    assert.equal(release.organizationMayRelease, true, JSON.stringify(release));
    const packet = await evaluateGeneratedDraftReviewPacketInTransaction(h.tx, { organizationId: ORG, generatedContentDraftId: draftId }, evaluateClaimTraceabilityInTransaction, { allowedLifecycleProfiles: GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES });
    assert.equal(packet.ok, true);
    const exportInput = { organizationId: ORG, exportCandidateId: "75000000-0000-4000-8000-000000000001", exportReviewQueueItemId: "76000000-0000-4000-8000-000000000001" };
    const exportWithAuthority = granted => evaluateFinalExportEligibilityInTransaction(h.tx, exportInput, {
      loadCandidate: async () => ({ generated_content_draft_id: draftId, requested_audience: "internal" }),
      evaluatePacket: async () => ({ ok: true, data: { draftStatus: packet.data.draftStatus, requestedExportAudience: "internal", currentUseEligible: packet.data.currentUseEligible,
        generatedContentReviewQueueStatus: packet.data.queueStatus, generatedContentReviewStatus: packet.data.reviewStatus, exportReviewQueueStatus: "resolved", exportReviewStatus: "resolved" } }),
      evaluateAuthorityEffectiveness: async () => ({ ok: true, data: { effective: granted, effectiveDecisionId: "77000000-0000-4000-8000-000000000001" } }),
    });
    const exported = await exportWithAuthority(true);
    assert.equal(exported.data.finalExportEligible, true);
    const noAuthority = await exportWithAuthority(false);
    assert.equal(noAuthority.data.finalExportEligible, false, "no source metadata can supply human authority");
    const renderModel = { renderModelContractVersion: "synthetic", exportCandidate: { contentType: "evidence_summary", requestedAudience: "internal" },
      content: { blocks: packet.data.blocks.map(b => ({ ordinal: b.ordinal, text: b.text, citationRefs: ["CIT-001"] })) },
      citations: [{ citationRef: "CIT-001", claimId: f.claimId, evidenceItemId: f.evidenceItemId, sourceId: f.sourceId, sourceVersionId: f.sourceVersionId }], limitations: [], methodNotes: { limitationEntries: [] } };
    const markdown = serializeExportManifestRenderModelToMarkdown(renderModel);
    assert.ok(markdown.includes(STORY_SOURCE_NOTE));
    outcomes.push({ factual, coverage, release, exported, noAuthority, markdown });
  }
  assert.deepEqual(outcomes[1], outcomes[0]); assert.deepEqual(outcomes[2], outcomes[0]);
});

test("saved historical story-only validator results and authority markers do not hold reports; independent saved failures and negative decisions remain effective", async () => {
  for (const flag of FLAGS) {
    const h = assembled(flag, ["count"]);
    const created = await createImpactNarrativeDraft(h.input, h.dependencies);
    assert.equal(created.ok, true);
    const draftId = created.data.generatedContentDraftId;
    h.store.drafts[0].validator_results = h.store.drafts[0].validator_results.filter(r => r.validator_key !== STORY_SOURCE_NOTE_RESULT.validator_key);
    h.store.drafts[0].validator_results.push({ validator_key: "VAL-GEN-010", severity: "blocker", blocking_reason: "count_only_content_boundary_exceeded", evidence: { limitationCodes: [LEGACY_STORY_LIMITATION_CODE], basis: "count_only_story_testimonial_present" } });
    const before = structuredClone(h.store);
    const report = await h.reportRepository.readInternalReport({ organizationId: ORG, generatedContentDraftId: draftId });
    assert.equal(report.ok, true); assert.equal(report.data.available, true);
    assert.deepEqual(h.store, before, "read projection never rewrites history");
    const originalText = h.store.blocks[0].text;
    h.store.blocks[0].text += ' One participant said "it changed my life".';
    const unsupportedHistorical = await h.reportRepository.readInternalReport({ organizationId: ORG, generatedContentDraftId: draftId });
    assert.equal(unsupportedHistorical.data.available, false, "retiring a source-only result never approves unsupported actual quotations");
    h.store.blocks[0].text = originalText;
    const replay = await createImpactNarrativeDraft(h.input, h.dependencies);
    assert.equal(replay.ok, true); assert.deepEqual(replay.warnings, storySourceWarnings());
    h.store.drafts[0].validator_results.push({ validator_key: "VAL-GEN-004", severity: "blocker", blocking_reason: "unsupported_numeric_or_causal_assertion" });
    const refused = await h.reportRepository.readInternalReport({ organizationId: ORG, generatedContentDraftId: draftId });
    assert.equal(refused.data.available, false); assert.ok(refused.data.blockedReasons.includes("validator_results_not_passed"));
    const negative = makeStoryEvidenceFixture({ flag, evidenceHead: { decision_outcome: "not_supported", decided_by_role: "gk_reviewer" } });
    const trace = await evaluateClaimTraceabilityInTransaction(negative.tx, { organizationId: ORG, claimId: negative.claimId, requestedAudience: "internal" });
    assert.equal(trace.data.eligible, false); assert.ok(trace.data.blockerCodes.includes("support_strength_unassessed"));
  }
});

test("actual quotations are checked against actual cited content, with identical severity for every flag and legacy marker", async () => {
  const { validateGeneratedContentDraft } = await import("../Backend/kai/validators/kaiGeneratedContentValidators.js");
  for (const flag of FLAGS) {
    const f = makeStoryEvidenceFixture({ flag });
    const claim = { claimId: f.claimId, evidenceItemId: f.evidenceItemId, claimStatement: "An authorized source says: welcome to the programme.", requestedAudience: "internal", revalidatedForGeneration: true, audienceAuthority: { internal: true }, limitationCodes: [LEGACY_STORY_LIMITATION_CODE] };
    const check = text => validateGeneratedContentDraft({ requestedAudience: "internal", generationClaims: [claim], blocks: [{ ordinal: 1, text, citations: [{ claimId: f.claimId, evidenceItemId: f.evidenceItemId }] }] });
    assert.equal(check('The source says "welcome to the programme".').ok, true);
    assert.equal(check('The report uses the heading "Our story".').ok, true, "storytelling presentation is not an attributed factual quotation");
    assert.ok(check('A participant said "it changed my life".').blockers.some(b => b.validator_key === "VAL-GEN-010" && b.blocking_reason === "unsupported_quotation"));
  }
});

test("authenticated HTTP Impact Narrative creation, saved read, download and replay carry the note for every flag; role denials stay independent", async t => {
  // Isolated test-process configuration only; restore the existing values.
  // The real route's feature gate remains active, exactly as other route specs.
  const previous = { KAI_SPRINT2_ENABLED: process.env.KAI_SPRINT2_ENABLED, KAI_GENERATION_ENABLED: process.env.KAI_GENERATION_ENABLED };
  process.env.KAI_SPRINT2_ENABLED = "true"; process.env.KAI_GENERATION_ENABLED = "true";
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const express = (await import("express")).default;
  const { once } = await import("node:events");
  const { default: router, __testables: routes } = await import("../Backend/kai/routes/sprint2IntakeApi.js");
  const { requireKaiSprint2Authenticated } = await import("../Backend/kai/middleware/kaiSprint2Authentication.js");
  for (const flag of FLAGS) {
    const h = assembled(flag, ["count", "derived"]);
    const readDeps = { ...h.dependencies, internalReportRepository: h.reportRepository, readGeneratedDraftEngagementId: async () => ENGAGEMENT,
      organizationReviewRepository: { evaluate: async ({ packet }) => (await import("../Backend/kai/dictionary/postgresOrganizationInternalReviewRepository.js")).evaluateOrganizationInternalReviewInTransaction(h.tx, { organizationId: ORG, packet }),
        evaluateInternalReport: async ({ packet }) => (await import("../Backend/kai/dictionary/postgresOrganizationInternalReviewRepository.js")).evaluateInternalReportAvailabilityInTransaction(h.tx, { organizationId: ORG, packet }),
        readCompletedReviewer: async () => null } };
    let actor = ACTOR;
    const restore = routes.setIntakeServiceForTest({
      createImpactNarrativeDraft: input => createImpactNarrativeDraft({ ...input, now: NOW }, h.dependencies),
      listClientGeneratedDrafts: () => assert.fail("not used"),
      getClientInternalDraft: input => getClientInternalDraft(input, readDeps),
      getClientInternalReportMarkdown: input => getClientInternalReportMarkdown(input, readDeps),
    });
    const app = express(); app.use(express.json());
    app.use((req, res, next) => { req.isAuthenticated = () => true; req.kaiSprint2ActorContext = actor; next(); });
    app.use("/api/kai/sprint2/intake", requireKaiSprint2Authenticated, router);
    const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
    try {
      const base = `http://127.0.0.1:${server.address().port}/api/kai/sprint2/intake/admin/organizations/${ORG}`;
      const generate = () => fetch(`${base}/generated-content-drafts/impact-narrative`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ claim_ids: h.input.claimIds, engagement_id: ENGAGEMENT, idempotency_key: "story-http" }) });
      const response = await generate(); const body = await response.json();
      assert.equal(response.status, 201, JSON.stringify(body)); assert.deepEqual(body.warnings, storySourceWarnings());
      const path = `${base}/engagements/${ENGAGEMENT}/client-internal-drafts/${body.data.generatedContentDraftId}`;
      const read = await fetch(path); const detail = await read.json();
      assert.equal(read.status, 200, JSON.stringify(detail)); assert.deepEqual(detail.warnings, storySourceWarnings());
      const download = await fetch(`${path}/markdown`);
      assert.equal(download.status, 200); assert.ok((await download.text()).includes(STORY_SOURCE_NOTE));
      assert.equal(download.headers.get("x-kai-information"), STORY_SOURCE_NOTE);
      const replay = await generate(); const replayed = await replay.json();
      assert.equal(replay.status, 201); assert.equal(replayed.data.replayed, true); assert.deepEqual(replayed.warnings, body.warnings); assert.equal(h.calls.length, 1);
      actor = { ...ACTOR, organizationMemberships: [{ ...ACTOR.organizationMemberships[0], role_name: "client_contributor" }] };
      assert.equal((await generate()).status, 403); assert.equal((await fetch(`${path}/markdown`)).status, 403); assert.equal(h.calls.length, 1);
    } finally { restore(); await new Promise(resolve => server.close(resolve)); }
  }
});

test("download presentation: PDF and DOCX contain the note; the CSV attachment carries it without changing its evidence-table contract", async () => {
  const { serializeExportManifestRenderModelToPdf } = await import("../Backend/kai/services/kaiExportManifestPdfSerializer.js");
  const { serializeExportManifestRenderModelToDocx } = await import("../Backend/kai/services/kaiExportManifestDocxSerializer.js");
  const { serializeExportManifestRenderModelToCsv } = await import("../Backend/kai/services/kaiExportManifestCsvSerializer.js");
  const { __testables: routes } = await import("../Backend/kai/routes/sprint2IntakeApi.js");
  const JSZip = (await import("jszip")).default;
  const mupdf = await import("mupdf"); mupdf.setLog(null);
  const models = [];
  for (const flag of FLAGS) {
    const f = makeStoryEvidenceFixture({ flag });
    const model = { renderModelContractVersion: "synthetic", exportCandidate: { contentType: "impact_narrative", requestedAudience: "internal" },
      content: { blocks: [{ ordinal: 1, text: f.claimRow.statement, citationRefs: ["CIT-001"] }] }, citations: [], limitations: [], methodNotes: { limitationEntries: [] } };
    const pdf = await serializeExportManifestRenderModelToPdf(model);
    const document = mupdf.Document.openDocument(pdf, "application/pdf");
    const texts = [];
    for (let i = 0; i < document.countPages(); i++) { const page = document.loadPage(i); const text = page.toStructuredText(); texts.push(text.asText()); text.destroy(); page.destroy(); }
    document.destroy();
    assert.ok(texts.join(" ").replace(/\s+/g, " ").includes(STORY_SOURCE_NOTE));
    const zip = await JSZip.loadAsync(await serializeExportManifestRenderModelToDocx(model));
    const xml = await zip.file("word/document.xml").async("string");
    assert.ok(xml.includes(STORY_SOURCE_NOTE));
    const csv = serializeExportManifestRenderModelToCsv(model);
    const headers = {};
    const res = { status(code) { this.code = code; return this; }, setHeader(key, value) { headers[key] = value; }, send(value) { this.body = value; } };
    routes.sendCsvAttachment(res, { ok: true, data: { csv } });
    assert.equal(res.code, 200); assert.equal(res.body, csv); assert.equal(headers["X-KAI-Information"], STORY_SOURCE_NOTE);
    models.push({ text: texts.join(" "), xml, csv });
  }
  assert.deepEqual(models[1], models[0]); assert.deepEqual(models[2], models[0]);
});

test("production Evidence Summary adapter: mixed count and derived findings retain the independent measurement prompt and pass all validators for every story value", async () => {
  const { createEvidenceSummaryDraft } = await import("../Backend/kai/services/kaiGeneratedContentService.js");
  const { createProductionEvidenceSummaryDraftGenerator } = await import("../Backend/kai/services/kaiEvidenceSummaryDraftGenerator.js");
  const outcomes = [];
  for (const flag of FLAGS) {
    const h = assembled(flag, ["count", "derived"]);
    const calls = [];
    const generator = createProductionEvidenceSummaryDraftGenerator({ createMessage: async payload => {
      calls.push(payload);
      assert.match(payload.system, /a numerically higher follow-up value is not an improvement/);
      assert.match(payload.system, /never extend a result beyond its comparable pairs or measured population/);
      return { content: [{ type: "text", text: JSON.stringify({ blocks: JSON.parse(payload.messages[0].content).claims.map(c => ({ text: c.claimStatement, citations: [{ claimId: c.claimId, evidenceItemId: c.evidenceItemId }] })) }) }] };
    } });
    const result = await createEvidenceSummaryDraft(h.input, { ...h.dependencies, draftGenerator: generator });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(calls.length, 1);
    assert.equal(result.data.blocks.length, 2);
    assert.deepEqual(result.warnings, storySourceWarnings());
    outcomes.push({ result, calls });
  }
  assert.deepEqual(outcomes[1], outcomes[0]); assert.deepEqual(outcomes[2], outcomes[0]);
});
