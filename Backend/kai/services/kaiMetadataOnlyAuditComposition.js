import { insertRequiredSuccessfulAuditEvent } from "../db/kaiAuditQueries.js";

/**
 * Production composition of the `metadataOnlyAudit` contract required by P1
 * (`prepareMetadataOnlyAudit({ payload, db }) -> { ok, publish() }`), consumed by
 * `Backend/kai/parsing/postgresParserRunRepository.js` and
 * `Backend/kai/parsing/parserProfileWorkerOrchestration.js` unchanged.
 *
 * No production composition previously supplied this contract: every existing
 * caller of these P1 modules (dictionary/review-queue services and their tests)
 * only forwards a caller-supplied `dependencies.metadataOnlyAudit` or a test
 * double. This module is the smallest production implementation, and it creates
 * no second audit table or new audit vocabulary: `publish()` performs a real,
 * durable insert through the existing approved required-audit machinery -
 * `insertRequiredSuccessfulAuditEvent` writing into the existing `kai.audit_events`
 * table - the same machinery already used for Gate C's own required, rollback-on-
 * failure audit write in `kaiIntakeService.js#applyConfirmedSecurityAssessment`.
 *
 * Bound per organization/intake-file identity at construction (mirroring how
 * `Backend/kai/parsing/p1ObjectVersionByteSource.js` is bound per file), because
 * the P1 audit payload built by `postgresParserRunRepository.js`
 * (`buildParserRunAuditPayload`) carries no organization/actor identity of its
 * own - only a parser-run-shaped payload.
 */
export function createProductionMetadataOnlyAudit({
  organizationId,
  intakeFileId,
  engagementId = null,
  actorContext,
  now,
  insertAuditEvent = insertRequiredSuccessfulAuditEvent,
} = {}) {
  if (typeof organizationId !== "string" || organizationId.length === 0) {
    throw new TypeError("createProductionMetadataOnlyAudit requires organizationId.");
  }
  if (typeof intakeFileId !== "string" || intakeFileId.length === 0) {
    throw new TypeError("createProductionMetadataOnlyAudit requires intakeFileId.");
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  return Object.freeze({
    prepareMetadataOnlyAudit({ payload, db } = {}) {
      if (!isPlainObject(payload)) return { ok: false };

      const metadata = {
        organization_id: organizationId,
        intake_file_id: intakeFileId,
        engagement_id: engagementId,
        object_type: typeof payload.object_type === "string" ? payload.object_type : "intake_file",
        target_object_type: typeof payload.object_type === "string" ? payload.object_type : "intake_file",
        object_id: intakeFileId,
        operation: typeof payload.attempted_operation === "string" ? payload.attempted_operation : "p1_parser_profile_activation",
        operation_type: typeof payload.attempted_operation === "string" ? payload.attempted_operation : "p1_parser_profile_activation",
        validator_key: typeof payload.validator_key === "string" ? payload.validator_key : null,
        actor_type: actorContext?.actorType || "system",
        actor_user_id: actorContext?.actorUserId || null,
        request_id: actorContext?.requestId || null,
        route: "p1_parser_profile_worker_activation",
        created_at: typeof now === "string" ? now : new Date().toISOString(),
        metadata_only: true,
        contains_raw_file_content: false,
        contains_raw_parsed_rows: false,
        contains_client_pii: false,
        contains_prompt_text: false,
        contains_unsafe_generated_text: false,
        contains_signed_urls: false,
        contains_storage_credentials: false,
      };

      return {
        ok: true,
        async publish() {
          const result = await insertAuditEvent(metadata, db);
          if (!result || result.ok !== true) {
            throw new Error("p1_metadata_only_audit_publish_failed");
          }
          return result;
        },
      };
    },
  });
}

/**
 * Production composition of the `metadataOnlyAudit` contract required by P2-01
 * (`Backend/kai/dictionary/postgresEvidenceLineageRepository.js`), which builds its
 * own full audit payload (`attempted_operation`, `object_type`, `validator_key`,
 * etc.) and calls `prepareMetadataOnlyAudit({ payload })` directly - unlike P1's
 * caller, it supplies no `intakeFileId`, because P2-01 extracts evidence from an
 * already-promoted `source_version`, not an intake file. Reusing
 * `createProductionMetadataOnlyAudit` here would force a fabricated
 * `intakeFileId` identity onto a request that has none, so this is instead the
 * smallest separate adapter around the same existing required-audit mechanism -
 * `insertRequiredSuccessfulAuditEvent` writing into the existing
 * `kai.audit_events` table - keyed by the real `sourceVersionId` identity via the
 * already-allowlisted `object_id` metadata field.
 */
export function createProductionMetadataOnlyAuditForSourceVersion({
  organizationId,
  sourceVersionId,
  actorContext,
  now,
  insertAuditEvent = insertRequiredSuccessfulAuditEvent,
} = {}) {
  if (typeof organizationId !== "string" || organizationId.length === 0) {
    throw new TypeError("createProductionMetadataOnlyAuditForSourceVersion requires organizationId.");
  }
  if (typeof sourceVersionId !== "string" || sourceVersionId.length === 0) {
    throw new TypeError("createProductionMetadataOnlyAuditForSourceVersion requires sourceVersionId.");
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  return Object.freeze({
    prepareMetadataOnlyAudit({ payload, db } = {}) {
      if (!isPlainObject(payload)) return { ok: false };

      const metadata = {
        organization_id: organizationId,
        object_type: "source_version",
        target_object_type: "source_version",
        object_id: sourceVersionId,
        operation: typeof payload.attempted_operation === "string" ? payload.attempted_operation : "p2_01_evidence_lineage_extraction",
        operation_type: typeof payload.attempted_operation === "string" ? payload.attempted_operation : "p2_01_evidence_lineage_extraction",
        validator_key: typeof payload.validator_key === "string" ? payload.validator_key : null,
        actor_type: actorContext?.actorType || "human",
        actor_user_id: actorContext?.actorUserId || null,
        request_id: actorContext?.requestId || null,
        route: "p2_01_evidence_lineage_extraction",
        created_at: typeof now === "string" ? now : new Date().toISOString(),
        metadata_only: true,
        contains_raw_file_content: false,
        contains_raw_parsed_rows: false,
        contains_client_pii: false,
        contains_prompt_text: false,
        contains_unsafe_generated_text: false,
        contains_signed_urls: false,
        contains_storage_credentials: false,
      };

      return {
        ok: true,
        async publish() {
          const result = await insertAuditEvent(metadata, db);
          if (!result || result.ok !== true) {
            throw new Error("p2_01_metadata_only_audit_publish_failed");
          }
          return result;
        },
      };
    },
  });
}

const CLAIM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Production composition of the `metadataOnlyAudit` contract required by P1-08's
 * `createSourcePromotionDecision` repository write
 * (`Backend/kai/dictionary/postgresSourcePromotionRepository.js`), which builds
 * its own full audit payload (`buildSourcePromotionAuditPayload`) keyed by
 * `object_type: "intake_promotion_decision"`. Bound at construction to
 * organizationId/intakeSourceCandidateId - the identity the P1-09 review-cockpit
 * decision route already has before the decision row exists - mirroring the
 * P2-01 source-version adapter's identity discipline: no decision/source/
 * source-version identifier is fabricated or predicted here, only the request's
 * own candidate identity is used.
 */
export function createProductionMetadataOnlyAuditForSourcePromotion({
  organizationId,
  intakeSourceCandidateId,
  actorContext,
  now,
  insertAuditEvent = insertRequiredSuccessfulAuditEvent,
} = {}) {
  if (typeof organizationId !== "string" || organizationId.length === 0) {
    throw new TypeError("createProductionMetadataOnlyAuditForSourcePromotion requires organizationId.");
  }
  if (typeof intakeSourceCandidateId !== "string" || intakeSourceCandidateId.length === 0) {
    throw new TypeError("createProductionMetadataOnlyAuditForSourcePromotion requires intakeSourceCandidateId.");
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  return Object.freeze({
    prepareMetadataOnlyAudit({ payload, db } = {}) {
      if (!isPlainObject(payload)) return { ok: false };

      const metadata = {
        organization_id: organizationId,
        object_type: "intake_promotion_decision",
        target_object_type: "intake_promotion_decision",
        object_id: intakeSourceCandidateId,
        operation: typeof payload.attempted_operation === "string" ? payload.attempted_operation : "p1_08_source_promotion_decision_persisted",
        operation_type: typeof payload.attempted_operation === "string" ? payload.attempted_operation : "p1_08_source_promotion_decision_persisted",
        validator_key: typeof payload.validator_key === "string" ? payload.validator_key : null,
        actor_type: actorContext?.actorType || "human",
        actor_user_id: actorContext?.actorUserId || null,
        request_id: actorContext?.requestId || null,
        route: "p1_08_source_promotion_decision",
        created_at: typeof now === "string" ? now : new Date().toISOString(),
        metadata_only: true,
        contains_raw_file_content: false,
        contains_raw_parsed_rows: false,
        contains_client_pii: false,
        contains_prompt_text: false,
        contains_unsafe_generated_text: false,
        contains_signed_urls: false,
        contains_storage_credentials: false,
      };

      return {
        ok: true,
        async publish() {
          const result = await insertAuditEvent(metadata, db);
          if (!result || result.ok !== true) {
            throw new Error("p1_08_source_promotion_metadata_only_audit_publish_failed");
          }
          return result;
        },
      };
    },
  });
}

/**
 * Production composition of the `metadataOnlyAudit` contract required by P2-03
 * (`Backend/kai/dictionary/postgresClaimProposalRepository.js`), which supplies
 * its own full audit payload (`buildClaimProposalAuditPayload`) including the
 * authoritative `claim_id` of the row it just inserted/reread inside the same
 * transaction. Unlike the P1/P2-01 adapters above, this one is bound at
 * construction only to organizationId/evidenceItemId - it is never given, and
 * never generates or predicts, a claim identity of its own. The generic audit
 * object identity (`object_type`/`target_object_type`/`object_id`) is derived
 * exclusively from `payload.claim_id` at prepare time; a payload without a
 * valid claim_id is refused rather than falling back to evidenceItemId or any
 * other identifier.
 */
export function createProductionMetadataOnlyAuditForClaimProposal({
  organizationId,
  evidenceItemId,
  actorContext,
  now,
  insertAuditEvent = insertRequiredSuccessfulAuditEvent,
} = {}) {
  if (typeof organizationId !== "string" || organizationId.length === 0) {
    throw new TypeError("createProductionMetadataOnlyAuditForClaimProposal requires organizationId.");
  }
  if (typeof evidenceItemId !== "string" || evidenceItemId.length === 0) {
    throw new TypeError("createProductionMetadataOnlyAuditForClaimProposal requires evidenceItemId.");
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  return Object.freeze({
    prepareMetadataOnlyAudit({ payload, db } = {}) {
      if (!isPlainObject(payload)) return { ok: false };
      const claimId = payload.claim_id;
      if (typeof claimId !== "string" || !CLAIM_ID_PATTERN.test(claimId)) return { ok: false };

      const metadata = {
        organization_id: organizationId,
        object_type: "claim",
        target_object_type: "claim",
        object_id: claimId,
        operation: typeof payload.attempted_operation === "string" ? payload.attempted_operation : "p2_03_claim_proposed",
        operation_type: typeof payload.attempted_operation === "string" ? payload.attempted_operation : "p2_03_claim_proposed",
        validator_key: typeof payload.validator_key === "string" ? payload.validator_key : null,
        actor_type: actorContext?.actorType || "human",
        actor_user_id: actorContext?.actorUserId || null,
        request_id: actorContext?.requestId || null,
        route: "p2_03_claim_proposal",
        created_at: typeof now === "string" ? now : new Date().toISOString(),
        metadata_only: true,
        contains_raw_file_content: false,
        contains_raw_parsed_rows: false,
        contains_client_pii: false,
        contains_prompt_text: false,
        contains_unsafe_generated_text: false,
        contains_signed_urls: false,
        contains_storage_credentials: false,
      };

      return {
        ok: true,
        async publish() {
          const result = await insertAuditEvent(metadata, db);
          if (!result || result.ok !== true) {
            throw new Error("p2_03_metadata_only_audit_publish_failed");
          }
          return result;
        },
      };
    },
  });
}

/**
 * Production composition of the `metadataOnlyAudit` contract required by P2-04
 * (`Backend/kai/dictionary/postgresClaimGapFollowupRepository.js`), which
 * supplies its own full audit payload (`buildClaimGapFollowupAuditPayload`)
 * including the authoritative `claim_id` of the already-proposed P2-03 claim
 * this package's transaction read. Bound at construction to
 * organizationId/claimId (the route's own resource identity), mirroring the
 * P2-03 adapter's claim identity discipline: the generic audit object identity
 * is derived exclusively from `payload.claim_id` at prepare time, and - because
 * this factory is constructed with the route's own claimId - a payload whose
 * claim_id does not match that route claimId is refused as well as a payload
 * with no valid claim_id at all. One P2-04 execution may create multiple
 * gap_log_item/client_followup_item rows, so no such identifier is ever
 * fabricated or selected as the generic audit identity.
 */
export function createProductionMetadataOnlyAuditForClaimGapFollowup({
  organizationId,
  claimId,
  actorContext,
  now,
  insertAuditEvent = insertRequiredSuccessfulAuditEvent,
} = {}) {
  if (typeof organizationId !== "string" || organizationId.length === 0) {
    throw new TypeError("createProductionMetadataOnlyAuditForClaimGapFollowup requires organizationId.");
  }
  if (typeof claimId !== "string" || claimId.length === 0) {
    throw new TypeError("createProductionMetadataOnlyAuditForClaimGapFollowup requires claimId.");
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  return Object.freeze({
    prepareMetadataOnlyAudit({ payload, db } = {}) {
      if (!isPlainObject(payload)) return { ok: false };
      const payloadClaimId = payload.claim_id;
      if (typeof payloadClaimId !== "string" || !CLAIM_ID_PATTERN.test(payloadClaimId)) return { ok: false };
      if (payloadClaimId !== claimId) return { ok: false };

      const metadata = {
        organization_id: organizationId,
        object_type: "claim",
        target_object_type: "claim",
        object_id: payloadClaimId,
        operation: typeof payload.attempted_operation === "string" ? payload.attempted_operation : "p2_04_claim_gap_followup_generated",
        operation_type: typeof payload.attempted_operation === "string" ? payload.attempted_operation : "p2_04_claim_gap_followup_generated",
        validator_key: typeof payload.validator_key === "string" ? payload.validator_key : null,
        actor_type: actorContext?.actorType || "human",
        actor_user_id: actorContext?.actorUserId || null,
        request_id: actorContext?.requestId || null,
        route: "p2_04_claim_gap_followup",
        created_at: typeof now === "string" ? now : new Date().toISOString(),
        metadata_only: true,
        contains_raw_file_content: false,
        contains_raw_parsed_rows: false,
        contains_client_pii: false,
        contains_prompt_text: false,
        contains_unsafe_generated_text: false,
        contains_signed_urls: false,
        contains_storage_credentials: false,
      };

      return {
        ok: true,
        async publish() {
          const result = await insertAuditEvent(metadata, db);
          if (!result || result.ok !== true) {
            throw new Error("p2_04_metadata_only_audit_publish_failed");
          }
          return result;
        },
      };
    },
  });
}

const CONFLICT_GROUP_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Production composition of the `metadataOnlyAudit` contract required by P2-05
 * (`Backend/kai/dictionary/postgresConflictReviewCandidateRepository.js`),
 * which already supplies its own full required-audit payload including the
 * authoritative `conflict_group_id` of the row it just inserted/reread inside
 * this package's own transaction. This adapter never generates, hashes, or
 * derives a conflict-group identity from `firstClaimId`/`secondClaimId`: the
 * generic audit object identity is derived exclusively from
 * `payload.conflict_group_id` at prepare time, and preparation is refused
 * closed when that field is absent or malformed.
 */
export function createProductionMetadataOnlyAuditForConflictReviewCandidate({
  organizationId,
  actorContext,
  now,
  insertAuditEvent = insertRequiredSuccessfulAuditEvent,
} = {}) {
  if (typeof organizationId !== "string" || organizationId.length === 0) {
    throw new TypeError("createProductionMetadataOnlyAuditForConflictReviewCandidate requires organizationId.");
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  return Object.freeze({
    prepareMetadataOnlyAudit({ payload, db } = {}) {
      if (!isPlainObject(payload)) return { ok: false };
      const conflictGroupId = payload.conflict_group_id;
      if (typeof conflictGroupId !== "string" || !CONFLICT_GROUP_ID_PATTERN.test(conflictGroupId)) return { ok: false };

      const metadata = {
        organization_id: organizationId,
        object_type: "conflict_group",
        target_object_type: "conflict_group",
        object_id: conflictGroupId,
        operation: typeof payload.attempted_operation === "string" ? payload.attempted_operation : "p2_05_conflict_review_candidate_created",
        operation_type: typeof payload.attempted_operation === "string" ? payload.attempted_operation : "p2_05_conflict_review_candidate_created",
        validator_key: typeof payload.validator_key === "string" ? payload.validator_key : null,
        actor_type: actorContext?.actorType || "human",
        actor_user_id: actorContext?.actorUserId || null,
        request_id: actorContext?.requestId || null,
        route: "p2_05_conflict_review_candidate",
        created_at: typeof now === "string" ? now : new Date().toISOString(),
        metadata_only: true,
        contains_raw_file_content: false,
        contains_raw_parsed_rows: false,
        contains_client_pii: false,
        contains_prompt_text: false,
        contains_unsafe_generated_text: false,
        contains_signed_urls: false,
        contains_storage_credentials: false,
      };

      return {
        ok: true,
        async publish() {
          const result = await insertAuditEvent(metadata, db);
          if (!result || result.ok !== true) {
            throw new Error("p2_05_metadata_only_audit_publish_failed");
          }
          return result;
        },
      };
    },
  });
}

const EVIDENCE_ITEM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Production composition of the `metadataOnlyAudit` contract required by
 * P2-09's evidence-review completion
 * (Backend/kai/dictionary/postgresHumanReviewRepository.js), which supplies
 * its own full audit payload including the authoritative `evidence_item_id`
 * the route was invoked for. Bound at construction to
 * organizationId/evidenceItemId, mirroring the P2-03 claim-proposal adapter's
 * identity discipline: a payload whose evidence_item_id does not match the
 * route's own evidenceItemId is refused, as is a payload with no valid
 * evidence_item_id at all.
 */
export function createProductionMetadataOnlyAuditForEvidenceReview({
  organizationId,
  evidenceItemId,
  actorContext,
  now,
  insertAuditEvent = insertRequiredSuccessfulAuditEvent,
} = {}) {
  if (typeof organizationId !== "string" || organizationId.length === 0) {
    throw new TypeError("createProductionMetadataOnlyAuditForEvidenceReview requires organizationId.");
  }
  if (typeof evidenceItemId !== "string" || evidenceItemId.length === 0) {
    throw new TypeError("createProductionMetadataOnlyAuditForEvidenceReview requires evidenceItemId.");
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  return Object.freeze({
    prepareMetadataOnlyAudit({ payload, db } = {}) {
      if (!isPlainObject(payload)) return { ok: false };
      const payloadEvidenceItemId = payload.evidence_item_id;
      if (typeof payloadEvidenceItemId !== "string" || !EVIDENCE_ITEM_ID_PATTERN.test(payloadEvidenceItemId)) return { ok: false };
      if (payloadEvidenceItemId !== evidenceItemId) return { ok: false };

      const metadata = {
        organization_id: organizationId,
        object_type: "evidence_item",
        target_object_type: "evidence_item",
        object_id: payloadEvidenceItemId,
        operation: typeof payload.attempted_operation === "string" ? payload.attempted_operation : "p2_09_evidence_review_completed",
        operation_type: typeof payload.attempted_operation === "string" ? payload.attempted_operation : "p2_09_evidence_review_completed",
        validator_key: typeof payload.validator_key === "string" ? payload.validator_key : null,
        actor_type: actorContext?.actorType || "human",
        actor_user_id: actorContext?.actorUserId || null,
        request_id: actorContext?.requestId || null,
        route: "p2_09_evidence_review_completion",
        created_at: typeof now === "string" ? now : new Date().toISOString(),
        metadata_only: true,
        contains_raw_file_content: false,
        contains_raw_parsed_rows: false,
        contains_client_pii: false,
        contains_prompt_text: false,
        contains_unsafe_generated_text: false,
        contains_signed_urls: false,
        contains_storage_credentials: false,
      };

      return {
        ok: true,
        async publish() {
          const result = await insertAuditEvent(metadata, db);
          if (!result || result.ok !== true) {
            throw new Error("p2_09_evidence_review_metadata_only_audit_publish_failed");
          }
          return result;
        },
      };
    },
  });
}

/**
 * Production composition of the `metadataOnlyAudit` contract required by
 * P2-09's claim-review/internal-approval completion
 * (Backend/kai/dictionary/postgresHumanReviewRepository.js), which supplies
 * its own full audit payload including the authoritative `claim_id` the route
 * was invoked for. Bound at construction to organizationId/claimId, mirroring
 * the P2-04 claim-gap-followup adapter's identity discipline exactly.
 */
export function createProductionMetadataOnlyAuditForClaimReview({
  organizationId,
  claimId,
  actorContext,
  now,
  insertAuditEvent = insertRequiredSuccessfulAuditEvent,
} = {}) {
  if (typeof organizationId !== "string" || organizationId.length === 0) {
    throw new TypeError("createProductionMetadataOnlyAuditForClaimReview requires organizationId.");
  }
  if (typeof claimId !== "string" || claimId.length === 0) {
    throw new TypeError("createProductionMetadataOnlyAuditForClaimReview requires claimId.");
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  return Object.freeze({
    prepareMetadataOnlyAudit({ payload, db } = {}) {
      if (!isPlainObject(payload)) return { ok: false };
      const payloadClaimId = payload.claim_id;
      if (typeof payloadClaimId !== "string" || !CLAIM_ID_PATTERN.test(payloadClaimId)) return { ok: false };
      if (payloadClaimId !== claimId) return { ok: false };

      const metadata = {
        organization_id: organizationId,
        object_type: "claim",
        target_object_type: "claim",
        object_id: payloadClaimId,
        operation: typeof payload.attempted_operation === "string" ? payload.attempted_operation : "p2_09_claim_review_completed_internal_approval",
        operation_type: typeof payload.attempted_operation === "string" ? payload.attempted_operation : "p2_09_claim_review_completed_internal_approval",
        validator_key: typeof payload.validator_key === "string" ? payload.validator_key : null,
        actor_type: actorContext?.actorType || "human",
        actor_user_id: actorContext?.actorUserId || null,
        request_id: actorContext?.requestId || null,
        route: "p2_09_claim_review_internal_approval",
        created_at: typeof now === "string" ? now : new Date().toISOString(),
        metadata_only: true,
        contains_raw_file_content: false,
        contains_raw_parsed_rows: false,
        contains_client_pii: false,
        contains_prompt_text: false,
        contains_unsafe_generated_text: false,
        contains_signed_urls: false,
        contains_storage_credentials: false,
      };

      return {
        ok: true,
        async publish() {
          const result = await insertAuditEvent(metadata, db);
          if (!result || result.ok !== true) {
            throw new Error("p2_09_claim_review_metadata_only_audit_publish_failed");
          }
          return result;
        },
      };
    },
  });
}

const DIMENSION_KEY_PATTERN = /^[a-z_]+$/;

/**
 * Production composition of the `metadataOnlyAudit` contract required by
 * P2-10's coverage-review-decision write
 * (Backend/kai/dictionary/postgresCoverageReviewDecisionRepository.js), which
 * supplies its own full audit payload including the authoritative `claim_id`
 * and `dimension_key` the route was invoked for. Bound at construction to
 * organizationId/claimId, mirroring the P2-04/P2-09 claim-scoped adapters'
 * identity discipline exactly: a payload whose claim_id does not match the
 * route's own claimId, or whose dimension_key is missing/malformed, is
 * refused.
 */
export function createProductionMetadataOnlyAuditForCoverageReviewDecision({
  organizationId,
  claimId,
  actorContext,
  now,
  insertAuditEvent = insertRequiredSuccessfulAuditEvent,
} = {}) {
  if (typeof organizationId !== "string" || organizationId.length === 0) {
    throw new TypeError("createProductionMetadataOnlyAuditForCoverageReviewDecision requires organizationId.");
  }
  if (typeof claimId !== "string" || claimId.length === 0) {
    throw new TypeError("createProductionMetadataOnlyAuditForCoverageReviewDecision requires claimId.");
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  return Object.freeze({
    prepareMetadataOnlyAudit({ payload, db } = {}) {
      if (!isPlainObject(payload)) return { ok: false };
      const payloadClaimId = payload.claim_id;
      if (typeof payloadClaimId !== "string" || !CLAIM_ID_PATTERN.test(payloadClaimId)) return { ok: false };
      if (payloadClaimId !== claimId) return { ok: false };
      const dimensionKey = payload.dimension_key;
      if (typeof dimensionKey !== "string" || !DIMENSION_KEY_PATTERN.test(dimensionKey)) return { ok: false };

      const metadata = {
        organization_id: organizationId,
        object_type: "claim",
        target_object_type: "claim",
        object_id: payloadClaimId,
        operation: typeof payload.attempted_operation === "string" ? payload.attempted_operation : "p2_10_coverage_review_decision_accepted_internal_with_limitation",
        operation_type: typeof payload.attempted_operation === "string" ? payload.attempted_operation : "p2_10_coverage_review_decision_accepted_internal_with_limitation",
        validator_key: typeof payload.validator_key === "string" ? payload.validator_key : null,
        actor_type: actorContext?.actorType || "human",
        actor_user_id: actorContext?.actorUserId || null,
        request_id: actorContext?.requestId || null,
        route: "p2_10_coverage_review_decision_internal_acceptance",
        created_at: typeof now === "string" ? now : new Date().toISOString(),
        metadata_only: true,
        contains_raw_file_content: false,
        contains_raw_parsed_rows: false,
        contains_client_pii: false,
        contains_prompt_text: false,
        contains_unsafe_generated_text: false,
        contains_signed_urls: false,
        contains_storage_credentials: false,
      };

      return {
        ok: true,
        async publish() {
          const result = await insertAuditEvent(metadata, db);
          if (!result || result.ok !== true) {
            throw new Error("p2_10_coverage_review_decision_metadata_only_audit_publish_failed");
          }
          return result;
        },
      };
    },
  });
}

const CLIENT_FOLLOWUP_ITEM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Production composition of the `metadataOnlyAudit` contract required by
 * P2-11 (`Backend/kai/dictionary/postgresClientFollowupCompletionRepository.js`).
 * Mirrors `createProductionMetadataOnlyAuditForCoverageReviewDecision` exactly:
 * bound to organizationId/claimId, refusing a payload whose claim_id or
 * client_followup_item_id don't match, and never accepting/forwarding an
 * answer, free-text, question_text, or safe_summary field.
 */
export function createProductionMetadataOnlyAuditForClientFollowupCompletion({
  organizationId,
  claimId,
  actorContext,
  now,
  insertAuditEvent = insertRequiredSuccessfulAuditEvent,
} = {}) {
  if (typeof organizationId !== "string" || organizationId.length === 0) {
    throw new TypeError("createProductionMetadataOnlyAuditForClientFollowupCompletion requires organizationId.");
  }
  if (typeof claimId !== "string" || claimId.length === 0) {
    throw new TypeError("createProductionMetadataOnlyAuditForClientFollowupCompletion requires claimId.");
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  return Object.freeze({
    prepareMetadataOnlyAudit({ payload, db } = {}) {
      if (!isPlainObject(payload)) return { ok: false };
      const payloadClaimId = payload.claim_id;
      if (typeof payloadClaimId !== "string" || !CLAIM_ID_PATTERN.test(payloadClaimId)) return { ok: false };
      if (payloadClaimId !== claimId) return { ok: false };
      const payloadClientFollowupItemId = payload.client_followup_item_id;
      if (typeof payloadClientFollowupItemId !== "string" || !CLIENT_FOLLOWUP_ITEM_ID_PATTERN.test(payloadClientFollowupItemId)) return { ok: false };

      const metadata = {
        organization_id: organizationId,
        object_type: "claim",
        target_object_type: "client_followup_item",
        object_id: payloadClientFollowupItemId,
        operation: typeof payload.attempted_operation === "string" ? payload.attempted_operation : "p2_11_client_followup_completed",
        operation_type: typeof payload.attempted_operation === "string" ? payload.attempted_operation : "p2_11_client_followup_completed",
        validator_key: typeof payload.validator_key === "string" ? payload.validator_key : null,
        actor_type: actorContext?.actorType || "human",
        actor_user_id: actorContext?.actorUserId || null,
        request_id: actorContext?.requestId || null,
        route: "p2_11_client_followup_completion",
        created_at: typeof now === "string" ? now : new Date().toISOString(),
        metadata_only: true,
        contains_raw_file_content: false,
        contains_raw_parsed_rows: false,
        contains_client_pii: false,
        contains_prompt_text: false,
        contains_unsafe_generated_text: false,
        contains_signed_urls: false,
        contains_storage_credentials: false,
      };

      return {
        ok: true,
        async publish() {
          const result = await insertAuditEvent(metadata, db);
          if (!result || result.ok !== true) {
            throw new Error("p2_11_client_followup_completion_metadata_only_audit_publish_failed");
          }
          return result;
        },
      };
    },
  });
}

export function createProductionMetadataOnlyAuditForGeneratedContentDraft({
  organizationId,
  actorContext,
  now,
  route = "p3_01_create_evidence_summary_draft",
  insertAuditEvent = insertRequiredSuccessfulAuditEvent,
} = {}) {
  if (typeof organizationId !== "string" || organizationId.length === 0) {
    throw new TypeError("createProductionMetadataOnlyAuditForGeneratedContentDraft requires organizationId.");
  }
  if (typeof route !== "string" || route.length === 0) {
    throw new TypeError("createProductionMetadataOnlyAuditForGeneratedContentDraft requires route.");
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  return Object.freeze({
    prepareMetadataOnlyAudit({ payload, db } = {}) {
      if (!isPlainObject(payload)) return { ok: false };
      const draftId = payload.generated_content_draft_id;
      if (typeof draftId !== "string" || !CLAIM_ID_PATTERN.test(draftId)) return { ok: false };

      const metadata = {
        organization_id: organizationId,
        object_type: "generated_content_draft",
        target_object_type: "generated_content_draft",
        object_id: draftId,
        operation: typeof payload.attempted_operation === "string" ? payload.attempted_operation : "create_evidence_summary_draft",
        operation_type: typeof payload.attempted_operation === "string" ? payload.attempted_operation : "create_evidence_summary_draft",
        validator_key: typeof payload.validator_key === "string" ? payload.validator_key : null,
        actor_type: actorContext?.actorType || "human",
        actor_user_id: actorContext?.actorUserId || null,
        request_id: actorContext?.requestId || null,
        route,
        created_at: typeof now === "string" ? now : new Date().toISOString(),
        metadata_only: true,
        contains_raw_file_content: false,
        contains_raw_parsed_rows: false,
        contains_client_pii: false,
        contains_prompt_text: false,
        contains_unsafe_generated_text: false,
        contains_signed_urls: false,
        contains_storage_credentials: false,
      };

      return {
        ok: true,
        async publish() {
          const result = await insertAuditEvent(metadata, db);
          if (!result || result.ok !== true) {
            throw new Error("p3_01_generated_content_metadata_only_audit_publish_failed");
          }
          return result;
        },
      };
    },
  });
}

export function createProductionMetadataOnlyAuditForGeneratedContentReview({
  organizationId,
  generatedContentDraftId,
  reviewQueueItemId,
  actorContext,
  now,
  insertAuditEvent = insertRequiredSuccessfulAuditEvent,
} = {}) {
  if (typeof organizationId !== "string" || organizationId.length === 0) {
    throw new TypeError("createProductionMetadataOnlyAuditForGeneratedContentReview requires organizationId.");
  }
  if (typeof generatedContentDraftId !== "string" || !CLAIM_ID_PATTERN.test(generatedContentDraftId)) {
    throw new TypeError("createProductionMetadataOnlyAuditForGeneratedContentReview requires generatedContentDraftId.");
  }
  if (typeof reviewQueueItemId !== "string" || !CLAIM_ID_PATTERN.test(reviewQueueItemId)) {
    throw new TypeError("createProductionMetadataOnlyAuditForGeneratedContentReview requires reviewQueueItemId.");
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  return Object.freeze({
    prepareMetadataOnlyAudit({ payload, db } = {}) {
      if (!isPlainObject(payload)) return { ok: false };

      const metadata = {
        organization_id: organizationId,
        object_type: "generated_content_review_queue_item",
        target_object_type: "generated_content_review_queue_item",
        object_id: reviewQueueItemId,
        generated_content_draft_id: generatedContentDraftId,
        operation: typeof payload.attempted_operation === "string" ? payload.attempted_operation : "generated_content_review_transition",
        operation_type: typeof payload.attempted_operation === "string" ? payload.attempted_operation : "generated_content_review_transition",
        validator_key: typeof payload.validator_key === "string" ? payload.validator_key : null,
        actor_type: actorContext?.actorType || "human",
        actor_user_id: actorContext?.actorUserId || null,
        request_id: actorContext?.requestId || null,
        route: "p3_stage_b_generated_content_review_transition",
        created_at: typeof now === "string" ? now : new Date().toISOString(),
        metadata_only: true,
        contains_raw_file_content: false,
        contains_raw_parsed_rows: false,
        contains_client_pii: false,
        contains_prompt_text: false,
        contains_unsafe_generated_text: false,
        contains_signed_urls: false,
        contains_storage_credentials: false,
      };

      return {
        ok: true,
        async publish() {
          const result = await insertAuditEvent(metadata, db);
          if (!result || result.ok !== true) {
            throw new Error("p3_generated_content_review_metadata_only_audit_publish_failed");
          }
          return result;
        },
      };
    },
  });
}

/**
 * Production composition of the `metadataOnlyAudit` contract for the KAI
 * organization-enablement package (Get Kinder organization -> KAI
 * organization/binding/initial-engagement provisioning). Bound at
 * construction to the newly bound kaiOrganizationId, mirroring the P2-01
 * source-version adapter's identity discipline: this operation's object
 * identity is the KAI organization itself, not a caller-supplied field, so no
 * payload field is required to derive it.
 */
export function createProductionMetadataOnlyAuditForOrganizationKaiEnablement({
  kaiOrganizationId,
  actorContext,
  now,
  insertAuditEvent = insertRequiredSuccessfulAuditEvent,
} = {}) {
  if (typeof kaiOrganizationId !== "string" || kaiOrganizationId.length === 0) {
    throw new TypeError("createProductionMetadataOnlyAuditForOrganizationKaiEnablement requires kaiOrganizationId.");
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  return Object.freeze({
    prepareMetadataOnlyAudit({ payload, db } = {}) {
      if (!isPlainObject(payload)) return { ok: false };

      const metadata = {
        organization_id: kaiOrganizationId,
        engagement_id: typeof payload.engagement_id === "string" ? payload.engagement_id : null,
        object_type: "organization",
        target_object_type: "organization",
        object_id: kaiOrganizationId,
        operation: typeof payload.attempted_operation === "string" ? payload.attempted_operation : "enable_kai_for_organization",
        operation_type: typeof payload.attempted_operation === "string" ? payload.attempted_operation : "enable_kai_for_organization",
        validator_key: typeof payload.validator_key === "string" ? payload.validator_key : null,
        actor_type: actorContext?.actorType || "human",
        actor_user_id: actorContext?.actorUserId || null,
        request_id: actorContext?.requestId || null,
        route: "kai_organization_enablement",
        created_at: typeof now === "string" ? now : new Date().toISOString(),
        metadata_only: true,
        contains_raw_file_content: false,
        contains_raw_parsed_rows: false,
        contains_client_pii: false,
        contains_prompt_text: false,
        contains_unsafe_generated_text: false,
        contains_signed_urls: false,
        contains_storage_credentials: false,
      };

      return {
        ok: true,
        async publish() {
          const result = await insertAuditEvent(metadata, db);
          if (!result || result.ok !== true) {
            throw new Error("kai_organization_enablement_metadata_only_audit_publish_failed");
          }
          return result;
        },
      };
    },
  });
}

/**
 * Production composition of the `metadataOnlyAudit` contract required by
 * Package 2's governed role/organization-membership administration
 * (Backend/kai/services/kaiAccessAdministrationService.js). organizationId is
 * null for the platform-superuser-only global-role path, which is not
 * tenant-scoped; every allowlisted metadata key here
 * (target_user_id/role_name/previous_role_name/resulting_role_name/
 * previous_membership_status/resulting_membership_status/authority_source)
 * is one Backend/kai/db/kaiAuditQueries.js's SAFE_AUDIT_METADATA_KEYS
 * allowlist already accepts - no new audit vocabulary or table is created.
 */
export function createProductionMetadataOnlyAuditForAccessAdministration({
  organizationId = null,
  targetUserId,
  objectType,
  actorContext,
  now,
  insertAuditEvent = insertRequiredSuccessfulAuditEvent,
} = {}) {
  if (typeof targetUserId !== "string" || targetUserId.length === 0) {
    throw new TypeError("createProductionMetadataOnlyAuditForAccessAdministration requires targetUserId.");
  }
  if (typeof objectType !== "string" || objectType.length === 0) {
    throw new TypeError("createProductionMetadataOnlyAuditForAccessAdministration requires objectType.");
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  return Object.freeze({
    prepareMetadataOnlyAudit({ payload, db } = {}) {
      if (!isPlainObject(payload)) return { ok: false };
      if (payload.target_user_id !== targetUserId) return { ok: false };

      const metadata = {
        organization_id: organizationId,
        object_type: objectType,
        target_object_type: objectType,
        object_id: targetUserId,
        target_user_id: targetUserId,
        role_name: typeof payload.role_name === "string" ? payload.role_name : null,
        previous_role_name: typeof payload.previous_role_name === "string" ? payload.previous_role_name : null,
        resulting_role_name: typeof payload.resulting_role_name === "string" ? payload.resulting_role_name : null,
        previous_membership_status:
          typeof payload.previous_membership_status === "string" ? payload.previous_membership_status : null,
        resulting_membership_status:
          typeof payload.resulting_membership_status === "string" ? payload.resulting_membership_status : null,
        authority_source: typeof payload.authority_source === "string" ? payload.authority_source : null,
        operation: typeof payload.attempted_operation === "string" ? payload.attempted_operation : "kai_access_administration",
        operation_type: typeof payload.attempted_operation === "string" ? payload.attempted_operation : "kai_access_administration",
        validator_key: typeof payload.validator_key === "string" ? payload.validator_key : null,
        actor_type: actorContext?.actorType || "human",
        actor_user_id: actorContext?.actorUserId || null,
        request_id: actorContext?.requestId || null,
        route: "kai_access_administration",
        created_at: typeof now === "string" ? now : new Date().toISOString(),
        metadata_only: true,
        contains_raw_file_content: false,
        contains_raw_parsed_rows: false,
        contains_client_pii: false,
        contains_prompt_text: false,
        contains_unsafe_generated_text: false,
        contains_signed_urls: false,
        contains_storage_credentials: false,
      };

      return {
        ok: true,
        async publish() {
          const result = await insertAuditEvent(metadata, db);
          if (!result || result.ok !== true) {
            throw new Error("kai_access_administration_metadata_only_audit_publish_failed");
          }
          return result;
        },
      };
    },
  });
}

const INTAKE_SENSITIVITY_PROFILE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Production composition of the `metadataOnlyAudit` contract required by B1A-2's
 * Phase-5 sensitivity/allowed-use decision recording
 * (Backend/kai/dictionary/postgresSensitivityAllowedUseReviewRepository.js), which
 * supplies its own full audit payload including the authoritative
 * `intake_sensitivity_profile_id` the route was invoked for. Bound at construction
 * to organizationId/intakeSensitivityProfileId, mirroring the P2-09/P2-12
 * evidence-review adapter's identity discipline exactly: a payload whose
 * intake_sensitivity_profile_id does not match the route's own id is refused, as is
 * a payload with no valid id at all.
 *
 * The audit row carries decision identity and queue-transition metadata only - never
 * the reviewed Phase-5 classification snapshot itself.
 */
export function createProductionMetadataOnlyAuditForSensitivityAllowedUseDecision({
  organizationId,
  intakeSensitivityProfileId,
  actorContext,
  now,
  insertAuditEvent = insertRequiredSuccessfulAuditEvent,
} = {}) {
  if (typeof organizationId !== "string" || organizationId.length === 0) {
    throw new TypeError("createProductionMetadataOnlyAuditForSensitivityAllowedUseDecision requires organizationId.");
  }
  if (typeof intakeSensitivityProfileId !== "string" || intakeSensitivityProfileId.length === 0) {
    throw new TypeError(
      "createProductionMetadataOnlyAuditForSensitivityAllowedUseDecision requires intakeSensitivityProfileId.",
    );
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  return Object.freeze({
    prepareMetadataOnlyAudit({ payload, db } = {}) {
      if (!isPlainObject(payload)) return { ok: false };
      const payloadProfileId = payload.intake_sensitivity_profile_id;
      if (typeof payloadProfileId !== "string" || !INTAKE_SENSITIVITY_PROFILE_ID_PATTERN.test(payloadProfileId)) {
        return { ok: false };
      }
      if (payloadProfileId !== intakeSensitivityProfileId) return { ok: false };

      const metadata = {
        organization_id: organizationId,
        object_type: "intake_sensitivity_profile",
        target_object_type: "intake_sensitivity_profile",
        object_id: payloadProfileId,
        operation: typeof payload.attempted_operation === "string" ? payload.attempted_operation : "sensitivity_review_decision_recorded",
        operation_type: typeof payload.attempted_operation === "string" ? payload.attempted_operation : "sensitivity_review_decision_recorded",
        validator_key: typeof payload.validator_key === "string" ? payload.validator_key : null,
        actor_type: actorContext?.actorType || "human",
        actor_user_id: actorContext?.actorUserId || null,
        request_id: actorContext?.requestId || null,
        route: "b1a_02_sensitivity_allowed_use_decision",
        created_at: typeof now === "string" ? now : new Date().toISOString(),
        metadata_only: true,
        contains_raw_file_content: false,
        contains_raw_parsed_rows: false,
        contains_client_pii: false,
        contains_prompt_text: false,
        contains_unsafe_generated_text: false,
        contains_signed_urls: false,
        contains_storage_credentials: false,
      };

      return {
        ok: true,
        async publish() {
          const result = await insertAuditEvent(metadata, db);
          if (!result || result.ok !== true) {
            throw new Error("b1a_02_sensitivity_allowed_use_decision_metadata_only_audit_publish_failed");
          }
          return result;
        },
      };
    },
  });
}

/**
 * Production composition of the `metadataOnlyAudit` contract required by P1-06's
 * `createSensitivityReviewQueueItem` seam
 * (Backend/kai/dictionary/postgresReviewQueueRepository.js), used by the B1A-2R
 * review-work route/service to actually reach it. Bound at construction to
 * organizationId/intakeSensitivityProfileId exactly like the sibling B1A-2
 * decision adapter above, but the repository's own
 * `buildSensitivityReviewAuditPayload` never places an id on the payload it hands
 * to `prepareMetadataOnlyAudit` - only fixed operation/contract/queue metadata -
 * so this adapter validates that fixed shape instead of an id match, and always
 * stamps the route's own bound identity onto the published audit row.
 */
export function createProductionMetadataOnlyAuditForSensitivityReviewQueueItem({
  organizationId,
  intakeSensitivityProfileId,
  actorContext,
  now,
  insertAuditEvent = insertRequiredSuccessfulAuditEvent,
} = {}) {
  if (typeof organizationId !== "string" || organizationId.length === 0) {
    throw new TypeError("createProductionMetadataOnlyAuditForSensitivityReviewQueueItem requires organizationId.");
  }
  if (typeof intakeSensitivityProfileId !== "string" || intakeSensitivityProfileId.length === 0) {
    throw new TypeError(
      "createProductionMetadataOnlyAuditForSensitivityReviewQueueItem requires intakeSensitivityProfileId.",
    );
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  return Object.freeze({
    prepareMetadataOnlyAudit({ payload, db } = {}) {
      if (!isPlainObject(payload)) return { ok: false };
      if (payload.object_type !== "review_queue_item") return { ok: false };
      if (typeof payload.queue_status !== "string" || payload.queue_status.length === 0) return { ok: false };

      const metadata = {
        organization_id: organizationId,
        object_type: "intake_sensitivity_profile",
        target_object_type: "intake_sensitivity_profile",
        object_id: intakeSensitivityProfileId,
        operation: typeof payload.attempted_operation === "string"
          ? payload.attempted_operation
          : "sensitivity_review_queue_item_created",
        operation_type: typeof payload.attempted_operation === "string"
          ? payload.attempted_operation
          : "sensitivity_review_queue_item_created",
        validator_key: typeof payload.validator_key === "string" ? payload.validator_key : null,
        actor_type: actorContext?.actorType || "human",
        actor_user_id: actorContext?.actorUserId || null,
        request_id: actorContext?.requestId || null,
        route: "p1_06_sensitivity_review_queue_item",
        created_at: typeof now === "string" ? now : new Date().toISOString(),
        metadata_only: true,
        contains_raw_file_content: false,
        contains_raw_parsed_rows: false,
        contains_client_pii: false,
        contains_prompt_text: false,
        contains_unsafe_generated_text: false,
        contains_signed_urls: false,
        contains_storage_credentials: false,
      };

      return {
        ok: true,
        async publish() {
          const result = await insertAuditEvent(metadata, db);
          if (!result || result.ok !== true) {
            throw new Error("p1_06_sensitivity_review_queue_item_metadata_only_audit_publish_failed");
          }
          return result;
        },
      };
    },
  });
}

const IMPACT_EVALUATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Production composition of the `metadataOnlyAudit` contract required by
 * A2.2's impact-evaluation persistence write
 * (Backend/kai/dictionary/postgresImpactEvaluationRepository.js#createImpactEvaluationSnapshot),
 * mirroring the P2-03 claim-proposal adapter's identity discipline: bound at
 * construction to organizationId/impactOutcomeContextId, both already known
 * before the write transaction begins. The evaluation's own id cannot be
 * known ahead of time (it is generated by the INSERT this same transaction
 * performs), so this adapter never fabricates or predicts it -- it only
 * requires the repository's own freshly-inserted, well-formed
 * impact_evaluation_id to be present on the payload before it will publish.
 */
export function createProductionMetadataOnlyAuditForImpactEvaluation({
  organizationId,
  impactOutcomeContextId,
  actorContext,
  now,
  insertAuditEvent = insertRequiredSuccessfulAuditEvent,
} = {}) {
  if (typeof organizationId !== "string" || organizationId.length === 0) {
    throw new TypeError("createProductionMetadataOnlyAuditForImpactEvaluation requires organizationId.");
  }
  if (typeof impactOutcomeContextId !== "string" || impactOutcomeContextId.length === 0) {
    throw new TypeError("createProductionMetadataOnlyAuditForImpactEvaluation requires impactOutcomeContextId.");
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  return Object.freeze({
    prepareMetadataOnlyAudit({ payload, db } = {}) {
      if (!isPlainObject(payload)) return { ok: false };
      const impactEvaluationId = payload.impact_evaluation_id;
      if (typeof impactEvaluationId !== "string" || !IMPACT_EVALUATION_ID_PATTERN.test(impactEvaluationId)) {
        return { ok: false };
      }

      const metadata = {
        organization_id: organizationId,
        engagement_id: null,
        object_type: "impact_evaluation",
        target_object_type: "impact_evaluation",
        object_id: impactEvaluationId,
        operation: typeof payload.attempted_operation === "string" ? payload.attempted_operation : "a2_02_impact_evaluation_created",
        operation_type: typeof payload.attempted_operation === "string" ? payload.attempted_operation : "a2_02_impact_evaluation_created",
        validator_key: typeof payload.validator_key === "string" ? payload.validator_key : null,
        actor_type: actorContext?.actorType || "human",
        actor_user_id: actorContext?.actorUserId || null,
        request_id: actorContext?.requestId || null,
        route: "a2_02_impact_evaluation_creation",
        created_at: typeof now === "string" ? now : new Date().toISOString(),
        metadata_only: true,
        contains_raw_file_content: false,
        contains_raw_parsed_rows: false,
        contains_client_pii: false,
        contains_prompt_text: false,
        contains_unsafe_generated_text: false,
        contains_signed_urls: false,
        contains_storage_credentials: false,
      };

      return {
        ok: true,
        async publish() {
          const result = await insertAuditEvent(metadata, db);
          if (!result || result.ok !== true) {
            throw new Error("a2_02_impact_evaluation_metadata_only_audit_publish_failed");
          }
          return result;
        },
      };
    },
  });
}

const REQUIREMENT_ASSESSMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Production composition of the `metadataOnlyAudit` contract required by
 * C3.A2's organization-scope requirement-assessment write
 * (Backend/kai/dictionary/postgresRequirementAssessmentRepository.js#assessOrganizationRequirement),
 * mirroring the A2.2 impact-evaluation adapter's identity discipline: bound
 * at construction to organizationId/requirementId, both already known before
 * the write transaction begins. The assessment's own id cannot be known
 * ahead of time (it is generated by the INSERT this same transaction
 * performs), so this adapter never fabricates or predicts it - it only
 * requires the repository's own freshly-inserted, well-formed
 * requirement_assessment_id to be present on the payload, and that the
 * payload's own requirement_id matches the bound identity, before it will
 * publish.
 */
export function createProductionMetadataOnlyAuditForRequirementAssessment({
  organizationId,
  requirementId,
  actorContext,
  now,
  insertAuditEvent = insertRequiredSuccessfulAuditEvent,
} = {}) {
  if (typeof organizationId !== "string" || organizationId.length === 0) {
    throw new TypeError("createProductionMetadataOnlyAuditForRequirementAssessment requires organizationId.");
  }
  if (typeof requirementId !== "string" || requirementId.length === 0) {
    throw new TypeError("createProductionMetadataOnlyAuditForRequirementAssessment requires requirementId.");
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  return Object.freeze({
    prepareMetadataOnlyAudit({ payload, db } = {}) {
      if (!isPlainObject(payload)) return { ok: false };
      if (payload.requirement_id !== requirementId) return { ok: false };
      const requirementAssessmentId = payload.requirement_assessment_id;
      if (typeof requirementAssessmentId !== "string" || !REQUIREMENT_ASSESSMENT_ID_PATTERN.test(requirementAssessmentId)) {
        return { ok: false };
      }

      const metadata = {
        organization_id: organizationId,
        engagement_id: null,
        object_type: "requirement_assessment",
        target_object_type: "requirement_assessment",
        object_id: requirementAssessmentId,
        operation: typeof payload.attempted_operation === "string" ? payload.attempted_operation : "c3_a2_requirement_assessment_created",
        operation_type: typeof payload.attempted_operation === "string" ? payload.attempted_operation : "c3_a2_requirement_assessment_created",
        validator_key: typeof payload.validator_key === "string" ? payload.validator_key : null,
        actor_type: actorContext?.actorType || "human",
        actor_user_id: actorContext?.actorUserId || null,
        request_id: actorContext?.requestId || null,
        route: "c3_a2_requirement_assessment",
        created_at: typeof now === "string" ? now : new Date().toISOString(),
        metadata_only: true,
        contains_raw_file_content: false,
        contains_raw_parsed_rows: false,
        contains_client_pii: false,
        contains_prompt_text: false,
        contains_unsafe_generated_text: false,
        contains_signed_urls: false,
        contains_storage_credentials: false,
      };

      return {
        ok: true,
        async publish() {
          const result = await insertAuditEvent(metadata, db);
          if (!result || result.ok !== true) {
            throw new Error("c3_a2_requirement_assessment_metadata_only_audit_publish_failed");
          }
          return result;
        },
      };
    },
  });
}

export const __testables = Object.freeze({
  createProductionMetadataOnlyAudit,
  createProductionMetadataOnlyAuditForSensitivityAllowedUseDecision,
  createProductionMetadataOnlyAuditForSensitivityReviewQueueItem,
  createProductionMetadataOnlyAuditForSourceVersion,
  createProductionMetadataOnlyAuditForSourcePromotion,
  createProductionMetadataOnlyAuditForClaimProposal,
  createProductionMetadataOnlyAuditForClaimGapFollowup,
  createProductionMetadataOnlyAuditForConflictReviewCandidate,
  createProductionMetadataOnlyAuditForEvidenceReview,
  createProductionMetadataOnlyAuditForClaimReview,
  createProductionMetadataOnlyAuditForCoverageReviewDecision,
  createProductionMetadataOnlyAuditForClientFollowupCompletion,
  createProductionMetadataOnlyAuditForGeneratedContentDraft,
  createProductionMetadataOnlyAuditForGeneratedContentReview,
  createProductionMetadataOnlyAuditForOrganizationKaiEnablement,
  createProductionMetadataOnlyAuditForAccessAdministration,
  createProductionMetadataOnlyAuditForImpactEvaluation,
  createProductionMetadataOnlyAuditForRequirementAssessment,
});
