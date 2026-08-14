import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { createParserProfileWorkerOrchestration } from "./parserProfileWorkerOrchestration.js";
import { createPostgresParserRunRepository } from "./postgresParserRunRepository.js";
import { createP1ObjectVersionByteSource } from "./p1ObjectVersionByteSource.js";
import { createProductionMetadataOnlyAudit } from "../services/kaiMetadataOnlyAuditComposition.js";
import { getScopedIntakeFileParserProfileEligibilityFacts } from "../db/kaiIntakeQueries.js";

/**
 * KAI P1 synthetic-production activation entrypoint.
 *
 * This is the smallest DORMANT repository entrypoint that connects the existing,
 * accepted, previously-unwired P1 parser/profile orchestration
 * (`parserProfileWorkerOrchestration.js`, whose own `route_contract` audit literal
 * still records it as "unwired_synthetic_parser_profile_worker" - unchanged by this
 * package, since that is the existing accepted audit vocabulary) to the
 * authoritative committed intake state that becomes eligible for P1 once Gate C's
 * own confirmation/security/policy path reaches `file_policy_status = 'passed'`
 * (`Backend/kai/upload/postgresUploadLifecycleRepository.js`
 * `POLICY_DECISION_OUTCOMES.passed`).
 *
 * It registers no route, listener, scheduler, timer, cron job, or startup hook,
 * and is not imported by any mounted route or the process entrypoint. It is a
 * plain exported function a future, separately-authorized worker/deployment
 * package may invoke - once per eligible intake file, for one organization-scoped
 * intake file identity at a time - or that an operator may invoke manually
 * (e.g. from a REPL or a one-off script) against a non-production database. It
 * performs no P2/evidence/claim/generation/export activation and reuses the
 * existing P1 queue/claim/retry contract and audit machinery exactly.
 */
export async function activateParserProfileWorkForIntakeFile(
  { organizationId, intakeFileId, actorContext, retry = false } = {},
  dependencies = {},
) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) {
    return { ok: false, data: null, error: { code: "feature_disabled" } };
  }
  if (typeof organizationId !== "string" || organizationId.length === 0) {
    return { ok: false, data: null, error: { code: "validation_blocker" } };
  }
  if (typeof intakeFileId !== "string" || intakeFileId.length === 0) {
    return { ok: false, data: null, error: { code: "validation_blocker" } };
  }

  const nowFn = dependencies.now || (() => new Date().toISOString());
  const now = nowFn();

  const readEligibilityFacts =
    dependencies.getScopedIntakeFileParserProfileEligibilityFacts
    || getScopedIntakeFileParserProfileEligibilityFacts;

  let facts;
  try {
    facts = await readEligibilityFacts({ organizationId, intakeFileId });
  } catch {
    return { ok: false, data: null, error: { code: "system_error" } };
  }

  if (
    !facts
    || facts.organization_id !== organizationId
    || facts.intake_file_id !== intakeFileId
  ) {
    return { ok: false, data: null, error: { code: "not_found" } };
  }

  // The authoritative boundary this package consumes: only a file whose Gate C
  // confirmation/security/policy path has already reached the terminal `passed`
  // file_policy_status is eligible for P1. This is the existing lifecycle value
  // defined by `postgresUploadLifecycleRepository.js`'s
  // `POLICY_DECISION_OUTCOMES.passed`, not a value invented by this package.
  if (facts.file_policy_status !== "passed") {
    return {
      ok: true,
      data: { activated: false, reason: "not_eligible_for_p1", file_policy_status: facts.file_policy_status },
      error: null,
    };
  }

  if (
    typeof facts.object_version_id !== "string"
    || typeof facts.verified_checksum !== "string"
    || !Number.isSafeInteger(facts.verified_size_bytes)
    || typeof facts.mime_type !== "string"
    || typeof facts.file_extension !== "string"
  ) {
    return { ok: false, data: null, error: { code: "validation_blocker" } };
  }

  const trustedFileFacts = {
    organizationId,
    intakeFileId,
    objectVersionId: facts.object_version_id,
    checksum: facts.verified_checksum,
    verifiedSizeBytes: facts.verified_size_bytes,
    declaredMime: facts.mime_type,
    extension: facts.file_extension,
  };

  const parserRunRepository = dependencies.parserRunRepository || createPostgresParserRunRepository();

  const objectVersionByteSource = dependencies.objectVersionByteSource || createP1ObjectVersionByteSource({
    trustedIntakeFacts: {
      organizationId,
      intakeFileId,
      objectVersionId: facts.object_version_id,
      verifiedChecksum: facts.verified_checksum,
      verifiedSizeBytes: facts.verified_size_bytes,
      storageProvider: facts.storage_provider,
      storageObjectKey: facts.storage_object_key,
    },
    storageAdapter: dependencies.storageAdapter,
    gcsProvider: dependencies.gcsProvider,
    gcsParserReaderProvider: dependencies.gcsParserReaderProvider,
    uploadLifecycleRepository: dependencies.uploadLifecycleRepository,
    signal: dependencies.signal,
  });

  const metadataOnlyAudit = dependencies.metadataOnlyAudit || createProductionMetadataOnlyAudit({
    organizationId,
    intakeFileId,
    engagementId: facts.engagement_id,
    actorContext,
    now,
  });

  const orchestration = dependencies.parserProfileWorkerOrchestration || createParserProfileWorkerOrchestration({
    parserRunRepository,
    objectVersionByteSource,
    env,
  });

  const queued = await orchestration.queueParserProfileWork({ trustedFileFacts, now });
  if (!queued.ok) return { ok: false, data: null, error: queued.error };

  const run = retry
    ? await orchestration.retryParserProfileWork({ trustedFileFacts, now, metadataOnlyAudit })
    : await orchestration.runQueuedParserProfileWork({ trustedFileFacts, now, metadataOnlyAudit });

  if (!run.ok) return { ok: false, data: { queued: queued.data }, error: run.error };

  return {
    ok: true,
    data: { activated: true, queued: queued.data, run: run.data },
    error: null,
  };
}

export const __testables = Object.freeze({
  activateParserProfileWorkForIntakeFile,
});
