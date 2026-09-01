import test from "node:test";
import assert from "node:assert/strict";

import { getClaimTraceabilitySummary } from "../Backend/kai/services/kaiClaimTraceabilityService.js";
import { evaluateClaimTraceabilityInTransaction } from "../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js";
import { listOrganizationEvidenceGapsForImpactLibrary } from "../Backend/kai/services/kaiOrganizationEvidenceGapReadService.js";
import {
  CLIENT_FOLLOWUP_QUESTION_BY_DIMENSION,
  CLIENT_FOLLOWUP_QUEUE_STATUS,
  CLIENT_FOLLOWUP_REVIEW_STATUS,
  CLIENT_FOLLOWUP_PRIORITY,
  CLIENT_FOLLOWUP_SUMMARY,
} from "../Backend/kai/validators/kaiClaimGapFollowupValidators.js";

/**
 * KAI Package 4 false-negative regression (proven with production evidence:
 * claim 0d8e7e48-c3ce-4277-b2de-5cc268810b6d - get_claim_traceability_summary
 * returned ok:true with gap_items for a claim that
 * list_organization_evidence_gaps omitted entirely for the same organization).
 *
 * Root cause: postgresOrganizationEvidenceGapCurrentStateRepository.js's
 * batched `kai.client_followup_items` read
 * (loadCurrentStateBatches -> followupRows) never selects `question_text`,
 * but followupRowsMatchExpectation (shared with
 * evaluateClaimTraceabilityInTransaction via
 * __claimGapFollowupRepositoryTestables) requires
 * `followupRow.question_text === CLIENT_FOLLOWUP_QUESTION_BY_DIMENSION[dimensionKey]`.
 * Every existing Package 4 fixture/fake-tx in this repo returns whole
 * in-memory fixture objects regardless of the SQL SELECT list actually sent,
 * so this exact column omission is invisible to them even though the real
 * `kai.client_followup_items` row genuinely carries `question_text` (proven
 * by kai_sprint2_p2_04_claim_gap_followup.sql and by
 * postgresClaimGapFollowupRepository.js#insertGapRowsBulk, which always
 * writes it). Real Postgres never returns a column that was not requested, so
 * against the real database this SELECT always yields
 * `followupRow.question_text === undefined`, `followupsMatch` is always
 * false whenever the claim has any client-answerable gap, and the claim's
 * gaps are always classified stale/omitted - exactly the observed production
 * discrepancy.
 *
 * This test builds one fake `tx` that actually projects each query's result
 * rows down to the exact column list named in its own SQL text (a real
 * Postgres would never hand back an unselected column), fed from one shared
 * in-memory fixture, and runs BOTH the real
 * evaluateClaimTraceabilityInTransaction and the real
 * filterCurrentOrganizationEvidenceGaps (via
 * listOrganizationEvidenceGapsForImpactLibrary) against it - proving the
 * exact divergence and, after the repair, its removal.
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
const NOW = new Date("2026-08-01T00:00:00.000Z");

// Given a single fully-defined dictionary field, fully covered by evidence,
// no small-cell risk, and no open data_quality_findings, these are the six
// dimensions buildExpectedGapPlans does not resolve as resolved_clear -
// mirrors the already-accepted 4658703/8a7b704 fixture exactly.
const GAP_DIMENSIONS = [
  "missingness",
  "duplicates",
  "denominator_clarity",
  "time_period_clarity",
  "conflicting_source_indicators",
  "requirement_alignment",
];
const CLIENT_ANSWERABLE_GAP_DIMENSIONS = ["denominator_clarity", "time_period_clarity"];

const GAP_IDS = Object.fromEntries(GAP_DIMENSIONS.map((dim, i) => [dim, `00000000-0000-4000-8000-000000000c0${i}`]));
const FOLLOWUP_IDS = Object.fromEntries(
  CLIENT_ANSWERABLE_GAP_DIMENSIONS.map((dim, i) => [dim, `00000000-0000-4000-8000-000000000d0${i}`]),
);
const FOLLOWUP_QUEUE_IDS = Object.fromEntries(
  CLIENT_ANSWERABLE_GAP_DIMENSIONS.map((dim, i) => [dim, `00000000-0000-4000-8000-000000000e0${i}`]),
);

function persistedGapRows() {
  return GAP_DIMENSIONS.map((dimensionKey) => ({
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
    created_at: NOW,
  }));
}

function persistedFollowupRows() {
  return CLIENT_ANSWERABLE_GAP_DIMENSIONS.map((dimensionKey) => ({
    client_followup_item_id: FOLLOWUP_IDS[dimensionKey],
    organization_id: ORG,
    claim_id: CLAIM_ID,
    gap_log_item_id: GAP_IDS[dimensionKey],
    dimension_key: dimensionKey,
    question_text: CLIENT_FOLLOWUP_QUESTION_BY_DIMENSION[dimensionKey],
    created_by_type: "system",
    created_at: NOW,
  }));
}

function persistedFollowupQueueRows() {
  return CLIENT_ANSWERABLE_GAP_DIMENSIONS.map((dimensionKey) => ({
    review_queue_item_id: FOLLOWUP_QUEUE_IDS[dimensionKey],
    organization_id: ORG,
    queue_type: "client_followup",
    target_object_type: "client_followup_item",
    target_object_id: FOLLOWUP_IDS[dimensionKey],
    priority: CLIENT_FOLLOWUP_PRIORITY,
    queue_status: CLIENT_FOLLOWUP_QUEUE_STATUS,
    review_status: CLIENT_FOLLOWUP_REVIEW_STATUS,
    assigned_to: null,
    due_at: null,
    summary: CLIENT_FOLLOWUP_SUMMARY,
    required_action: CLIENT_FOLLOWUP_QUESTION_BY_DIMENSION[dimensionKey],
    created_at: NOW,
  }));
}

function actorContext() {
  return {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000001",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_admin" }],
  };
}

/**
 * Splits a SQL SELECT list on top-level commas (parenthesis-depth-aware, so
 * `ROW_NUMBER() OVER (...)` and similar expressions are never split
 * internally).
 */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/**
 * Projects `row` down to exactly the columns named in one SQL statement's own
 * SELECT list - the same thing a real Postgres result row would do. A column
 * never named in the SELECT list is never present on the returned row, even
 * if the in-memory fixture object happens to carry it.
 */
function projectToSelectedColumns(row, sql) {
  const selectIdx = sql.indexOf("SELECT");
  const fromIdx = sql.indexOf("FROM", selectIdx);
  const selectList = sql.slice(selectIdx + "SELECT".length, fromIdx);
  const projected = {};
  for (const rawColumn of splitTopLevel(selectList)) {
    const column = rawColumn.trim();
    if (!column) continue;
    const asMatch = column.match(/\bAS\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i);
    let key;
    if (asMatch) {
      key = asMatch[1];
    } else {
      const withoutCast = column.replace(/::[A-Za-z0-9_]+(\[\])?/g, "").trim();
      const parts = withoutCast.split(".");
      key = parts[parts.length - 1].trim();
    }
    projected[key] = row[key];
  }
  return projected;
}

function project(rows, sql) {
  return rows.map((row) => projectToSelectedColumns(row, sql));
}

/**
 * One fake `tx` shared by both evaluateClaimTraceabilityInTransaction (the
 * getScoped* single-row reads plus its own readGapRows/readFollowupRows/...)
 * and filterCurrentOrganizationEvidenceGaps (the batched reads in
 * postgresOrganizationEvidenceGapCurrentStateRepository.js), fed from one
 * shared fixture, with every result actually projected to the requesting
 * query's own SELECT column list.
 */
function buildFakeTx({ withFollowupTargetsMatchingClaim = true } = {}) {
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
    updated_at: NOW,
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
    updated_at: NOW,
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
  const followupRows = withFollowupTargetsMatchingClaim ? persistedFollowupRows() : [];
  const followupQueueRows = withFollowupTargetsMatchingClaim ? persistedFollowupQueueRows() : [];

  return {
    async query(rawSql) {
      const sql = typeof rawSql === "string" ? rawSql : rawSql?.text ?? "";

      if (sql.startsWith("SET TRANSACTION ISOLATION LEVEL")) return { rows: [] };
      if (sql.includes("FROM kai.gap_log_items")) return { rows: project(gapRows, sql) };
      if (sql.includes("FROM kai.client_followup_items")) return { rows: project(followupRows, sql) };
      if (sql.includes("kai.review_queue_items") && sql.includes("queue_type = 'client_followup'")) {
        return { rows: project(followupQueueRows, sql) };
      }
      if (sql.includes("kai.review_queue_items") && sql.includes("queue_type = 'evidence_review'")) {
        return { rows: project([evidenceReviewQueueItemRow], sql) };
      }
      if (sql.includes("kai.review_queue_items") && sql.includes("queue_type = 'claim_review'")) {
        return { rows: project([claimReviewQueueItemRow], sql) };
      }
      if (sql.includes("kai.review_queue_items") && sql.includes("queue_type = 'conflict_resolution'")) {
        return { rows: [] };
      }
      if (sql.includes("FROM kai.coverage_review_decisions")) return { rows: [] };
      if (sql.includes("kai.conflict_groups")) return { rows: [] };
      if (sql.includes("FROM kai.intake_source_candidates")) return { rows: project([candidateRow], sql) };
      if (sql.includes("FROM kai.intake_promotion_decisions")) return { rows: project([decisionRow], sql) };
      if (sql.includes("FROM kai.intake_sensitivity_profiles")) return { rows: project([profileRow], sql) };
      if (sql.includes("FROM kai.evidence_items e")) return { rows: project(evidenceFieldKeyRows, sql) };
      if (sql.includes("FROM kai.data_dictionary_fields")) return { rows: project(dictionaryFieldRows, sql) };
      if (sql.includes("FROM kai.data_quality_findings")) return { rows: [] };
      if (sql.includes("FROM kai.data_dictionaries")) return { rows: project([dictionaryRow], sql) };
      if (sql.includes("FROM kai.claim_evidence_links")) return { rows: project([claimEvidenceLinkRow], sql) };
      if (sql.includes("FROM kai.evidence_items")) return { rows: project([evidenceItemRow], sql) };
      if (sql.includes("FROM kai.source_locators")) return { rows: project([locatorRow], sql) };
      if (sql.includes("FROM kai.source_versions")) return { rows: project([sourceVersionRow], sql) };
      if (sql.includes("FROM kai.sources")) return { rows: project([sourceRow], sql) };
      if (sql.includes("FROM kai.claims")) return { rows: project([claimRow], sql) };
      if (sql.includes("FROM kai.evidence_review_decisions")) return { rows: [] };
      if (sql.includes("FROM kai.claim_review_decisions")) return { rows: [] };

      throw new Error(`Unhandled fake-tx query in Package 4 column-projection regression: ${sql}`);
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

test("current-with-client-followup parity: traceability accepts a claim with real client_followup_items rows, and the organization-level read must return the same gaps (proven production false negative)", async () => {
  const fakeTx = buildFakeTx();

  const traceability = await runTraceability(fakeTx);
  assert.equal(traceability.ok, true, JSON.stringify(traceability));
  assert.equal(traceability.data.eligible, false);
  assert.ok(traceability.data.blockerCodes.length > 0);
  const traceabilityGapDimensions = traceability.data.gap_items.map((row) => row.dimension_key).sort();
  assert.deepEqual(traceabilityGapDimensions, [...GAP_DIMENSIONS].sort());

  const orgGaps = await runOrganizationEvidenceGaps(fakeTx);
  assert.equal(orgGaps.ok, true, JSON.stringify(orgGaps));
  const orgGapDimensions = orgGaps.data.items.map((row) => row.dimension_key).sort();

  // TOOL_VERIFIED (pre-fix, this repo's current code): traceability returns
  // all six gaps for this claim while the organization-level read returns
  // none, because the batched client_followup_items read never selects
  // question_text and followupRowsMatchExpectation then always fails for a
  // claim with any client-answerable gap - the exact proven production
  // discrepancy. After the repair this assertion holds: both surfaces agree.
  assert.deepEqual(orgGapDimensions, [...GAP_DIMENSIONS].sort());
});

test("stale-state regression stays fail-closed: a real authoritative mismatch is still rejected by both traceability and Package 4", async () => {
  // No client_followup_items/queue rows persisted at all for a claim whose
  // dimensions require them - the same well-established mismatch class the
  // existing Package 4 repair/semantic-parity suites already cover.
  const fakeTx = buildFakeTx({ withFollowupTargetsMatchingClaim: false });

  const traceability = await runTraceability(fakeTx);
  assert.equal(traceability.ok, false, JSON.stringify(traceability));
  assert.equal(traceability.error.code, "conflict_current_state_changed");

  const orgGaps = await runOrganizationEvidenceGaps(fakeTx);
  assert.equal(orgGaps.ok, true, JSON.stringify(orgGaps));
  assert.deepEqual(orgGaps.data.items, []);
});
