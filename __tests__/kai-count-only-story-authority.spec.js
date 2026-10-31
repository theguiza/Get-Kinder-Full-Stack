import test from "node:test";
import assert from "node:assert/strict";

import {
  COUNT_ONLY_CONTENT_TYPE,
  COUNT_ONLY_LIMITATION_CODE,
  COUNT_ONLY_OPERATION_REASON,
  ORDINARY_AUTHORITY_BASIS,
  attachOrdinaryInternalAuthority,
  classifySourceDecision,
  isCountOnlyStoryTestimonialSource,
  ordinaryInternalAuthorityOf,
  recordedSourcePermissions,
} from "../Backend/kai/dictionary/postgresOrdinaryInternalFactAuthority.js";
import { countOnlyBlockViolations, validateGeneratedContentDraft } from "../Backend/kai/validators/kaiGeneratedContentValidators.js";
import { createProductionEvidenceSummaryDraftGenerator } from "../Backend/kai/services/kaiEvidenceSummaryDraftGenerator.js";
import { serializeInternalReportToMarkdown } from "../Backend/kai/services/kaiInternalReportMarkdownSerializer.js";
import { CLIENT_INTERNAL_REPORT_REASONS } from "../frontend/impactEvidenceLibraryLogic.js";
import { INTERNAL_REPORT_REASON_MESSAGES } from "../frontend/knowledgeStudio/clientEvidenceWorkflowLogic.js";
import { COUNT_ONLY_RULE_TEXT, projectOrganizationFactualReview } from "../frontend/knowledgeStudio/clientMeasuredClaimReviewLogic.js";

/**
 * Count-only internal authority for a story-present source (owner prompt
 * 2026-10-30): the pure contracts. The source verdict admits only a recorded
 * 'present' story/testimonial category with every other category absent and
 * use and AI processing permitted; VAL-GEN-010 bounds what a block citing
 * such a claim may say; the model prompt and the report carry the count only.
 * The connected PostgreSQL/browser proof is case I of
 * kai-customer-xlsx-file-to-report-browser-acceptance.integration.spec.js.
 */
const CLAIM = "c0000000-0000-4000-8000-000000000001";
const EVIDENCE = "e0000000-0000-4000-8000-000000000001";
const SOURCE = "b0000000-0000-4000-8000-000000000001";
const VERSION = "70000000-0000-4000-8000-000000000001";

const STORY_PRESENT = Object.freeze({
  decision_outcome: "reviewed", reviewed_allowed_use_status: "allowed", reviewed_llm_processing_allowed: true,
  reviewed_personal_data_status: "absent", reviewed_minor_data_status: "absent", reviewed_health_housing_justice_immigration_status: "absent",
  reviewed_indigenous_governance_status: "absent", reviewed_story_testimonial_status: "present", reviewed_small_cell_risk_status: "absent",
});
const source = (decision, { current = true } = {}) => {
  const classified = classifySourceDecision(decision);
  return {
    getKinderReviewReasons: classified.getKinderReviewReasons,
    blockedReasons: current ? classified.blockedReasons : ["source_version_not_current", ...classified.blockedReasons],
    recorded: recordedSourcePermissions(decision),
  };
};

test("source verdict: only a recorded 'present' story/testimonial category, with every other condition ordinary, is a count-only source", () => {
  assert.equal(isCountOnlyStoryTestimonialSource(source(STORY_PRESENT)), true);
  const refused = {
    "story unknown": { ...STORY_PRESENT, reviewed_story_testimonial_status: "unknown" },
    "story absent (the all-absent basis instead)": { ...STORY_PRESENT, reviewed_story_testimonial_status: "absent" },
    "minors present": { ...STORY_PRESENT, reviewed_minor_data_status: "present" },
    "personal information unknown": { ...STORY_PRESENT, reviewed_personal_data_status: "unknown" },
    "small-cell risk present": { ...STORY_PRESENT, reviewed_small_cell_risk_status: "present" },
    "internal use not allowed": { ...STORY_PRESENT, reviewed_allowed_use_status: "not_allowed" },
    "AI processing denied": { ...STORY_PRESENT, reviewed_llm_processing_allowed: false },
    "review not complete": { ...STORY_PRESENT, decision_outcome: "deferred" },
  };
  for (const [label, decision] of Object.entries(refused)) assert.equal(isCountOnlyStoryTestimonialSource(source(decision)), false, label);
  assert.equal(isCountOnlyStoryTestimonialSource(source(STORY_PRESENT, { current: false })), false, "stale source version");
  assert.equal(isCountOnlyStoryTestimonialSource(source(null)), false, "no decision");
  // The recorded category and the shared classification are unchanged: every other operation still sees the reason.
  assert.deepEqual(classifySourceDecision(STORY_PRESENT), { getKinderReviewReasons: ["story_testimonial_not_cleared"], blockedReasons: [] });
  assert.equal(recordedSourcePermissions(STORY_PRESENT).categories.reviewed_story_testimonial_status, "present");
});

test("P2-06 side channel: the basis travels out of band and leaves exact-key DTO contracts and JSON untouched", () => {
  const data = { eligible: true, blockerCodes: [] };
  attachOrdinaryInternalAuthority(data, { basis: ORDINARY_AUTHORITY_BASIS.COUNT_ONLY_STORY_TESTIMONIAL_PRESENT, reliedOn: true });
  assert.deepEqual(Object.keys(data), ["eligible", "blockerCodes"]);
  assert.equal(JSON.stringify(data), '{"eligible":true,"blockerCodes":[]}');
  assert.deepEqual({ ...ordinaryInternalAuthorityOf(data) }, { basis: "count_only_story_testimonial_present", reliedOn: true });
  assert.equal(ordinaryInternalAuthorityOf({ ...data }), null, "a copy carries no authority");
  assert.equal(ordinaryInternalAuthorityOf(null), null);
  assert.equal(COUNT_ONLY_CONTENT_TYPE, "evidence_summary");
  assert.equal(COUNT_ONLY_OPERATION_REASON, "story_testimonial_count_only_operation_not_permitted");
});

// The governed restatement of a selected-worksheet count (composeMeasurementClaimStatement).
const STATEMENT = "The promoted source records 364 service events with no reporting period defined in selected worksheet sheet_3 "
  + "(record count: one service event per selected worksheet data row; 0 blank records excluded, 2 exact-duplicate records included).";
const LIMITATIONS = ["coverage.conflicting_source_indicators.unresolved", "coverage.requirement_alignment.unresolved", "coverage.small_cell_risk.unresolved",
  "measurement.duplicate_records_included", "measurement.no_reporting_period", "measurement.record_meaning_human_defined", COUNT_ONLY_LIMITATION_CODE].sort();
const COMPLIANT = "In selected worksheet sheet_3 the promoted source records 364 service events: a count of worksheet records, each one row, "
  + "under the human-defined definition, which KAI did not check. No reporting period is defined. 2 exact-duplicate rows are included in the count. "
  + "Internal limitations: small-cell risk, conflicting source indicators and requirement alignment remain unresolved.";
const validate = (text, limitationCodes = LIMITATIONS) => validateGeneratedContentDraft({
  requestedAudience: "internal",
  contentType: "evidence_summary",
  generationClaims: [{
    claimId: CLAIM, evidenceItemId: EVIDENCE, claimStatement: STATEMENT, limitationCodes, requestedAudience: "internal",
    revalidatedForGeneration: true, currentEligible: true, audienceAuthority: { internal: true, funder: false, public: false },
  }],
  blocks: [{ ordinal: 1, text, citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }] }],
});
const blocker = (result, key) => result.results.find((entry) => entry.validator_key === key);

test("VAL-GEN-010: a count-only block that restates the count with its limitations passes every validator", () => {
  const result = validate(COMPLIANT);
  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(blocker(result, "VAL-GEN-010").severity, "pass");
  // Without the count-only code the validator set is unchanged.
  const ordinary = validate(COMPLIANT, LIMITATIONS.filter((code) => code !== COUNT_ONLY_LIMITATION_CODE));
  assert.equal(blocker(ordinary, "VAL-GEN-010"), undefined);
});

test("VAL-GEN-010: testimonial quotations, story-derived assertions, participant/outcome claims, verified meaning and an unnamed worksheet are refused", () => {
  const cases = {
    "testimonial quotation": [`${COMPLIANT} One attendee said “this changed my life.”`, ["first_person", "participant_or_outcome_assertion", "quotation", "story_or_testimonial_wording"]],
    "straight-quoted testimonial": [`${COMPLIANT} "It helped so much," a family told staff.`, ["participant_or_outcome_assertion", "quotation", "story_or_testimonial_wording"]],
    "story-derived assertion": [`${COMPLIANT} Stories shared by families describe a welcoming service.`, ["participant_or_outcome_assertion", "story_or_testimonial_wording"]],
    "unsupported outcome": [`${COMPLIANT} The service events show participants achieved better outcomes.`, ["participant_or_outcome_assertion"]],
    "unique people": [`${COMPLIANT} They represent 364 people served.`, ["participant_or_outcome_assertion"]],
    "verified completions": [`${COMPLIANT} These are 364 verified service completions.`, ["meaning_presented_as_verified", "participant_or_outcome_assertion"]],
    "worksheet not named": [COMPLIANT.replace("In selected worksheet sheet_3 the", "The"), ["counted_worksheet_not_named"]],
  };
  for (const [label, [text, classes]] of Object.entries(cases)) {
    const result = validate(text);
    assert.equal(result.ok, false, label);
    const found = blocker(result, "VAL-GEN-010");
    assert.equal(found.severity, "blocker", label);
    assert.equal(found.blocking_reason, "count_only_content_boundary_exceeded", label);
    assert.deepEqual(found.evidence.violation_classes, classes, label);
  }
  // A word the governed statement itself uses (the human-defined unit label) is not an added assertion.
  const participants = "The promoted source records 37 participants with no reporting period defined in selected worksheet sheet_5 (record count: ...).";
  assert.deepEqual(countOnlyBlockViolations("In sheet_5, 37 participants, a count of records under the human-defined definition.", [participants]), []);
  assert.deepEqual(countOnlyBlockViolations("The period was not verified against record dates.", ["single-worksheet statement"]), []);
});

test("generator: the count-only instruction is added only for a count-only claim; the request carries only the governed projection", async () => {
  const payloads = [];
  const generator = createProductionEvidenceSummaryDraftGenerator({
    createMessage: async (payload) => {
      payloads.push(payload);
      return { content: [{ type: "text", text: JSON.stringify({ blocks: [] }) }] };
    },
  });
  const claim = { claimId: CLAIM, claimStatement: STATEMENT, claimType: "finding", evidenceItemId: EVIDENCE, sourceId: SOURCE, sourceVersionId: VERSION, limitationCodes: LIMITATIONS };
  await generator({ contentType: "evidence_summary", requestedAudience: "internal", claims: [claim] });
  await generator({ contentType: "evidence_summary", requestedAudience: "internal", claims: [{ ...claim, limitationCodes: LIMITATIONS.filter((code) => code !== COUNT_ONLY_LIMITATION_CODE) }] });
  const [countOnly, ordinary] = payloads;
  assert.match(countOnly.system, /source\.story_testimonial_present_count_only/);
  assert.match(countOnly.system, /use no quotation marks, no first person/);
  assert.doesNotMatch(ordinary.system, /story_testimonial|quotation/);
  assert.equal(countOnly.system.startsWith(ordinary.system), true, "the ordinary prompt is unchanged and the instruction is appended");
  const body = JSON.parse(countOnly.messages[0].content);
  assert.deepEqual(Object.keys(body), ["contentType", "requestedAudience", "claims"]);
  assert.deepEqual(Object.keys(body.claims[0]), ["claimId", "claimStatement", "claimType", "evidenceItemId", "sourceId", "sourceVersionId", "limitationCodes"]);
});

function countOnlyModel({ sentinel = "SENTINEL-DEFINITION-TEXT" } = {}) {
  const statement = "The promoted source records 37 service events with no reporting period defined in selected worksheet sheet_5 "
    + "(record count: one service event per selected worksheet data row; 0 blank records excluded, 0 exact-duplicate records included).";
  return {
    modelContractVersion: "kai-sprint2-internal-report-model-v1", available: true, getKinderReviewReasons: [], blockedReasons: [],
    report: { generatedContentDraftId: "d0000000-0000-4000-8000-000000000001", generationRunId: "a0000000-0000-4000-8000-000000000001", contentType: "evidence_summary", audience: "internal", createdAt: "2026-10-30T10:00:00.000Z", validatorKeys: ["VAL-GEN-008", "VAL-GEN-010"] },
    context: { organizationId: "11111111-2222-4333-8444-555555555555", organizationName: "Synthetic Society" },
    blocks: [{ ordinal: 1, text: "In selected worksheet sheet_5 the source records 37 service events, a count of records under the human-defined definition.", citationRefs: ["CIT-001"] }],
    citations: [{ citationRef: "CIT-001", claimId: CLAIM, evidenceItemId: EVIDENCE, sourceId: SOURCE, sourceCode: "svc", sourceVersionId: VERSION, worksheetKey: "sheet_5", worksheetName: "Data_Dictionary" }],
    facts: [{
      citationRefs: ["CIT-001"], claimId: CLAIM, evidenceItemId: EVIDENCE, sourceId: SOURCE, sourceCode: "svc", sourceVersionId: VERSION,
      sourceVersionCreatedAt: null, sourceVersionCurrent: true, profileCanonicalSha256: "ab".repeat(32), claimStatement: statement,
      evidenceStatement: "Source version record count: 37 service events.", currentlyEligible: true, blockerCodes: [], countOnly: true,
      evidenceReviewOutcome: null, claimReviewOutcome: null,
      measurement: {
        measuredValue: 37, unitLabel: "service events", countedUnit: "service event", totalRecordCount: 37, blankRecordCount: 0, duplicateRecordCount: 0,
        calculationMethod: "p1_xlsx_selected_worksheet_data_rows_excluding_blank_v1", worksheetKey: "sheet_5", worksheetName: "Data_Dictionary",
        periodStart: null, periodEnd: null, definitionText: sentinel, inclusionRule: sentinel, exclusionRule: sentinel, definitionRecordedAt: null,
      },
      limitationCodes: ["measurement.no_reporting_period", "measurement.record_meaning_human_defined", COUNT_ONLY_LIMITATION_CODE],
    }],
  };
}

test("report: a count-only fact is a row count in its worksheet, its meaning is attributed and unverified, and no free text is reproduced", () => {
  const markdown = serializeInternalReportToMarkdown(countOnlyModel());
  const section = (from, to) => markdown.slice(markdown.indexOf(`\n## ${from}\n`), markdown.indexOf(`\n## ${to}\n`));
  assert.match(section("Key findings", "Reporting period"),
    /contains \*\*37 non-blank data rows in worksheet Data_Dictionary \(`sheet_5`\)\*\*\. A person at the organization defined each row as one service event; KAI did not verify that meaning, so this is a count of rows, not an established count of service events\./);
  assert.doesNotMatch(markdown, /\*\*37 service events\*\*/, "the human meaning is never the stated finding");
  assert.doesNotMatch(markdown, /SENTINEL-DEFINITION-TEXT/, "free-text definition fields are not reproduced");
  assert.match(markdown, /Definition, inclusion and exclusion text:\*\* not reproduced/);
  assert.match(section("What this evidence does not establish", "Analysis"), /That each counted row is one service event \[CIT-001\]: a person at the organization defined that meaning, and KAI did not verify it\./);
  assert.match(section("What this evidence does not establish", "Analysis"), /stories or testimonials the source is recorded as containing: none of that content is used/);
  assert.match(section("Authority for internal use", "Conclusion"), /used for its record count only: no story or testimonial content is used, and its recorded category is unchanged/);
  assert.doesNotMatch(section("Authority for internal use", "Conclusion"), /records none of the high-risk categories/);
  assert.match(section("Data quality and limitations", "What this evidence establishes"), /recorded as containing stories or testimonials\. Only its record count is used here/);
  assert.match(section("Conclusion", "References"), /the promoted source contains 37 non-blank data rows in worksheet Data_Dictionary \(`sheet_5`\)\. Each figure is a count of rows\./);
  // An ordinary (all-absent) fact keeps its existing wording.
  const ordinary = countOnlyModel();
  ordinary.facts[0].countOnly = false;
  assert.match(serializeInternalReportToMarkdown(ordinary), /records \*\*37 service events\*\*/);
});

test("browser: the count-only basis is projected and explained; its refusals have words", () => {
  const view = projectOrganizationFactualReview({ ordinary_internal_rule: { applies: true, reasons: [], basis: "count_only_story_testimonial_present" } });
  assert.deepEqual([view.ordinaryRule.applies, view.ordinaryRule.countOnly], [true, true]);
  assert.equal(projectOrganizationFactualReview({ ordinary_internal_rule: { applies: true, reasons: [], basis: "all_sensitive_categories_absent" } }).ordinaryRule.countOnly, false);
  assert.equal(projectOrganizationFactualReview({ ordinary_internal_rule: { applies: false, reasons: ["story_testimonial_not_cleared"], basis: null } }).ordinaryRule.countOnly, false);
  assert.match(COUNT_ONLY_RULE_TEXT, /internal Evidence Summary as a record count, with no story or testimonial content/);
  assert.ok(CLIENT_INTERNAL_REPORT_REASONS.includes("count_only_content_boundary_exceeded"));
  assert.equal(typeof INTERNAL_REPORT_REASON_MESSAGES.count_only_content_boundary_exceeded, "string");
});
