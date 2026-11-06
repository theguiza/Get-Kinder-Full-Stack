import assert from "node:assert/strict";
import * as Derived from "../../Backend/kai/validators/kaiDerivedMeasurementValidators.js";
import * as M from "../../Backend/kai/validators/kaiSourceMeasurementValidators.js";
import { __claimTraceabilityRepositoryTestables } from "../../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js";
import { __claimGapFollowupRepositoryTestables } from "../../Backend/kai/dictionary/postgresClaimGapFollowupRepository.js";

// Synthetic SQL adapter using the existing P2-06 semantic-parity fixture's
// rows and the real pure P2-04 gap computation. No database or network access.
export function makeStoryEvidenceFixture({ kind = "derived", flag = "absent", offset = 0, evidenceHead = null } = {}) {
  const identity = value => value.slice(0, 24) + (BigInt("0x" + value.slice(24)) + BigInt(offset)).toString(16).padStart(12, "0");
  const ORG = "00000000-0000-4000-8000-000000000001";
  const CLAIM_ID = identity("00000000-0000-4000-8000-000000000101");
  const EVIDENCE_ITEM_ID = identity("00000000-0000-4000-8000-000000000201");
  const LOCATOR_ID = identity("00000000-0000-4000-8000-000000000301");
  const SOURCE_ID = identity("00000000-0000-4000-8000-000000000401");
  const SOURCE_VERSION_ID = identity("00000000-0000-4000-8000-000000000501");
  const CANDIDATE_ID = identity("00000000-0000-4000-8000-000000000601");
  const DECISION_ID = identity("00000000-0000-4000-8000-000000000701");
  const EVIDENCE_REVIEW_QUEUE_ID = identity("00000000-0000-4000-8000-000000000801");
  const CLAIM_REVIEW_QUEUE_ID = identity("00000000-0000-4000-8000-000000000901");
  const PROFILE_ID = identity("00000000-0000-4000-8000-000000000a01");
  const DICTIONARY_ID = identity("00000000-0000-4000-8000-000000000b01");
  const SHA = "a".repeat(64);

  const GAP_IDS = {
    missingness: identity("00000000-0000-4000-8000-000000000c01"),
    duplicates: identity("00000000-0000-4000-8000-000000000c02"),
    denominator_clarity: identity("00000000-0000-4000-8000-000000000c03"),
    time_period_clarity: identity("00000000-0000-4000-8000-000000000c04"),
    conflicting_source_indicators: identity("00000000-0000-4000-8000-000000000c05"),
    requirement_alignment: identity("00000000-0000-4000-8000-000000000c06"),
  };
  // The six dimensions that, given the fixture below (a fully-defined single
  // dictionary field, fully covered by evidence, small_cell_risk absent, and
  // NO open data_quality_findings), are the only ones not resolved_clear -
  // mirroring buildExpectedGapPlans/dimensionResultRequiresGap exactly.
  const EXPECTED_GAP_DIMENSIONS = Object.keys(GAP_IDS);
  const FOLLOWUP_IDS = {
    denominator_clarity: identity("00000000-0000-4000-8000-000000000d01"),
    time_period_clarity: identity("00000000-0000-4000-8000-000000000d02"),
  };
  const FOLLOWUP_QUEUE_IDS = {
    denominator_clarity: identity("00000000-0000-4000-8000-000000000e01"),
    time_period_clarity: identity("00000000-0000-4000-8000-000000000e02"),
  };
  const CLIENT_FOLLOWUP_QUESTION_BY_DIMENSION = {
    denominator_clarity: "Confirm the denominator and how it is calculated.",
    time_period_clarity: "Confirm the reporting period represented by this source.",
  };

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
  function buildFakeTx({ qualityFindingRows, smallCellState = null, derived = null, record = null }) {
    const claimRow = {
      claim_id: CLAIM_ID,
      organization_id: ORG,
      evidence_item_id: EVIDENCE_ITEM_ID,
      claim_type: "outcome",
      claim_status: "draft",
      claim_review_status: "unassessed",
      claim_strength: smallCellState?.reviewed ? "reviewed_supported" : "unassessed",
      internal_only: true,
      public_use_allowed: false,
      funder_use_allowed: false,
      export_ready: false,
    };
    const claimEvidenceLinkRow = {
      claim_evidence_link_id: identity("00000000-0000-4000-8000-000000000f01"),
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
      support_strength: smallCellState?.reviewed ? "reviewed_supported" : "unassessed",
      sensitivity_level: "unknown",
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
      intake_file_id: identity("00000000-0000-4000-8000-000000001001"),
      file_profile_id: identity("00000000-0000-4000-8000-000000001101"),
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
      intake_file_id: identity("00000000-0000-4000-8000-000000001001"),
      file_profile_id: identity("00000000-0000-4000-8000-000000001101"),
      data_dictionary_id: DICTIONARY_ID,
      profile_canonical_sha256: SHA,
      human_review_required: true,
      public_use_allowed: false,
      funder_use_allowed: false,
      llm_processing_allowed: false,
      product_learning_allowed: false,
      retention_posture: "restricted_pending_review",
      small_cell_risk_status: smallCellState ? "unknown" : "absent",
      allowed_use_status: "allowed",
    };
    const dictionaryRow = {
      data_dictionary_id: DICTIONARY_ID,
      organization_id: ORG,
      intake_file_id: identity("00000000-0000-4000-8000-000000001001"),
      file_profile_id: identity("00000000-0000-4000-8000-000000001101"),
      profile_canonical_sha256: SHA,
      dictionary_status: "final",
    };
    const dictionaryFieldRows = [
      {
        data_dictionary_id: DICTIONARY_ID,
        data_dictionary_field_id: identity("00000000-0000-4000-8000-000000001201"),
        profile_field_key: "field_a",
        data_type: "string",
        business_meaning: "Defined meaning for field_a.",
        entity_level: "household",
        sensitivity: "low",
      },
    ];
    const evidenceFieldKeyRows = [{ source_version_id: SOURCE_VERSION_ID, profile_field_key: "field_a" }];
    const gapRows = persistedGapRows();
    if (smallCellState) gapRows.push({ ...gapRows[0], gap_log_item_id: identity("00000000-0000-4000-8000-000000009999"),
      dimension_key: "small_cell_risk", validator_key: "VAL-KAI-P2-02-small_cell_risk",
      safe_summary: "Claim gap requires review for dimension: small_cell_risk." });
    const followupRows = persistedFollowupRows();
    const followupQueueRows = persistedFollowupQueueRows();
    if (derived || record) {
      const row = derived?.row || record.row;
      // A paired-outcome measurement claim with no review decision recorded:
      // the shape of the reported production claims.
      Object.assign(evidenceItemRow, {
        evidence_type: record ? M.MEASUREMENT_EVIDENCE_TYPE : Derived.DERIVED_MEASUREMENT_EVIDENCE_TYPE, data_class: record ? M.MEASUREMENT_DATA_CLASS : Derived.DERIVED_MEASUREMENT_DATA_CLASS,
        statement: record ? M.composeMeasurementEvidenceStatement({ measurement: { measuredValue: row.measured_value, blankRecordCount: row.blank_record_count, duplicateRecordCount: row.duplicate_record_count, calculationMethod: row.calculation_method }, definition: { countedUnit: row.counted_unit, unitLabel: row.unit_label, periodStart: null, periodEnd: null } }) : Derived.composeDerivedMeasurementEvidenceStatement({ measurementRow: row, interpretation: null }),
      });
      Object.assign(locatorRow, {
        locator_type: record ? M.MEASUREMENT_LOCATOR_TYPE : Derived.DERIVED_MEASUREMENT_LOCATOR_TYPE,
        coordinates: record ? M.MEASUREMENT_LOCATOR_COORDINATES : Derived.derivedMeasurementLocatorCoordinates({ sheetKey: row.worksheet_key, fieldKeys: row.field_keys }),
      });
      Object.assign(claimRow, { claim_type: "finding", statement: record ? M.composeMeasurementClaimStatement({ measurementRow: row, definitionRow: row }) : Derived.composeDerivedClaimStatementFromRow(row), claim_strength: "unassessed" });
      evidenceItemRow.support_strength = "unassessed";
      for (const row of [evidenceReviewQueueItemRow, claimReviewQueueItemRow]) Object.assign(row, { queue_status: "open", review_status: "needs_gk_review" });
      // The claim's P2-04 preparation, persisted from the same pure helpers P2-04 uses.
      const { buildExpectedGapPlans, buildExpectedFollowupDimensionKeys } = __claimGapFollowupRepositoryTestables;
      const base = __claimTraceabilityRepositoryTestables.computeDimensions({
        dictionaryFieldRows, qualityFindingRows, profileRow, evidenceFieldKeys: evidenceFieldKeyRows.map((row) => row.profile_field_key),
      });
      const plans = buildExpectedGapPlans(record ? M.applyMeasurementCoverageDimensions(base, row) : Derived.applyDerivedMeasurementCoverageDimensions(base, row));
      assert.deepEqual(buildExpectedFollowupDimensionKeys(plans, record ? M.MEASUREMENT_ANSWERED_DIMENSION_KEYS : Derived.DERIVED_ANSWERED_DIMENSION_KEYS), [], "no client follow-up for a derived measurement here");
      gapRows.length = 0;
      plans.forEach((plan, index) => gapRows.push({
        gap_log_item_id: `00000000-0000-4000-8000-0000000030${String(index).padStart(2, "0")}`, organization_id: ORG, claim_id: CLAIM_ID,
        evidence_item_id: EVIDENCE_ITEM_ID, source_version_id: SOURCE_VERSION_ID, ...plan, created_by_type: "system", created_at: new Date("2026-11-02T00:00:00.000Z"),
      }));
      followupRows.length = 0;
      followupQueueRows.length = 0;
    }

    const calls = [];
    return {
      fixture: { claimRow, evidenceItemRow, sourceRow, sourceVersionRow, candidateRow, profileRow, locatorRow },
      calls,
      async query(rawSql) {
        const sql = typeof rawSql === "string" ? rawSql : rawSql?.text ?? "";
        calls.push(sql);

        if (sql.startsWith("SET TRANSACTION ISOLATION LEVEL")) return { rows: [] };
        if (record && sql.includes("FROM kai.evidence_measurements")) return { rows: [record.row] };
        if (derived && sql.includes("FROM kai.evidence_derived_measurements")) return { rows: [derived.row] };
        if ((derived || record) && sql.includes("FROM kai.intake_sensitivity_review_decisions")) return { rows: [(derived || record).head] };
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
        if (sql.includes("FROM kai.coverage_review_decisions")) return { rows: smallCellState?.acceptances ?? [] };
        if (sql.includes("kai.conflict_groups")) return { rows: [] };
        if (sql.includes("FROM kai.intake_source_candidates")) return { rows: [candidateRow] };
        if (sql.includes("FROM kai.intake_promotion_decisions")) return { rows: [decisionRow] };
        // VAL-KAI-B1A-02-003: no human sensitivity decision is recorded in this fixture.
        if (sql.includes("FROM kai.intake_sensitivity_review_decisions")) return { rows: smallCellState?.head ? [smallCellState.head] : [] };
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
        if ((derived || record) && sql.includes("FROM kai.evidence_review_decisions")) return { rows: (derived || record).evidenceHead ? [(derived || record).evidenceHead] : [] };
        if ((derived || record) && sql.includes("FROM kai.claim_review_decisions")) return { rows: [] };
        if (sql.includes("FROM kai.evidence_review_decisions")) return { rows: smallCellState?.reviewed ? [{ decision_outcome: "supported", decided_by_role: "gk_reviewer" }] : [] };
        if (sql.includes("FROM kai.claim_review_decisions")) return { rows: smallCellState?.reviewed ? [{ decision_outcome: "approved", approved_audiences: ["internal"], decided_by_role: "gk_reviewer" }] : [] };

        throw new Error(`Unhandled fake-tx query in semantic-parity test: ${sql}`);
      },
    };
  }


  const head = { organization_id: ORG, intake_sensitivity_profile_id: PROFILE_ID, decision_outcome: "reviewed",
    reviewed_allowed_use_status: "allowed", reviewed_llm_processing_allowed: true,
    reviewed_personal_data_status: "absent", reviewed_minor_data_status: "absent", reviewed_health_housing_justice_immigration_status: "absent",
    reviewed_indigenous_governance_status: "absent", reviewed_story_testimonial_status: flag, reviewed_small_cell_risk_status: "absent" };
  const row = kind === "count" ? {
    organization_id: ORG, evidence_item_id: EVIDENCE_ITEM_ID, source_version_id: SOURCE_VERSION_ID, definition_source_version_id: SOURCE_VERSION_ID,
    source_measurement_definition_id: identity("00000000-0000-4000-8000-000000004001"),
    measurement_type: M.MEASUREMENT_TYPE_RECORD_COUNT, definition_status: M.MEASUREMENT_DEFINITION_STATUS,
    calculation_method: M.MEASUREMENT_CALCULATION_METHOD, profile_canonical_sha256: SHA,
    measured_value: 37, total_record_count: 37, blank_record_count: 0, duplicate_record_count: 0, profile_field_missing_counts: [0],
    counted_unit: "service event", unit_label: "service events", definition_unit_label: "service events",
    definition_text: "One recorded row.", inclusion_rule: "Nonblank rows.", exclusion_rule: "Blank rows.", period_start: null, period_end: null,
  } : {
    organization_id: ORG, evidence_item_id: EVIDENCE_ITEM_ID, source_version_id: SOURCE_VERSION_ID, measurement_source_version_id: SOURCE_VERSION_ID,
    source_derived_measurement_id: identity("00000000-0000-4000-8000-000000002001"), measurement_family: Derived.DERIVED_MEASUREMENT_FAMILIES.PAIRED_OUTCOME,
    calculation_method: Derived.DERIVED_MEASUREMENT_METHODS.PAIRED_OUTCOME, worksheet_key: "sheet_1",
    definition: { outcome_field_key: "field_6", outcome_column: "F", participant_field_key: "field_2", stage_field_key: "field_4", instrument_version_field_key: "field_5" },
    field_keys: ["field_2", "field_4", "field_5", "field_6"], measured_value: 25, numerator: 25, denominator: 38, percentage: "65.79",
    component_counts: { participant_count: 62, comparable_pair_count: 38, increased_count: 25, unchanged_count: 10, decreased_count: 3, excluded_participant_count: 24 },
    exclusions: { participants: [{ reason: "no_baseline_observation", participant_count: 24 }], rows: [] },
    profile_canonical_sha256: SHA, interpretation_id: null, current_interpretation_id: null, contributing_sources: [],
  };
  const tx = buildFakeTx({ qualityFindingRows: [], [kind === "count" ? "record" : "derived"]: { row, head, evidenceHead } });
  return { tx, row, head, organizationId: ORG, claimId: CLAIM_ID, evidenceItemId: EVIDENCE_ITEM_ID, sourceId: SOURCE_ID,
    sourceVersionId: SOURCE_VERSION_ID, profileId: PROFILE_ID, ...tx.fixture };
}
