import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { getClientInternalReportMarkdown } from "../Backend/kai/services/kaiClientGeneratedContentService.js";
import { serializeInternalReportToMarkdown } from "../Backend/kai/services/kaiInternalReportMarkdownSerializer.js";
import { STORED_ORGANIZATION_MEMBERSHIP_SOURCE } from "../Backend/kai/auth/kaiOrganizationMembershipSource.js";
import {
  ORDINARY_AUTHORITY_REASONS,
  ORDINARY_SOURCE_LIMITATION_DIMENSION_KEYS,
  classifySourceDecision,
  isConfirmedMeasurement,
} from "../Backend/kai/dictionary/postgresOrdinaryInternalFactAuthority.js";
import {
  HIGH_RISK_SENSITIVITY_FIELDS,
  INTERNAL_REPORT_CONTENT_TYPES,
  evaluateInternalReportAvailabilityInTransaction,
} from "../Backend/kai/dictionary/postgresOrganizationInternalReviewRepository.js";
import { ORGANIZATION_ACCEPTABLE_LIMITATION_DIMENSION_KEYS } from "../Backend/kai/dictionary/postgresOrganizationFactualReviewRepository.js";
import {
  CLIENT_INTERNAL_REPORT_REASONS,
  clientInternalReportMarkdownPath,
  projectClientInternalDraft,
  projectClientInternalDraftList,
} from "../frontend/impactEvidenceLibraryLogic.js";
import { INTERNAL_REPORT_REASON_MESSAGES } from "../frontend/knowledgeStudio/clientEvidenceWorkflowLogic.js";
import { measuredClaimReviewPlan } from "../frontend/knowledgeStudio/clientMeasuredClaimReviewLogic.js";

/**
 * Owner decision 2026-10-25: ordinary, adequately supported internal factual
 * information is reused in evidence, claims, generation and internal report
 * downloads with no further human approval. These are the unit contracts of
 * the internal report (admission, refusal, serialization) and of the browser
 * projection; the PostgreSQL and browser proofs are
 * kai-sprint2-p2-01m-source-record-count-measurement.integration.spec.js,
 * kai-client-admin-internal-factual-review-browser-acceptance.integration.spec.js
 * and kai-customer-file-to-report-assembled-browser-acceptance.integration.spec.js.
 */

const ENV = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });
const ORG = "11111111-2222-4333-8444-555555555555";
const OTHER_ORG = "99999999-8888-4777-8666-555555555555";
const ENGAGEMENT = "22222222-3333-4444-8555-666666666666";
const OTHER_ENGAGEMENT = "22222222-3333-4444-8555-777777777777";
const DRAFT = "d0000000-0000-4000-8000-000000000001";
const CLAIM = "c0000000-0000-4000-8000-000000000001";
const EVIDENCE = "e0000000-0000-4000-8000-000000000001";
const SOURCE = "b0000000-0000-4000-8000-000000000001";
const VERSION = "70000000-0000-4000-8000-000000000001";

const CLEARED = Object.freeze({
  decision_outcome: "reviewed", reviewed_allowed_use_status: "allowed", reviewed_llm_processing_allowed: true,
  reviewed_personal_data_status: "absent", reviewed_minor_data_status: "absent", reviewed_health_housing_justice_immigration_status: "absent",
  reviewed_indigenous_governance_status: "absent", reviewed_story_testimonial_status: "absent", reviewed_small_cell_risk_status: "absent",
});

function actor(roleName, { organizationId = ORG, status = "active", actorType = "human" } = {}) {
  return {
    actorType, actorUserId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", kaiUserStatus: "active", kaiRoles: [], platformSuperuser: false,
    organizationMemberships: [{ organization_id: organizationId, role_name: roleName, membership_status: status, source: STORED_ORGANIZATION_MEMBERSHIP_SOURCE }],
  };
}

function model({ available = true, contentType = "evidence_summary", getKinderReviewReasons = [], blockedReasons = [] } = {}) {
  return {
    modelContractVersion: "kai-sprint2-internal-report-model-v1",
    available,
    getKinderReviewReasons,
    blockedReasons,
    report: {
      generatedContentDraftId: DRAFT, generationRunId: "a0000000-0000-4000-8000-000000000001", contentType, audience: "internal",
      createdAt: "2026-10-25T10:00:00.000Z", validatorKeys: ["VAL-GEN-001", "VAL-GEN-004", "VAL-GEN-008"],
    },
    context: { organizationId: ORG, organizationName: "Harbourline Session Society", engagementId: ENGAGEMENT, engagementCode: "Session Programme 2026", engagementType: "pilot_assessment" },
    blocks: [{ ordinal: 1, text: "The promoted source records 5 programme sessions for the reporting period 2026-09-01 to 2026-09-30.", citationRefs: ["CIT-001"] }],
    citations: [{ citationRef: "CIT-001", claimId: CLAIM, evidenceItemId: EVIDENCE, sourceId: SOURCE, sourceCode: "sessions", sourceVersionId: VERSION }],
    facts: [{
      citationRefs: ["CIT-001"], claimId: CLAIM, evidenceItemId: EVIDENCE, sourceId: SOURCE, sourceCode: "sessions", sourceVersionId: VERSION,
      sourceVersionCreatedAt: "2026-10-25T09:00:00.000Z", sourceVersionCurrent: true, profileCanonicalSha256: "ab".repeat(32),
      claimStatement: "The promoted source records 5 programme sessions for the reporting period 2026-09-01 to 2026-09-30 (record count: one programme session per CSV data record; 1 blank record excluded, 2 exact-duplicate records included).",
      evidenceStatement: "Source version record count: 5 programme sessions for the reporting period 2026-09-01 to 2026-09-30.",
      currentlyEligible: true, blockerCodes: [], evidenceReviewOutcome: null, claimReviewOutcome: null,
      measurement: {
        measuredValue: 5, unitLabel: "programme sessions", countedUnit: "programme session", totalRecordCount: 6, blankRecordCount: 1, duplicateRecordCount: 2,
        calculationMethod: "p1_csv_profile_data_records_excluding_blank_v1", periodStart: "2026-09-01", periodEnd: "2026-09-30",
        definitionText: "Each row records one delivered programme session.", inclusionRule: "Every non-empty data row.", exclusionRule: "The header row and empty rows.",
        definitionRecordedAt: "2026-10-25T09:30:00.000Z",
      },
      limitationCodes: ["coverage.small_cell_risk.unresolved", "measurement.blank_records_excluded", "measurement.duplicate_records_included"],
    }],
  };
}

function dependencies({ report = model(), calls = [] } = {}) {
  return {
    env: ENV,
    getEngagementForOrganization: async ({ organizationId, engagementId }) => (organizationId === ORG && [ENGAGEMENT, OTHER_ENGAGEMENT].includes(engagementId)
      ? { engagement_id: engagementId, organization_id: organizationId } : null),
    readGeneratedDraftEngagementId: async (organizationId, draftId) => (organizationId === ORG && draftId === DRAFT ? ENGAGEMENT : null),
    internalReportRepository: {
      async readInternalReport(input) {
        calls.push(input);
        return typeof report === "function" ? report(input) : { ok: true, error: null, data: report };
      },
    },
  };
}

const read = (deps, overrides = {}) => getClientInternalReportMarkdown({
  organizationId: ORG, engagementId: ENGAGEMENT, generatedContentDraftId: DRAFT, actorContext: actor("client_admin"), ...overrides,
}, deps);

test("internal report: an available report is returned as complete Markdown with no approval, release, or export flag", async () => {
  const calls = [];
  const result = await read(dependencies({ calls }));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.contentType, "evidence_summary");
  assert.equal(result.data.markdownContractVersion, "kai-sprint2-internal-report-markdown-v1");
  assert.deepEqual(calls, [{ organizationId: ORG, generatedContentDraftId: DRAFT }], "one read; nothing written");
  const markdown = result.data.markdown;
  for (const section of ["Context", "Key findings", "Reporting period", "Measurement definition and counting method", "Duplicate records",
    "Data quality and limitations", "What this evidence establishes", "What this evidence does not establish", "Analysis", "Generated narrative",
    "Source and evidence traceability", "Authority for internal use", "Conclusion", "References"]) {
    assert.ok(markdown.includes(`\n## ${section}\n`), section);
  }
  assert.ok(markdown.startsWith("# Internal Evidence Summary\n"));
  assert.match(markdown, /records \*\*5 programme sessions\*\* for the reporting period 2026-09-01 to 2026-09-30/);
  assert.match(markdown, /6 data records after the header, minus 1 blank record excluded = \*\*5\*\* counted/);
  assert.match(markdown, /2 exact-duplicate records\. They are included in the count of 5/);
  assert.match(markdown, /no further approval is required for internal use/);
  assert.match(markdown, /Small-number \(small-cell\) risk: not yet resolved\. \(`coverage\.small_cell_risk\.unresolved`\)/);
  assert.ok(markdown.includes(`\`${CLAIM}\``) && markdown.includes(`\`${EVIDENCE}\``) && markdown.includes(`\`${VERSION}\``));
  // The export flag does not gate an internal report.
  assert.equal((await read({ ...dependencies(), env: { ...ENV, KAI_PUBLIC_EXPORT_ENABLED: "false" } })).ok, true);
});

test("internal report: a recorded review decision is reported as the basis, and a second report type reuses the same facts", () => {
  const reviewed = model();
  reviewed.facts[0].evidenceReviewOutcome = "supported";
  reviewed.facts[0].claimReviewOutcome = "approved";
  assert.match(serializeInternalReportToMarkdown(reviewed), /basis: recorded review decisions \(evidence: `supported`; claim: `approved`\)/);
  const narrative = serializeInternalReportToMarkdown(model({ contentType: "impact_narrative" }));
  assert.ok(narrative.startsWith("# Internal Impact Narrative\n"));
  assert.match(narrative, /\*\*Purpose:\*\* this report describes the programme activity/);
  assert.match(narrative, /records \*\*5 programme sessions\*\*/);
  assert.throws(() => serializeInternalReportToMarkdown(model({ available: false })), /available internal report model/);
});

test("internal report: an unavailable report is refused with the server's structured reasons; stale and missing drafts keep their codes", async () => {
  const held = await read(dependencies({ report: model({ available: false, getKinderReviewReasons: ["minor_information_not_cleared"], blockedReasons: ["cited_claims_not_currently_eligible"] }) }));
  assert.deepEqual([held.ok, held.error.code, held.error.status], [false, "blocked", 422]);
  assert.deepEqual(held.blockers.map((blocker) => [blocker.validator_key, blocker.blocking_reason]), [
    ["VAL-KAI-INTERNAL-REPORT-001", "minor_information_not_cleared"],
    ["VAL-KAI-INTERNAL-REPORT-001", "cited_claims_not_currently_eligible"],
  ]);
  const stale = await read(dependencies({ report: () => ({ ok: false, data: null, error: { code: "conflict_current_state_changed", status: 409 } }) }));
  assert.equal(stale.error.code, "conflict_current_state_changed");
  const funder = model();
  funder.report.audience = "funder";
  assert.equal((await read(dependencies({ report: funder }))).error.code, "not_found", "only internal reports");
  const readiness = model();
  readiness.report.contentType = "readiness_assessment";
  assert.equal((await read(dependencies({ report: readiness }))).error.code, "not_found", "only internal report types");
});

test("internal report: only an active client_admin of the organization, for a draft of this Project; non-humans and disabled flags are refused before any read", async () => {
  for (const [label, overrides, deps, code] of [
    ["client_contributor", { actorContext: actor("client_contributor") }, null, "authorization_denied"],
    ["client_reviewer", { actorContext: actor("client_reviewer") }, null, "authorization_denied"],
    ["inactive administrator", { actorContext: actor("client_admin", { status: "inactive" }) }, null, "authorization_denied"],
    ["another organization's administrator", { actorContext: actor("client_admin", { organizationId: OTHER_ORG }) }, null, "authorization_denied"],
    ["AI actor", { actorContext: actor("client_admin", { actorType: "ai" }) }, null, "authorization_denied"],
    ["assistant actor", { actorContext: actor("client_admin", { actorType: "assistant" }) }, null, "authorization_denied"],
    ["another Project", { engagementId: OTHER_ENGAGEMENT }, null, "not_found"],
    ["malformed draft id", { generatedContentDraftId: "not-a-uuid" }, null, "validation_blocker"],
    ["generation disabled", {}, { env: { KAI_SPRINT2_ENABLED: "true" } }, "feature_disabled"],
  ]) {
    const calls = [];
    const result = await read({ ...dependencies({ calls }), ...(deps || {}) }, overrides);
    assert.equal(result.error?.code, code, `${label}: ${JSON.stringify(result.error)}`);
    assert.deepEqual(calls, [], `${label}: refused before any read`);
  }
});

test("availability: both internal report types qualify on an ordinary, eligible packet; a high-risk source keeps Get Kinder's review", async () => {
  assert.deepEqual([...INTERNAL_REPORT_CONTENT_TYPES], ["evidence_summary", "impact_narrative"]);
  // A transaction stand-in for the source classification: one current version with the given decision.
  const tx = (decision) => ({
    async query(sql) {
      if (/FROM kai\.source_versions/.test(sql)) return { rows: [{ source_version_id: VERSION, organization_id: ORG, is_current: true, intake_sensitivity_profile_id: "50000000-0000-4000-8000-000000000001" }] };
      if (/intake_sensitivity_review_decisions/.test(sql)) return { rows: decision ? [{ ...decision, organization_id: ORG, decision_id: "60000000-0000-4000-8000-000000000001", supersedes_decision_id: null }] : [] };
      return { rows: [] };
    },
  });
  const packet = (contentType, eligible = true) => ({
    contentType, requestedAudience: "internal", currentUseEligible: eligible,
    blocks: [{ citations: [{ sourceVersionId: VERSION }] }],
  });
  for (const contentType of ["evidence_summary", "impact_narrative"]) {
    const ordinary = await evaluateInternalReportAvailabilityInTransaction(tx(CLEARED), { organizationId: ORG, packet: packet(contentType) });
    assert.deepEqual(ordinary, { available: true, getKinderReviewReasons: [], blockedReasons: [] }, contentType);
  }
  const ineligible = await evaluateInternalReportAvailabilityInTransaction(tx(CLEARED), { organizationId: ORG, packet: packet("evidence_summary", false) });
  assert.deepEqual([ineligible.available, ineligible.blockedReasons], [false, ["cited_claims_not_currently_eligible"]]);
  const sensitive = await evaluateInternalReportAvailabilityInTransaction(tx({ ...CLEARED, reviewed_minor_data_status: "present" }), { organizationId: ORG, packet: packet("evidence_summary") });
  assert.deepEqual([sensitive.available, sensitive.getKinderReviewReasons], [false, ["minor_information_not_cleared"]]);
  const other = await evaluateInternalReportAvailabilityInTransaction(tx(CLEARED), { organizationId: ORG, packet: packet("board_update") });
  assert.deepEqual([other.available, other.getKinderReviewReasons], [false, ["content_type_requires_get_kinder_review"]]);
});

test("ordinary authority: the source classification and confirmed measurement are the shared, unchanged rules", () => {
  assert.deepEqual(classifySourceDecision(CLEARED), { getKinderReviewReasons: [], blockedReasons: [] });
  for (const [field, reason] of Object.entries(HIGH_RISK_SENSITIVITY_FIELDS)) {
    assert.deepEqual(classifySourceDecision({ ...CLEARED, [field]: "unknown" }).getKinderReviewReasons, [reason], field);
    assert.ok(ORDINARY_AUTHORITY_REASONS.includes(reason), reason);
  }
  assert.deepEqual(classifySourceDecision({ ...CLEARED, reviewed_llm_processing_allowed: false }).blockedReasons, ["processing_permission_not_established"]);
  const evidence = { source_version_id: VERSION };
  const measurement = { measurement_type: "source_record_count", definition_status: "human_confirmed", source_version_id: VERSION, definition_source_version_id: VERSION };
  assert.equal(isConfirmedMeasurement(measurement, evidence), true);
  assert.equal(isConfirmedMeasurement({ ...measurement, definition_status: "proposed" }, evidence), false);
  assert.equal(isConfirmedMeasurement({ ...measurement, definition_source_version_id: "other" }, evidence), false);
  assert.deepEqual([...ORGANIZATION_ACCEPTABLE_LIMITATION_DIMENSION_KEYS], [...ORDINARY_SOURCE_LIMITATION_DIMENSION_KEYS]);
});

test("browser: the internal report projection fails closed, every reason has words, and an eligible measurement offers no confirmation", () => {
  assert.equal(clientInternalReportMarkdownPath(ORG, ENGAGEMENT, DRAFT),
    `/api/kai/sprint2/intake/admin/organizations/${ORG}/engagements/${ENGAGEMENT}/client-internal-drafts/${DRAFT}/markdown`);
  for (const reason of CLIENT_INTERNAL_REPORT_REASONS) assert.equal(typeof INTERNAL_REPORT_REASON_MESSAGES[reason], "string", reason);
  const dto = {
    generatedContentDraftId: DRAFT, contentType: "evidence_summary", audience: "internal", reviewState: "awaiting_organization_review",
    citedClaimsCurrentlyEligible: true, internalReportAvailable: true, limitations: ["internal_use_only", "not_approved_for_external_use"],
    blocks: [{ ordinal: 1, text: "x", supportingClaimIds: [CLAIM] }],
    internalReport: { available: true, getKinderReviewReasons: [], blockedReasons: [] },
  };
  assert.deepEqual(projectClientInternalDraft(dto).internalReport, { available: true, getKinderReviewReasons: [], blockedReasons: [] });
  for (const malformed of [undefined, null, [], { available: true, getKinderReviewReasons: ["made_up"], blockedReasons: [] }]) {
    assert.equal(projectClientInternalDraft({ ...dto, internalReport: malformed }).internalReport.available, false);
  }
  const list = projectClientInternalDraftList({ items: [{ ...dto, createdAt: null, blockCount: 1 }], nextCursor: null });
  assert.equal(list.items[0].internalReportAvailable, true);

  const decision = { organizationMayDecide: true, decisionOutcome: null };
  const review = (eligible) => ({ evidenceReview: decision, claimReview: decision, coverageLimitations: [], internalEligibility: { eligible } });
  assert.deepEqual(measuredClaimReviewPlan(review(true), "supported"), [], "no redundant confirmation");
  assert.deepEqual(measuredClaimReviewPlan(review(true), "not_supported").map((step) => step.kind), ["evidence", "claim"], "a problem can still be reported");
  assert.ok(measuredClaimReviewPlan(review(false), "supported").length > 0, "an ineligible measurement keeps its existing review");
});

test("no surviving approval step: the internal drafts UI, the console canary and the internal report path never ask for factual approval or release", async () => {
  const ui = await readFile(new URL("../frontend/knowledgeStudio/ClientInternalDrafts.jsx", import.meta.url), "utf8");
  for (const removed of ["Approve factual content", "Release internal report", "clientInternalDraftFactualReviewPath", "clientInternalDraftReleasePath",
    "data-client-factual-review-approve", "data-client-internal-release-submit", "limitations_confirmed"]) {
    assert.ok(!ui.includes(removed), `ClientInternalDrafts.jsx still contains ${removed}`);
  }
  const canary = await readFile(new URL("../scripts/kai-production-browser-console-canary.js", import.meta.url), "utf8");
  for (const removed of ['key: "gk_review"', 'key: "factual_review"', 'key: "release"', "client-released-reports", "Approve factual content", "Release internal report"]) {
    assert.ok(!canary.includes(removed), `the console canary still contains ${removed}`);
  }
  const service = await readFile(new URL("../Backend/kai/services/kaiClientGeneratedContentService.js", import.meta.url), "utf8");
  const reportPath = service.slice(service.indexOf("export async function getClientInternalReportMarkdown"), service.indexOf("const INTERNAL_REPORT_VALIDATOR_KEY"));
  for (const removed of ["isKaiPublicExportEnabled", "readCompletedReviewer", "REVIEWED_STATES", "evaluateRelease", "limitationsConfirmed", "releasedReportRepository"]) {
    assert.ok(!reportPath.includes(removed), `getClientInternalReportMarkdown depends on ${removed}`);
  }
});
