import { areKaiSprint2WorkerFeaturesEnabled } from "../config/kaiSprint2Config.js";
import { activateParserProfileWorkForIntakeFile } from "./parserProfileActivation.js";
import { listActionableKaiP1WorkCandidates } from "../db/kaiIntakeQueries.js";
import { createDraftDataDictionary } from "../services/kaiDataDictionaryService.js";
import { persistIntakeSensitivityProfile } from "../services/kaiIntakeSensitivityProfileService.js";
import { createProductionMetadataOnlyAudit } from "../services/kaiMetadataOnlyAuditComposition.js";

/**
 * KAI P1 worker runtime.
 *
 * `processKaiP1IntakeFile` is the one trusted internal file-scoped P1
 * operation: P1-03 -> P1-04 -> P1-05 for exactly one organization-scoped
 * intake file. `runKaiP1WorkerTick` is the scheduled-recovery seam a
 * cron/scheduling wrapper invokes; it discovers ACTIONABLE_AUTOMATIC_P1_WORK
 * candidates across every organization (bounded, deterministically ordered,
 * database-backed) and hands each one - using that candidate's own persisted
 * `organization_id`, never a process-global value - to that same operation.
 * Neither performs persistence of its own.
 *
 * The operation reuses the existing, unchanged
 * `activateParserProfileWorkForIntakeFile` activation seam - which re-reads
 * the authoritative eligibility facts (confirmed upload, passed file policy,
 * verified object-version identity) on every call - and with it the existing
 * queue/idempotency, `FOR UPDATE ... SKIP LOCKED` claiming, exact-version
 * read, audit-transaction, tenant-boundary, and retry semantics as-is. The
 * caller supplies only the file's identity (plus, optionally, the exact
 * confirmed object-version facts it observed, which can only narrow
 * eligibility); it can never supply an actor, a retry request, or any
 * eligibility fact.
 *
 * Only when that P1-03 activation reports an authoritative COMPLETED run -
 * whether freshly completed now or an idempotent replay of an already-
 * completed run - does the operation continue, strictly in order, through
 * the existing dormant P1-04 (`createDraftDataDictionary`) and P1-05
 * (`persistIntakeSensitivityProfile`) service seams - unchanged by this
 * module - using the authoritative `output_profile_id` that completed run
 * carries, and then the P1-04 bundle's own `data_dictionary_id`. Neither seam
 * is reimplemented here; both are invoked exactly as any other caller would
 * invoke them, and both resolve concurrent identical creation inside
 * PostgreSQL (`ON CONFLICT ... DO NOTHING` plus a locked re-read), so
 * overlapping operations for one file replay rather than duplicate. An
 * already-completed P1-03 run is never re-profiled or re-queued merely to
 * resume P1-04/P1-05. The operation stops there: it never imports, calls, or
 * otherwise reaches the P1-06 review-queue seam, so no worker/system/internal
 * P1-06 write path exists. P1-06 initiation remains exclusively a human
 * action, gated by the existing `AUTH-KAI-003` mapped-human-actor check in
 * `kaiReviewQueueService.js`, untouched by this package.
 *
 * A P1-04 or P1-05 failure stops the chain at that stage (`stoppedAt`) and
 * is never treated as grounds to re-run P1-03 or to mark the completed parser
 * run failed. The operation never retries within a call. Because a failed
 * P1-04/P1-05 transaction rolls back completely and no durable downstream
 * attempt state exists, such a file remains an actionable recovery candidate
 * and is attempted again on each later scheduled sweep.
 *
 * Fails closed (zero work) unless both `KAI_SPRINT2_ENABLED` and
 * `KAI_WORKER_ENABLED` are enabled. Never automatically retries a failed
 * parser run - every activation passes `retry: false`.
 */
export const KAI_P1_WORKER_SYNTHETIC_ACTOR_CONTEXT = Object.freeze({
  actorType: "system",
  actorUserId: null,
});

const PROCESS_INPUT_KEYS = new Set(["organizationId", "intakeFileId", "expectedFileFacts"]);

function isProcessInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  if (!Object.keys(input).every((key) => PROCESS_INPUT_KEYS.has(key))) return false;
  return (
    typeof input.organizationId === "string"
    && input.organizationId.length > 0
    && typeof input.intakeFileId === "string"
    && input.intakeFileId.length > 0
  );
}

export async function processKaiP1IntakeFile(input, dependencies = {}) {
  const env = dependencies.env || process.env;

  if (!areKaiSprint2WorkerFeaturesEnabled(env)) {
    return { ok: false, data: null, error: { code: "feature_disabled" } };
  }
  if (!isProcessInput(input)) {
    return { ok: false, data: null, error: { code: "validation_blocker" } };
  }

  const { organizationId, intakeFileId } = input;
  const activateFn =
    dependencies.activateParserProfileWorkForIntakeFile || activateParserProfileWorkForIntakeFile;
  const draftDataDictionaryFn = dependencies.createDraftDataDictionary || createDraftDataDictionary;
  const persistSensitivityProfileFn =
    dependencies.persistIntakeSensitivityProfile || persistIntakeSensitivityProfile;
  const buildMetadataOnlyAudit =
    dependencies.createProductionMetadataOnlyAudit || createProductionMetadataOnlyAudit;
  const nowFn = dependencies.now || (() => new Date().toISOString());

  const result = await activateFn(
    {
      organizationId,
      intakeFileId,
      actorContext: KAI_P1_WORKER_SYNTHETIC_ACTOR_CONTEXT,
      retry: false,
      ...(input.expectedFileFacts !== undefined ? { expectedFileFacts: input.expectedFileFacts } : {}),
    },
    dependencies,
  );

  const entry = { organizationId, intakeFileId, result };

  // Continuation requires an authoritative COMPLETED P1-03 result - whether
  // freshly completed now or an idempotent replay of an already-completed
  // run - never a bare `activated: true` flag, which is false on a completed
  // replay even though the completed run itself is just as authoritative.
  // Any other status (queued/running/failed/error) never carries a completed
  // run and is never treated as one.
  const parserStatus = result?.ok === true ? result?.data?.run?.run?.parser_status : undefined;
  const outputProfileId = result?.ok === true ? result?.data?.run?.run?.output_profile_id : undefined;

  if (!(result?.ok === true && parserStatus === "completed" && typeof outputProfileId === "string" && outputProfileId.length > 0)) {
    entry.stoppedAt = "parser_profile_activation";
    return { ok: true, data: entry, error: null };
  }

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

  if (!(dictionaryResult?.ok === true && typeof dataDictionaryId === "string" && dataDictionaryId.length > 0)) {
    entry.stoppedAt = "draft_data_dictionary";
    return { ok: true, data: entry, error: null };
  }

  entry.sensitivityProfile = await persistSensitivityProfileFn(
    {
      organizationId,
      fileProfileId: outputProfileId,
      dataDictionaryId,
      now: nowFn(),
    },
    { ...dependencies, metadataOnlyAudit },
  );
  if (entry.sensitivityProfile?.ok !== true) {
    entry.stoppedAt = "persist_intake_sensitivity_profile";
  }

  return { ok: true, data: entry, error: null };
}

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

  const activated = [];
  for (const file of Array.isArray(candidates) ? candidates : []) {
    // Defense in depth: never process a malformed row missing either half of
    // its tenant identity, even if a supplied dependency ever returned one.
    if (typeof file?.organization_id !== "string" || file.organization_id.length === 0) continue;
    if (typeof file?.intake_file_id !== "string" || file.intake_file_id.length === 0) continue;

    const processed = await processKaiP1IntakeFile(
      { organizationId: file.organization_id, intakeFileId: file.intake_file_id },
      dependencies,
    );
    activated.push(
      processed.ok
        ? processed.data
        : { organizationId: file.organization_id, intakeFileId: file.intake_file_id, result: processed },
    );
  }

  return { ok: true, data: { activated }, error: null };
}

export const __testables = Object.freeze({
  KAI_P1_WORKER_SYNTHETIC_ACTOR_CONTEXT,
});
