import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { STORED_ORGANIZATION_MEMBERSHIP_SOURCE } from "../Backend/kai/auth/kaiOrganizationMembershipSource.js";
import { canRecordEvidenceReviewDecision } from "../Backend/kai/services/kaiHumanReviewService.js";
import {
  __organizationFactualReviewServiceContract,
  getOrganizationFactualReview,
} from "../Backend/kai/services/kaiOrganizationFactualReviewService.js";
import {
  classifySourceDecision,
  recordedSourcePermissions,
} from "../Backend/kai/dictionary/postgresOrdinaryInternalFactAuthority.js";
import { canReviewMeasuredFinding } from "../frontend/impactEvidenceLibraryLogic.js";
import {
  measuredClaimReviewPlan,
  measurementWorksheetText,
  ordinaryRuleConditions,
  projectOrganizationFactualReview,
  recordedCategoryText,
  reviewRequirementText,
} from "../frontend/knowledgeStudio/clientMeasuredClaimReviewLogic.js";

/**
 * Measured-finding review: the finding-review read admits the Get Kinder
 * reviewer who may record this organization's evidence review (GK checked
 * first, as the decisions are) and the organization administrator, and no
 * one else; the ordinary internal rule's source verdict keeps an unanswered
 * ('unknown') category distinguishable from one recorded 'present'; and the
 * "Review finding" / "View review status" surfaces offer only what the server
 * admits. The connected proof is the XLSX browser acceptance (case H).
 */
const ENV = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });
const ORG_X = "11111111-2222-4333-8444-555555555555";
const ORG_Y = "99999999-8888-4777-8666-555555555555";
const CLAIM = "3d000000-0000-4000-8000-000000000001";
const { FINDING_REVIEW_VIEWERS } = __organizationFactualReviewServiceContract;

function actor(memberships, kaiRoles = [], extra = {}) {
  return { actorType: "human", actorUserId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", kaiRoles, platformSuperuser: false, organizationMemberships: memberships, ...extra };
}
const membership = (roleName, extra = {}) => ({ organization_id: ORG_X, role_name: roleName, membership_status: "active", ...extra });

function readProbe() {
  const calls = [];
  return {
    calls,
    repository: {
      async getOrganizationFactualReview(input) {
        calls.push(input);
        return { ok: true, data: { claim_id: input.claimId }, error: null };
      },
    },
  };
}
const read = (actorContext, probe, organizationId = ORG_X, env = ENV) => getOrganizationFactualReview(
  { organizationId, claimId: CLAIM, actorContext },
  { env, organizationFactualReviewRepository: probe.repository },
);

test("finding-review read: a GK reviewer or administrator with active membership reads it as Get Kinder's reviewer; the organization administrator as itself", async () => {
  const admitted = {
    "gk_reviewer (membership + global role)": [actor([membership("gk_reviewer")], ["gk_reviewer"]), FINDING_REVIEW_VIEWERS.getKinderReviewer],
    "gk_reviewer (membership only)": [actor([membership("gk_reviewer")]), FINDING_REVIEW_VIEWERS.getKinderReviewer],
    "gk_admin (membership + global role)": [actor([membership("gk_admin")], ["gk_admin"]), FINDING_REVIEW_VIEWERS.getKinderReviewer],
    "client_admin (verified)": [actor([membership("client_admin", { source: STORED_ORGANIZATION_MEMBERSHIP_SOURCE })]), FINDING_REVIEW_VIEWERS.organizationAdministrator],
  };
  for (const [label, [actorContext, viewer]] of Object.entries(admitted)) {
    const probe = readProbe();
    const result = await read(actorContext, probe);
    assert.equal(result.ok, true, `${label}: ${JSON.stringify(result.error)}`);
    assert.equal(result.data.viewer, viewer, label);
    assert.deepEqual(probe.calls, [{ organizationId: ORG_X, claimId: CLAIM }], label);
    assert.equal(canRecordEvidenceReviewDecision({ actorContext, organizationId: ORG_X }), viewer === FINDING_REVIEW_VIEWERS.getKinderReviewer, label);
  }
});

test("finding-review read: global GK roles without this organization's membership, gk_operator, other client roles, another organization and non-human actors never reach the repository", async () => {
  const refused = {
    "global gk_reviewer, no membership": actor([], ["gk_reviewer"]),
    "global gk_admin, membership in another organization": actor([{ ...membership("gk_admin"), organization_id: ORG_Y }], ["gk_admin"]),
    "inactive gk_reviewer membership": actor([membership("gk_reviewer", { membership_status: "inactive" })], ["gk_reviewer"]),
    gk_operator: actor([membership("gk_operator")], ["gk_operator"]),
    client_contributor: actor([membership("client_contributor")]),
    client_reviewer: actor([membership("client_reviewer")]),
    "client_admin without verified provenance": actor([membership("client_admin")]),
    assistant: actor([membership("gk_reviewer")], ["gk_reviewer"], { actorType: "assistant" }),
    system: actor([membership("gk_admin")], ["gk_admin"], { actorType: "system" }),
    "no actor id": actor([membership("gk_reviewer")], ["gk_reviewer"], { actorUserId: "" }),
  };
  for (const [label, actorContext] of Object.entries(refused)) {
    const probe = readProbe();
    const result = await read(actorContext, probe);
    assert.equal(result.ok, false, label);
    assert.deepEqual(probe.calls, [], label);
    assert.equal(canRecordEvidenceReviewDecision({ actorContext, organizationId: ORG_X }), false, label);
  }
  // Cross-tenant: an organization the reviewer is not a member of.
  const probe = readProbe();
  const crossTenant = await read(actor([membership("gk_reviewer")], ["gk_reviewer"]), probe, ORG_Y);
  assert.deepEqual([crossTenant.ok, crossTenant.error.code, probe.calls.length], [false, "authorization_denied", 0]);
  // Behind KAI_SPRINT2_ENABLED.
  const disabled = await read(actor([membership("gk_reviewer")], ["gk_reviewer"]), readProbe(), ORG_X, {});
  assert.deepEqual([disabled.ok, disabled.error.code], [false, "feature_disabled"]);
});

const REVIEWED = Object.freeze({
  decision_outcome: "reviewed",
  reviewed_allowed_use_status: "allowed",
  reviewed_llm_processing_allowed: true,
  reviewed_personal_data_status: "absent",
  reviewed_minor_data_status: "absent",
  reviewed_health_housing_justice_immigration_status: "absent",
  reviewed_indigenous_governance_status: "absent",
  reviewed_story_testimonial_status: "absent",
  reviewed_small_cell_risk_status: "absent",
});

test("ordinary rule source verdict: 'unknown' and 'present' both keep Get Kinder's review, and the recorded value says which", () => {
  assert.deepEqual(classifySourceDecision(REVIEWED), { getKinderReviewReasons: [], blockedReasons: [] });
  for (const value of ["unknown", "present"]) {
    const decision = { ...REVIEWED, reviewed_story_testimonial_status: value };
    assert.deepEqual(classifySourceDecision(decision), { getKinderReviewReasons: ["story_testimonial_not_cleared"], blockedReasons: [] }, value);
    assert.equal(recordedSourcePermissions(decision).categories.reviewed_story_testimonial_status, value);
  }
  assert.equal(recordedSourcePermissions(null), null);
  assert.equal(recordedSourcePermissions({ ...REVIEWED, decision_outcome: "deferred" }), null);
  assert.deepEqual(classifySourceDecision({ ...REVIEWED, reviewed_llm_processing_allowed: false }).blockedReasons, ["processing_permission_not_established"]);
  assert.deepEqual(Object.keys(recordedSourcePermissions(REVIEWED).categories), [
    "reviewed_personal_data_status", "reviewed_minor_data_status", "reviewed_health_housing_justice_immigration_status",
    "reviewed_indigenous_governance_status", "reviewed_story_testimonial_status", "reviewed_small_cell_risk_status",
  ]);
});

function findingDto(overrides = {}) {
  return {
    claim_id: CLAIM,
    evidence_item_id: "3c000000-0000-4000-8000-000000000001",
    claim_statement: "The promoted source records 37 service events with no reporting period defined in selected worksheet sheet_5 (record count: ...).",
    source: { source_code: "SRC", is_current: true },
    measurement: {
      calculation_method: "p1_xlsx_selected_worksheet_data_rows_excluding_blank_v1", worksheet_key: "sheet_5", worksheet_name: "Data_Dictionary",
      measured_value: 37, unit_label: "service events", counted_unit: "service event", total_record_count: 37, blank_record_count: 0, duplicate_record_count: 0,
    },
    limitations: [],
    evidence_review: { queue_status: "open", review_status: "needs_gk_review", decision_outcome: null, organization_may_decide: false, get_kinder_review_reasons: ["story_testimonial_not_cleared"] },
    claim_review: { queue_status: "open", review_status: "needs_gk_review", decision_outcome: null, organization_may_decide: false, get_kinder_review_reasons: ["story_testimonial_not_cleared"] },
    coverage_limitations: [],
    internal_eligibility: { eligible: false, blocker_codes: ["claim_review_unresolved", "evidence_review_unresolved"] },
    ordinary_internal_rule: { applies: false, reasons: ["story_testimonial_not_cleared"] },
    source_permissions: {
      is_current: true, sensitivity_review_complete: true, allowed_use_status: "allowed", ai_processing_allowed: true,
      categories: Object.fromEntries(Object.keys(recordedSourcePermissions(REVIEWED).categories).map((key) => [key, key === "reviewed_story_testimonial_status" ? "unknown" : "absent"])),
    },
    review_requirement: { responsible_role: "gk_reviewer", outstanding: ["claim_review", "evidence_review"] },
    viewer: "organization_administrator",
    ...overrides,
  };
}

test("review status text: the worksheet, the exact recorded condition, the responsible GK role and the outstanding steps; no approval for the organization", () => {
  const review = projectOrganizationFactualReview(findingDto());
  assert.equal(measurementWorksheetText(review.measurement), "Data_Dictionary (sheet_5)");
  assert.deepEqual(ordinaryRuleConditions(review), ["Stories or testimonials: not determined (recorded as unknown)."]);
  const present = projectOrganizationFactualReview(findingDto({
    source_permissions: { ...findingDto().source_permissions, categories: { ...findingDto().source_permissions.categories, reviewed_story_testimonial_status: "present" } },
  }));
  assert.deepEqual(ordinaryRuleConditions(present), ["Stories or testimonials: recorded as present."]);
  assert.equal(recordedCategoryText("reviewed_minor_data_status", "absent"), "Information about minors: recorded as absent");
  assert.equal(reviewRequirementText(review.reviewRequirement),
    "Get Kinder review required. Responsible: a Get Kinder reviewer (gk_reviewer). Outstanding: claim review; evidence review.");
  assert.deepEqual([review.evidenceReview.queueStatus, review.claimReview.reviewStatus], ["open", "needs_gk_review"]);
  for (const judgment of ["supported", "not_supported", "needs_more_information"]) {
    assert.deepEqual(measuredClaimReviewPlan(review, judgment), [], `${judgment}: nothing the server does not admit`);
  }
  const incomplete = projectOrganizationFactualReview(findingDto({ source_permissions: { is_current: false, sensitivity_review_complete: false } }));
  assert.deepEqual(ordinaryRuleConditions(incomplete), ["The source version is not current.", "The source has no completed sensitivity & allowed-use review."]);
  assert.equal(reviewRequirementText(null), null);
  assert.equal(measurementWorksheetText({ worksheetKey: null }), null);
});

test("Review finding: offered only for measured findings to an actor the capability read admits to record the evidence review", () => {
  const measured = { claimId: CLAIM, evidenceType: "source_record_count_measurement" };
  assert.equal(canReviewMeasuredFinding(measured, { recordEvidenceReview: true }), true);
  assert.equal(canReviewMeasuredFinding(measured, { recordEvidenceReview: false }), false);
  assert.equal(canReviewMeasuredFinding(measured, null), false);
  assert.equal(canReviewMeasuredFinding({ ...measured, evidenceType: "dictionary_field_presence_fact" }, { recordEvidenceReview: true }), false);
  assert.equal(canReviewMeasuredFinding({ ...measured, claimId: "not-a-uuid" }, { recordEvidenceReview: true }), false);
});

test("UI wiring: the GK Claims list action opens the finding beside the existing decision forms; the client claim offers its review status", () => {
  const library = readFileSync(new URL("../frontend/ImpactEvidenceLibrary.jsx", import.meta.url), "utf8");
  assert.match(library, /\{canReviewFinding\(claim\) \? \([\s\S]*?data-gk-review-finding=\{claim\.claimId\}[\s\S]*?onClick=\{\(\) => reviewFinding\(claim\.claimId\)\}>\s*Review finding/);
  assert.match(library, /selectedClaim && canReviewFinding\(selectedClaim\) \? \(\s*<GkFindingReviewPanel/);
  assert.ok(library.indexOf("<GkFindingReviewPanel") < library.lastIndexOf("Record Evidence Review Decision"), "the finding precedes the Traceability decision forms");
  const panel = readFileSync(new URL("../frontend/GkFindingReviewPanel.jsx", import.meta.url), "utf8");
  assert.match(panel, /canAcceptCoverage && claimApproved && !row\.internalLimitationAccepted/);
  assert.doesNotMatch(panel, /evidenceReviewCompletePath|claimReviewCompletePath/, "decisions use the existing GK forms, not a second path");
  const workflow = readFileSync(new URL("../frontend/knowledgeStudio/ClientEvidenceWorkflow.jsx", import.meta.url), "utf8");
  assert.match(workflow, /\{use === "not_usable" \? "View review status" : "View measurement"\}/);
});
