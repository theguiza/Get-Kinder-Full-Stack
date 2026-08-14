import { insertRequiredSuccessfulAuditEvent } from "../db/kaiAuditQueries.js";

/**
 * Production composition of the `metadataOnlyAudit` contract required by P1
 * (`prepareMetadataOnlyAudit({ payload }) -> { ok, publish() }`), consumed by
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
    prepareMetadataOnlyAudit({ payload } = {}) {
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
          const result = await insertAuditEvent(metadata);
          if (!result || result.ok !== true) {
            throw new Error("p1_metadata_only_audit_publish_failed");
          }
          return result;
        },
      };
    },
  });
}

export const __testables = Object.freeze({
  createProductionMetadataOnlyAudit,
});
