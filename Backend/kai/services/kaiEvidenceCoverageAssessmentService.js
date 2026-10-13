import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import {
  validateEvidenceCoverageAssessmentIsPermitted,
  assessMissingness,
  assessDuplicates,
  assessDefinitionClarity,
  assessDenominatorClarity,
  assessTimePeriodClarity,
  assessEntityLevelClarity,
  assessSmallCellRisk,
  assessConflictingSourceIndicators,
  assessRequirementAlignment,
  assessCoverageGaps,
} from "../validators/kaiEvidenceCoverageAssessmentValidators.js";
import { createPostgresEvidenceCoverageAssessmentRepository } from "../dictionary/postgresEvidenceCoverageAssessmentRepository.js";
import { validateEvidenceReviewDecisionContinuation } from "../validators/kaiEvidenceReviewContinuationValidators.js";
import { __humanReviewServiceContract } from "./kaiHumanReviewService.js";

const EVIDENCE_COVERAGE_ASSESSMENT_ALLOWED_ROLES = new Set(["gk_admin", "gk_operator", "gk_reviewer"]);
const EVIDENCE_COVERAGE_ASSESSMENT_OPERATION = "assess_evidence_coverage";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

/**
 * P2-02 owned input shape: exactly `organizationId`, `sourceVersionId`,
 * `actorContext` - no other key is accepted. Follows the exact
 * `isExtractEvidenceFromSourceVersionInput` allowlist idiom P2-01 already
 * uses in `Backend/kai/services/kaiEvidenceLineageService.js`.
 */
function isAssessEvidenceCoverageInput(value) {
  const allowedKeys = new Set(["organizationId", "sourceVersionId", "actorContext"]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  return (
    isNonEmptyString(value.organizationId) &&
    isNonEmptyString(value.sourceVersionId) &&
    isPlainObject(value.actorContext)
  );
}

/**
 * AUTH-KAI-003 (reapplied from P1-06/P1-07/P1-08/P2-01): this internal
 * evidence-coverage assessment may only be performed by a mapped human actor.
 * Every non-human actor type is rejected outright - there is no bypass.
 */
function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human" && isNonEmptyString(actorContext?.actorUserId);
}

/**
 * KAI P2-02 dormant deterministic evidence-coverage-assessment seam.
 *
 * Human-authorized, read-only assessment of ten fixed dimensions
 * (missingness, duplicates, definition clarity, denominator clarity,
 * time-period clarity, entity-level clarity, small-cell risk, conflicting-
 * source indicators, requirement alignment, coverage gaps) over the current,
 * fully promoted P1-08 source_version's already-committed P1-04/P1-05
 * dictionary/quality/sensitivity metadata and already-committed P2-01
 * evidence. Requires `KAI_SPRINT2_ENABLED` before any repository read - if it
 * is disabled, this returns the canonical `feature_disabled` result with zero
 * repository calls. Adds no package-specific feature flag of its own: like
 * P2-01, this package has no route, worker, listener, or production
 * composition and so remains dormant under `KAI_SPRINT2_ENABLED` alone.
 *
 * Contains no SQL and imports no database pool: every read is delegated to
 * the injected P2-02 repository. Authorization, tenant-membership, and
 * fail-closed lineage/permission checks are delegated to the existing shared
 * mechanisms (`validateActorCanPerformOperation`,
 * `validateTenantBoundaryConsistency`, `validateEvidenceHasSourceLineage` via
 * `validateEvidenceCoverageAssessmentIsPermitted`) rather than reimplemented
 * locally.
 *
 * Implements no claim, coverage-gap write, conflict write, follow-up, queue,
 * or audit persistence of any kind: every dimension result below is computed
 * fresh, on every call, from already-committed rows, and nothing this
 * function returns is ever written back to the database.
 */
export async function assessEvidenceCoverageForSourceVersion(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isAssessEvidenceCoverageInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const { actorContext } = input;
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    EVIDENCE_COVERAGE_ASSESSMENT_OPERATION,
    input.organizationId,
    { allowedRoles: EVIDENCE_COVERAGE_ASSESSMENT_ALLOWED_ROLES },
  );
  if (!auth.ok) {
    // The validator's own refusal: authorization_denied with role_not_allowed
    // or missing_active_organization_membership, tenant_boundary_violation
    // only for a missing organization scope. A genuine tenant inconsistency
    // is the separate check below.
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
  }

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: input.organizationId,
    payload: { organization_id: input.organizationId },
  });
  if (tenant.severity === "blocker") {
    return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
  }

  const evidenceCoverageAssessmentRepository =
    dependencies.evidenceCoverageAssessmentRepository || createPostgresEvidenceCoverageAssessmentRepository();

  return assessPermittedSourceVersion(evidenceCoverageAssessmentRepository, {
    organizationId: input.organizationId,
    sourceVersionId: input.sourceVersionId,
  });
}

/**
 * The ten-dimension assessment itself, shared by the direct P2-02 entry above
 * and the decision-bound continuation below. Callers have already applied
 * their own authorization.
 */
async function assessPermittedSourceVersion(evidenceCoverageAssessmentRepository, { organizationId, sourceVersionId }) {
  const result = await evidenceCoverageAssessmentRepository.readEvidenceCoverageAssessmentFacts({
    organizationId,
    sourceVersionId,
  });
  if (!result.ok) {
    return buildKaiError(result.error.code, { status: result.error.status });
  }

  const { rows } = result.data;

  const permitted = validateEvidenceCoverageAssessmentIsPermitted(rows);
  if (!permitted.ok) {
    return buildKaiError(permitted.code);
  }

  const dimensions = {
    missingness: assessMissingness(rows.qualityFindingRows),
    duplicates: assessDuplicates(rows.qualityFindingRows),
    definition_clarity: assessDefinitionClarity(rows.dictionaryFieldRows),
    denominator_clarity: assessDenominatorClarity(),
    time_period_clarity: assessTimePeriodClarity(),
    entity_level_clarity: assessEntityLevelClarity(rows.dictionaryFieldRows),
    small_cell_risk: assessSmallCellRisk(rows.profileRow),
    conflicting_source_indicators: assessConflictingSourceIndicators(),
    requirement_alignment: assessRequirementAlignment(),
    coverage_gaps: assessCoverageGaps(rows.dictionaryFieldRows, rows.evidenceFieldKeys),
  };

  return {
    ok: true,
    data: {
      organization_id: organizationId,
      source_version_id: sourceVersionId,
      data_dictionary_id: rows.dictionaryRow.data_dictionary_id,
      profile_canonical_sha256: rows.sourceVersionRow.profile_canonical_sha256,
      dimensions,
    },
    error: null,
  };
}

function isDecisionBoundAssessmentInput(value) {
  const allowedKeys = new Set(["organizationId", "evidenceItemId", "actorContext"]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  return (
    isNonEmptyString(value.organizationId) &&
    isNonEmptyString(value.evidenceItemId) &&
    isPlainObject(value.actorContext)
  );
}

/**
 * J3-3 / Decision C Option A (owner-accepted 2026-10-13): the governed
 * decision-bound P2-02 continuation, called only by the P2-12 evidence-review
 * handoff (Backend/kai/services/kaiEvidenceReviewClaimProposalHandoffService.js).
 *
 * Authority is NOT the P2-02 role set. It is the P2-12 evidence-review
 * authority the actor holds now (the same roles and combineGlobalRoles option
 * recordEvidenceReviewDecision applies) together with the persisted current
 * evidence-review decision that this same actor made, read here through the
 * scoped repository and judged by `validateEvidenceReviewDecisionContinuation`.
 * The input carries only the evidence item id: the source_version assessed is
 * the evidence item's own, and no decision object, id, or marker is accepted.
 * The direct P2-02 entry above and its route are unchanged.
 */
export async function assessEvidenceCoverageFromEvidenceReviewDecision(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isDecisionBoundAssessmentInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const { actorContext } = input;
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    EVIDENCE_COVERAGE_ASSESSMENT_OPERATION,
    input.organizationId,
    {
      allowedRoles: __humanReviewServiceContract.RECORD_EVIDENCE_REVIEW_DECISION_ALLOWED_ROLES,
      combineGlobalRoles: true,
    },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
  }

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: input.organizationId,
    payload: { organization_id: input.organizationId },
  });
  if (tenant.severity === "blocker") {
    return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
  }

  const evidenceCoverageAssessmentRepository =
    dependencies.evidenceCoverageAssessmentRepository || createPostgresEvidenceCoverageAssessmentRepository();

  const facts = await evidenceCoverageAssessmentRepository.readEvidenceReviewContinuationFacts({
    organizationId: input.organizationId,
    evidenceItemId: input.evidenceItemId,
  });
  if (!facts.ok) {
    return buildKaiError(facts.error.code, { status: facts.error.status });
  }

  const { evidenceItemRow, evidenceReviewQueueItemRow, decisionRow } = facts.data.rows;
  const continuation = validateEvidenceReviewDecisionContinuation({
    organizationId: input.organizationId,
    evidenceItemId: input.evidenceItemId,
    actorUserId: actorContext.actorUserId,
    decisionRow,
    evidenceItemRow,
    evidenceReviewQueueItemRow,
  });
  if (!continuation.ok) {
    return buildKaiError(continuation.code, { blockers: continuation.blockers });
  }

  return assessPermittedSourceVersion(evidenceCoverageAssessmentRepository, {
    organizationId: input.organizationId,
    sourceVersionId: evidenceItemRow.source_version_id,
  });
}

export const __evidenceCoverageAssessmentServiceContract = Object.freeze({
  EVIDENCE_COVERAGE_ASSESSMENT_OPERATION,
  EVIDENCE_COVERAGE_ASSESSMENT_ALLOWED_ROLES,
});
