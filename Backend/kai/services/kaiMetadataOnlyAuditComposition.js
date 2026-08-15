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

export const __testables = Object.freeze({
  createProductionMetadataOnlyAudit,
  createProductionMetadataOnlyAuditForSourceVersion,
  createProductionMetadataOnlyAuditForClaimProposal,
  createProductionMetadataOnlyAuditForClaimGapFollowup,
});
