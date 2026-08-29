import { areKaiSprint2WorkerFeaturesEnabled } from "../config/kaiSprint2Config.js";
import { activateParserProfileWorkForIntakeFile } from "./parserProfileActivation.js";
import { listActionableKaiP1WorkCandidates } from "../db/kaiIntakeQueries.js";
import { createDraftDataDictionary } from "../services/kaiDataDictionaryService.js";
import { persistIntakeSensitivityProfile } from "../services/kaiIntakeSensitivityProfileService.js";
import { createProductionMetadataOnlyAudit } from "../services/kaiMetadataOnlyAuditComposition.js";

/**
 * KAI P1 worker runtime tick.
 *
 * This is the small in-process runtime seam a cron/scheduling wrapper invokes.
 * It performs no persistence of its own: it discovers ACTIONABLE_AUTOMATIC_P1_
 * WORK candidates across every organization (bounded, deterministically
 * ordered, database-backed) and hands each one - using that candidate's own
 * persisted `organization_id`, never a process-global value - to the existing,
 * unchanged `activateParserProfileWorkForIntakeFile` activation seam, reusing
 * its existing activation, queue/idempotency, locking, exact-version read,
 * audit-transaction, tenant-boundary, and retry semantics as-is.
 *
 * Only when that P1-03 activation reports an authoritative COMPLETED run -
 * whether freshly completed this tick or an idempotent replay of an
 * already-completed run - does the tick continue, strictly in order, through
 * the existing dormant P1-04 (`createDraftDataDictionary`) and P1-05
 * (`persistIntakeSensitivityProfile`) service seams - unchanged by this
 * module - using the authoritative `output_profile_id` that completed run
 * carries, and then the P1-04 bundle's own `data_dictionary_id`. Neither seam
 * is reimplemented here; both are invoked exactly as any other caller would
 * invoke them. A later tick never re-profiles or re-queues an already-
 * completed P1-03 run merely to resume P1-04/P1-05. The tick stops there: it
 * never imports, calls, or otherwise reaches the P1-06 review-queue seam, so
 * no worker/system/internal P1-06 write path exists. P1-06 initiation remains
 * exclusively a human action, gated by the existing `AUTH-KAI-003` mapped-
 * human-actor check in `kaiReviewQueueService.js`, untouched by this package.
 *
 * A P1-04 or P1-05 failure stops the chain at that stage: it is recorded on
 * the returned entry but never retried automatically and never treated as
 * grounds to re-run P1-03.
 *
 * Fails closed (zero work) unless both `KAI_SPRINT2_ENABLED` and
 * `KAI_WORKER_ENABLED` are enabled. Never accepts a file-ID selector and never
 * uses a process-global organization id: each candidate's own persisted
 * `organization_id` is used for its activation and downstream P1-04/P1-05
 * calls. Never retries automatically - each eligible file is activated with
 * `retry: false`.
 */
export const KAI_P1_WORKER_SYNTHETIC_ACTOR_CONTEXT = Object.freeze({
  actorType: "system",
  actorUserId: null,
});

export async function runKaiP1WorkerTick(dependencies = {}) {
  const env = dependencies.env || process.env;

  if (!areKaiSprint2WorkerFeaturesEnabled(env)) {
    return { ok: true, data: { activated: [], reason: "worker_disabled" }, error: null };
  }

  const listCandidates =
    dependencies.listActionableKaiP1WorkCandidates || listActionableKaiP1WorkCandidates;

  let candidates;
  try {
    candidates = await listCandidates();
  } catch {
    return { ok: false, data: null, error: { code: "system_error" } };
  }

  const activateFn =
    dependencies.activateParserProfileWorkForIntakeFile || activateParserProfileWorkForIntakeFile;
  const draftDataDictionaryFn = dependencies.createDraftDataDictionary || createDraftDataDictionary;
  const persistSensitivityProfileFn =
    dependencies.persistIntakeSensitivityProfile || persistIntakeSensitivityProfile;
  const buildMetadataOnlyAudit =
    dependencies.createProductionMetadataOnlyAudit || createProductionMetadataOnlyAudit;
  const nowFn = dependencies.now || (() => new Date().toISOString());

  const activated = [];
  for (const file of Array.isArray(candidates) ? candidates : []) {
    // Defense in depth: never process a malformed row missing either half of
    // its tenant identity, even if a supplied dependency ever returned one.
    if (typeof file?.organization_id !== "string" || file.organization_id.length === 0) continue;
    if (typeof file?.intake_file_id !== "string" || file.intake_file_id.length === 0) continue;

    const organizationId = file.organization_id;
    const intakeFileId = file.intake_file_id;

    const result = await activateFn(
      {
        organizationId,
        intakeFileId,
        actorContext: KAI_P1_WORKER_SYNTHETIC_ACTOR_CONTEXT,
        retry: false,
      },
      dependencies,
    );

    const entry = { organizationId, intakeFileId, result };

    // Continuation requires an authoritative COMPLETED P1-03 result - whether
    // freshly completed this tick or an idempotent replay of an
    // already-completed run - never a bare `activated: true` flag, which is
    // false on a completed replay even though the completed run itself is
    // just as authoritative. Any other status (queued/running/failed/error)
    // never carries a completed run and is never treated as one.
    const parserStatus = result?.ok === true ? result?.data?.run?.run?.parser_status : undefined;
    const outputProfileId = result?.ok === true ? result?.data?.run?.run?.output_profile_id : undefined;

    if (result?.ok === true && parserStatus === "completed" && typeof outputProfileId === "string" && outputProfileId.length > 0) {
      const metadataOnlyAudit = dependencies.metadataOnlyAudit || buildMetadataOnlyAudit({
        organizationId,
        intakeFileId,
        actorContext: KAI_P1_WORKER_SYNTHETIC_ACTOR_CONTEXT,
        now: nowFn(),
      });

      const dictionaryResult = await draftDataDictionaryFn(
        { organizationId, fileProfileId: outputProfileId, now: nowFn() },
        { ...dependencies, metadataOnlyAudit },
      );
      entry.dataDictionary = dictionaryResult;

      const dataDictionaryId =
        dictionaryResult?.ok === true ? dictionaryResult?.data?.dictionary?.data_dictionary_id : undefined;

      if (dictionaryResult?.ok === true && typeof dataDictionaryId === "string" && dataDictionaryId.length > 0) {
        entry.sensitivityProfile = await persistSensitivityProfileFn(
          {
            organizationId,
            fileProfileId: outputProfileId,
            dataDictionaryId,
            now: nowFn(),
          },
          { ...dependencies, metadataOnlyAudit },
        );
      }
    }

    activated.push(entry);
  }

  return { ok: true, data: { activated }, error: null };
}

export const __testables = Object.freeze({
  KAI_P1_WORKER_SYNTHETIC_ACTOR_CONTEXT,
});
