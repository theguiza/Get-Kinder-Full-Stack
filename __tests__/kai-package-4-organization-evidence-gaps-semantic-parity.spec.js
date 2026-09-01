import test from "node:test";
import assert from "node:assert/strict";

import { getClaimTraceabilitySummary } from "../Backend/kai/services/kaiClaimTraceabilityService.js";
import { evaluateClaimTraceabilityInTransaction } from "../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js";
import { listOrganizationEvidenceGapsForImpactLibrary } from "../Backend/kai/services/kaiOrganizationEvidenceGapReadService.js";

/**
 * KAI Package 4 semantic-parity regression.
 *
 * get_claim_traceability_summary (P2-06, Backend/kai/dictionary/
 * postgresClaimTraceabilityRepository.js#evaluateClaimTraceabilityInTransaction)
 * never trusts a persisted kai.gap_log_items row at face value: on every read
 * it recomputes the *expected* gap-plan set fresh from the claim's current
 * authoritative P2-02 inputs (kai.data_quality_findings via
 * readDataQualityFindingsForAssessment, kai.data_dictionary_fields, the
 * kai.intake_sensitivity_profiles row, and the evidence-covered field-key
 * set - see computeDimensions/buildExpectedGapPlans in
 * Backend/kai/dictionary/postgresClaimGapFollowupRepository.js) and diffs it
 * against the persisted rows via gapRowsMatchExpectation. A mismatch fails
 * closed with conflict_current_state_changed
 * (reason: "gap_followup_queue_mismatch").
 *
 * list_organization_evidence_gaps (Package 4,
 * Backend/kai/services/kaiOrganizationEvidenceGapReadService.js) does none of
 * this: it is a single bounded SELECT over kai.gap_log_items
 * (Backend/kai/db/kaiOrganizationEvidenceGapReadModels.js) with no
 * recomputation and no join back to data_quality_findings/dictionary/
 * sensitivity-profile state. Nothing in the write path keeps gap_log_items
 * synchronized with those inputs either: kai.gap_log_items rows are only ever
 * INSERTed by the P2-04 generate path
 * (postgresClaimGapFollowupRepository.js#insertGapRowsBulk) and there is no
 * trigger, upsert, or FK cascade from kai.data_quality_findings back onto
 * kai.gap_log_items (migrations/kai_sprint2_p2_04_claim_gap_followup.sql
 * defines only uniqueness/FK/CHECK constraints on kai.gap_log_items, none of
 * them a sync mechanism). So a gap_log_items row can persist unchanged while
 * a new kai.data_quality_findings row makes traceability's freshly computed
 * expected state disagree with it.
 *
 * This test proves that divergence end to end using the real comparison
 * function (evaluateClaimTraceabilityInTransaction, via a fake `tx` whose
 * `.query` routes by table/clause the exact way the real repository queries
 * do) and the real Package 4 service (listOrganizationEvidenceGapsForImpactLibrary),
 * both fed the identical persisted kai.gap_log_items row content.
 */

const ORG = "00000000-0000-4000-8000-000000000001";
const CLAIM_ID = "00000000-0000-4000-8000-000000000101";
const EVIDENCE_ITEM_ID = "00000000-0000-4000-8000-000000000201";
const LOCATOR_ID = "00000000-0000-4000-8000-000000000301";
const SOURCE_ID = "00000000-0000-4000-8000-000000000401";
const SOURCE_VERSION_ID = "00000000-0000-4000-8000-000000000501";
const CANDIDATE_ID = "00000000-0000-4000-8000-000000000601";
const DECISION_ID = "00000000-0000-4000-8000-000000000701";
const EVIDENCE_REVIEW_QUEUE_ID = "00000000-0000-4000-8000-000000000801";
const CLAIM_REVIEW_QUEUE_ID = "00000000-0000-4000-8000-000000000901";
const PROFILE_ID = "00000000-0000-4000-8000-000000000a01";
const DICTIONARY_ID = "00000000-0000-4000-8000-000000000b01";
const SHA = "a".repeat(64);

const GAP_IDS = {
  missingness: "00000000-0000-4000-8000-000000000c01",
  duplicates: "00000000-0000-4000-8000-000000000c02",
  denominator_clarity: "00000000-0000-4000-8000-000000000c03",
  time_period_clarity: "00000000-0000-4000-8000-000000000c04",
  conflicting_source_indicators: "00000000-0000-4000-8000-000000000c05",
  requirement_alignment: "00000000-0000-4000-8000-000000000c06",
};
// The six dimensions that, given the fixture below (a fully-defined single
// dictionary field, fully covered by evidence, small_cell_risk absent, and
// NO open data_quality_findings), are the only ones not resolved_clear -
// mirroring buildExpectedGapPlans/dimensionResultRequiresGap exactly.
const EXPECTED_GAP_DIMENSIONS = Object.keys(GAP_IDS);
const FOLLOWUP_IDS = {
  denominator_clarity: "00000000-0000-4000-8000-000000000d01",
  time_period_clarity: "00000000-0000-4000-8000-000000000d02",
};
const FOLLOWUP_QUEUE_IDS = {
  denominator_clarity: "00000000-0000-4000-8000-000000000e01",
  time_period_clarity: "00000000-0000-4000-8000-000000000e02",
};
const CLIENT_FOLLOWUP_QUESTION_BY_DIMENSION = {
  denominator_clarity: "Confirm the denominator and how it is calculated.",
  time_period_clarity: "Confirm the reporting period represented by this source.",
};

function actorContext() {
  return {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000001",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_admin" }],
  };
}

function persistedGapRows() {
  return EXPECTED_GAP_DIMENSIONS.map((dimensionKey) => ({
    gap_log_item_id: GAP_IDS[dimensionKey],
    organization_id: ORG,
    claim_id: CLAIM_ID,
    evidence_item_id: EVIDENCE_ITEM_ID,
    source_version_id: SOURCE_VERSION_ID,
    dimension_key: dimensionKey,
    assessment_status: "unresolved",
    validator_key: `VAL-KAI-P2-02-${dimensionKey}`,
    safe_summary: `Claim gap requires review for dimension: ${dimensionKey}.`,
    open_finding_count: null,
    field_count: null,
    undefined_field_count: null,
    uncovered_field_count: null,
    created_by_type: "system",
    created_at: new Date("2026-08-01T00:00:00.000Z"),
  }));
}

function persistedFollowupRows() {
  return Object.keys(FOLLOWUP_IDS).map((dimensionKey) => ({
    client_followup_item_id: FOLLOWUP_IDS[dimensionKey],
    organization_id: ORG,
    claim_id: CLAIM_ID,
    gap_log_item_id: GAP_IDS[dimensionKey],
    dimension_key: dimensionKey,
    question_text: CLIENT_FOLLOWUP_QUESTION_BY_DIMENSION[dimensionKey],
    created_by_type: "system",
    created_at: new Date("2026-08-01T00:00:00.000Z"),
  }));
}

function persistedFollowupQueueRows() {
  return Object.keys(FOLLOWUP_QUEUE_IDS).map((dimensionKey) => ({
    review_queue_item_id: FOLLOWUP_QUEUE_IDS[dimensionKey],
    organization_id: ORG,
    queue_type: "client_followup",
    target_object_type: "client_followup_item",
    target_object_id: FOLLOWUP_IDS[dimensionKey],
    priority: "medium",
    queue_status: "waiting_on_client",
    review_status: "proposed",
    assigned_to: null,
    due_at: null,
    summary: "Client clarification is required for an unresolved claim gap.",
    required_action: CLIENT_FOLLOWUP_QUESTION_BY_DIMENSION[dimensionKey],
    created_at: new Date("2026-08-01T00:00:00.000Z"),
    updated_at: new Date("2026-08-01T00:00:00.000Z"),
  }));
}

/**
 * Builds a fake transaction whose `.query` dispatches on the exact table/
 * clause substrings the real repository queries use (verified by reading
 * Backend/kai/db/kaiIntakeQueries.js, Backend/kai/dictionary/
 * postgresClaimTraceabilityRepository.js, Backend/kai/dictionary/
 * postgresEvidenceCoverageAssessmentRepository.js, and Backend/kai/dictionary/
 * postgresHumanReviewDecisionRepository.js). `qualityFindingRows` is the only
 * authoritative input that differs between the matching and mismatched cases
 * below.
 */
function buildFakeTx({ qualityFindingRows }) {
  const claimRow = {
    claim_id: CLAIM_ID,
    organization_id: ORG,
    evidence_item_id: EVIDENCE_ITEM_ID,
    claim_type: "outcome",
    claim_status: "draft",
    claim_review_status: "unassessed",
    claim_strength: "unassessed",
    internal_only: true,
    public_use_allowed: false,
    funder_use_allowed: false,
    export_ready: false,
  };
  const claimEvidenceLinkRow = {
    claim_evidence_link_id: "00000000-0000-4000-8000-000000000f01",
    organization_id: ORG,
    claim_id: CLAIM_ID,
    evidence_item_id: EVIDENCE_ITEM_ID,
  };
  const evidenceItemRow = {
    evidence_item_id: EVIDENCE_ITEM_ID,
    organization_id: ORG,
    source_id: SOURCE_ID,
    source_version_id: SOURCE_VERSION_ID,
    source_locator_id: LOCATOR_ID,
    evidence_review_status: "unassessed",
    support_strength: "unassessed",
    sensitivity_level: "internal",
  };
  const locatorRow = {
    source_locator_id: LOCATOR_ID,
    organization_id: ORG,
    source_version_id: SOURCE_VERSION_ID,
    locator_type: "file",
    coordinates: {},
  };
  const sourceRow = { source_id: SOURCE_ID, organization_id: ORG, source_code: "SRC-1" };
  const sourceVersionRow = {
    source_version_id: SOURCE_VERSION_ID,
    organization_id: ORG,
    source_id: SOURCE_ID,
    intake_source_candidate_id: CANDIDATE_ID,
    intake_sensitivity_profile_id: PROFILE_ID,
    profile_canonical_sha256: SHA,
    is_current: true,
  };
  const candidateRow = {
    intake_source_candidate_id: CANDIDATE_ID,
    organization_id: ORG,
    intake_file_id: "00000000-0000-4000-8000-000000001001",
    file_profile_id: "00000000-0000-4000-8000-000000001101",
    data_dictionary_id: DICTIONARY_ID,
    intake_sensitivity_profile_id: PROFILE_ID,
    profile_canonical_sha256: SHA,
    proposed_source_type: "survey",
    candidate_status: "promoted",
  };
  const decisionRow = {
    intake_promotion_decision_id: DECISION_ID,
    organization_id: ORG,
    intake_source_candidate_id: CANDIDATE_ID,
    source_id: SOURCE_ID,
    source_version_id: SOURCE_VERSION_ID,
    decision_status: "promoted",
  };
  const evidenceReviewQueueItemRow = {
    review_queue_item_id: EVIDENCE_REVIEW_QUEUE_ID,
    organization_id: ORG,
    queue_type: "evidence_review",
    target_object_type: "evidence_item",
    target_object_id: EVIDENCE_ITEM_ID,
    priority: "medium",
    queue_status: "resolved",
    review_status: "resolved",
    assigned_to: null,
    due_at: null,
    summary: null,
    required_action: null,
    updated_at: new Date("2026-08-01T00:00:00.000Z"),
  };
  const claimReviewQueueItemRow = {
    review_queue_item_id: CLAIM_REVIEW_QUEUE_ID,
    organization_id: ORG,
    queue_type: "claim_review",
    target_object_type: "claim",
    target_object_id: CLAIM_ID,
    priority: "medium",
    queue_status: "resolved",
    review_status: "resolved",
    assigned_to: null,
    due_at: null,
    summary: null,
    required_action: null,
    updated_at: new Date("2026-08-01T00:00:00.000Z"),
  };
  const profileRow = {
    organization_id: ORG,
    intake_sensitivity_profile_id: PROFILE_ID,
    intake_file_id: "00000000-0000-4000-8000-000000001001",
    file_profile_id: "00000000-0000-4000-8000-000000001101",
    data_dictionary_id: DICTIONARY_ID,
    profile_canonical_sha256: SHA,
    human_review_required: true,
    public_use_allowed: false,
    funder_use_allowed: false,
    llm_processing_allowed: false,
    product_learning_allowed: false,
    retention_posture: "restricted_pending_review",
    small_cell_risk_status: "absent",
    allowed_use_status: "allowed",
  };
  const dictionaryRow = {
    data_dictionary_id: DICTIONARY_ID,
    organization_id: ORG,
    intake_file_id: "00000000-0000-4000-8000-000000001001",
    file_profile_id: "00000000-0000-4000-8000-000000001101",
    profile_canonical_sha256: SHA,
    dictionary_status: "final",
  };
  const dictionaryFieldRows = [
    {
      data_dictionary_id: DICTIONARY_ID,
      data_dictionary_field_id: "00000000-0000-4000-8000-000000001201",
      profile_field_key: "field_a",
      data_type: "string",
      business_meaning: "Defined meaning for field_a.",
      entity_level: "household",
      sensitivity: "low",
    },
  ];
  const evidenceFieldKeyRows = [{ source_version_id: SOURCE_VERSION_ID, profile_field_key: "field_a" }];
  const gapRows = persistedGapRows();
  const followupRows = persistedFollowupRows();
  const followupQueueRows = persistedFollowupQueueRows();

  const calls = [];
  return {
    calls,
    async query(rawSql) {
      const sql = typeof rawSql === "string" ? rawSql : rawSql?.text ?? "";
      calls.push(sql);

      if (sql.startsWith("SET TRANSACTION ISOLATION LEVEL")) return { rows: [] };
      if (sql.includes("FROM kai.gap_log_items")) return { rows: gapRows };
      if (sql.includes("FROM kai.client_followup_items")) return { rows: followupRows };
      if (sql.includes("kai.review_queue_items") && sql.includes("queue_type = 'client_followup'")) {
        return { rows: followupQueueRows };
      }
      if (sql.includes("kai.review_queue_items") && sql.includes("queue_type = 'evidence_review'")) {
        return { rows: [evidenceReviewQueueItemRow] };
      }
      if (sql.includes("kai.review_queue_items") && sql.includes("queue_type = 'claim_review'")) {
        return { rows: [claimReviewQueueItemRow] };
      }
      if (sql.includes("kai.review_queue_items") && sql.includes("queue_type = 'conflict_resolution'")) {
        return { rows: [] };
      }
      if (sql.includes("FROM kai.coverage_review_decisions")) return { rows: [] };
      if (sql.includes("kai.conflict_groups")) return { rows: [] };
      if (sql.includes("FROM kai.intake_source_candidates")) return { rows: [candidateRow] };
      if (sql.includes("FROM kai.intake_promotion_decisions")) return { rows: [decisionRow] };
      if (sql.includes("FROM kai.intake_sensitivity_profiles")) return { rows: [profileRow] };
      if (sql.includes("FROM kai.evidence_items e")) return { rows: evidenceFieldKeyRows };
      if (sql.includes("FROM kai.data_dictionary_fields")) return { rows: dictionaryFieldRows };
      if (sql.includes("FROM kai.data_quality_findings")) return { rows: qualityFindingRows };
      if (sql.includes("FROM kai.data_dictionaries")) return { rows: [dictionaryRow] };
      if (sql.includes("FROM kai.claim_evidence_links")) return { rows: [claimEvidenceLinkRow] };
      if (sql.includes("FROM kai.evidence_items")) return { rows: [evidenceItemRow] };
      if (sql.includes("FROM kai.source_locators")) return { rows: [locatorRow] };
      if (sql.includes("FROM kai.source_versions")) return { rows: [sourceVersionRow] };
      if (sql.includes("FROM kai.sources")) return { rows: [sourceRow] };
      if (sql.includes("FROM kai.claims")) return { rows: [claimRow] };
      if (sql.includes("FROM kai.evidence_review_decisions")) return { rows: [] };
      if (sql.includes("FROM kai.claim_review_decisions")) return { rows: [] };

      throw new Error(`Unhandled fake-tx query in semantic-parity test: ${sql}`);
    },
  };
}

async function runTraceability(fakeTx) {
  return getClaimTraceabilitySummary(
    {
      organizationId: ORG,
      claimId: CLAIM_ID,
      requestedAudience: "internal",
      actorContext: actorContext(),
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      claimTraceabilityRepository: {
        getClaimTraceabilitySummary: (input) => evaluateClaimTraceabilityInTransaction(fakeTx, input),
      },
    },
  );
}

/**
 * Runs the REAL Package 4 repair end to end: the real
 * filterCurrentOrganizationEvidenceGaps (postgresOrganizationEvidenceGapCurrentStateRepository.js)
 * batch-validates the same persisted kai.gap_log_items candidate page against
 * the SAME fakeTx used for traceability above - one shared authoritative
 * state, read through the identical query-routing fake. Only
 * `listOrganizationEvidenceGaps` (the plain SELECT over kai.gap_log_items) and
 * `runInTransaction` (so this test never opens a real DB connection) are
 * stubbed; the current-state batch-read/classification logic itself is not
 * stubbed at all.
 */
async function runOrganizationEvidenceGaps(fakeTx) {
  return listOrganizationEvidenceGapsForImpactLibrary(
    {
      organizationId: ORG,
      limit: 25,
      afterGapLogItemId: null,
      actorContext: actorContext(),
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      runInTransaction: (callback) => callback(fakeTx),
      // The real DB read (kaiOrganizationEvidenceGapReadModels.js#listOrganizationEvidenceGaps)
      // is a plain SELECT over kai.gap_log_items with no join back to
      // data_quality_findings/dictionary/profile state - so it returns
      // exactly the same persisted rows regardless of those inputs. This stub
      // returns that identical persisted content, in the DB's own column
      // shape, for both the matching and mismatched cases; the real
      // filterCurrentOrganizationEvidenceGaps (not stubbed) is what now
      // recomputes current-state against fakeTx.
      listOrganizationEvidenceGaps: async () =>
        persistedGapRows().map((row) => ({
          gap_log_item_id: row.gap_log_item_id,
          claim_id: row.claim_id,
          dimension_key: row.dimension_key,
          assessment_status: row.assessment_status,
          validator_key: row.validator_key,
        })),
    },
  );
}

test("Case A (current/matching): traceability accepts the persisted gap and the organization-level read returns it", async () => {
  const fakeTx = buildFakeTx({ qualityFindingRows: [] });
  const traceability = await runTraceability(fakeTx);
  assert.equal(traceability.ok, true, JSON.stringify(traceability));
  const missingnessGap = traceability.data.gap_items.find((item) => item.dimension_key === "missingness");
  assert.ok(missingnessGap, "traceability discloses the missingness gap as current");
  assert.equal(missingnessGap.gap_log_item_id, GAP_IDS.missingness);
  assert.equal(missingnessGap.assessment_status, "unresolved");

  const orgGaps = await runOrganizationEvidenceGaps(fakeTx);
  assert.equal(orgGaps.ok, true, JSON.stringify(orgGaps));
  const orgMissingnessGap = orgGaps.data.items.find((item) => item.gap_log_item_id === GAP_IDS.missingness);
  assert.ok(orgMissingnessGap, "list_organization_evidence_gaps returns the same current gap");
  assert.equal(orgMissingnessGap.claim_id, CLAIM_ID);
});

test("Case B (persisted-but-mismatched, REPAIRED): a new open kai.data_quality_findings row (no write to gap_log_items) makes traceability reject the persisted gap as stale, and list_organization_evidence_gaps now omits it too", async () => {
  // The ONE authoritative input that changes relative to Case A: a
  // data_quality_findings row for the same dictionary now exists with
  // finding_type='missingness', finding_status='open'. Nothing writes to
  // kai.gap_log_items when this happens - readDataQualityFindingsForAssessment
  // (postgresEvidenceCoverageAssessmentRepository.js) feeds assessMissingness
  // (Backend/kai/validators/kaiEvidenceCoverageAssessmentValidators.js), which
  // now returns assessment_status "resolved_risk_flagged" with
  // open_finding_count:1 instead of the persisted row's "unresolved"/null.
  const qualityFindingRows = [
    {
      data_dictionary_id: DICTIONARY_ID,
      data_quality_finding_id: "00000000-0000-4000-8000-000000001301",
      profile_field_key: "field_a",
      finding_type: "missingness",
      finding_status: "open",
    },
  ];
  const fakeTx = buildFakeTx({ qualityFindingRows });

  const traceability = await runTraceability(fakeTx);
  assert.equal(traceability.ok, false);
  assert.equal(traceability.error.code, "conflict_current_state_changed");
  assert.equal(traceability.error.status, 409);
  assert.equal(
    traceability.data?.traceability_conflict_reason,
    "gap_followup_queue_mismatch",
    "the real gapRowsMatchExpectation comparator (postgresClaimGapFollowupRepository.js) is what rejects the stale row",
  );

  // BEFORE the repair, this same persisted kai.gap_log_items row was still
  // disclosed as current by list_organization_evidence_gaps (the accepted
  // defect proven by this file before the repair). After the repair,
  // filterCurrentOrganizationEvidenceGaps batch-validates the claim this gap
  // belongs to against the SAME fakeTx/authoritative state traceability just
  // rejected it against, and the claim fails the identical
  // gapRowsMatchExpectation gate - so the gap is omitted here too. This is
  // REQUIRED_INVARIANT: the organization-level capability must never present
  // a gap as current when the authoritative traceability path would refuse to
  // expose that gap as current governed state.
  const orgGaps = await runOrganizationEvidenceGaps(fakeTx);
  assert.equal(orgGaps.ok, true, JSON.stringify(orgGaps));
  const orgMissingnessGap = orgGaps.data.items.find((item) => item.gap_log_item_id === GAP_IDS.missingness);
  assert.equal(
    orgMissingnessGap,
    undefined,
    "REPAIRED: list_organization_evidence_gaps no longer returns a gap_log_items row that get_claim_traceability_summary rejects as no longer matching current state",
  );
  // Every other persisted gap for the SAME claim is also stale for the same
  // reason (the claim-level gate, not a per-gap gate, is what fails) - none
  // of this claim's gaps are exposed as current.
  for (const dimensionKey of EXPECTED_GAP_DIMENSIONS) {
    assert.equal(
      orgGaps.data.items.find((item) => item.gap_log_item_id === GAP_IDS[dimensionKey]),
      undefined,
      `REPAIRED: no gap for claim ${CLAIM_ID} is exposed as current while the claim itself fails the current-state gate (dimension ${dimensionKey})`,
    );
  }
});
