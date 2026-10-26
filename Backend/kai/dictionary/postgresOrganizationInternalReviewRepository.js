import { withTransaction } from "../db/kaiDb.js";
import { evaluateClaimTraceabilityInTransaction } from "./postgresClaimTraceabilityRepository.js";
import { GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES } from "./generatedContentReviewQueueContract.js";
import {
  evaluateExportReviewRequestStateInTransaction,
  evaluateGeneratedDraftReviewPacketInTransaction,
} from "./postgresGeneratedContentRepository.js";
import {
  HIGH_RISK_SENSITIVITY_FIELDS,
  classifySourceDecision,
  classifySourceVersionInTransaction,
} from "./postgresOrdinaryInternalFactAuthority.js";

// The source classification is shared with P2-06's ordinary internal factual
// authority (postgresOrdinaryInternalFactAuthority.js) and re-exported here
// for the existing callers.
export { HIGH_RISK_SENSITIVITY_FIELDS, classifySourceDecision, classifySourceVersionInTransaction };

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
    const source = await classifySourceVersionInTransaction(tx, { organizationId, sourceVersionId });
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

/**
 * Ordinary internal report availability (owner decision 2026-10-25): an
 * internal evidence summary or impact narrative whose every cited claim is
 * currently eligible for internal use (P2-06, which already admits ordinary
 * measured facts without further review) and whose every cited source is
 * current, permitted and free of the section 7.2 categories is the
 * organization's internal report. No factual approval or release decision is
 * required for internal use; a high-risk source still keeps Get Kinder's
 * review, and nothing here grants funder or public use. Read-only.
 */
export const INTERNAL_REPORT_CONTENT_TYPES = Object.freeze(["evidence_summary", "impact_narrative"]);

// Owner prompt 2026-10-26: a draft whose every cited claim restates a
// dictionary field-presence fact (which columns a source has) documents
// source structure, not a programme result, so it is not the organization's
// internal impact report - whatever review its claims have. The structural
// facts stay valid, and Get Kinder's own review, export and release paths
// are unchanged; a draft citing at least one other fact is not affected.
export const STRUCTURAL_EVIDENCE_TYPE = "dictionary_field_presence_fact";
export const STRUCTURAL_FACTS_ONLY_REASON = "structural_facts_only";

async function citesOnlyStructuralFacts(tx, { organizationId, packet }) {
  const evidenceItemIds = [...new Set(packet.blocks.flatMap((block) => block.citations.map((citation) => citation.evidenceItemId)))]
    .filter((id) => UUID_PATTERN.test(id ?? ""));
  if (evidenceItemIds.length === 0) return false;
  const { rows } = await tx.query(
    `SELECT evidence_item_id::text, evidence_type
       FROM kai.evidence_items
      WHERE organization_id = $1::uuid AND evidence_item_id = ANY($2::uuid[])`,
    [organizationId, evidenceItemIds],
  );
  return rows.length === evidenceItemIds.length && rows.every((row) => row.evidence_type === STRUCTURAL_EVIDENCE_TYPE);
}

export async function evaluateInternalReportAvailabilityInTransaction(tx, { organizationId, packet }) {
  const evaluation = await evaluateOrganizationInternalReviewInTransaction(tx, { organizationId, packet });
  const getKinderReviewReasons = evaluation.getKinderReviewReasons
    .filter((reason) => reason !== "content_type_requires_get_kinder_review" || !INTERNAL_REPORT_CONTENT_TYPES.includes(packet.contentType));
  const blockedReasons = [
    ...evaluation.blockedReasons,
    ...(await citesOnlyStructuralFacts(tx, { organizationId, packet }) ? [STRUCTURAL_FACTS_ONLY_REASON] : []),
  ];
  return {
    getKinderReviewReasons,
    blockedReasons,
    available: getKinderReviewReasons.length === 0 && blockedReasons.length === 0,
  };
}

/**
 * Organization-owned final release of the same ordinary internal Evidence
 * Summary (owner amendment 2026-10-23; migration
 * kai_sprint2_plan_a_organization_internal_release_authority). Read-only and
 * transaction-scoped: every release write (export review, limitation
 * snapshot, final-release decision, manifest) calls it inside its own
 * transaction, before writing. The draft must have a completed factual
 * review (by Get Kinder or by the organization) and must still be ordinary
 * by exactly the classification above, re-evaluated now: a source that has
 * since become high-risk, stale or no longer permitted goes back to Get
 * Kinder or is blocked.
 */
export const RELEASE_BLOCKED_REASONS = Object.freeze([
  "factual_review_not_complete",
  "release_state_not_current",
]);

const RESOLVED_REVIEW_PROFILE = GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES[2];

export async function evaluateOrganizationInternalReleaseInTransaction(tx, { organizationId, generatedContentDraftId }) {
  const notReleasable = (reason) => ({ getKinderReviewReasons: [], blockedReasons: [reason], organizationMayRelease: false });
  if (![organizationId, generatedContentDraftId].every((id) => UUID_PATTERN.test(id ?? ""))) return notReleasable("release_state_not_current");
  const packetResult = await evaluateGeneratedDraftReviewPacketInTransaction(
    tx,
    { organizationId, generatedContentDraftId },
    evaluateClaimTraceabilityInTransaction,
    { allowedLifecycleProfiles: GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES },
  );
  if (!packetResult.ok) return notReleasable("release_state_not_current");
  const packet = packetResult.data;
  const evaluation = await evaluateOrganizationInternalReviewInTransaction(tx, { organizationId, packet });
  const reviewed = packet.queueStatus === RESOLVED_REVIEW_PROFILE.queueStatus && packet.reviewStatus === RESOLVED_REVIEW_PROFILE.reviewStatus;
  const blockedReasons = [...evaluation.blockedReasons, ...(reviewed ? [] : ["factual_review_not_complete"])];
  return {
    getKinderReviewReasons: evaluation.getKinderReviewReasons,
    blockedReasons,
    organizationMayRelease: evaluation.getKinderReviewReasons.length === 0 && blockedReasons.length === 0,
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

    async evaluateInternalReport({ organizationId, packet }) {
      return readOnly((tx) => evaluateInternalReportAvailabilityInTransaction(tx, { organizationId, packet }));
    },

    async evaluateRelease({ organizationId, generatedContentDraftId }) {
      return readOnly((tx) => evaluateOrganizationInternalReleaseInTransaction(tx, { organizationId, generatedContentDraftId }));
    },

    // The draft's export-review lifecycle state (P3-05 / P3-09 / P3-13),
    // which the organization's release advances; null when it cannot be read.
    async readExportReviewState({ organizationId, generatedContentDraftId, exportReviewQueueItemId }) {
      if (![organizationId, generatedContentDraftId, exportReviewQueueItemId].every((id) => UUID_PATTERN.test(id ?? ""))) return null;
      return readOnly(async (tx) => {
        const result = await evaluateExportReviewRequestStateInTransaction(tx, { organizationId, generatedContentDraftId, exportReviewQueueItemId });
        return result.ok ? result.data : null;
      });
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
