import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import StorySourceInformation from "../frontend/StorySourceInformation.js";
import {
  HIGH_RISK_SENSITIVITY_FIELDS, classifySourceDecision, recordedSourcePermissions,
} from "../Backend/kai/dictionary/postgresOrdinaryInternalFactAuthority.js";
import {
  evaluateOrganizationInternalReviewInTransaction, evaluateInternalReportAvailabilityInTransaction,
} from "../Backend/kai/dictionary/postgresOrganizationInternalReviewRepository.js";
import {
  sensitivityEffectiveAllowedUseProhibition, sensitivityEffectiveAiProcessingProhibition,
  sensitivityPublicUseBasisEstablished, validateSensitivityReviewedSnapshot,
} from "../Backend/kai/dictionary/sensitivityAllowedUseDecisionContract.js";
import { validateGeneratedContentDraft, composeEvidenceSummaryMeasurementDisclosures } from "../Backend/kai/validators/kaiGeneratedContentValidators.js";
import { createProductionEvidenceSummaryDraftGenerator } from "../Backend/kai/services/kaiEvidenceSummaryDraftGenerator.js";
import { projectOrganizationFactualReview } from "../frontend/knowledgeStudio/clientMeasuredClaimReviewLogic.js";
import { defaultSensitivityReviewFormState, buildReviewedSnapshotBody } from "../frontend/impactEvidenceLibraryLogic.js";
import { sendServiceResult } from "../Backend/kai/routes/sprint2IntakeApi.js";
import { STORY_SOURCE_NOTE, STORY_SOURCE_NOTE_CODE, LEGACY_STORY_LIMITATION_CODE, storySourceWarnings, isRetiredStoryValidationResult } from "../shared/kaiStorySourceInformation.js";

const ORG = "11000000-0000-4000-8000-000000000001";
const VERSION = "12000000-0000-4000-8000-000000000001";
const PROFILE = "13000000-0000-4000-8000-000000000001";
const EVIDENCE = "14000000-0000-4000-8000-000000000001";
const CLAIM = "15000000-0000-4000-8000-000000000001";
const base = { organization_id: ORG, decision_outcome: "reviewed", reviewed_allowed_use_status: "allowed", reviewed_llm_processing_allowed: true,
  ...Object.fromEntries(Object.keys(HIGH_RISK_SENSITIVITY_FIELDS).map(key => [key, "absent"])) };
const values = ["absent", "present", "unknown"];

for (const value of values) {
  test(`${value}: story source metadata changes no source classification, processing permission or consent basis`, () => {
    const decision = { ...base, reviewed_story_testimonial_status: value };
    assert.deepEqual(classifySourceDecision(decision), { getKinderReviewReasons: [], blockedReasons: [] });
    assert.equal(recordedSourcePermissions(decision).categories.reviewed_story_testimonial_status, value);
    assert.equal(sensitivityEffectiveAllowedUseProhibition({ currentHead: decision }), null);
    assert.equal(sensitivityEffectiveAiProcessingProhibition({ currentHead: decision }), null);
    assert.equal(sensitivityPublicUseBasisEstablished(decision), false, "story presence never supplies consent");
    assert.equal(sensitivityEffectiveAiProcessingProhibition({ currentHead: { ...decision, reviewed_llm_processing_allowed: false } }), "reviewed_llm_processing_not_allowed");
    assert.deepEqual(classifySourceDecision({ ...decision, reviewed_minor_data_status: "present" }).getKinderReviewReasons, ["minor_information_not_cleared"]);
    const snapshot = buildReviewedSnapshotBody({ ...defaultSensitivityReviewFormState(), ...decision });
    assert.equal(validateSensitivityReviewedSnapshot(snapshot).ok, true);
    assert.equal(validateSensitivityReviewedSnapshot({ ...snapshot, reviewed_public_use_allowed: true }).reason, "public_use_basis_not_established");
  });
}

test("review and report availability: every story value and mixed-source selection has identical review requirements and actions", async () => {
  const verdicts = [];
  for (const value of values) {
    const decisions = { [VERSION]: { ...base, reviewed_story_testimonial_status: value } };
    const tx = { async query(sql, params) {
      if (sql.includes("FROM kai.source_versions")) return { rows: [{ source_version_id: params[1], intake_sensitivity_profile_id: PROFILE, is_current: true }] };
      if (sql.includes("FROM kai.intake_sensitivity_review_decisions")) return { rows: [decisions[VERSION]] };
      if (sql.includes("FROM kai.evidence_items")) return { rows: [{ evidence_item_id: EVIDENCE, evidence_type: "source_record_count_measurement" }] };
      assert.fail(sql);
    } };
    for (const contentType of ["evidence_summary", "impact_narrative", "case_for_support", "board_update", "annual_report_section", "funder_outcome_table", "grant_response_paragraph"]) {
      const packet = { contentType, requestedAudience: "internal", currentUseEligible: true, blocks: [{ text: "Recorded evidence.", citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE, sourceVersionId: VERSION }] }] };
      const review = await evaluateOrganizationInternalReviewInTransaction(tx, { organizationId: ORG, packet });
      const availability = await evaluateInternalReportAvailabilityInTransaction(tx, { organizationId: ORG, packet });
      verdicts.push({ contentType, value, review, availability });
    }
  }
  const baseline = verdicts.filter(v => v.value === "absent").map(({ value, ...v }) => v);
  for (const value of values) assert.deepEqual(verdicts.filter(v => v.value === value).map(({ value, ...v }) => v), baseline);
  assert.equal(baseline[0].availability.available, true);
  assert.equal(baseline[1].availability.available, true);
  // Content-type authority remains independent (this suite does not grant new role permissions).
  assert.deepEqual(baseline[1].review.getKinderReviewReasons, ["content_type_requires_get_kinder_review"]);
});

test("historical authority and limitation markers cannot reactivate source-flag validation or special model instructions", async () => {
  const claim = { claimId: CLAIM, claimStatement: "37 records were counted.", claimType: "finding", evidenceItemId: EVIDENCE,
    sourceId: VERSION, sourceVersionId: VERSION, limitationCodes: [], requestedAudience: "internal", revalidatedForGeneration: true, audienceAuthority: { internal: true } };
  const blocks = [{ ordinal: 1, text: "37 records were counted.", citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }] }];
  const plain = validateGeneratedContentDraft({ requestedAudience: "internal", generationClaims: [claim], blocks });
  const legacy = validateGeneratedContentDraft({ requestedAudience: "internal", generationClaims: [{ ...claim, limitationCodes: [LEGACY_STORY_LIMITATION_CODE] }], blocks });
  assert.deepEqual(legacy, plain); assert.equal(plain.ok, true);
  for (const basis of ["all_sensitive_categories_absent", "count_only_story_testimonial_present", "numerical_measurement_story_testimonial_present"]) {
    const projected = projectOrganizationFactualReview({ ordinary_internal_rule: { applies: true, reasons: [], basis } });
    assert.deepEqual(projected.ordinaryRule, { applies: true, reasons: [], countOnly: false, numericalOnly: false });
  }
  const payloads = [];
  const generator = createProductionEvidenceSummaryDraftGenerator({ createMessage: async payload => { payloads.push(payload); return { content: [{ type: "text", text: JSON.stringify({ blocks }) }] }; } });
  for (const codes of [[], [LEGACY_STORY_LIMITATION_CODE]]) {
    await generator({ contentType: "evidence_summary", requestedAudience: "internal", claims: [{ claimId: CLAIM, evidenceItemId: EVIDENCE, claimStatement: claim.claimStatement, claimType: "finding", sourceId: VERSION, sourceVersionId: VERSION, limitationCodes: codes }] });
  }
  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].system, payloads[1].system, "legacy metadata must not add a story instruction");
  assert.ok(!payloads[0].system.includes("VAL-GEN-010"));
  assert.equal(isRetiredStoryValidationResult({ validator_key: "VAL-GEN-010", severity: "blocker", blocking_reason: "count_only_content_boundary_exceeded" }), true);
  assert.equal(isRetiredStoryValidationResult({ validator_key: "VAL-GEN-004", severity: "blocker", blocking_reason: "unsupported_numeric_or_causal_assertion" }), false);
});

test("independent citation, numeric and material limitation controls still refuse unsupported text for every presence value", () => {
  for (const value of values) {
    const claim = { claimId: CLAIM, evidenceItemId: EVIDENCE, claimStatement: "37 records were counted.", requestedAudience: "internal", revalidatedForGeneration: true,
      audienceAuthority: { internal: true }, limitationCodes: [], sourceStoryPresence: value };
    const invalid = validateGeneratedContentDraft({ requestedAudience: "internal", generationClaims: [claim], blocks: [{ ordinal: 1, text: "99 records caused improvements.", citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }] }] });
    assert.ok(invalid.blockers.some(b => b.validator_key === "VAL-GEN-004"));
    const noCitation = validateGeneratedContentDraft({ requestedAudience: "internal", generationClaims: [claim], blocks: [{ ordinal: 1, text: "37 records.", citations: [] }] });
    assert.ok(noCitation.blockers.some(b => b.validator_key === "VAL-GEN-002"));
  }
});

test("note: success API allowlist preserves the fixed reminder and never carries arbitrary warning text", () => {
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  sendServiceResult(res, { ok: true, data: {}, warnings: [{ code: STORY_SOURCE_NOTE_CODE, message: "untrusted" }, { code: "arbitrary", message: "private" }] }, 201);
  assert.equal(res.code, 201); assert.deepEqual(res.body.warnings, storySourceWarnings());
  assert.equal(res.body.warnings[0].message, STORY_SOURCE_NOTE);
});

test("note UI is neutral and remains outside review, availability and acknowledgment controls", async () => {
  const markup = renderToStaticMarkup(React.createElement(StorySourceInformation));
  assert.ok(markup.includes(STORY_SOURCE_NOTE));
  assert.match(markup, /^<p class="small text-muted my-2" data-story-source-information="">/);
  assert.doesNotMatch(markup, /button|input|disabled|alert|role=/);
  for (const file of ["ClientInternalDrafts.jsx", "ClientGeneratedDrafts.jsx", "ClientMeasuredClaimReviewPanel.jsx"]) {
    const source = await readFile(new URL(`../frontend/knowledgeStudio/${file}`, import.meta.url), "utf8");
    assert.ok(source.includes("<StorySourceInformation />"));
    assert.doesNotMatch(source, /disabled=\{[^}]*STORY_SOURCE_NOTE/);
  }
});
