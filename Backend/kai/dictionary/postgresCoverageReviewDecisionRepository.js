import { getScopedSourceCandidateByIdentity } from "../db/kaiIntakeQueries.js";
import { evaluateClaimTraceabilityInTransaction } from "./postgresClaimTraceabilityRepository.js";
import {
  COVERAGE_REVIEW_DECISION_ROLE,
  COVERAGE_REVIEW_DECISION_TYPE,
  computeCoverageReviewDecisionFingerprint,
  isCoverageReviewDimensionKey,
} from "../validators/kaiCoverageReviewDecisionValidators.js";

/**
 * KAI P2-10 durable coverage authority: the owner-authorized
 * `accepted_internal_with_limitation` decision a `gk_reviewer` may record for
 * one CURRENT unresolved P2-02 coverage dimension on one CURRENT claim. This
 * module owns exactly one write: an append-only insert into
 * `kai.coverage_review_decisions`, bound to a `state_fingerprint` computed
 * from the CURRENT authoritative claim/evidence/dimension/gap state as
 * evaluated - not reimplemented - by P2-06's own
 * `evaluateClaimTraceabilityInTransaction`. It never mutates claim_status,
 * claim_review_status, evidence_review_status, P2-02 assessment rows, P2-04
 * gap/follow-up rows, or P2-05 conflict state, and it never grants
 * funder/public/export authority.
 */

const COVERAGE_REVIEW_DECISION_RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  not_found: 404,
  conflict_current_state_changed: 409,
  human_review_incomplete: 409,
  dimension_not_unresolved: 409,
  system_error: 500,
});

const COVERAGE_REVIEW_DECISION_AUDIT_CONTRACT = "p2_10_coverage_review_decision_v1";
const COVERAGE_REVIEW_DECISION_AUDIT_OPERATION = "coverage_review_decision_accepted_internal_with_limitation";
const COVERAGE_REVIEW_DECISION_VALIDATOR_KEY = "VAL-KAI-P2-10-001";

function failure(code) {
  return { ok: false, data: null, error: { code, status: COVERAGE_REVIEW_DECISION_RESULT_STATUS[code] || 500 } };
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

function isNormalizedNow(value) {
  if (!isNonEmptyString(value)) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  return new Date(parsed).toISOString() === value;
}

function isMetadataOnlyAuditDependency(value) {
  return Boolean(value) && typeof value.prepareMetadataOnlyAudit === "function";
}

function isAcceptInternalCoverageLimitationInput(input) {
  const allowedKeys = new Set([
    "organizationId", "claimId", "dimensionKey", "actorUserId", "actorRole", "now", "metadataOnlyAudit",
  ]);
  if (!isPlainObject(input) || !hasOnlyKeys(input, allowedKeys)) return false;
  return (
    isNonEmptyString(input.organizationId) &&
    isNonEmptyString(input.claimId) &&
    isCoverageReviewDimensionKey(input.dimensionKey) &&
    isNonEmptyString(input.actorUserId) &&
    input.actorRole === COVERAGE_REVIEW_DECISION_ROLE &&
    isNormalizedNow(input.now) &&
    isMetadataOnlyAuditDependency(input.metadataOnlyAudit)
  );
}

class RequiredAuditRejectedError extends Error {
  constructor() {
    super("required metadata-only audit was rejected");
    this.name = "RequiredAuditRejectedError";
  }
}

class MalformedResultRowError extends Error {
  constructor(what) {
    super(`${what} row failed post-write validation`);
    this.name = "MalformedResultRowError";
  }
}

function shapeError(error) {
  if (error instanceof RequiredAuditRejectedError) return failure("validation_blocker");
  if (error instanceof MalformedResultRowError) return failure("system_error");
  if (error?.code === "23514" || error?.code === "22P02") return failure("validation_blocker");
  if (error?.code === "23503") return failure("conflict_current_state_changed");
  if (error?.code === "25001") return failure("conflict_current_state_changed");
  return failure("system_error");
}

async function resolveDefaultRunInTransaction() {
  const { withTransaction } = await import("../db/kaiDb.js");
  return withTransaction;
}

function toDecisionRecord(row, replayed) {
  return {
    coverage_review_decision_id: row.coverage_review_decision_id,
    organization_id: row.organization_id,
    claim_id: row.claim_id,
    dimension_key: row.dimension_key,
    decision: row.decision,
    decided_by_role: row.decided_by_role,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    replayed,
  };
}

async function readScopedUploadState(tx, organizationId, intakeFileId) {
  const { rows } = await tx.query(
    `SELECT upload_state
       FROM kai.intake_files
      WHERE organization_id = $1::uuid
        AND intake_file_id = $2::uuid`,
    [organizationId, intakeFileId],
  );
  return rows[0]?.upload_state ?? null;
}

async function readExistingDecisionRow(tx, { organizationId, claimId, dimensionKey, stateFingerprint }) {
  const { rows } = await tx.query(
    `SELECT coverage_review_decision_id, organization_id, claim_id, dimension_key,
            decision, decided_by_role, created_at
       FROM kai.coverage_review_decisions
      WHERE organization_id = $1::uuid
        AND claim_id = $2::uuid
        AND dimension_key = $3
        AND state_fingerprint = $4`,
    [organizationId, claimId, dimensionKey, stateFingerprint],
  );
  return rows[0] || null;
}

async function insertDecisionRow(tx, { organizationId, claimId, dimensionKey, stateFingerprint, actorUserId, actorRole, now }) {
  const { rows } = await tx.query(
    `INSERT INTO kai.coverage_review_decisions (
       organization_id, claim_id, dimension_key, decision, state_fingerprint,
       decided_by, decided_by_role, created_by_type, created_at
     ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid, $7, 'human', $8::timestamptz)
     ON CONFLICT (organization_id, claim_id, dimension_key, state_fingerprint)
       DO NOTHING
     RETURNING coverage_review_decision_id, organization_id, claim_id, dimension_key,
               decision, decided_by_role, created_at`,
    [
      organizationId,
      claimId,
      dimensionKey,
      COVERAGE_REVIEW_DECISION_TYPE,
      stateFingerprint,
      actorUserId,
      actorRole,
      now,
    ],
  );
  return rows[0] || null;
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

export function createPostgresCoverageReviewDecisionRepository({ runInTransaction, evaluateClaimTraceability } = {}) {
  return Object.freeze({
    async acceptInternalCoverageLimitation(input) {
      if (!isAcceptInternalCoverageLimitationInput(input)) return failure("validation_blocker");
      const { organizationId, claimId, dimensionKey, actorUserId, actorRole, now, metadataOnlyAudit } = input;
      const run = runInTransaction || (await resolveDefaultRunInTransaction());
      const evaluate = evaluateClaimTraceability || evaluateClaimTraceabilityInTransaction;

      try {
        return await run(async (tx) => {
          const traceability = await evaluate(tx, {
            organizationId,
            claimId,
            requestedAudience: "internal",
          });
          if (!traceability.ok) return { ok: false, data: null, error: traceability.error };

          const data = traceability.data;
          if (
            data.blockerCodes.includes("evidence_review_unresolved") ||
            data.blockerCodes.includes("claim_review_unresolved")
          ) {
            return failure("human_review_incomplete");
          }

          const dimension = data.dimensions[dimensionKey];
          if (!dimension) return failure("validation_blocker");
          if (dimension.assessment_status !== "unresolved") return failure("dimension_not_unresolved");

          const gapItem = data.gap_items.find((row) => row.dimension_key === dimensionKey);
          if (!gapItem) return failure("conflict_current_state_changed");

          const stateFingerprint = computeCoverageReviewDecisionFingerprint({
            claimId,
            dimensionKey,
            evidenceItemId: data.evidence.evidence_item_id,
            sourceVersionId: data.source_version.source_version_id,
            dimensionAssessmentStatus: dimension.assessment_status,
            dimensionValidatorKey: dimension.validator_key,
            gapLogItemId: gapItem.gap_log_item_id,
            gapAssessmentStatus: gapItem.assessment_status,
            claimReviewStatus: data.claim_review.review_status,
            evidenceReviewStatus: data.evidence.review_status,
            claimStrength: data.claim.claim_strength,
            supportStrength: data.evidence.support_strength,
          });

          const insertedRow = await insertDecisionRow(tx, {
            organizationId,
            claimId,
            dimensionKey,
            stateFingerprint,
            actorUserId,
            actorRole,
            now,
          });

          if (!insertedRow) {
            const existingRow = await readExistingDecisionRow(tx, {
              organizationId,
              claimId,
              dimensionKey,
              stateFingerprint,
            });
            if (!existingRow) throw new MalformedResultRowError("coverage_review_decisions");
            return success(toDecisionRecord(existingRow, true));
          }

          const candidateRow = await getScopedSourceCandidateByIdentity(
            { organizationId, intakeSourceCandidateId: data.candidate.intake_source_candidate_id },
            tx,
          );
          if (!candidateRow) throw new MalformedResultRowError("intake_source_candidates");

          const uploadState = await readScopedUploadState(tx, organizationId, candidateRow.intake_file_id);
          if (!uploadState) throw new MalformedResultRowError("intake_files");

          const preparedAudit = prepareRequiredAudit(metadataOnlyAudit, {
            attempted_operation: COVERAGE_REVIEW_DECISION_AUDIT_OPERATION,
            actor_type: "human",
            actor_user_id: actorUserId,
            contract: COVERAGE_REVIEW_DECISION_AUDIT_CONTRACT,
            object_type: "claim",
            claim_id: claimId,
            dimension_key: dimensionKey,
            decision: COVERAGE_REVIEW_DECISION_TYPE,
            decided_by_role: actorRole,
            state_fingerprint: stateFingerprint,
            replayed: false,
            validator_key: COVERAGE_REVIEW_DECISION_VALIDATOR_KEY,
          }, tx);

          await tx.query(
            `INSERT INTO kai.upload_lifecycle_audit (
               organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
             )
             VALUES ($1::uuid, $2::uuid, $3, $4, $4, 'success', $5::jsonb, $6::timestamptz)`,
            [
              organizationId,
              candidateRow.intake_file_id,
              COVERAGE_REVIEW_DECISION_AUDIT_OPERATION,
              uploadState,
              JSON.stringify({
                metadata_only: true,
                contract: COVERAGE_REVIEW_DECISION_AUDIT_CONTRACT,
                claim_id: claimId,
                dimension_key: dimensionKey,
                decision: COVERAGE_REVIEW_DECISION_TYPE,
                decided_by_role: actorRole,
                state_fingerprint: stateFingerprint,
                replayed: false,
                validator_key: COVERAGE_REVIEW_DECISION_VALIDATOR_KEY,
              }),
              now,
            ],
          );

          await preparedAudit.publish();

          return success(toDecisionRecord(insertedRow, false));
        });
      } catch (error) {
        return shapeError(error);
      }
    },
  });
}

export const __coverageReviewDecisionRepositoryContract = Object.freeze({
  COVERAGE_REVIEW_DECISION_AUDIT_CONTRACT,
  COVERAGE_REVIEW_DECISION_AUDIT_OPERATION,
  COVERAGE_REVIEW_DECISION_VALIDATOR_KEY,
});

export const __coverageReviewDecisionRepositoryTestables = Object.freeze({
  RequiredAuditRejectedError,
  MalformedResultRowError,
  isAcceptInternalCoverageLimitationInput,
});
