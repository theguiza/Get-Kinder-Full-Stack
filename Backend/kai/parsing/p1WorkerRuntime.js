import { areKaiSprint2WorkerFeaturesEnabled } from "../config/kaiSprint2Config.js";
import { activateParserProfileWorkForIntakeFile } from "./parserProfileActivation.js";
import { listActionableKaiP1WorkCandidates } from "../db/kaiIntakeQueries.js";
import { createDraftDataDictionary } from "../services/kaiDataDictionaryService.js";
import { persistIntakeSensitivityProfile } from "../services/kaiIntakeSensitivityProfileService.js";
import { createProductionMetadataOnlyAudit } from "../services/kaiMetadataOnlyAuditComposition.js";
import { ensureSensitivityReviewQueueItemAfterProfiling } from "../services/kaiReviewQueueService.js";
import { createPostgresDataDictionaryRepository } from "../dictionary/postgresDataDictionaryRepository.js";
import { createPostgresIntakeSensitivityProfileRepository } from "../dictionary/postgresIntakeSensitivityProfileRepository.js";
import { createPostgresReviewQueueRepository } from "../dictionary/postgresReviewQueueRepository.js";
import { createKaiP1StageTransaction } from "./p1StageTransaction.js";
import {
  P1_DOWNSTREAM_STAGES,
  createPostgresP1DownstreamRecoveryRepository,
} from "./postgresP1DownstreamRecoveryRepository.js";

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
 * resume P1-04/P1-05. Once P1-05 has a committed sensitivity profile (fresh,
 * replayed, or reconciled), the operation hands off to the P1-06 seam
 * `ensureSensitivityReviewQueueItemAfterProfiling` (owner decision
 * 2026-10-18), which ensures the profile's pending 'sensitivity_review' work
 * item exists, attributed to the system. That handoff records no review
 * decision of any kind; the decision stays a mapped-human action under
 * AUTH-KAI-003. Its failure is reported (`stoppedAt`) and never undoes P1-05;
 * the human review-work route remains available, and a later re-run of this
 * operation replays the idempotent handoff. Nothing beyond P1-06 is reached.
 *
 * Each downstream stage runs only under a PostgreSQL-owned attempt claim
 * (`postgresP1DownstreamRecoveryRepository.js`): the attempt is reserved
 * and counted before the stage runs, an already-committed output is
 * reconciled instead of re-run, and the outcome is acknowledged through the
 * claim's fencing token. A failure stops the chain at that stage
 * (`stoppedAt`, with the recovery decision in `recovery`); it is never
 * grounds to re-run P1-03 or to mark the completed parser run failed, and
 * the operation never retries within a call. Only the established
 * infrastructure code `system_error` is retryable (at most three attempts
 * per stage, cooling down 1 then 5 minutes); every other or unrecognized
 * outcome is recorded for operator attention and excluded from automatic
 * selection. The stage transactions re-assert the file's eligibility under
 * a share lock, so a file blocked mid-chain cannot gain P1-04/P1-05 output.
 *
 * Fails closed (zero work) unless both `KAI_SPRINT2_ENABLED` and
 * `KAI_WORKER_ENABLED` are enabled. Every activation passes `retry: false`:
 * a failed parser run is retried only when the activation finds its failure
 * was infrastructure-only and due (`isAutomaticParserRetryDue`); a failure
 * about the file itself is never retried.
 */
export const KAI_P1_WORKER_SYNTHETIC_ACTOR_CONTEXT = Object.freeze({
  actorType: "system",
  actorUserId: null,
});

const PROCESS_INPUT_KEYS = new Set(["organizationId", "intakeFileId", "expectedFileFacts"]);

// Downstream stage outcomes, from the inspected P1-04/P1-05 service and
// repository taxonomy. `system_error` is the repositories' infrastructure
// class (its transaction rolled back; the stage is idempotent), so it alone
// is retried within the bounded budget. Every other code - and anything
// unrecognized, malformed, or thrown - fails closed to operator attention.
const RETRYABLE_STAGE_ERROR_CODES = new Set(["system_error"]);
const NON_RETRYABLE_STAGE_ERROR_CODES = new Set([
  "validation_blocker",
  "conflict_current_state_changed",
  "not_found",
  "feature_disabled",
  "authorization_denied",
  "tenant_boundary_violation",
  "state_transition_denied",
  // Assigned below when a stage throws instead of returning a result.
  "unclassified_stage_exception",
]);
const SAFE_CODE_RE = /^[a-z0-9_]{1,64}$/;

export function classifyKaiP1DownstreamStageFailure(result) {
  const code = result?.error?.code;
  if (RETRYABLE_STAGE_ERROR_CODES.has(code)) return { outcome: "retryable_failure", errorCode: code };
  if (NON_RETRYABLE_STAGE_ERROR_CODES.has(code)) return { outcome: "non_retryable_failure", errorCode: code };
  return { outcome: "non_retryable_failure", errorCode: "unclassified_stage_failure" };
}

function safeCode(value) {
  return typeof value === "string" && SAFE_CODE_RE.test(value) ? value : null;
}

/**
 * Runs one downstream stage under its durable attempt claim. Returns the
 * stage result (or a reconciled stand-in carrying the committed output id),
 * the output id when the stage is satisfied, and the recovery record.
 */
async function runClaimedDownstreamStage({ recoveryRepository, identity, nowFn, metadataOnlyAudit, invoke, outputIdOf, reconciledResult }) {
  let claim;
  try {
    claim = await recoveryRepository.claimDownstreamAttempt({ identity, now: nowFn(), metadataOnlyAudit });
  } catch {
    claim = null;
  }
  if (claim?.ok !== true) {
    return {
      outputId: null,
      result: null,
      recovery: { stage: identity.stage, decision: "claim_failed", code: safeCode(claim?.error?.code) || "system_error" },
    };
  }

  const decision = claim.data.decision;
  if (decision === "already_succeeded" && typeof claim.data.outputId === "string" && claim.data.outputId.length > 0) {
    return {
      outputId: claim.data.outputId,
      result: reconciledResult(claim.data.outputId),
      recovery: { stage: identity.stage, decision: "already_succeeded", code: null },
    };
  }
  if (decision !== "claimed") {
    return {
      outputId: null,
      result: null,
      recovery: {
        stage: identity.stage,
        decision: safeCode(decision) || "unclassified",
        code: safeCode(claim.data.errorCode),
        attempt: claim.data.attemptNumber ?? null,
      },
    };
  }

  let result;
  try {
    result = await invoke();
  } catch {
    result = { ok: false, data: null, error: { code: "unclassified_stage_exception" } };
  }
  const outputId = result?.ok === true ? outputIdOf(result) : undefined;
  const succeeded = typeof outputId === "string" && outputId.length > 0;
  const failure = succeeded ? null : classifyKaiP1DownstreamStageFailure(result);

  let ack;
  try {
    ack = await recoveryRepository.completeDownstreamAttempt({
      identity,
      claimToken: claim.data.claimToken,
      outcome: succeeded ? "succeeded" : failure.outcome,
      errorCode: succeeded ? null : failure.errorCode,
      now: nowFn(),
      metadataOnlyAudit,
    });
  } catch {
    ack = null;
  }
  const acknowledged = ack?.ok === true && ack.data?.acknowledged === true;
  return {
    outputId: succeeded ? outputId : null,
    result,
    recovery: {
      stage: identity.stage,
      // An unacknowledged attempt stays reserved; its lease expiry counts it.
      decision: acknowledged ? ack.data.recoveryState : "unacknowledged",
      code: succeeded ? null : failure.errorCode,
      attempt: claim.data.attemptNumber,
    },
  };
}

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

  const stageTransaction = createKaiP1StageTransaction({
    organizationId,
    intakeFileId,
    verifiedChecksum: result.data.run.run.checksum,
    runInTransaction: dependencies.runInTransaction,
  });
  const stageDependencies = {
    ...dependencies,
    metadataOnlyAudit,
    dataDictionaryRepository: dependencies.dataDictionaryRepository
      || createPostgresDataDictionaryRepository({ runInTransaction: stageTransaction }),
    intakeSensitivityProfileRepository: dependencies.intakeSensitivityProfileRepository
      || createPostgresIntakeSensitivityProfileRepository({ runInTransaction: stageTransaction }),
  };
  const recoveryRepository = dependencies.p1DownstreamRecoveryRepository
    || createPostgresP1DownstreamRecoveryRepository({ runInTransaction: dependencies.runInTransaction });
  entry.recovery = [];

  const dictionaryStage = await runClaimedDownstreamStage({
    recoveryRepository,
    identity: { organizationId, intakeFileId, fileProfileId: outputProfileId, stage: P1_DOWNSTREAM_STAGES.dataDictionary },
    nowFn,
    metadataOnlyAudit,
    invoke: () => draftDataDictionaryFn({ organizationId, fileProfileId: outputProfileId, now: nowFn() }, stageDependencies),
    outputIdOf: (stageResult) => stageResult?.data?.dictionary?.data_dictionary_id,
    reconciledResult: (dataDictionaryId) => ({
      ok: true,
      data: { dictionary: { data_dictionary_id: dataDictionaryId }, replayed: true, reconciled: true },
      error: null,
    }),
  });
  entry.recovery.push(dictionaryStage.recovery);
  if (dictionaryStage.result) entry.dataDictionary = dictionaryStage.result;
  if (!dictionaryStage.outputId) {
    entry.stoppedAt = "draft_data_dictionary";
    return { ok: true, data: entry, error: null };
  }
  const dataDictionaryId = dictionaryStage.outputId;

  const sensitivityStage = await runClaimedDownstreamStage({
    recoveryRepository,
    identity: { organizationId, intakeFileId, fileProfileId: outputProfileId, stage: P1_DOWNSTREAM_STAGES.sensitivityProfile },
    nowFn,
    metadataOnlyAudit,
    invoke: () => persistSensitivityProfileFn(
      { organizationId, fileProfileId: outputProfileId, dataDictionaryId, now: nowFn() },
      stageDependencies,
    ),
    outputIdOf: (stageResult) => stageResult?.data?.sensitivityProfile?.intake_sensitivity_profile_id,
    reconciledResult: (intakeSensitivityProfileId) => ({
      ok: true,
      data: { sensitivityProfile: { intake_sensitivity_profile_id: intakeSensitivityProfileId }, replayed: true, reconciled: true },
      error: null,
    }),
  });
  entry.recovery.push(sensitivityStage.recovery);
  if (sensitivityStage.result) entry.sensitivityProfile = sensitivityStage.result;
  if (!sensitivityStage.outputId) {
    entry.stoppedAt = "persist_intake_sensitivity_profile";
    return { ok: true, data: entry, error: null };
  }

  const ensureReviewWorkFn = dependencies.ensureSensitivityReviewQueueItemAfterProfiling
    || ensureSensitivityReviewQueueItemAfterProfiling;
  let reviewWork;
  try {
    reviewWork = await ensureReviewWorkFn(
      { organizationId, intakeSensitivityProfileId: sensitivityStage.outputId, now: nowFn() },
      {
        env,
        reviewQueueRepository: dependencies.reviewQueueRepository
          || createPostgresReviewQueueRepository({ runInTransaction: dependencies.runInTransaction }),
      },
    );
  } catch {
    reviewWork = { ok: false, data: null, error: { code: "system_error" } };
  }
  entry.sensitivityReviewWork = reviewWork?.ok === true
    ? { ok: true, replayed: reviewWork.data?.replayed === true, reviewQueueItemId: reviewWork.data?.reviewQueueItem?.review_queue_item_id ?? null }
    : { ok: false, code: safeCode(reviewWork?.error?.code) || "system_error" };
  if (reviewWork?.ok !== true) entry.stoppedAt = "sensitivity_review_work";

  return { ok: true, data: entry, error: null };
}

export async function runKaiP1WorkerTick(dependencies = {}) {
  const env = dependencies.env || process.env;

  if (!areKaiSprint2WorkerFeaturesEnabled(env)) {
    return { ok: true, data: { activated: [], reason: "worker_disabled" }, error: null };
  }

  const nowFn = dependencies.now || (() => new Date().toISOString());
  const listCandidates =
    dependencies.listActionableKaiP1WorkCandidates
    || ((options) => listActionableKaiP1WorkCandidates(undefined, options));

  let candidates;
  try {
    candidates = await listCandidates({ now: nowFn() });
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
