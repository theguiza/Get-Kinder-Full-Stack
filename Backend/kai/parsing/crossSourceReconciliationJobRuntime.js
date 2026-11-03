import { areKaiSprint2WorkerFeaturesEnabled } from "../config/kaiSprint2Config.js";
import { createPostgresCrossSourceReconciliationJobRepository } from "./postgresCrossSourceReconciliationJobRepository.js";

/**
 * KAI cross-source reconciliation worker runtime: the queued half of a
 * cross-source measurement. The HTTP request only admits it and records a
 * job; here one job attempt is claimed, the measurements are committed in
 * the derived-measurement repository's own transaction under the claim's
 * fencing token (the shared loader revalidates both versions' currentness,
 * profile binding and allowed use, and the reconciliation worker reads and
 * checks both versions' bytes through the P1 exact-version reader), and a
 * refused or failed attempt is recorded with its safe code only.
 *
 * It runs on the existing P1 scheduling model: `dispatch` after the request
 * commits (fire-and-forget, bounded, coalesced) and the per-minute sweep of
 * `runCrossSourceReconciliationTick` registered beside the P1 tick. Both
 * fail closed unless `KAI_SPRINT2_ENABLED` and `KAI_WORKER_ENABLED` are on.
 * PostgreSQL claims stay the authority across processes.
 */

// Infrastructure failures are retried within the attempt budget; anything
// about the sources, the mapping or the bytes' identity fails the job.
const RETRYABLE_CODES = new Set(["system_error", "cross_source_bytes_unavailable"]);
const SAFE_CODE_RE = /^[a-z0-9_]{1,64}$/;
const LOG_PREFIX = "[kai-cross-source-reconciliation]";

function safeCode(value) {
  return typeof value === "string" && SAFE_CODE_RE.test(value) ? value : null;
}

// The most specific safe code of a refusal: its blocking reason, else its error code.
export function reconciliationFailureCode(result) {
  const blockers = Array.isArray(result?.error?.blockers) ? result.error.blockers : [];
  return safeCode(blockers[0]?.blocking_reason) || safeCode(result?.error?.code) || "unclassified_reconciliation_failure";
}

function samePeriod(a, b) {
  return a?.period_start === b?.period_start && a?.period_end === b?.period_end && a?.precision === b?.precision;
}

/**
 * One attempt of one job. Returns `{ outcome, code, job }` with outcome one of
 * succeeded, failed, retry_scheduled, exhausted, lost (the claim was taken
 * over), or the claim decision when nothing was attempted.
 */
export async function processCrossSourceReconciliationJob({ organizationId, reconciliationJobId } = {}, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!areKaiSprint2WorkerFeaturesEnabled(env)) return { outcome: "worker_disabled", code: null, job: null };
  const nowFn = dependencies.now || (() => new Date().toISOString());
  const jobs = dependencies.reconciliationJobRepository || createPostgresCrossSourceReconciliationJobRepository();
  const measurements = dependencies.derivedMeasurementRepository || (await createDefaultCrossSourceRepository());

  const claimed = await jobs.claim({ organizationId, reconciliationJobId, now: nowFn() });
  if (claimed.decision !== "claimed") return { outcome: claimed.decision, code: claimed.job?.last_error_code ?? null, job: claimed.job };
  const job = claimed.job;
  const { period, ...mapping } = job.mapping;

  let result;
  try {
    result = await measurements.recordCrossSourceReachMeasurements({
      organizationId,
      primarySourceVersionId: job.primary_source_version_id,
      referenceSourceVersionId: job.reference_source_version_id,
      mapping,
      actorUserId: job.requested_by,
      now: nowFn(),
      fence: {
        async before(tx) {
          const held = await jobs.fenceInTransaction(tx, { organizationId, reconciliationJobId, claimToken: job.claim_token, now: nowFn() });
          return held ? null : { ok: false, data: null, error: { code: "reconciliation_claim_lost", status: 409 } };
        },
        profilesMatch: ({ primary, reference, period: currentPeriod }) => primary === job.primary_profile_canonical_sha256
          && reference === job.reference_profile_canonical_sha256 && samePeriod(currentPeriod, period),
        async after(tx, measurementIds) {
          await jobs.completeSucceededInTransaction(tx, { organizationId, reconciliationJobId, claimToken: job.claim_token, measurementIds, now: nowFn() });
        },
      },
    });
  } catch {
    result = { ok: false, data: null, error: { code: "system_error" } };
  }

  if (result?.ok === true) return { outcome: "succeeded", code: null, job: await jobs.read({ organizationId, reconciliationJobId }) };
  if (result?.error?.code === "reconciliation_claim_lost") return { outcome: "lost", code: null, job: null };
  const code = reconciliationFailureCode(result);
  const settled = await jobs.completeFailed({
    organizationId, reconciliationJobId, claimToken: job.claim_token, errorCode: code, retryable: RETRYABLE_CODES.has(code), now: nowFn(),
  });
  if (!settled.acknowledged) return { outcome: "lost", code, job: settled.job };
  return { outcome: settled.job.job_state, code, job: settled.job };
}

// The measurement repository with the reconciliation worker, composed from the
// P1 parser-reader dependencies only (the one composition that may read bytes).
async function createDefaultCrossSourceRepository() {
  const [{ createPostgresDerivedMeasurementRepository }, { createCrossSourceReconciliationWorker }, { getKaiIntakeParserReadDependencies }] = await Promise.all([
    import("../dictionary/postgresDerivedMeasurementRepository.js"),
    import("./crossSourceReconciliationWorker.js"),
    import("../services/kaiIntakeRuntimeService.js"),
  ]);
  return createPostgresDerivedMeasurementRepository({
    crossSourceReconciliationWorker: createCrossSourceReconciliationWorker(getKaiIntakeParserReadDependencies()),
  });
}

/** The sweep: every due job (queued, retry due, lease expired), one attempt each. */
export async function runCrossSourceReconciliationTick(dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!areKaiSprint2WorkerFeaturesEnabled(env)) return { ok: true, data: { attempted: [], reason: "worker_disabled" }, error: null };
  const nowFn = dependencies.now || (() => new Date().toISOString());
  const jobs = dependencies.reconciliationJobRepository || createPostgresCrossSourceReconciliationJobRepository();
  let due;
  try {
    due = await jobs.listDue({ now: nowFn() });
  } catch {
    return { ok: false, data: null, error: { code: "system_error" } };
  }
  const attempted = [];
  for (const row of due) {
    try {
      const processed = await processCrossSourceReconciliationJob(
        { organizationId: row.organization_id, reconciliationJobId: row.reconciliation_job_id },
        { ...dependencies, reconciliationJobRepository: jobs },
      );
      attempted.push({ outcome: processed.outcome, code: processed.code });
    } catch {
      attempted.push({ outcome: "error", code: "system_error" });
    }
  }
  return { ok: true, data: { attempted }, error: null };
}

export const KAI_RECONCILIATION_DISPATCH_MAX_CONCURRENT = 1;
export const KAI_RECONCILIATION_DISPATCH_MAX_WAITING = 25;

/**
 * Post-commit hand-off of a freshly queued job, as the P1 file dispatcher
 * does for a passed upload: never awaited, at most one job at a time and a
 * bounded wait list per process, coalesced per job; whatever it drops stays
 * queued for the sweep.
 */
export function createCrossSourceReconciliationDispatcher({
  processJob = processCrossSourceReconciliationJob,
  maxConcurrent = KAI_RECONCILIATION_DISPATCH_MAX_CONCURRENT,
  maxWaiting = KAI_RECONCILIATION_DISPATCH_MAX_WAITING,
  schedule = (callback) => setImmediate(callback),
  log = (line) => console.log(line),
} = {}) {
  const waiting = [];
  const activeKeys = new Set();
  const idleWaiters = [];
  let running = 0;
  const safeLog = (line) => {
    try { log(line); } catch { /* logging never affects dispatch */ }
  };
  const notifyIdle = () => {
    if (running === 0 && waiting.length === 0) while (idleWaiters.length > 0) idleWaiters.shift()();
  };
  function start() {
    while (running < maxConcurrent && waiting.length > 0) {
      const item = waiting.shift();
      running += 1;
      Promise.resolve()
        .then(() => processJob(item.input, item.dependencies))
        .then(
          (result) => safeLog(`${LOG_PREFIX} outcome=${safeCode(result?.outcome) || "unclassified"}${safeCode(result?.code) ? ` code=${result.code}` : ""}`),
          () => safeLog(`${LOG_PREFIX} outcome=error`),
        )
        .finally(() => {
          running -= 1;
          activeKeys.delete(item.key);
          start();
          notifyIdle();
        });
    }
  }
  return Object.freeze({
    dispatch({ organizationId, reconciliationJobId } = {}, dependencies = {}) {
      if (typeof organizationId !== "string" || !organizationId || typeof reconciliationJobId !== "string" || !reconciliationJobId) {
        return { scheduled: false, reason: "invalid_identity" };
      }
      if (!areKaiSprint2WorkerFeaturesEnabled(dependencies.env || process.env)) return { scheduled: false, reason: "worker_disabled" };
      const key = `${organizationId}/${reconciliationJobId}`;
      if (activeKeys.has(key)) return { scheduled: false, reason: "already_dispatched" };
      if (waiting.length >= maxWaiting) return { scheduled: false, reason: "dispatcher_saturated" };
      activeKeys.add(key);
      waiting.push({ key, input: { organizationId, reconciliationJobId }, dependencies: dependencies.env ? { env: dependencies.env } : {} });
      schedule(start);
      return { scheduled: true, reason: null };
    },
    whenIdle() {
      if (running === 0 && waiting.length === 0) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },
  });
}

let defaultDispatcher = null;

export function getCrossSourceReconciliationDispatcher() {
  defaultDispatcher ||= createCrossSourceReconciliationDispatcher();
  return defaultDispatcher;
}
