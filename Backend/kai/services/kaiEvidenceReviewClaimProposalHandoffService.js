import { KAI_SPRINT2_P0_PATTERNS } from "../config/kaiSprint2P0Contract.js";
import { getScopedEvidenceItemById } from "../db/kaiIntakeQueries.js";
import { recordEvidenceReviewDecision } from "./kaiHumanReviewService.js";
import { assessEvidenceCoverageForSourceVersion } from "./kaiEvidenceCoverageAssessmentService.js";
import { proposeClaim } from "./kaiClaimProposalService.js";
import { createProductionMetadataOnlyAuditForClaimProposal } from "./kaiMetadataOnlyAuditComposition.js";
import { __claimProposalRepositoryContract } from "../dictionary/postgresClaimProposalRepository.js";

const UUID_RE = KAI_SPRINT2_P0_PATTERNS.uuid;
const MACHINE_TOKEN_RE = /^[a-z0-9_]{1,64}$/;

// The P2-12 evidence-review outcomes whose committed support strength is
// 'reviewed_supported' (humanReviewDecisionContract.supportStrengthForOutcome).
// not_supported ('reviewed_not_supported') and needs_more_information
// (unresolved, 'unassessed') never enter the claim-proposal path.
const POSITIVE_EVIDENCE_REVIEW_OUTCOMES = new Set(["supported", "supported_with_limitation"]);
const REVIEWED_SUPPORTED_STRENGTH = "reviewed_supported";
const RESOLVED = "resolved";

const COVERAGE_DIMENSION_KEYS = Object.freeze([
  "missingness",
  "duplicates",
  "definition_clarity",
  "denominator_clarity",
  "time_period_clarity",
  "entity_level_clarity",
  "small_cell_risk",
  "conflicting_source_indicators",
  "requirement_alignment",
  "coverage_gaps",
]);

const {
  CLAIM_TYPE_FINDING,
  CLAIM_STATUS_PROPOSED,
  CLAIM_REVIEW_STATUS_NEEDS_GK_REVIEW,
  CLAIM_STRENGTH_UNASSESSED,
  CLAIM_REVIEW_QUEUE_TYPE,
  CLAIM_REVIEW_TARGET_OBJECT_TYPE,
} = __claimProposalRepositoryContract;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalUuid(value) {
  return typeof value === "string" && value === value.toLowerCase() && UUID_RE.test(value);
}

function sanitizedCode(code) {
  return typeof code === "string" && MACHINE_TOKEN_RE.test(code) ? code : "system_error";
}

function coverageAssessmentSummary(status, { dimensions = null, errorCode = null } = {}) {
  const statuses = dimensions ? COVERAGE_DIMENSION_KEYS.map((key) => dimensions[key].evidence.assessment_status) : [];
  return {
    status,
    unresolved_dimension_count: dimensions ? statuses.filter((value) => value === "unresolved").length : null,
    risk_flagged_dimension_count: dimensions ? statuses.filter((value) => value === "resolved_risk_flagged").length : null,
    error_code: errorCode,
  };
}

function claimProposalHandoffResult(
  status,
  { coverageAssessment = null, claimId = null, claimReviewQueueItemId = null, errorCode = null } = {},
) {
  return {
    status,
    coverage_assessment: coverageAssessment,
    claim_id: claimId,
    claim_review_status: claimId ? CLAIM_REVIEW_STATUS_NEEDS_GK_REVIEW : null,
    claim_review_queue_item_id: claimReviewQueueItemId,
    error_code: errorCode,
  };
}

function isCommittedPositiveEvidenceReview(decision, evidenceItemId) {
  return isPlainObject(decision)
    && decision.evidence_item_id === evidenceItemId
    && POSITIVE_EVIDENCE_REVIEW_OUTCOMES.has(decision.decision_outcome)
    && decision.support_strength === REVIEWED_SUPPORTED_STRENGTH
    && decision.queue_status === RESOLVED
    && decision.review_status === RESOLVED;
}

function isCompleteCoverageAssessment(data, { organizationId, sourceVersionId }) {
  return isPlainObject(data)
    && data.organization_id === organizationId
    && data.source_version_id === sourceVersionId
    && isPlainObject(data.dimensions)
    && COVERAGE_DIMENSION_KEYS.every((key) => (
      isPlainObject(data.dimensions[key]) && typeof data.dimensions[key].evidence?.assessment_status === "string"
    ));
}

// The P2-03 result must be exactly the review-gated proposal P2-03 writes:
// never approved, never wider than internal, never export-ready, with its
// canonical evidence link and its own claim_review queue item.
function isReviewGatedProposal(data, { organizationId, evidenceItemId }) {
  const claim = data?.claim;
  const link = data?.claimEvidenceLink;
  const queue = data?.reviewQueueItem;
  return isPlainObject(data)
    && typeof data.replayed === "boolean"
    && isPlainObject(claim)
    && canonicalUuid(claim.claim_id)
    && claim.organization_id === organizationId
    && claim.evidence_item_id === evidenceItemId
    && claim.claim_type === CLAIM_TYPE_FINDING
    && claim.claim_status === CLAIM_STATUS_PROPOSED
    && claim.claim_review_status === CLAIM_REVIEW_STATUS_NEEDS_GK_REVIEW
    && claim.claim_strength === CLAIM_STRENGTH_UNASSESSED
    && claim.internal_only === true
    && claim.public_use_allowed === false
    && claim.funder_use_allowed === false
    && claim.llm_processing_allowed === false
    && claim.product_learning_allowed === false
    && claim.export_ready === false
    && isPlainObject(link)
    && link.organization_id === organizationId
    && link.claim_id === claim.claim_id
    && link.evidence_item_id === evidenceItemId
    && isPlainObject(queue)
    && canonicalUuid(queue.review_queue_item_id)
    && queue.organization_id === organizationId
    && queue.queue_type === CLAIM_REVIEW_QUEUE_TYPE
    && queue.target_object_type === CLAIM_REVIEW_TARGET_OBJECT_TYPE
    && queue.target_object_id === claim.claim_id;
}

/**
 * The claim-proposal handoff after a committed P2-12 evidence-review decision.
 *
 * Runs only for a POSITIVE committed decision (supported or
 * supported_with_limitation, both projected to 'reviewed_supported' with the
 * evidence_review queue item resolved), re-read fresh from the evidence item
 * itself. not_supported and needs_more_information never reach P2-02 or P2-03.
 *
 * Phase 8 before Phase 9: the existing P2-02 `assessEvidenceCoverageForSourceVersion`
 * runs first, over the evidence item's own current source_version. P2-02 is
 * read-only and persists nothing; its fail-closed permission gate (lineage,
 * promotion completeness, checksums, and allowed_use_status 'not_allowed')
 * blocks the proposal. Its ten dimension results are informational by P2-02's
 * own contract (never a blocker severity) and are not persisted here; P2-06
 * recomputes the same dimensions and blocks every audience on an unresolved
 * dimension until a P2-10 coverage decision accepts it.
 *
 * Only then is the existing P2-03 `proposeClaim` called, exactly once, with
 * the same authenticated human actor, the same `now`, and the production
 * claim-proposal audit adapter the P2-03 route composes. Every P2-02 and P2-03
 * guarantee (KAI_SPRINT2_ENABLED, mapped-human-only, role and active-membership
 * checks, tenant consistency, current-source-version lineage, deterministic
 * claim text, idempotent replay, required audit) stays inside those services
 * and is not reimplemented here. P2-03 writes one internal-only
 * proposed/needs_gk_review/unassessed claim, its canonical evidence link, and
 * its own open claim_review queue item. Nothing here records a claim-review
 * decision, approves a claim, widens an audience, or sets export_ready.
 *
 * Never throws and never retries. The evidence review is already committed,
 * so any refusal or failure is reported as `not_created` with a sanitized
 * error code; an identical resubmission of the same evidence-review decision
 * replays it and re-attempts this idempotent handoff. The response carries
 * ids, counts, and statuses only - never a claim or evidence statement.
 */
export async function proposeClaimAfterEvidenceReviewDecision(
  { organizationId, evidenceItemId, evidenceReviewDecision, actorContext, now },
  deps = {},
) {
  if (!isCommittedPositiveEvidenceReview(evidenceReviewDecision, evidenceItemId)) {
    return claimProposalHandoffResult("not_applicable");
  }

  try {
    const readEvidenceItem = deps.getScopedEvidenceItemById || getScopedEvidenceItemById;
    const evidenceItem = await readEvidenceItem({ organizationId, evidenceItemId });
    if (
      !isPlainObject(evidenceItem)
      || evidenceItem.organization_id !== organizationId
      || evidenceItem.evidence_item_id !== evidenceItemId
      || !canonicalUuid(evidenceItem.source_version_id)
    ) {
      return claimProposalHandoffResult("not_created", { errorCode: "not_found" });
    }
    if (evidenceItem.support_strength !== REVIEWED_SUPPORTED_STRENGTH) {
      return claimProposalHandoffResult("not_created", { errorCode: "conflict_current_state_changed" });
    }
    const sourceVersionId = evidenceItem.source_version_id;

    const assess = deps.assessEvidenceCoverageForSourceVersion || assessEvidenceCoverageForSourceVersion;
    const assessment = await assess(
      { organizationId, sourceVersionId, actorContext },
      {
        env: deps.env,
        ...(deps.evidenceCoverageAssessmentRepository
          ? { evidenceCoverageAssessmentRepository: deps.evidenceCoverageAssessmentRepository }
          : {}),
      },
    );
    if (!assessment?.ok) {
      const errorCode = sanitizedCode(assessment?.error?.code);
      return claimProposalHandoffResult("not_created", {
        coverageAssessment: coverageAssessmentSummary("blocked", { errorCode }),
        errorCode,
      });
    }
    if (!isCompleteCoverageAssessment(assessment.data, { organizationId, sourceVersionId })) {
      return claimProposalHandoffResult("not_created", {
        coverageAssessment: coverageAssessmentSummary("blocked", { errorCode: "system_error" }),
        errorCode: "system_error",
      });
    }
    const coverageAssessment = coverageAssessmentSummary("assessed", { dimensions: assessment.data.dimensions });

    const metadataOnlyAudit = deps.claimProposalMetadataOnlyAudit
      || createProductionMetadataOnlyAuditForClaimProposal({ organizationId, evidenceItemId, actorContext, now });
    const propose = deps.proposeClaim || proposeClaim;
    const proposal = await propose(
      { organizationId, evidenceItemId, actorContext, now },
      {
        env: deps.env,
        ...(deps.claimProposalRepository ? { claimProposalRepository: deps.claimProposalRepository } : {}),
        metadataOnlyAudit,
      },
    );
    if (!proposal?.ok) {
      return claimProposalHandoffResult("not_created", {
        coverageAssessment,
        errorCode: sanitizedCode(proposal?.error?.code),
      });
    }
    if (!isReviewGatedProposal(proposal.data, { organizationId, evidenceItemId })) {
      return claimProposalHandoffResult("not_created", { coverageAssessment, errorCode: "system_error" });
    }

    return claimProposalHandoffResult(proposal.data.replayed ? "replayed" : "created", {
      coverageAssessment,
      claimId: proposal.data.claim.claim_id,
      claimReviewQueueItemId: proposal.data.reviewQueueItem.review_queue_item_id,
    });
  } catch {
    return claimProposalHandoffResult("not_created", { errorCode: "system_error" });
  }
}

/**
 * The P2-12 evidence-review route's composition: records the decision through
 * the unmodified P2-12 `recordEvidenceReviewDecision` (its own authorization,
 * compare-and-set, decision ledger, and audit), then - only when that
 * succeeded - runs the claim-proposal handoff above and reports it as
 * `claim_proposal_handoff`. A refused or failed evidence review is returned
 * exactly as P2-12 returned it, with no handoff attempted.
 */
export async function recordEvidenceReviewDecisionWithClaimProposalHandoff(input, deps = {}) {
  const record = deps.recordEvidenceReviewDecision || recordEvidenceReviewDecision;
  const result = await record(input, {
    ...(deps.env ? { env: deps.env } : {}),
    ...(deps.humanReviewRepository ? { humanReviewRepository: deps.humanReviewRepository } : {}),
    metadataOnlyAudit: deps.metadataOnlyAudit,
  });
  if (!result?.ok) return result;

  const claimProposalHandoff = await proposeClaimAfterEvidenceReviewDecision(
    {
      organizationId: input.organizationId,
      evidenceItemId: input.evidenceItemId,
      evidenceReviewDecision: result.data,
      actorContext: input.actorContext,
      now: input.now,
    },
    deps,
  );
  return { ...result, data: { ...result.data, claim_proposal_handoff: claimProposalHandoff } };
}

export const __evidenceReviewClaimProposalHandoffContract = Object.freeze({
  POSITIVE_EVIDENCE_REVIEW_OUTCOMES,
  COVERAGE_DIMENSION_KEYS,
});
