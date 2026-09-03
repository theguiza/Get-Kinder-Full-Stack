import {
  SUPPORTED_REQUIREMENT_KEY,
  computeRequirementAssessmentFingerprint as computeIrContrib002Fingerprint,
  deriveRequirementAssessmentState as deriveIrContrib002State,
} from "../validators/kaiRequirementAssessmentValidators.js";
import {
  REQUIREMENT_KEY as IR_COMM_002_REQUIREMENT_KEY,
  computeRequirementAssessmentFingerprint as computeIrComm002Fingerprint,
  deriveRequirementAssessmentState as deriveIrComm002State,
} from "../validators/kaiCommunicationAccountabilityAssessmentValidators.js";
import {
  REQUIREMENT_KEY as IR_PUR_001_REQUIREMENT_KEY,
  computeRequirementAssessmentFingerprint as computeIrPur001Fingerprint,
  deriveRequirementAssessmentState as deriveIrPur001State,
} from "../validators/kaiOutcomeDefinedAssessmentValidators.js";
import {
  REQUIREMENT_KEY as IR_STK_001_REQUIREMENT_KEY,
  computeRequirementAssessmentFingerprint as computeIrStk001Fingerprint,
  deriveRequirementAssessmentState as deriveIrStk001State,
} from "../validators/kaiStakeholderIdentifiedAssessmentValidators.js";
import {
  REQUIREMENT_KEY as IR_DATA_001_REQUIREMENT_KEY,
  computeRequirementAssessmentFingerprint as computeIrData001Fingerprint,
  deriveRequirementAssessmentState as deriveIrData001State,
} from "../validators/kaiSourceGovernanceAssessmentValidators.js";
import {
  REQUIREMENT_KEY as IR_DATA_002_REQUIREMENT_KEY,
  computeRequirementAssessmentFingerprint as computeIrData002Fingerprint,
  deriveRequirementAssessmentState as deriveIrData002State,
} from "../validators/kaiDataQualityDocumentedAssessmentValidators.js";
import {
  REQUIREMENT_KEY as IR_DATA_003_REQUIREMENT_KEY,
  computeRequirementAssessmentFingerprint as computeIrData003Fingerprint,
  deriveRequirementAssessmentState as deriveIrData003State,
} from "../validators/kaiClaimEvidenceTraceabilityAssessmentValidators.js";
import {
  REQUIREMENT_KEY as IR_CONTRIB_003_REQUIREMENT_KEY,
  computeRequirementAssessmentFingerprint as computeIrContrib003Fingerprint,
  deriveRequirementAssessmentState as deriveIrContrib003State,
} from "../validators/kaiConflictGapTrackedAssessmentValidators.js";
import {
  REQUIREMENT_KEY as IR_COMM_001_REQUIREMENT_KEY,
  computeRequirementAssessmentFingerprint as computeIrComm001Fingerprint,
  deriveRequirementAssessmentState as deriveIrComm001State,
} from "../validators/kaiAudiencePermissionKnownAssessmentValidators.js";

/**
 * KAI C3.A3.B durable organization-scope requirement assessment for exactly
 * one requirement - `ir_contrib_002`. This module owns exactly two
 * operations: (1) `assessOrganizationRequirement`, an append-only,
 * idempotent-replay write mirroring C2.1's own
 * `ux_requirement_assessments_c2_1_org_scope_fingerprint` partial-unique-
 * index shape (organization_id, requirement_id, state_fingerprint) WHERE
 * engagement_id IS NULL, plus this requirement's exact evidence/claim
 * provenance links (C2.1, unchanged), the current review-decision links,
 * and the current-gap links (both C3.A3's provenance foundation); and
 * (2) `readOrganizationRequirementAssessment`, a read-only recompute-and-
 * compare currency lookup. Neither operation ever accepts or references an
 * engagement_id - organization-level scope only, per C3.A1's owner
 * decision, unchanged by this repair. Neither operation ever writes to
 * kai.requirement_assessment_evaluation_result_links (impact_evaluation_
 * results is not a material input for ir_contrib_002), and neither ever
 * attempts an UPDATE/DELETE against kai.requirement_assessments or any of
 * its link tables - each table's own append-only trigger already enforces
 * that at the database level.
 *
 * C3A3.B replaces the retired C3.A2 N/R algorithm completely: governed
 * evidence_items/claims are still the universe, but each object's material
 * state is now its CURRENT P2-12 review-decision-ledger lineage-head
 * (never the support_strength/claim_strength projection column, and never
 * a superseded decision), plus, for claims, every currently-applicable
 * confidence-relevant kai.gap_log_items row - determined by the exact same
 * fail-closed currency gate claim traceability already uses
 * (filterCurrentOrganizationEvidenceGaps,
 * postgresOrganizationEvidenceGapCurrentStateRepository.js). See
 * Backend/kai/validators/kaiRequirementAssessmentValidators.js for the
 * classification/fingerprint/state rules themselves - this module only
 * loads the governed inputs, writes the resulting row plus its provenance,
 * and rereads/verifies.
 */

const RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  not_found: 404,
  unsupported_requirement: 422,
  conflict_current_state_changed: 409,
  system_error: 500,
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failure(code) {
  return { ok: false, data: null, error: { code, status: RESULT_STATUS[code] || 500 } };
}

function success(data) {
  return { ok: true, data, error: null };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, allowedKeys) {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isCanonicalUtcTimestamp(value) {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  return new Date(parsed).toISOString() === value;
}

function isAssessOrganizationRequirementInput(input) {
  const allowedKeys = new Set([
    "organizationId", "requirementId", "actorUserId", "actorRole", "now", "metadataOnlyAudit",
  ]);
  if (!isPlainObject(input) || !hasOnlyKeys(input, allowedKeys)) return false;
  return (
    UUID_PATTERN.test(input.organizationId) &&
    UUID_PATTERN.test(input.requirementId) &&
    isNonEmptyString(input.actorUserId) &&
    isNonEmptyString(input.actorRole) &&
    isCanonicalUtcTimestamp(input.now) &&
    Boolean(input.metadataOnlyAudit) &&
    typeof input.metadataOnlyAudit.prepareMetadataOnlyAudit === "function"
  );
}

function isReadOrganizationRequirementAssessmentInput(input) {
  const allowedKeys = new Set(["organizationId", "requirementId"]);
  if (!isPlainObject(input) || !hasOnlyKeys(input, allowedKeys)) return false;
  return UUID_PATTERN.test(input.organizationId) && UUID_PATTERN.test(input.requirementId);
}

function isListOrganizationRequirementsReadinessInput(input) {
  const allowedKeys = new Set(["organizationId"]);
  if (!isPlainObject(input) || !hasOnlyKeys(input, allowedKeys)) return false;
  return UUID_PATTERN.test(input.organizationId);
}

async function resolveDefaultRunInTransaction() {
  const { withTransaction } = await import("../db/kaiDb.js");
  return withTransaction;
}

async function resolveDefaultGapCurrentStateFilter() {
  const { filterCurrentOrganizationEvidenceGaps } = await import("./postgresOrganizationEvidenceGapCurrentStateRepository.js");
  return filterCurrentOrganizationEvidenceGaps;
}

async function loadRequirement(tx, { requirementId }) {
  const { rows } = await tx.query(
    `SELECT requirement_id::text AS requirement_id, requirement_key, requirement_label
       FROM kai.requirements
      WHERE requirement_id = $1::uuid`,
    [requirementId],
  );
  return rows[0] || null;
}

// Catalogue-only read (no organization scope, no assessment state): every
// kai.requirements row whose requirement_key this repository actually has a
// rule for, in the catalogue's own display order. Used only by
// listOrganizationRequirementsReadiness below to discover which
// requirements to report readiness for.
async function loadSupportedRequirementsCatalogue(tx) {
  const { rows } = await tx.query(
    `SELECT requirement_id::text AS requirement_id, requirement_key, requirement_label, display_order
       FROM kai.requirements
      WHERE requirement_key = ANY($1::text[])
      ORDER BY display_order ASC, requirement_key ASC`,
    [Object.keys(REQUIREMENT_ASSESSMENT_RULES)],
  );
  return rows;
}

async function loadGovernedEvidenceItemIds(tx, { organizationId }) {
  const { rows } = await tx.query(
    `SELECT evidence_item_id::text AS evidence_item_id
       FROM kai.evidence_items
      WHERE organization_id = $1::uuid
      ORDER BY evidence_item_id ASC`,
    [organizationId],
  );
  return rows.map((row) => row.evidence_item_id);
}

async function loadGovernedClaimIds(tx, { organizationId }) {
  const { rows } = await tx.query(
    `SELECT claim_id::text AS claim_id
       FROM kai.claims
      WHERE organization_id = $1::uuid
      ORDER BY claim_id ASC`,
    [organizationId],
  );
  return rows.map((row) => row.claim_id);
}

/**
 * Current lineage-head decision per evidence_item_id/claim_id: the P2-12
 * ledger's own invariant guarantees a single chain per (organization,
 * subject), so "the row nothing else supersedes" is exactly one row per
 * subject that has any decision history at all - never a superseded row,
 * regardless of how long the chain is.
 */
async function loadCurrentEvidenceDecisionsByItemId(tx, { organizationId }) {
  const { rows } = await tx.query(
    `SELECT decision_id::text AS decision_id, evidence_item_id::text AS evidence_item_id, decision_outcome
       FROM kai.evidence_review_decisions d
      WHERE organization_id = $1::uuid
        AND NOT EXISTS (
          SELECT 1 FROM kai.evidence_review_decisions s WHERE s.supersedes_decision_id = d.decision_id
        )`,
    [organizationId],
  );
  return new Map(rows.map((row) => [row.evidence_item_id, row]));
}

async function loadCurrentClaimDecisionsByClaimId(tx, { organizationId }) {
  const { rows } = await tx.query(
    `SELECT decision_id::text AS decision_id, claim_id::text AS claim_id, decision_outcome,
            decided_by::text AS decided_by, decided_by_role
       FROM kai.claim_review_decisions d
      WHERE organization_id = $1::uuid
        AND NOT EXISTS (
          SELECT 1 FROM kai.claim_review_decisions s WHERE s.supersedes_decision_id = d.decision_id
        )`,
    [organizationId],
  );
  return new Map(rows.map((row) => [row.claim_id, row]));
}

/**
 * Every gap_log_items row for this organization's claims, narrowed to
 * exactly the currently-applicable subset via the same fail-closed gate
 * claim traceability itself uses - no new currency rule, no reimplementation
 * of P2-02 dimension recomputation here.
 */
async function loadCurrentGapsByClaimId(tx, { organizationId, filterCurrentGaps }) {
  const currentRows = await loadCurrentGapRowsForOrganization(tx, { organizationId, filterCurrentGaps });
  const byClaimId = new Map();
  for (const row of currentRows) {
    if (!byClaimId.has(row.claim_id)) byClaimId.set(row.claim_id, []);
    byClaimId.get(row.claim_id).push(row);
  }
  return byClaimId;
}

async function loadGovernedAssessmentInputs(tx, { organizationId, filterCurrentGaps }) {
  const evidenceItemIds = await loadGovernedEvidenceItemIds(tx, { organizationId });
  const claimIds = await loadGovernedClaimIds(tx, { organizationId });
  const evidenceDecisionsByItemId = await loadCurrentEvidenceDecisionsByItemId(tx, { organizationId });
  const claimDecisionsByClaimId = await loadCurrentClaimDecisionsByClaimId(tx, { organizationId });
  const gapsByClaimId = await loadCurrentGapsByClaimId(tx, { organizationId, filterCurrentGaps });

  const evidenceItems = evidenceItemIds.map((evidenceItemId) => {
    const decision = evidenceDecisionsByItemId.get(evidenceItemId) || null;
    return {
      evidenceItemId,
      decisionId: decision ? decision.decision_id : null,
      decisionOutcome: decision ? decision.decision_outcome : null,
    };
  });

  const claims = claimIds.map((claimId) => {
    const decision = claimDecisionsByClaimId.get(claimId) || null;
    const gaps = (gapsByClaimId.get(claimId) || []).map((gap) => ({
      gapLogItemId: gap.gap_log_item_id,
      dimensionKey: gap.dimension_key,
      assessmentStatus: gap.assessment_status,
      evidenceItemId: gap.evidence_item_id,
      sourceVersionId: gap.source_version_id,
    }));
    return {
      claimId,
      decisionId: decision ? decision.decision_id : null,
      decisionOutcome: decision ? decision.decision_outcome : null,
      gaps,
    };
  });

  return { evidenceItems, claims };
}

/**
 * `ir_comm_002` governed inputs - claims only (no evidence items, no
 * gaps). Reuses `loadGovernedClaimIds` and
 * `loadCurrentClaimDecisionsByClaimId` verbatim, unchanged from the
 * ir_contrib_002 path above, since the "current lineage-head decision per
 * claim_id" fact is identical for both requirements - only what each
 * requirement does with that fact differs.
 */
async function loadGovernedCommunicationAccountabilityInputs(tx, { organizationId }) {
  const claimIds = await loadGovernedClaimIds(tx, { organizationId });
  const claimDecisionsByClaimId = await loadCurrentClaimDecisionsByClaimId(tx, { organizationId });

  const claims = claimIds.map((claimId) => {
    const decision = claimDecisionsByClaimId.get(claimId) || null;
    return {
      claimId,
      decisionId: decision ? decision.decision_id : null,
      decidedBy: decision ? decision.decided_by : null,
      decidedByRole: decision ? decision.decided_by_role : null,
    };
  });

  return { claims };
}

/**
 * `ir_pur_001`/`ir_stk_001` governed inputs - every organization-scope
 * (engagement_id IS NULL) kai.impact_outcome_contexts row. Shared verbatim
 * by both rules since they govern the same object.
 */
async function loadGovernedOutcomeContexts(tx, { organizationId }) {
  const { rows } = await tx.query(
    `SELECT impact_outcome_context_id::text AS impact_outcome_context_id, outcome_key, outcome_statement,
            stakeholder_key, stakeholder_label
       FROM kai.impact_outcome_contexts
      WHERE organization_id = $1::uuid AND engagement_id IS NULL
      ORDER BY impact_outcome_context_id ASC`,
    [organizationId],
  );
  return rows.map((row) => ({
    impactOutcomeContextId: row.impact_outcome_context_id,
    outcomeKey: row.outcome_key,
    outcomeStatement: row.outcome_statement,
    stakeholderKey: row.stakeholder_key,
    stakeholderLabel: row.stakeholder_label,
  }));
}

/**
 * `ir_data_001` governed inputs - every kai.evidence_items row for the
 * organization, joined to its exact source/source_version/promotion-
 * decision identity. evidence_items.source_id/source_version_id are always
 * populated (NOT NULL), and a source_version only exists once its
 * candidate has been promoted, so this INNER JOIN chain never silently
 * drops a governed evidence item.
 */
async function loadGovernedEvidenceSourceInputs(tx, { organizationId }) {
  const { rows } = await tx.query(
    `SELECT ei.evidence_item_id::text AS evidence_item_id,
            ei.source_id::text AS source_id,
            ei.source_version_id::text AS source_version_id,
            sv.intake_source_candidate_id::text AS intake_source_candidate_id,
            sv.is_current AS is_current,
            ipd.intake_promotion_decision_id::text AS intake_promotion_decision_id,
            ipd.decision_status AS decision_status,
            ipd.reviewed_source_type AS reviewed_source_type
       FROM kai.evidence_items ei
       JOIN kai.source_versions sv
         ON sv.source_version_id = ei.source_version_id AND sv.organization_id = ei.organization_id
       JOIN kai.intake_promotion_decisions ipd
         ON ipd.organization_id = ei.organization_id AND ipd.intake_source_candidate_id = sv.intake_source_candidate_id
      WHERE ei.organization_id = $1::uuid
      ORDER BY ei.evidence_item_id ASC`,
    [organizationId],
  );
  return rows.map((row) => ({
    evidenceItemId: row.evidence_item_id,
    sourceId: row.source_id,
    sourceVersionId: row.source_version_id,
    intakeSourceCandidateId: row.intake_source_candidate_id,
    isCurrent: row.is_current,
    intakePromotionDecisionId: row.intake_promotion_decision_id,
    decisionStatus: row.decision_status,
    reviewedSourceType: row.reviewed_source_type,
  }));
}

/**
 * Shared current-gap query underlying both `loadCurrentGapsByClaimId`
 * (ir_contrib_002, grouped by claim) and the flat, ungrouped universe
 * `ir_data_002`/`ir_contrib_003` need - identical SQL/currency-gate, two
 * different shapes of the same result.
 */
async function loadCurrentGapRowsForOrganization(tx, { organizationId, filterCurrentGaps }) {
  const { rows } = await tx.query(
    `SELECT gap_log_item_id::text AS gap_log_item_id, claim_id::text AS claim_id,
            evidence_item_id::text AS evidence_item_id, source_version_id::text AS source_version_id,
            dimension_key, assessment_status
       FROM kai.gap_log_items
      WHERE organization_id = $1::uuid`,
    [organizationId],
  );
  return filterCurrentGaps(tx, { organizationId, candidateGapRows: rows });
}

async function loadCurrentGapsFlatForOrganization(tx, { organizationId, filterCurrentGaps }) {
  const currentRows = await loadCurrentGapRowsForOrganization(tx, { organizationId, filterCurrentGaps });
  return currentRows.map((row) => ({
    gapLogItemId: row.gap_log_item_id,
    claimId: row.claim_id,
    evidenceItemId: row.evidence_item_id,
    sourceVersionId: row.source_version_id,
    dimensionKey: row.dimension_key,
    assessmentStatus: row.assessment_status,
  }));
}

/**
 * `ir_data_003` governed inputs - every kai.claims row for the
 * organization, joined (LEFT) to its at-most-one kai.claim_evidence_links
 * row (claim_evidence_links_p2_03_one_link_per_claim_unique guarantees at
 * most one).
 */
async function loadGovernedClaimEvidenceTraceabilityInputs(tx, { organizationId }) {
  const { rows } = await tx.query(
    `SELECT c.claim_id::text AS claim_id, cel.evidence_item_id::text AS evidence_item_id
       FROM kai.claims c
       LEFT JOIN kai.claim_evidence_links cel
         ON cel.claim_id = c.claim_id AND cel.organization_id = c.organization_id
      WHERE c.organization_id = $1::uuid
      ORDER BY c.claim_id ASC`,
    [organizationId],
  );
  return rows.map((row) => ({ claimId: row.claim_id, evidenceItemId: row.evidence_item_id }));
}

/**
 * `ir_contrib_003` conflict-pairing provenance input - every
 * kai.conflict_groups row for the organization (append-only, no UPDATE
 * path). Expanded into one (conflictGroupId, claimId) row per participant
 * claim so both sides of a pairing get their own citation.
 */
async function loadGovernedConflictGroupClaimLinks(tx, { organizationId }) {
  const { rows } = await tx.query(
    `SELECT conflict_group_id::text AS conflict_group_id, lower_claim_id::text AS lower_claim_id,
            higher_claim_id::text AS higher_claim_id
       FROM kai.conflict_groups
      WHERE organization_id = $1::uuid
      ORDER BY conflict_group_id ASC`,
    [organizationId],
  );
  const links = [];
  for (const row of rows) {
    links.push({ conflictGroupId: row.conflict_group_id, claimId: row.lower_claim_id });
    links.push({ conflictGroupId: row.conflict_group_id, claimId: row.higher_claim_id });
  }
  return links;
}

/**
 * `ir_comm_001` governed inputs - every kai.claims row for the
 * organization, joined to its current (non-superseded) lineage-head
 * kai.claim_review_decisions row, additionally selecting
 * approved_audiences (not needed by ir_comm_002, so kept as its own query
 * rather than widening `loadCurrentClaimDecisionsByClaimId`'s existing
 * shape/callers).
 */
async function loadCurrentClaimAudienceDecisionsByClaimId(tx, { organizationId }) {
  const { rows } = await tx.query(
    `SELECT decision_id::text AS decision_id, claim_id::text AS claim_id, approved_audiences
       FROM kai.claim_review_decisions d
      WHERE organization_id = $1::uuid
        AND NOT EXISTS (
          SELECT 1 FROM kai.claim_review_decisions s WHERE s.supersedes_decision_id = d.decision_id
        )`,
    [organizationId],
  );
  return new Map(rows.map((row) => [row.claim_id, row]));
}

async function loadGovernedAudiencePermissionInputs(tx, { organizationId }) {
  const claimIds = await loadGovernedClaimIds(tx, { organizationId });
  const decisionsByClaimId = await loadCurrentClaimAudienceDecisionsByClaimId(tx, { organizationId });
  const claims = claimIds.map((claimId) => {
    const decision = decisionsByClaimId.get(claimId) || null;
    return {
      claimId,
      decisionId: decision ? decision.decision_id : null,
      approvedAudiences: decision ? decision.approved_audiences : null,
    };
  });
  return { claims };
}

/**
 * Explicit two-entry rule table (NOT a generic plugin/catalogue system):
 * exactly the two requirement keys this repository supports, each mapped to
 * its own loader/state-derivation/fingerprint/provenance-write/expected-
 * provenance-ids functions plus its own audit labels. `ir_contrib_002`'s
 * entry is byte-identical in behavior to the pre-C3.B2 code path - it still
 * calls the same `loadGovernedAssessmentInputs`/`deriveIrContrib002State`/
 * `computeIrContrib002Fingerprint` functions and writes the same five link
 * tables. `ir_comm_002`'s entry writes only claim membership and claim
 * review-decision provenance - never evidence or gap provenance.
 */
const REQUIREMENT_ASSESSMENT_RULES = Object.freeze({
  [SUPPORTED_REQUIREMENT_KEY]: Object.freeze({
    requirementKey: SUPPORTED_REQUIREMENT_KEY,
    async loadInputs(tx, { organizationId, filterCurrentGaps }) {
      return loadGovernedAssessmentInputs(tx, { organizationId, filterCurrentGaps });
    },
    deriveState(inputs) {
      return deriveIrContrib002State(inputs);
    },
    computeFingerprint(inputs) {
      return computeIrContrib002Fingerprint(inputs);
    },
    async writeProvenance(tx, { organizationId, requirementAssessmentId, inputs }) {
      for (const evidenceItem of inputs.evidenceItems) {
        await insertEvidenceLink(tx, {
          organizationId,
          requirementAssessmentId,
          evidenceItemId: evidenceItem.evidenceItemId,
        });
        if (evidenceItem.decisionId !== null) {
          await insertEvidenceDecisionLink(tx, {
            organizationId,
            requirementAssessmentId,
            evidenceItemId: evidenceItem.evidenceItemId,
            decisionId: evidenceItem.decisionId,
          });
        }
      }
      for (const claim of inputs.claims) {
        await insertClaimLink(tx, {
          organizationId,
          requirementAssessmentId,
          claimId: claim.claimId,
        });
        if (claim.decisionId !== null) {
          await insertClaimDecisionLink(tx, {
            organizationId,
            requirementAssessmentId,
            claimId: claim.claimId,
            decisionId: claim.decisionId,
          });
        }
        for (const gap of claim.gaps) {
          await insertGapLink(tx, {
            organizationId,
            requirementAssessmentId,
            claimId: claim.claimId,
            gap,
          });
        }
      }
    },
    expectedProvenanceIds(inputs) {
      return {
        evidenceItemIds: inputs.evidenceItems.map((row) => row.evidenceItemId),
        claimIds: inputs.claims.map((row) => row.claimId),
        evidenceDecisionIds: inputs.evidenceItems.filter((row) => row.decisionId !== null).map((row) => row.decisionId),
        claimDecisionIds: inputs.claims.filter((row) => row.decisionId !== null).map((row) => row.decisionId),
        gapLogItemIds: inputs.claims.flatMap((claim) => claim.gaps.map((gap) => gap.gapLogItemId)),
      };
    },
    attemptedOperation: "c3_a2_requirement_assessment_created",
    validatorKey: "VAL-KAI-C3-A2-001",
  }),
  [IR_COMM_002_REQUIREMENT_KEY]: Object.freeze({
    requirementKey: IR_COMM_002_REQUIREMENT_KEY,
    async loadInputs(tx, { organizationId }) {
      return loadGovernedCommunicationAccountabilityInputs(tx, { organizationId });
    },
    deriveState(inputs) {
      return deriveIrComm002State(inputs);
    },
    computeFingerprint(inputs) {
      return computeIrComm002Fingerprint(inputs);
    },
    async writeProvenance(tx, { organizationId, requirementAssessmentId, inputs }) {
      for (const claim of inputs.claims) {
        await insertClaimLink(tx, {
          organizationId,
          requirementAssessmentId,
          claimId: claim.claimId,
        });
        if (claim.decisionId !== null) {
          await insertClaimDecisionLink(tx, {
            organizationId,
            requirementAssessmentId,
            claimId: claim.claimId,
            decisionId: claim.decisionId,
          });
        }
      }
    },
    expectedProvenanceIds(inputs) {
      return {
        evidenceItemIds: [],
        claimIds: inputs.claims.map((row) => row.claimId),
        evidenceDecisionIds: [],
        claimDecisionIds: inputs.claims.filter((row) => row.decisionId !== null).map((row) => row.decisionId),
        gapLogItemIds: [],
      };
    },
    attemptedOperation: "c3_b_communication_accountability_requirement_assessment_created",
    validatorKey: "VAL-KAI-C3-B2-001",
  }),
  [IR_PUR_001_REQUIREMENT_KEY]: Object.freeze({
    requirementKey: IR_PUR_001_REQUIREMENT_KEY,
    async loadInputs(tx, { organizationId }) {
      const outcomeContexts = await loadGovernedOutcomeContexts(tx, { organizationId });
      return { outcomeContexts };
    },
    deriveState(inputs) {
      return deriveIrPur001State(inputs);
    },
    computeFingerprint(inputs) {
      return computeIrPur001Fingerprint(inputs);
    },
    async writeProvenance(tx, { organizationId, requirementAssessmentId, inputs }) {
      for (const context of inputs.outcomeContexts) {
        await insertOutcomeContextLink(tx, { organizationId, requirementAssessmentId, context });
      }
    },
    expectedProvenanceIds(inputs) {
      return {
        evidenceItemIds: [], claimIds: [], evidenceDecisionIds: [], claimDecisionIds: [], gapLogItemIds: [],
        outcomeContextIds: inputs.outcomeContexts.map((row) => row.impactOutcomeContextId),
      };
    },
    attemptedOperation: "c3_b3_ir_pur_001_requirement_assessment_created",
    validatorKey: "VAL-KAI-C3-B3-IR-PUR-001",
  }),
  [IR_STK_001_REQUIREMENT_KEY]: Object.freeze({
    requirementKey: IR_STK_001_REQUIREMENT_KEY,
    async loadInputs(tx, { organizationId }) {
      const outcomeContexts = await loadGovernedOutcomeContexts(tx, { organizationId });
      return { outcomeContexts };
    },
    deriveState(inputs) {
      return deriveIrStk001State(inputs);
    },
    computeFingerprint(inputs) {
      return computeIrStk001Fingerprint(inputs);
    },
    async writeProvenance(tx, { organizationId, requirementAssessmentId, inputs }) {
      for (const context of inputs.outcomeContexts) {
        await insertOutcomeContextLink(tx, { organizationId, requirementAssessmentId, context });
      }
    },
    expectedProvenanceIds(inputs) {
      return {
        evidenceItemIds: [], claimIds: [], evidenceDecisionIds: [], claimDecisionIds: [], gapLogItemIds: [],
        outcomeContextIds: inputs.outcomeContexts.map((row) => row.impactOutcomeContextId),
      };
    },
    attemptedOperation: "c3_b3_ir_stk_001_requirement_assessment_created",
    validatorKey: "VAL-KAI-C3-B3-IR-STK-001",
  }),
  [IR_DATA_001_REQUIREMENT_KEY]: Object.freeze({
    requirementKey: IR_DATA_001_REQUIREMENT_KEY,
    async loadInputs(tx, { organizationId }) {
      const evidenceSources = await loadGovernedEvidenceSourceInputs(tx, { organizationId });
      return { evidenceSources };
    },
    deriveState(inputs) {
      return deriveIrData001State(inputs);
    },
    computeFingerprint(inputs) {
      return computeIrData001Fingerprint(inputs);
    },
    async writeProvenance(tx, { organizationId, requirementAssessmentId, inputs }) {
      for (const evidenceSource of inputs.evidenceSources) {
        await insertEvidenceLink(tx, { organizationId, requirementAssessmentId, evidenceItemId: evidenceSource.evidenceItemId });
        await insertSourcePromotionLink(tx, { organizationId, requirementAssessmentId, evidenceSource });
      }
    },
    expectedProvenanceIds(inputs) {
      return {
        evidenceItemIds: inputs.evidenceSources.map((row) => row.evidenceItemId),
        claimIds: [], evidenceDecisionIds: [], claimDecisionIds: [], gapLogItemIds: [],
        sourcePromotionEvidenceItemIds: inputs.evidenceSources.map((row) => row.evidenceItemId),
      };
    },
    attemptedOperation: "c3_b3_ir_data_001_requirement_assessment_created",
    validatorKey: "VAL-KAI-C3-B3-IR-DATA-001",
  }),
  [IR_DATA_002_REQUIREMENT_KEY]: Object.freeze({
    requirementKey: IR_DATA_002_REQUIREMENT_KEY,
    async loadInputs(tx, { organizationId, filterCurrentGaps }) {
      const gaps = await loadCurrentGapsFlatForOrganization(tx, { organizationId, filterCurrentGaps });
      return { gaps };
    },
    deriveState(inputs) {
      return deriveIrData002State(inputs);
    },
    computeFingerprint(inputs) {
      return computeIrData002Fingerprint(inputs);
    },
    async writeProvenance(tx, { organizationId, requirementAssessmentId, inputs }) {
      for (const gap of inputs.gaps) {
        await insertGapLink(tx, { organizationId, requirementAssessmentId, claimId: gap.claimId, gap });
      }
    },
    expectedProvenanceIds(inputs) {
      return {
        evidenceItemIds: [], claimIds: [], evidenceDecisionIds: [], claimDecisionIds: [],
        gapLogItemIds: inputs.gaps.map((row) => row.gapLogItemId),
      };
    },
    attemptedOperation: "c3_b3_ir_data_002_requirement_assessment_created",
    validatorKey: "VAL-KAI-C3-B3-IR-DATA-002",
  }),
  [IR_DATA_003_REQUIREMENT_KEY]: Object.freeze({
    requirementKey: IR_DATA_003_REQUIREMENT_KEY,
    async loadInputs(tx, { organizationId }) {
      const claims = await loadGovernedClaimEvidenceTraceabilityInputs(tx, { organizationId });
      return { claims };
    },
    deriveState(inputs) {
      return deriveIrData003State(inputs);
    },
    computeFingerprint(inputs) {
      return computeIrData003Fingerprint(inputs);
    },
    async writeProvenance(tx, { organizationId, requirementAssessmentId, inputs }) {
      for (const claim of inputs.claims) {
        await insertClaimLink(tx, { organizationId, requirementAssessmentId, claimId: claim.claimId });
        if (claim.evidenceItemId !== null) {
          await insertEvidenceLink(tx, { organizationId, requirementAssessmentId, evidenceItemId: claim.evidenceItemId });
        }
      }
    },
    expectedProvenanceIds(inputs) {
      return {
        evidenceItemIds: inputs.claims.filter((row) => row.evidenceItemId !== null).map((row) => row.evidenceItemId),
        claimIds: inputs.claims.map((row) => row.claimId),
        evidenceDecisionIds: [], claimDecisionIds: [], gapLogItemIds: [],
      };
    },
    attemptedOperation: "c3_b3_ir_data_003_requirement_assessment_created",
    validatorKey: "VAL-KAI-C3-B3-IR-DATA-003",
  }),
  [IR_CONTRIB_003_REQUIREMENT_KEY]: Object.freeze({
    requirementKey: IR_CONTRIB_003_REQUIREMENT_KEY,
    async loadInputs(tx, { organizationId, filterCurrentGaps }) {
      const gaps = await loadCurrentGapsFlatForOrganization(tx, { organizationId, filterCurrentGaps });
      const conflictLinks = await loadGovernedConflictGroupClaimLinks(tx, { organizationId });
      return { gaps, conflictLinks };
    },
    deriveState(inputs) {
      return deriveIrContrib003State(inputs);
    },
    computeFingerprint(inputs) {
      return computeIrContrib003Fingerprint(inputs);
    },
    async writeProvenance(tx, { organizationId, requirementAssessmentId, inputs }) {
      for (const gap of inputs.gaps) {
        await insertGapLink(tx, { organizationId, requirementAssessmentId, claimId: gap.claimId, gap });
      }
      for (const link of inputs.conflictLinks) {
        await insertConflictResolutionLink(tx, {
          organizationId, requirementAssessmentId, claimId: link.claimId, conflictGroupId: link.conflictGroupId,
        });
      }
    },
    expectedProvenanceIds(inputs) {
      return {
        evidenceItemIds: [], claimIds: [], evidenceDecisionIds: [], claimDecisionIds: [],
        gapLogItemIds: inputs.gaps.map((row) => row.gapLogItemId),
        conflictResolutionPairs: inputs.conflictLinks.map((row) => `${row.conflictGroupId}:${row.claimId}`),
      };
    },
    attemptedOperation: "c3_b3_ir_contrib_003_requirement_assessment_created",
    validatorKey: "VAL-KAI-C3-B3-IR-CONTRIB-003",
  }),
  [IR_COMM_001_REQUIREMENT_KEY]: Object.freeze({
    requirementKey: IR_COMM_001_REQUIREMENT_KEY,
    async loadInputs(tx, { organizationId }) {
      return loadGovernedAudiencePermissionInputs(tx, { organizationId });
    },
    deriveState(inputs) {
      return deriveIrComm001State(inputs);
    },
    computeFingerprint(inputs) {
      return computeIrComm001Fingerprint(inputs);
    },
    async writeProvenance(tx, { organizationId, requirementAssessmentId, inputs }) {
      for (const claim of inputs.claims) {
        await insertClaimLink(tx, { organizationId, requirementAssessmentId, claimId: claim.claimId });
        if (claim.decisionId !== null) {
          await insertClaimDecisionLink(tx, { organizationId, requirementAssessmentId, claimId: claim.claimId, decisionId: claim.decisionId });
        }
      }
    },
    expectedProvenanceIds(inputs) {
      return {
        evidenceItemIds: [],
        claimIds: inputs.claims.map((row) => row.claimId),
        evidenceDecisionIds: [],
        claimDecisionIds: inputs.claims.filter((row) => row.decisionId !== null).map((row) => row.decisionId),
        gapLogItemIds: [],
      };
    },
    attemptedOperation: "c3_b3_ir_comm_001_requirement_assessment_created",
    validatorKey: "VAL-KAI-C3-B3-IR-COMM-001",
  }),
});

/**
 * Verifies the requirement exists at all and, if so, that it is one of the
 * exactly two requirements this package supports. Returns either
 * { ok: true, requirement, rule } or { ok: false, failure: <failure(...) result> }.
 * Callers must check this before touching kai.requirement_assessments or any
 * link table at all - zero writes on an unsupported/nonexistent requirement.
 */
async function loadSupportedRequirementOrFail(tx, { requirementId }) {
  const requirement = await loadRequirement(tx, { requirementId });
  if (!requirement) return { ok: false, failure: failure("not_found") };
  const rule = Object.hasOwn(REQUIREMENT_ASSESSMENT_RULES, requirement.requirement_key)
    ? REQUIREMENT_ASSESSMENT_RULES[requirement.requirement_key]
    : null;
  if (!rule) {
    return { ok: false, failure: failure("unsupported_requirement") };
  }
  return { ok: true, requirement, rule };
}

async function insertAssessmentRow(tx, { organizationId, requirementId, assessmentState, explanation, stateFingerprint, actorUserId, now }) {
  const { rows } = await tx.query(
    `INSERT INTO kai.requirement_assessments (
       organization_id, engagement_id, requirement_id, assessment_state, assessment_explanation,
       state_fingerprint, created_by, created_by_type, created_at
     ) VALUES ($1::uuid, NULL, $2::uuid, $3, $4, $5, $6::uuid, 'human', $7::timestamptz)
     ON CONFLICT (organization_id, requirement_id, state_fingerprint) WHERE engagement_id IS NULL
       DO NOTHING
     RETURNING requirement_assessment_id::text AS requirement_assessment_id, organization_id::text AS organization_id,
               engagement_id, requirement_id::text AS requirement_id, assessment_state, assessment_explanation,
               state_fingerprint, created_at`,
    [organizationId, requirementId, assessmentState, explanation, stateFingerprint, actorUserId, now],
  );
  return rows[0] || null;
}

async function readExistingAssessmentRow(tx, { organizationId, requirementId, stateFingerprint }) {
  const { rows } = await tx.query(
    `SELECT requirement_assessment_id::text AS requirement_assessment_id, organization_id::text AS organization_id,
            engagement_id, requirement_id::text AS requirement_id, assessment_state, assessment_explanation,
            state_fingerprint, created_at
       FROM kai.requirement_assessments
      WHERE organization_id = $1::uuid
        AND requirement_id = $2::uuid
        AND state_fingerprint = $3
        AND engagement_id IS NULL`,
    [organizationId, requirementId, stateFingerprint],
  );
  return rows[0] || null;
}

async function insertEvidenceLink(tx, { organizationId, requirementAssessmentId, evidenceItemId }) {
  await tx.query(
    `INSERT INTO kai.requirement_assessment_evidence_links (organization_id, requirement_assessment_id, evidence_item_id)
     VALUES ($1::uuid, $2::uuid, $3::uuid)`,
    [organizationId, requirementAssessmentId, evidenceItemId],
  );
}

async function insertClaimLink(tx, { organizationId, requirementAssessmentId, claimId }) {
  await tx.query(
    `INSERT INTO kai.requirement_assessment_claim_links (organization_id, requirement_assessment_id, claim_id)
     VALUES ($1::uuid, $2::uuid, $3::uuid)`,
    [organizationId, requirementAssessmentId, claimId],
  );
}

async function insertEvidenceDecisionLink(tx, { organizationId, requirementAssessmentId, evidenceItemId, decisionId }) {
  await tx.query(
    `INSERT INTO kai.ra_evidence_review_decision_links (organization_id, requirement_assessment_id, evidence_item_id, decision_id)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)`,
    [organizationId, requirementAssessmentId, evidenceItemId, decisionId],
  );
}

async function insertClaimDecisionLink(tx, { organizationId, requirementAssessmentId, claimId, decisionId }) {
  await tx.query(
    `INSERT INTO kai.ra_claim_review_decision_links (organization_id, requirement_assessment_id, claim_id, decision_id)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)`,
    [organizationId, requirementAssessmentId, claimId, decisionId],
  );
}

async function insertGapLink(tx, { organizationId, requirementAssessmentId, claimId, gap }) {
  await tx.query(
    `INSERT INTO kai.ra_gap_links
       (organization_id, requirement_assessment_id, gap_log_item_id, claim_id, evidence_item_id, source_version_id, dimension_key, assessment_status)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7, $8)`,
    [organizationId, requirementAssessmentId, gap.gapLogItemId, claimId, gap.evidenceItemId, gap.sourceVersionId, gap.dimensionKey, gap.assessmentStatus],
  );
}

async function insertOutcomeContextLink(tx, { organizationId, requirementAssessmentId, context }) {
  await tx.query(
    `INSERT INTO kai.ra_outcome_context_links
       (organization_id, requirement_assessment_id, impact_outcome_context_id, outcome_key, outcome_statement, stakeholder_key, stakeholder_label)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7)`,
    [organizationId, requirementAssessmentId, context.impactOutcomeContextId, context.outcomeKey, context.outcomeStatement, context.stakeholderKey, context.stakeholderLabel],
  );
}

async function insertSourcePromotionLink(tx, { organizationId, requirementAssessmentId, evidenceSource }) {
  await tx.query(
    `INSERT INTO kai.ra_source_promotion_links
       (organization_id, requirement_assessment_id, evidence_item_id, source_id, source_version_id,
        intake_source_candidate_id, intake_promotion_decision_id, is_current, decision_status, reviewed_source_type)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::uuid, $8, $9, $10)`,
    [
      organizationId, requirementAssessmentId, evidenceSource.evidenceItemId, evidenceSource.sourceId,
      evidenceSource.sourceVersionId, evidenceSource.intakeSourceCandidateId, evidenceSource.intakePromotionDecisionId,
      evidenceSource.isCurrent, evidenceSource.decisionStatus, evidenceSource.reviewedSourceType,
    ],
  );
}

async function insertConflictResolutionLink(tx, { organizationId, requirementAssessmentId, claimId, conflictGroupId }) {
  await tx.query(
    `INSERT INTO kai.ra_conflict_resolution_links (organization_id, requirement_assessment_id, claim_id, conflict_group_id)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)`,
    [organizationId, requirementAssessmentId, claimId, conflictGroupId],
  );
}

async function readAssessmentProvenance(tx, { organizationId, requirementAssessmentId }) {
  const evidenceLinkRows = await tx.query(
    `SELECT evidence_item_id::text AS evidence_item_id
       FROM kai.requirement_assessment_evidence_links
      WHERE organization_id = $1::uuid AND requirement_assessment_id = $2::uuid
      ORDER BY evidence_item_id ASC`,
    [organizationId, requirementAssessmentId],
  );
  const claimLinkRows = await tx.query(
    `SELECT claim_id::text AS claim_id
       FROM kai.requirement_assessment_claim_links
      WHERE organization_id = $1::uuid AND requirement_assessment_id = $2::uuid
      ORDER BY claim_id ASC`,
    [organizationId, requirementAssessmentId],
  );
  const evidenceDecisionLinkRows = await tx.query(
    `SELECT evidence_item_id::text AS evidence_item_id, decision_id::text AS decision_id
       FROM kai.ra_evidence_review_decision_links
      WHERE organization_id = $1::uuid AND requirement_assessment_id = $2::uuid
      ORDER BY evidence_item_id ASC`,
    [organizationId, requirementAssessmentId],
  );
  const claimDecisionLinkRows = await tx.query(
    `SELECT claim_id::text AS claim_id, decision_id::text AS decision_id
       FROM kai.ra_claim_review_decision_links
      WHERE organization_id = $1::uuid AND requirement_assessment_id = $2::uuid
      ORDER BY claim_id ASC`,
    [organizationId, requirementAssessmentId],
  );
  const gapLinkRows = await tx.query(
    `SELECT gap_log_item_id::text AS gap_log_item_id, claim_id::text AS claim_id,
            dimension_key, assessment_status
       FROM kai.ra_gap_links
      WHERE organization_id = $1::uuid AND requirement_assessment_id = $2::uuid
      ORDER BY gap_log_item_id ASC`,
    [organizationId, requirementAssessmentId],
  );
  const outcomeContextLinkRows = await tx.query(
    `SELECT impact_outcome_context_id::text AS impact_outcome_context_id
       FROM kai.ra_outcome_context_links
      WHERE organization_id = $1::uuid AND requirement_assessment_id = $2::uuid
      ORDER BY impact_outcome_context_id ASC`,
    [organizationId, requirementAssessmentId],
  );
  const sourcePromotionLinkRows = await tx.query(
    `SELECT evidence_item_id::text AS evidence_item_id, intake_promotion_decision_id::text AS intake_promotion_decision_id
       FROM kai.ra_source_promotion_links
      WHERE organization_id = $1::uuid AND requirement_assessment_id = $2::uuid
      ORDER BY evidence_item_id ASC`,
    [organizationId, requirementAssessmentId],
  );
  const conflictResolutionLinkRows = await tx.query(
    `SELECT conflict_group_id::text AS conflict_group_id, claim_id::text AS claim_id
       FROM kai.ra_conflict_resolution_links
      WHERE organization_id = $1::uuid AND requirement_assessment_id = $2::uuid
      ORDER BY conflict_group_id ASC, claim_id ASC`,
    [organizationId, requirementAssessmentId],
  );
  return {
    evidenceItemIds: evidenceLinkRows.rows.map((row) => row.evidence_item_id),
    claimIds: claimLinkRows.rows.map((row) => row.claim_id),
    evidenceDecisionLinks: evidenceDecisionLinkRows.rows,
    claimDecisionLinks: claimDecisionLinkRows.rows,
    gapLinks: gapLinkRows.rows,
    outcomeContextIds: outcomeContextLinkRows.rows.map((row) => row.impact_outcome_context_id),
    sourcePromotionEvidenceItemIds: sourcePromotionLinkRows.rows.map((row) => row.evidence_item_id),
    conflictResolutionPairs: conflictResolutionLinkRows.rows.map((row) => `${row.conflict_group_id}:${row.claim_id}`),
  };
}

class RequirementAssessmentRollbackError extends Error {
  constructor(result) {
    super("rollback requirement-assessment transaction");
    this.name = "RequirementAssessmentRollbackError";
    this.result = result;
  }
}

function rollbackFailure(code) {
  throw new RequirementAssessmentRollbackError(failure(code));
}

class MalformedResultRowError extends Error {
  constructor(what) {
    super(`${what} row failed post-write validation`);
    this.name = "MalformedResultRowError";
  }
}

class RequiredAuditRejectedError extends Error {
  constructor() {
    super("required metadata-only audit was rejected");
    this.name = "RequiredAuditRejectedError";
  }
}

function prepareRequiredAudit(metadataOnlyAudit, payload, tx) {
  const prepared = metadataOnlyAudit.prepareMetadataOnlyAudit({ payload, db: tx });
  const okDescriptor =
    prepared !== null && typeof prepared === "object" && !Array.isArray(prepared)
      ? Object.getOwnPropertyDescriptor(prepared, "ok")
      : undefined;
  const auditConfirmed =
    okDescriptor !== undefined &&
    Object.hasOwn(okDescriptor, "value") &&
    okDescriptor.value === true &&
    typeof prepared.publish === "function";
  if (!auditConfirmed) throw new RequiredAuditRejectedError();
  return prepared;
}

function toAssessmentRecord(row, replayed) {
  return {
    requirement_assessment_id: row.requirement_assessment_id,
    organization_id: row.organization_id,
    engagement_id: row.engagement_id,
    requirement_id: row.requirement_id,
    assessment_state: row.assessment_state,
    assessment_explanation: row.assessment_explanation,
    state_fingerprint: row.state_fingerprint,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    replayed,
  };
}

function sortedIds(ids) {
  return [...ids].sort();
}

/**
 * Post-write validation (mirroring A1.4/A2.2's re-read-and-verify
 * discipline): rereads exactly what was just inserted inside the same
 * transaction and proves it matches the in-memory intended write byte-for-
 * byte before any audit is prepared or the transaction is allowed to
 * commit. Now covers the C3.A3 decision-link and gap-link provenance too,
 * not just C2.1's bare evidence/claim membership links.
 */
function persistedAssessmentMatchesExpected(persistedRow, persistedProvenance, expected) {
  if (!persistedRow) return false;
  if (
    persistedRow.organization_id !== expected.organizationId ||
    persistedRow.requirement_id !== expected.requirementId ||
    persistedRow.engagement_id !== null ||
    persistedRow.assessment_state !== expected.assessmentState ||
    persistedRow.assessment_explanation !== expected.explanation ||
    persistedRow.state_fingerprint !== expected.stateFingerprint
  ) return false;

  if (JSON.stringify(sortedIds(persistedProvenance.evidenceItemIds)) !== JSON.stringify(sortedIds(expected.evidenceItemIds))) return false;
  if (JSON.stringify(sortedIds(persistedProvenance.claimIds)) !== JSON.stringify(sortedIds(expected.claimIds))) return false;

  const persistedEvidenceDecisionIds = sortedIds(persistedProvenance.evidenceDecisionLinks.map((row) => row.decision_id));
  if (JSON.stringify(persistedEvidenceDecisionIds) !== JSON.stringify(sortedIds(expected.evidenceDecisionIds))) return false;

  const persistedClaimDecisionIds = sortedIds(persistedProvenance.claimDecisionLinks.map((row) => row.decision_id));
  if (JSON.stringify(persistedClaimDecisionIds) !== JSON.stringify(sortedIds(expected.claimDecisionIds))) return false;

  const persistedGapIds = sortedIds(persistedProvenance.gapLinks.map((row) => row.gap_log_item_id));
  if (JSON.stringify(persistedGapIds) !== JSON.stringify(sortedIds(expected.gapLogItemIds))) return false;

  const persistedOutcomeContextIds = sortedIds(persistedProvenance.outcomeContextIds);
  if (JSON.stringify(persistedOutcomeContextIds) !== JSON.stringify(sortedIds(expected.outcomeContextIds || []))) return false;

  const persistedSourcePromotionIds = sortedIds(persistedProvenance.sourcePromotionEvidenceItemIds);
  if (JSON.stringify(persistedSourcePromotionIds) !== JSON.stringify(sortedIds(expected.sourcePromotionEvidenceItemIds || []))) return false;

  const persistedConflictPairs = sortedIds(persistedProvenance.conflictResolutionPairs);
  if (JSON.stringify(persistedConflictPairs) !== JSON.stringify(sortedIds(expected.conflictResolutionPairs || []))) return false;

  return true;
}

export function createPostgresRequirementAssessmentRepository({ runInTransaction, filterCurrentGaps } = {}) {
  return Object.freeze({
    async assessOrganizationRequirement(input) {
      if (!isAssessOrganizationRequirementInput(input)) return failure("validation_blocker");
      const { organizationId, requirementId, actorUserId, now, metadataOnlyAudit } = input;
      const run = runInTransaction || (await resolveDefaultRunInTransaction());
      const filterCurrentGapsFn = filterCurrentGaps || (await resolveDefaultGapCurrentStateFilter());

      try {
        return await run(async (tx) => {
          const requirementLookup = await loadSupportedRequirementOrFail(tx, { requirementId });
          if (!requirementLookup.ok) return requirementLookup.failure;
          const rule = requirementLookup.rule;

          const inputs = await rule.loadInputs(tx, { organizationId, filterCurrentGaps: filterCurrentGapsFn });

          const { assessmentState, explanation } = rule.deriveState(inputs);
          const stateFingerprint = rule.computeFingerprint(inputs);

          const insertedRow = await insertAssessmentRow(tx, {
            organizationId,
            requirementId,
            assessmentState,
            explanation,
            stateFingerprint,
            actorUserId,
            now,
          });

          if (!insertedRow) {
            // Replay: an identical-fingerprint row already exists for this
            // org+requirement. A true replay is a complete no-op besides
            // this reread - zero new provenance-link rows, zero new audit.
            const existingRow = await readExistingAssessmentRow(tx, { organizationId, requirementId, stateFingerprint });
            if (!existingRow) throw new MalformedResultRowError("requirement_assessments");
            return success(toAssessmentRecord(existingRow, true));
          }

          // From here on, nothing has been committed yet but writes have
          // begun: every failure below must roll the transaction back
          // instead of returning directly, so a partially-written
          // assessment (row without its full provenance, or an audited row
          // whose provenance failed to verify) can never be observed or
          // committed.
          const requirementAssessmentId = insertedRow.requirement_assessment_id;

          await rule.writeProvenance(tx, { organizationId, requirementAssessmentId, inputs });

          const persistedProvenance = await readAssessmentProvenance(tx, {
            organizationId,
            requirementAssessmentId,
          });
          const expectedProvenanceIds = rule.expectedProvenanceIds(inputs);
          if (!persistedAssessmentMatchesExpected(insertedRow, persistedProvenance, {
            organizationId,
            requirementId,
            assessmentState,
            explanation,
            stateFingerprint,
            ...expectedProvenanceIds,
          })) {
            rollbackFailure("system_error");
          }

          let preparedAudit;
          try {
            preparedAudit = prepareRequiredAudit(metadataOnlyAudit, {
              attempted_operation: rule.attemptedOperation,
              requirement_id: requirementId,
              requirement_assessment_id: requirementAssessmentId,
              validator_key: rule.validatorKey,
            }, tx);
          } catch {
            rollbackFailure("validation_blocker");
          }
          await preparedAudit.publish();

          return success(toAssessmentRecord(insertedRow, false));
        });
      } catch (error) {
        if (error instanceof RequirementAssessmentRollbackError) return error.result;
        if (error instanceof MalformedResultRowError) return failure("system_error");
        if (error?.code === "23514" || error?.code === "22P02") return failure("validation_blocker");
        if (error?.code === "23503") return failure("conflict_current_state_changed");
        return failure("system_error");
      }
    },

    async readOrganizationRequirementAssessment(input) {
      if (!isReadOrganizationRequirementAssessmentInput(input)) return failure("validation_blocker");
      const { organizationId, requirementId } = input;
      const run = runInTransaction || (await resolveDefaultRunInTransaction());
      const filterCurrentGapsFn = filterCurrentGaps || (await resolveDefaultGapCurrentStateFilter());

      try {
        return await run(async (tx) => {
          const requirementLookup = await loadSupportedRequirementOrFail(tx, { requirementId });
          if (!requirementLookup.ok) return requirementLookup.failure;
          const requirement = requirementLookup.requirement;
          const rule = requirementLookup.rule;

          const inputs = await rule.loadInputs(tx, { organizationId, filterCurrentGaps: filterCurrentGapsFn });
          const stateFingerprint = rule.computeFingerprint(inputs);

          const currentRow = await readExistingAssessmentRow(tx, { organizationId, requirementId, stateFingerprint });
          if (!currentRow) return failure("not_found");

          const provenance = await readAssessmentProvenance(tx, {
            organizationId,
            requirementAssessmentId: currentRow.requirement_assessment_id,
          });

          return success({
            requirement: {
              requirement_id: requirement.requirement_id,
              requirement_key: requirement.requirement_key,
              requirement_label: requirement.requirement_label,
            },
            assessment: toAssessmentRecord(currentRow, false),
            evidence_item_ids: provenance.evidenceItemIds,
            claim_ids: provenance.claimIds,
            evidence_review_decision_ids: provenance.evidenceDecisionLinks.map((row) => row.decision_id),
            claim_review_decision_ids: provenance.claimDecisionLinks.map((row) => row.decision_id),
            current_gap_log_item_ids: provenance.gapLinks.map((row) => row.gap_log_item_id),
            outcome_context_ids: provenance.outcomeContextIds,
            source_promotion_evidence_item_ids: provenance.sourcePromotionEvidenceItemIds,
            conflict_resolution_pairs: provenance.conflictResolutionPairs,
          });
        });
      } catch (error) {
        if (error?.code === "22P02") return failure("validation_blocker");
        return failure("system_error");
      }
    },

    // Read-only readiness rollup across every requirement this repository
    // supports: one snapshot transaction so every requirement's "current"
    // determination shares the same instant, exactly like a single-
    // requirement read. Never writes - `assessed: false` means live state
    // has no matching persisted assessment (never assessed, or assessed
    // state is now stale), the same "not_found" the single-requirement read
    // already reports; the caller decides whether to (re-)assess via the
    // existing write operation above.
    async listOrganizationRequirementsReadiness(input) {
      if (!isListOrganizationRequirementsReadinessInput(input)) return failure("validation_blocker");
      const { organizationId } = input;
      const run = runInTransaction || (await resolveDefaultRunInTransaction());
      const filterCurrentGapsFn = filterCurrentGaps || (await resolveDefaultGapCurrentStateFilter());

      try {
        return await run(async (tx) => {
          const catalogue = await loadSupportedRequirementsCatalogue(tx);
          const requirements = [];
          for (const requirement of catalogue) {
            const rule = REQUIREMENT_ASSESSMENT_RULES[requirement.requirement_key];
            const inputs = await rule.loadInputs(tx, { organizationId, filterCurrentGaps: filterCurrentGapsFn });
            const stateFingerprint = rule.computeFingerprint(inputs);
            const currentRow = await readExistingAssessmentRow(tx, {
              organizationId,
              requirementId: requirement.requirement_id,
              stateFingerprint,
            });
            requirements.push({
              requirement_id: requirement.requirement_id,
              requirement_key: requirement.requirement_key,
              requirement_label: requirement.requirement_label,
              assessed: Boolean(currentRow),
              assessment: currentRow ? toAssessmentRecord(currentRow, false) : null,
            });
          }
          return success({ requirements });
        });
      } catch (error) {
        if (error?.code === "22P02") return failure("validation_blocker");
        return failure("system_error");
      }
    },
  });
}

export const __requirementAssessmentRepositoryTestables = Object.freeze({
  RequirementAssessmentRollbackError,
  MalformedResultRowError,
  RequiredAuditRejectedError,
  isAssessOrganizationRequirementInput,
  isReadOrganizationRequirementAssessmentInput,
  isListOrganizationRequirementsReadinessInput,
  persistedAssessmentMatchesExpected,
  loadGovernedAssessmentInputs,
});
