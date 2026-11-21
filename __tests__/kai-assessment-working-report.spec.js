import test from "node:test";
import assert from "node:assert/strict";

import {
  ADAPTATION_MODEL_INSTRUCTION,
  ADAPTATION_PURPOSE_TARGETS,
  composeAssessmentAdaptation,
  parseSavedAssessment,
  reusableAssessmentProse,
  savedContentSha256,
  splitRevisableBlockText,
} from "../Backend/kai/services/kaiAssessmentAdaptation.js";
import { withAssessmentSection } from "../Backend/kai/services/kaiFreeImpactAssessmentComposition.js";
import {
  __generatedContentRepositoryTestables,
  fingerprintAssessmentAdaptationRequest,
  fingerprintWorkingReportRevision,
} from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";
import { revisedFigureContextViolations } from "../Backend/kai/validators/kaiGeneratedContentValidators.js";
import { createAssessmentAdaptationDraft } from "../Backend/kai/services/kaiGeneratedContentService.js";
import { reviseClientWorkingReport } from "../Backend/kai/services/kaiClientGeneratedContentService.js";
import { createProductionEvidenceSummaryDraftGenerator } from "../Backend/kai/services/kaiEvidenceSummaryDraftGenerator.js";
import { createProductionBoardUpdateDraftGenerator } from "../Backend/kai/services/kaiBoardUpdateDraftGenerator.js";
import { createProductionAnnualReportSectionDraftGenerator } from "../Backend/kai/services/kaiAnnualReportSectionDraftGenerator.js";
import { assessmentAdaptationPath, clientWorkingReportRevisionPath, projectClientInternalDraft, projectWorkingReportContext } from "../frontend/impactEvidenceLibraryLogic.js";
import {
  ADAPTATION_PURPOSE_OPTIONS,
  adaptationFailureMessage,
  revisionFailureMessage,
  withheldAssessmentMessage,
  workingReportDownloadName,
  workingReportLabel,
} from "../frontend/knowledgeStudio/clientEvidenceWorkflowLogic.js";

/**
 * Owner direction 2026-11-20 ("Use this assessment" and the organization's
 * working reports): the pure rules of adapting a saved Free Impact Assessment
 * and revising a saved report, the service admission of both operations, the
 * generator boundary that receives the saved assessment, and the browser
 * projections. The persisted journey (PostgreSQL, HTTP, browser) is proven by
 * the Project B document-evidence acceptance, scenario J.
 */

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = id(1);
const PROJECT = id(2);
const ASSESSMENT = id(3);
const C1 = { claimId: id(11), evidenceItemId: id(111) };
const C2 = { claimId: id(12), evidenceItemId: id(112) };
const C3 = { claimId: id(13), evidenceItemId: id(113) };
const DISCLOSURE = "Measurement disclosure for the cited measurement: values come from the organization's records and were not independently verified.";

function savedAssessmentBlocks() {
  return [
    { ordinal: 1, text: withAssessmentSection("executive_snapshot", "The programme reached people and recorded ratings."), citations: [C1, C2] },
    { ordinal: 2, text: withAssessmentSection("evidence_findings", `Reach: 67 distinct people received a completed service. ${DISCLOSURE}`), citations: [C1] },
    { ordinal: 3, text: withAssessmentSection("evidence_findings", `Confidence: 15 of 36 comparable participants gave a higher rating. ${DISCLOSURE}`), citations: [C2] },
    { ordinal: 4, text: withAssessmentSection("impact_stories", "The review reports that staff estimate at least 90 different people took part."), citations: [C3] },
    { ordinal: 5, text: withAssessmentSection("gaps_opportunities", "Documented gaps in the cited evidence:\n- Follow-up covers a subset. Selection note: one finding was left out."), citations: [C2] },
    { ordinal: 6, text: withAssessmentSection("recommended_improvements", "Proposed change: Set one follow-up point. Basis: a subset. What it could show: a defined group."), citations: [C2] },
    { ordinal: 7, text: withAssessmentSection("next_steps", "- Decide which proposed change to try first."), citations: [C3] },
  ];
}

test("the saved assessment is parsed from its persisted blocks; any other draft is not an assessment", () => {
  const parsed = parseSavedAssessment(savedAssessmentBlocks());
  assert.ok(parsed);
  assert.deepEqual(parsed.claimIds, [C1.claimId, C2.claimId, C3.claimId]);
  assert.equal(parsed.contentSha256, savedContentSha256(savedAssessmentBlocks()));
  assert.notEqual(parsed.contentSha256, savedContentSha256(savedAssessmentBlocks().map((block) => (block.ordinal === 2 ? { ...block, text: `${block.text} ` } : block))),
    "any change to saved text changes the fingerprint");
  assert.equal(parseSavedAssessment([{ ordinal: 1, text: "A plain evidence summary.", citations: [C1] }]), null);
});

test("adaptation reuses each saved block whose findings are usable now, without server disclosures or notes, and names every withheld block", () => {
  const parsed = parseSavedAssessment(savedAssessmentBlocks());
  const source = { draftId: ASSESSMENT, generationRunId: id(4), engagementId: PROJECT, contentSha256: parsed.contentSha256, sections: parsed.sections };
  // C3 (the document statement) is no longer usable, for example its source's AI processing was withdrawn.
  const { context, lineage } = composeAssessmentAdaptation({ source, admittedClaimIds: new Set([C1.claimId, C2.claimId]), purpose: "funder_report" });
  const reused = context.sourceAssessment.sections.flatMap((section) => section.blocks.map((block) => block.text));
  assert.ok(reused.includes("Reach: 67 distinct people received a completed service."), "prose kept, disclosure removed");
  assert.ok(reused.includes("Documented gaps in the cited evidence:\n- Follow-up covers a subset."), "selection note removed");
  assert.ok(reused.includes("Proposed change: Set one follow-up point. Basis: a subset. What it could show: a defined group."));
  assert.ok(!reused.some((text) => text.includes("90 different people")), "a block citing an unusable finding is never sent");
  assert.deepEqual(lineage.withheld_blocks, [
    { ordinal: 4, section_key: "impact_stories", reason: "cites_finding_not_currently_usable" },
    { ordinal: 7, section_key: "next_steps", reason: "cites_finding_not_currently_usable" },
  ]);
  assert.deepEqual(lineage.reused_block_ordinals, [1, 2, 3, 5, 6]);
  assert.deepEqual([lineage.relationship, lineage.reporting_purpose, lineage.version, lineage.source_assessment_draft_id, lineage.source_assessment_content_sha256],
    ["assessment_adaptation", "funder_report", 1, ASSESSMENT, parsed.contentSha256]);
  assert.equal(lineage.guidance_sha256, null);
  // An explicit selection withholds blocks citing anything outside it.
  const selected = composeAssessmentAdaptation({ source, admittedClaimIds: new Set([C1.claimId, C2.claimId, C3.claimId]), purpose: "board_update", selectedClaimIds: [C2.claimId], guidance: "Board focus." });
  assert.deepEqual(selected.context.sourceAssessment.sections.map((section) => section.key), ["evidence_findings", "gaps_opportunities", "recommended_improvements"]);
  assert.ok(selected.lineage.withheld_blocks.every((block) => block.reason === "cites_finding_not_selected"));
  assert.match(selected.lineage.guidance_sha256, /^[0-9a-f]{64}$/);
  assert.equal(reusableAssessmentProse(`Text. ${DISCLOSURE}`), "Text.");
});

test("purposes map onto the existing generators and audiences only; the generator input contract admits exactly the saved-assessment context", () => {
  assert.deepEqual(ADAPTATION_PURPOSE_TARGETS, {
    internal_planning: { contentType: "evidence_summary", requestedAudience: "internal", label: "Internal planning" },
    board_update: { contentType: "board_update", requestedAudience: "internal", label: "Board report" },
    funder_report: { contentType: "evidence_summary", requestedAudience: "funder", label: "Funder report" },
    annual_report: { contentType: "annual_report_section", requestedAudience: "public", label: "Annual-report content" },
  });
  const { validateGeneratorInput } = __generatedContentRepositoryTestables;
  const claim = (c) => ({ claimId: c.claimId, claimStatement: "Reach: 67 distinct people.", claimType: "finding", evidenceItemId: c.evidenceItemId, sourceId: id(21), sourceVersionId: id(22), limitationCodes: [] });
  const adaptation = { purpose: "funder_report", sourceAssessment: { title: "Free Impact Assessment", sections: [{ key: "evidence_findings", title: "What Your Evidence Tells Us", blocks: [{ text: "Reach.", claimIds: [C1.claimId] }] }] }, guidance: null, notReused: [] };
  const input = { contentType: "evidence_summary", requestedAudience: "funder", claims: [claim(C1)], adaptation };
  assert.equal(validateGeneratorInput(input), true);
  assert.equal(validateGeneratorInput({ ...input, requestedAudience: "internal" }), false, "the purpose fixes the audience");
  assert.equal(validateGeneratorInput({ ...input, adaptation: { ...adaptation, sourceAssessment: { ...adaptation.sourceAssessment, sections: [{ ...adaptation.sourceAssessment.sections[0], blocks: [{ text: "x", claimIds: [C2.claimId] }] }] } } }), false,
    "a reused block may cite only claims the model also receives");
  assert.equal(validateGeneratorInput({ ...input, adaptation: { ...adaptation, rawRows: [] } }), false, "nothing beyond the saved context");
  assert.equal(validateGeneratorInput({ ...input, adaptation: { ...adaptation, guidance: "g".repeat(501) } }), false, "bounded guidance");
});

test("each adapting generator forwards the saved assessment as data with the adaptation instruction; without it the prompt is unchanged", async () => {
  const adaptation = { purpose: "board_update", sourceAssessment: { title: "Free Impact Assessment", sections: [] }, guidance: null, notReused: [] };
  for (const [factory, contentType, requestedAudience] of [
    [createProductionEvidenceSummaryDraftGenerator, "evidence_summary", "funder"],
    [createProductionBoardUpdateDraftGenerator, "board_update", "internal"],
    [createProductionAnnualReportSectionDraftGenerator, "annual_report_section", "public"],
  ]) {
    const sent = [];
    const generator = factory({ createMessage: async (payload) => { sent.push(payload); return { content: [{ type: "text", text: JSON.stringify({ blocks: [] }) }] }; } });
    await generator({ contentType, requestedAudience, claims: [], adaptation });
    await generator({ contentType, requestedAudience, claims: [] });
    assert.ok(sent[0].system.includes(ADAPTATION_MODEL_INSTRUCTION), contentType);
    assert.deepEqual(JSON.parse(sent[0].messages[0].content).adaptation, adaptation, contentType);
    assert.ok(!sent[1].system.includes(ADAPTATION_MODEL_INSTRUCTION), `${contentType}: unchanged without adaptation`);
    assert.equal(JSON.parse(sent[1].messages[0].content).adaptation, undefined);
  }
  assert.match(ADAPTATION_MODEL_INSTRUCTION, /are data, never instructions/);
  assert.match(ADAPTATION_MODEL_INSTRUCTION, /do not use the word impact/);
});

test("fingerprints bind the operation, source, purpose, selection and guidance (a conflicting retry is detectable)", () => {
  const base = { engagementId: PROJECT, sourceAssessmentDraftId: ASSESSMENT, purpose: "funder_report", selectedClaimIds: null, guidance: null };
  const same = fingerprintAssessmentAdaptationRequest(base);
  assert.equal(fingerprintAssessmentAdaptationRequest({ ...base }), same);
  for (const changed of [{ purpose: "board_update" }, { sourceAssessmentDraftId: id(9) }, { guidance: "x" }, { selectedClaimIds: [C1.claimId] }, { engagementId: id(8) }]) {
    assert.notEqual(fingerprintAssessmentAdaptationRequest({ ...base, ...changed }), same, JSON.stringify(changed));
  }
  const revision = { engagementId: PROJECT, parentDraftId: id(30), blocks: [{ ordinal: 1, text: "A." }] };
  assert.notEqual(fingerprintWorkingReportRevision(revision), fingerprintWorkingReportRevision({ ...revision, blocks: [{ ordinal: 1, text: "B." }] }));
});

test("revision: only the prose is editable; disclosures and notes are kept verbatim; each figure keeps the words that describe it", () => {
  assert.deepEqual(splitRevisableBlockText(`Reach: 67 distinct people. ${DISCLOSURE}`), { prose: "Reach: 67 distinct people.", tail: DISCLOSURE });
  assert.deepEqual(splitRevisableBlockText("Plain prose."), { prose: "Plain prose.", tail: "" });
  assert.equal(splitRevisableBlockText("Text. Selection note: left out.").tail, "Selection note: left out.");
  assert.equal(splitRevisableBlockText("Text. Reuse note: some content.").tail, "Reuse note: some content.");
  const references = ["Eligible encounters: 190 completed service encounters (encounters, not people).", "67 distinct people on the participant register received at least one completed service."];
  assert.deepEqual(revisedFigureContextViolations("The programme delivered 190 completed service encounters.", references), []);
  assert.deepEqual(revisedFigureContextViolations("We reached 67 distinct people.", references), []);
  assert.deepEqual(revisedFigureContextViolations("We served 190 people.", references), ["190"], "encounters are not people");
  assert.deepEqual(revisedFigureContextViolations("67 households received a service.", references), ["67"], "people are not households");
  assert.deepEqual(revisedFigureContextViolations("We served 999 people.", references), [], "a figure in no reference is VAL-GEN-004's to refuse");
});

const ENV = { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" };
function memberActor(roleName, { organizationId = ORG, actorType = "human" } = {}) {
  return {
    actorType, actorUserId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", kaiUserStatus: "active", kaiRoles: [], platformSuperuser: false,
    organizationMemberships: [{ organization_id: organizationId, role_name: roleName, membership_status: "active" }],
  };
}

test("Use this assessment: admitted for the organization's administrator; other roles, organizations, non-human actors and disabled flags are refused before any read", async () => {
  const calls = [];
  const repository = {
    async readWorkingReportLineage() { calls.push("lineage"); return { ok: false, error: { code: "not_found" } }; },
    async createAssessmentAdaptationDraft(input) { calls.push(["adapt", input.purpose]); return { ok: true, data: { generatedContentDraftId: id(50) } }; },
  };
  const input = (overrides = {}) => ({
    organizationId: ORG, engagementId: PROJECT, sourceAssessmentDraftId: ASSESSMENT, purpose: "funder_report", selectedClaimIds: null, guidance: null,
    idempotencyKey: "use-assessment-1", actorContext: memberActor("client_admin"), now: "2026-11-20T12:00:00.000Z", ...overrides,
  });
  const deps = (extra = {}) => ({ env: ENV, generatedContentRepository: repository, getEngagementForOrganization: async () => ({ organization_id: ORG, engagement_id: PROJECT }), ...extra });
  const admitted = await createAssessmentAdaptationDraft(input(), deps());
  assert.equal(admitted.ok, true, JSON.stringify(admitted));
  assert.deepEqual(calls.at(-1), ["adapt", "funder_report"]);
  for (const [label, overrides, extra, code] of [
    ["client_contributor", { actorContext: memberActor("client_contributor") }, {}, "authorization_denied"],
    ["client_reviewer", { actorContext: memberActor("client_reviewer") }, {}, "authorization_denied"],
    ["another organization's administrator", { actorContext: memberActor("client_admin", { organizationId: id(99) }) }, {}, "authorization_denied"],
    ["assistant actor", { actorContext: memberActor("client_admin", { actorType: "assistant" }) }, {}, "authorization_denied"],
    ["system actor", { actorContext: memberActor("client_admin", { actorType: "system" }) }, {}, "authorization_denied"],
    ["another organization's Project", {}, { getEngagementForOrganization: async () => null }, "tenant_boundary_violation"],
    ["generation disabled", {}, { env: { KAI_SPRINT2_ENABLED: "true" } }, "feature_disabled"],
    ["Sprint 2 disabled", {}, { env: {} }, "feature_disabled"],
  ]) {
    const before = calls.length;
    const refused = await createAssessmentAdaptationDraft(input(overrides), deps(extra));
    assert.equal(refused.error?.code, code, `${label}: ${JSON.stringify(refused.error)}`);
    assert.equal(calls.length, before, `${label}: nothing read or written`);
  }
});

test("revision: admitted for the organization's administrator of this Project's draft; other roles, Projects, organizations, non-human actors and disabled flags are refused before any write", async () => {
  const calls = [];
  const repository = {
    async createWorkingReportRevision(input) { calls.push(input); return { ok: true, data: { generatedContentDraftId: id(60), requestedAudience: "funder", lineage: { relationship: "organization_revision", version: 2, parent_draft_id: id(40) }, replayed: false, blocks: [{}] } }; },
  };
  const input = (overrides = {}) => ({
    organizationId: ORG, engagementId: PROJECT, generatedContentDraftId: id(40), blocks: [{ ordinal: 1, text: "Revised." }],
    idempotencyKey: "revise-1", actorContext: memberActor("client_admin"), ...overrides,
  });
  const deps = (extra = {}) => ({
    env: ENV, generatedContentRepository: repository, metadataOnlyAudit: {},
    getEngagementForOrganization: async () => ({ organization_id: ORG, engagement_id: PROJECT }),
    readGeneratedDraftEngagementId: async () => PROJECT, ...extra,
  });
  const saved = await reviseClientWorkingReport(input(), deps());
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.deepEqual([saved.data.generatedContentDraftId, saved.data.lineage.version, saved.data.lineage.parentDraftId, saved.data.lineage.revisedByOrganization], [id(60), 2, id(40), true]);
  assert.equal(calls[0].parentDraftId, id(40));
  for (const [label, overrides, extra, code] of [
    ["client_contributor", { actorContext: memberActor("client_contributor") }, {}, "authorization_denied"],
    ["gk_reviewer", { actorContext: memberActor("gk_reviewer") }, {}, "authorization_denied"],
    ["another organization's administrator", { actorContext: memberActor("client_admin", { organizationId: id(99) }) }, {}, "authorization_denied"],
    ["assistant actor", { actorContext: memberActor("client_admin", { actorType: "assistant" }) }, {}, "authorization_denied"],
    ["a draft of another Project", {}, { readGeneratedDraftEngagementId: async () => id(77) }, "not_found"],
    ["generation disabled", {}, { env: { KAI_SPRINT2_ENABLED: "true" } }, "feature_disabled"],
    ["malformed draft id", { generatedContentDraftId: "not-a-uuid" }, {}, "validation_blocker"],
  ]) {
    const before = calls.length;
    const refused = await reviseClientWorkingReport(input(overrides), deps(extra));
    assert.equal(refused.error?.code, code, `${label}: ${JSON.stringify(refused.error)}`);
    assert.equal(calls.length, before, `${label}: nothing written`);
  }
});

test("browser projections: the saved relationship, purpose labels, download names and refusal messages; malformed values fail closed", () => {
  assert.equal(assessmentAdaptationPath(ORG, ASSESSMENT), `/api/kai/sprint2/intake/admin/organizations/${ORG}/generated-content-drafts/${ASSESSMENT}/assessment-adaptations`);
  assert.match(clientWorkingReportRevisionPath(ORG, PROJECT, id(40)), /\/client-internal-drafts\/0{8}-0{4}-4000-8000-0{10}40\/revisions$/);
  assert.deepEqual(ADAPTATION_PURPOSE_OPTIONS.map((option) => option.purpose), ["internal_planning", "board_update", "funder_report", "annual_report"]);
  const context = projectWorkingReportContext({ isAssessment: false, relationship: "organization_revision", purpose: "funder_report", version: 2,
    sourceAssessmentDraftId: ASSESSMENT, parentDraftId: id(40), revisedByOrganization: true, revisedBlockOrdinals: [1], withheldAssessmentBlocks: [{ ordinal: 4, sectionKey: "impact_stories", reason: "cites_finding_not_currently_usable" }] });
  assert.equal(workingReportLabel({ contentType: "evidence_summary", audience: "funder", report: context }), "Funder report · version 2");
  assert.equal(workingReportLabel({ contentType: "evidence_summary", audience: "internal", report: { isAssessment: true } }), "Free Impact Assessment");
  assert.equal(workingReportLabel({ contentType: "board_update", audience: "internal", report: null }), "Board update");
  assert.equal(workingReportDownloadName({ contentType: "evidence_summary", audience: "funder", report: context }), "kai-funder-report-version-2.md");
  assert.match(withheldAssessmentMessage(context), /^One passage of the assessment was not reused, because it cites a finding that is no longer usable/);
  assert.equal(projectWorkingReportContext({ purpose: "press_release", version: -1, sourceAssessmentDraftId: "x" }).purpose, null);
  assert.equal(projectWorkingReportContext(null), null);
  const figure = { statusCode: 422, body: { blockers: [{ blocking_reason: "revision_figure_context_changed", evidence: { block_ordinals: [3] } }] } };
  assert.match(revisionFailureMessage(figure, "fallback"), /figure no longer keeps the words that describe it .*\(passage 3\)/);
  assert.equal(revisionFailureMessage({ statusCode: 500, body: {} }, "fallback"), "fallback");
  assert.match(adaptationFailureMessage({ statusCode: 409, body: { error: { code: "duplicate_conflict" } } }, "fallback"), /already used for a different report/);
  const detail = projectClientInternalDraft({
    generatedContentDraftId: id(40), contentType: "evidence_summary", audience: "funder", reviewState: "awaiting_get_kinder_review", citedClaimsCurrentlyEligible: false,
    limitations: ["not_approved_for_external_use"], blocks: [{ ordinal: 1, text: "A.", supportingClaimIds: [C1.claimId] }],
    report: context, historical: { reason: "source_changed_since_saved", savedAt: "2026-11-20T00:00:00.000Z" }, revisable: true,
    editableBlocks: [{ ordinal: 1, prose: "A.", protectedText: null }],
    internalReport: { available: true, getKinderReviewReasons: [], blockedReasons: [], informationReasons: [] },
  });
  assert.deepEqual([detail.audience, detail.report.version, detail.historical.reason, detail.revisable, detail.editableBlocks.length], ["funder", 2, "source_changed_since_saved", true, 1]);
  assert.equal(projectClientInternalDraft({ ...detail, audience: "press" }), null, "an unknown audience fails closed");
});

test("every server-composed working-report note passes the same wording rules as model text (no digits, causal or verification words)", async () => {
  const { ADAPTATION_NOT_REUSED_NOTE } = await import("../Backend/kai/services/kaiAssessmentAdaptation.js");
  const { ASSESSMENT_SELECTION_NOTE, unsupportedAssertionViolations } = await import("../Backend/kai/validators/kaiGeneratedContentValidators.js");
  const claim = { claimId: C1.claimId, evidenceItemId: C1.evidenceItemId, claimStatement: "Source-reported, not independently verified (line 2): \"Sessions were held.\"", limitationCodes: [] };
  for (const note of [ADAPTATION_NOT_REUSED_NOTE, ASSESSMENT_SELECTION_NOTE]) {
    assert.deepEqual(unsupportedAssertionViolations({ blocks: [{ ordinal: 1, text: `Sessions were held. ${note}`, citations: [C1] }], generationClaims: [claim] }), [], note);
    assert.doesNotMatch(note, /\d/);
  }
});
