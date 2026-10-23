import { withTransaction } from "../db/kaiDb.js";
import { getScopedSourceVersionById } from "../db/kaiIntakeQueries.js";
import {
  AmbiguousSensitivityDecisionLineageError,
  findCurrentSensitivityAllowedUseDecision,
} from "./postgresSensitivityAllowedUseDecisionRepository.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Organization-owned factual review of an ordinary internal Evidence Summary
 * (owner amendment 2026-10-23, Operating Model v0.2 section 11). Read-only.
 *
 * A draft is ordinary only when it is an internal evidence_summary, every
 * cited claim is currently eligible for internal use (P2-06, as the review
 * packet reports it), and the current Phase-5 sensitivity decision of every
 * cited source version is complete, permits the use and AI processing, and
 * records each Operating Model section 7.2 high-risk category as 'absent':
 * personal (identifying) information, minors, health/housing/justice/
 * immigration information, Indigenous or governance-sensitive information,
 * stories or testimonials, and small-cell re-identification risk. 'present'
 * and 'unknown' both keep Get Kinder's review; nothing is inferred upward.
 *
 * Reasons come in two kinds:
 * - getKinderReviewReasons: a high-risk or unsupported case that only Get
 *   Kinder may review (the existing GK review path, unchanged);
 * - blockedReasons: nobody should approve the draft now (a cited claim or
 *   source is no longer current, or the use is no longer permitted).
 */
export const ORGANIZATION_INTERNAL_REVIEW_VALIDATOR_KEY = "VAL-KAI-ORG-REVIEW-001";
// The completion audit contract the organization-owned review records
// (kai.upload_lifecycle_audit, written in the review's own transaction); it
// is how the client projection tells an organization review from a GK one.
export const ORGANIZATION_REVIEW_COMPLETION_AUDIT_CONTRACT = "kai_organization_internal_factual_review_completion_v1";
export const ORGANIZATION_REVIEWABLE_CONTENT_TYPE = "evidence_summary";
export const ORGANIZATION_REVIEWABLE_AUDIENCE = "internal";

export const HIGH_RISK_SENSITIVITY_FIELDS = Object.freeze({
  reviewed_personal_data_status: "personal_information_not_cleared",
  reviewed_minor_data_status: "minor_information_not_cleared",
  reviewed_health_housing_justice_immigration_status: "sensitive_information_not_cleared",
  reviewed_indigenous_governance_status: "indigenous_governance_not_cleared",
  reviewed_story_testimonial_status: "story_testimonial_not_cleared",
  reviewed_small_cell_risk_status: "small_cell_risk_not_cleared",
});

export const GET_KINDER_REVIEW_REASONS = Object.freeze([
  "content_type_requires_get_kinder_review",
  "audience_requires_get_kinder_review",
  "sensitivity_review_not_complete",
  ...Object.values(HIGH_RISK_SENSITIVITY_FIELDS),
]);

export const BLOCKED_REASONS = Object.freeze([
  "cited_claims_not_currently_eligible",
  "source_version_not_current",
  "processing_permission_not_established",
]);

// One source version's current decision (or null when it has none) ->
// reasons. Pure; exported for the unit contract.
export function classifySourceDecision(decision) {
  if (!decision || decision.decision_outcome !== "reviewed") {
    return { getKinderReviewReasons: ["sensitivity_review_not_complete"], blockedReasons: [] };
  }
  const blockedReasons = decision.reviewed_allowed_use_status === "allowed" && decision.reviewed_llm_processing_allowed === true
    ? []
    : ["processing_permission_not_established"];
  const getKinderReviewReasons = Object.entries(HIGH_RISK_SENSITIVITY_FIELDS)
    .filter(([field]) => decision[field] !== "absent")
    .map(([, reason]) => reason);
  return { getKinderReviewReasons, blockedReasons };
}

// The draft-level reasons from the review packet alone. Pure.
export function classifyDraftPacket(packet) {
  const getKinderReviewReasons = [];
  if (packet.contentType !== ORGANIZATION_REVIEWABLE_CONTENT_TYPE) getKinderReviewReasons.push("content_type_requires_get_kinder_review");
  if (packet.requestedAudience !== ORGANIZATION_REVIEWABLE_AUDIENCE) getKinderReviewReasons.push("audience_requires_get_kinder_review");
  return {
    getKinderReviewReasons,
    blockedReasons: packet.currentUseEligible === true ? [] : ["cited_claims_not_currently_eligible"],
  };
}

function ordered(reasons, vocabulary) {
  const present = new Set(reasons);
  return vocabulary.filter((reason) => present.has(reason));
}

export async function evaluateOrganizationInternalReviewInTransaction(tx, { organizationId, packet }) {
  const getKinder = [];
  const blocked = [];
  const draft = classifyDraftPacket(packet);
  getKinder.push(...draft.getKinderReviewReasons);
  blocked.push(...draft.blockedReasons);

  const sourceVersionIds = [...new Set(packet.blocks.flatMap((block) => block.citations.map((citation) => citation.sourceVersionId)))];
  if (sourceVersionIds.length === 0) getKinder.push("sensitivity_review_not_complete");
  for (const sourceVersionId of sourceVersionIds) {
    const version = await getScopedSourceVersionById({ organizationId, sourceVersionId }, tx);
    if (!version) {
      getKinder.push("sensitivity_review_not_complete");
      continue;
    }
    if (version.is_current !== true) blocked.push("source_version_not_current");
    let decision = null;
    try {
      decision = UUID_PATTERN.test(version.intake_sensitivity_profile_id ?? "")
        ? await findCurrentSensitivityAllowedUseDecision(tx, {
          organizationId,
          intakeSensitivityProfileId: version.intake_sensitivity_profile_id,
        })
        : null;
    } catch (error) {
      if (!(error instanceof AmbiguousSensitivityDecisionLineageError)) throw error;
      decision = null;
    }
    if (decision && decision.organization_id !== organizationId) decision = null;
    const source = classifySourceDecision(decision);
    getKinder.push(...source.getKinderReviewReasons);
    blocked.push(...source.blockedReasons);
  }

  const getKinderReviewReasons = ordered(getKinder, GET_KINDER_REVIEW_REASONS);
  const blockedReasons = ordered(blocked, BLOCKED_REASONS);
  return {
    getKinderReviewReasons,
    blockedReasons,
    organizationMayReview: getKinderReviewReasons.length === 0 && blockedReasons.length === 0,
  };
}

export function organizationReviewBlockers({ getKinderReviewReasons, blockedReasons }) {
  return [...getKinderReviewReasons, ...blockedReasons].map((reason) => ({
    validator_key: ORGANIZATION_INTERNAL_REVIEW_VALIDATOR_KEY,
    severity: "blocker",
    blocking_reason: reason,
  }));
}

export function createPostgresOrganizationInternalReviewRepository({ runInTransaction = withTransaction } = {}) {
  async function readOnly(callback) {
    return runInTransaction(async (tx) => {
      await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      return callback(tx);
    });
  }

  return Object.freeze({
    async evaluate({ organizationId, packet }) {
      return readOnly((tx) => evaluateOrganizationInternalReviewInTransaction(tx, { organizationId, packet }));
    },

    // Who completed the draft's factual review: 'organization' when the
    // completion was recorded by the organization-owned operation,
    // 'get_kinder' for any other completion, null when none is recorded.
    async readCompletedReviewer({ organizationId, generatedContentDraftId, reviewQueueItemId }) {
      if (![organizationId, generatedContentDraftId, reviewQueueItemId].every((id) => UUID_PATTERN.test(id))) return null;
      return readOnly(async (tx) => {
        const { rows } = await tx.query(
          `SELECT metadata->>'contract' AS contract
             FROM kai.upload_lifecycle_audit
            WHERE organization_id = $1::uuid
              AND operation = 'generated_content_review_completed'
              AND outcome = 'success'
              AND metadata->>'generated_content_draft_id' = $2
              AND metadata->>'review_queue_item_id' = $3
            ORDER BY created_at DESC
            LIMIT 1`,
          [organizationId, generatedContentDraftId, reviewQueueItemId],
        );
        if (!rows[0]) return null;
        return rows[0].contract === ORGANIZATION_REVIEW_COMPLETION_AUDIT_CONTRACT ? "organization" : "get_kinder";
      });
    },
  });
}
