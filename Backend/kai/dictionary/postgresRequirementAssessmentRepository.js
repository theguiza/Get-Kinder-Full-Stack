import {
  SUPPORTED_REQUIREMENT_KEY,
  computeRequirementAssessmentFingerprint,
  deriveRequirementAssessmentState,
} from "../validators/kaiRequirementAssessmentValidators.js";

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
    `SELECT decision_id::text AS decision_id, claim_id::text AS claim_id, decision_outcome
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
  const { rows } = await tx.query(
    `SELECT gap_log_item_id::text AS gap_log_item_id, claim_id::text AS claim_id,
            evidence_item_id::text AS evidence_item_id, source_version_id::text AS source_version_id,
            dimension_key, assessment_status
       FROM kai.gap_log_items
      WHERE organization_id = $1::uuid`,
    [organizationId],
  );
  const currentRows = await filterCurrentGaps(tx, { organizationId, candidateGapRows: rows });
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
 * Verifies the requirement exists at all and, if so, that it is the one
 * requirement this package supports. Returns either
 * { ok: true, requirement } or { ok: false, failure: <failure(...) result> }.
 * Callers must check this before touching kai.requirement_assessments or any
 * link table at all - zero writes on an unsupported/nonexistent requirement.
 */
async function loadSupportedRequirementOrFail(tx, { requirementId }) {
  const requirement = await loadRequirement(tx, { requirementId });
  if (!requirement) return { ok: false, failure: failure("not_found") };
  if (requirement.requirement_key !== SUPPORTED_REQUIREMENT_KEY) {
    return { ok: false, failure: failure("unsupported_requirement") };
  }
  return { ok: true, requirement };
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
  return {
    evidenceItemIds: evidenceLinkRows.rows.map((row) => row.evidence_item_id),
    claimIds: claimLinkRows.rows.map((row) => row.claim_id),
    evidenceDecisionLinks: evidenceDecisionLinkRows.rows,
    claimDecisionLinks: claimDecisionLinkRows.rows,
    gapLinks: gapLinkRows.rows,
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

          const { evidenceItems, claims } = await loadGovernedAssessmentInputs(tx, {
            organizationId,
            filterCurrentGaps: filterCurrentGapsFn,
          });

          const { assessmentState, explanation } = deriveRequirementAssessmentState({ evidenceItems, claims });
          const stateFingerprint = computeRequirementAssessmentFingerprint({ evidenceItems, claims });

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

          for (const evidenceItem of evidenceItems) {
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
          for (const claim of claims) {
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

          const persistedProvenance = await readAssessmentProvenance(tx, {
            organizationId,
            requirementAssessmentId,
          });
          const expectedEvidenceDecisionIds = evidenceItems
            .filter((row) => row.decisionId !== null)
            .map((row) => row.decisionId);
          const expectedClaimDecisionIds = claims
            .filter((row) => row.decisionId !== null)
            .map((row) => row.decisionId);
          const expectedGapLogItemIds = claims.flatMap((claim) => claim.gaps.map((gap) => gap.gapLogItemId));
          if (!persistedAssessmentMatchesExpected(insertedRow, persistedProvenance, {
            organizationId,
            requirementId,
            assessmentState,
            explanation,
            stateFingerprint,
            evidenceItemIds: evidenceItems.map((row) => row.evidenceItemId),
            claimIds: claims.map((row) => row.claimId),
            evidenceDecisionIds: expectedEvidenceDecisionIds,
            claimDecisionIds: expectedClaimDecisionIds,
            gapLogItemIds: expectedGapLogItemIds,
          })) {
            rollbackFailure("system_error");
          }

          let preparedAudit;
          try {
            preparedAudit = prepareRequiredAudit(metadataOnlyAudit, {
              attempted_operation: "c3_a2_requirement_assessment_created",
              requirement_id: requirementId,
              requirement_assessment_id: requirementAssessmentId,
              validator_key: "VAL-KAI-C3-A2-001",
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

          const { evidenceItems, claims } = await loadGovernedAssessmentInputs(tx, {
            organizationId,
            filterCurrentGaps: filterCurrentGapsFn,
          });
          const stateFingerprint = computeRequirementAssessmentFingerprint({ evidenceItems, claims });

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
          });
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
  persistedAssessmentMatchesExpected,
  loadGovernedAssessmentInputs,
});
