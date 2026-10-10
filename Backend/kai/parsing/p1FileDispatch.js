import { areKaiSprint2WorkerFeaturesEnabled } from "../config/kaiSprint2Config.js";
import { processKaiP1IntakeFile } from "./p1WorkerRuntime.js";

/**
 * KAI P1 immediate file-scoped dispatch.
 *
 * The post-commit hand-off from a freshly committed Gate C `passed` policy
 * decision to the existing file-scoped P1 operation
 * (`processKaiP1IntakeFile`: P1-03 -> P1-04 -> P1-05, stopping before any
 * P1-06 human-review seam). It is an in-process, in-memory scheduler only:
 * it adds no persistent queue, job table, process, timer loop, or route, and
 * nothing it holds survives a process exit. The file's persisted
 * confirmed/passed state is the durable record; anything this dispatcher
 * drops, defers, or loses is left exactly as the existing scheduled sweep
 * (`runKaiP1WorkerTick`) already finds it.
 *
 * - `dispatch` returns synchronously and never awaits P1 work; jobs start on
 *   a later macrotask, so no parser work runs inside the caller's request.
 * - At most `maxConcurrent` jobs run at once per process and at most
 *   `maxWaiting` wait; a dispatch beyond that is refused (`dispatcher_saturated`)
 *   rather than queued without bound.
 * - A second notification for a file already waiting or running in this
 *   process is coalesced. Across processes, PostgreSQL parser-run claiming
 *   and the P1-04/P1-05 conflict handling remain the authority.
 * - A job runs exactly once. Whatever it returns - including an outer
 *   `ok: true` whose chain stopped at P1-03, P1-04, or P1-05 - is logged as a
 *   safe stage/code token and never retried or re-dispatched from here.
 */
export const KAI_P1_DISPATCH_MAX_CONCURRENT = 2;
export const KAI_P1_DISPATCH_MAX_WAITING = 25;

const LOG_PREFIX = "[kai-p1-dispatch]";
const SAFE_TOKEN_RE = /^[a-z0-9_]{1,64}$/;

// Only the trusted runtime composition the P1 byte source and feature gates
// need is forwarded; request-scoped overrides of the confirming call (clock,
// transaction, CAS, audit, assessment) never reach P1.
const FORWARDED_DEPENDENCY_KEYS = Object.freeze([
  "env",
  "storageAdapter",
  "gcsProvider",
  "gcsParserReaderProvider",
  "uploadLifecycleRepository",
]);

function forwardedDependencies(dependencies = {}) {
  const forwarded = {};
  for (const key of FORWARDED_DEPENDENCY_KEYS) {
    if (dependencies[key] !== undefined) forwarded[key] = dependencies[key];
  }
  return forwarded;
}

function safeToken(value) {
  return typeof value === "string" && SAFE_TOKEN_RE.test(value) ? value : "unclassified";
}

// Downstream recovery decisions (see postgresP1DownstreamRecoveryRepository.js)
// mapped to the outcome a stopped P1-04/P1-05 stage is reported as.
const RECOVERY_DECISION_OUTCOMES = Object.freeze({
  retry_scheduled: "deferred",
  deferred: "deferred",
  busy: "busy",
  exhausted: "exhausted",
  operator_attention: "operator_attention",
  not_eligible: "not_eligible",
  claim_failed: "failed",
  unacknowledged: "failed",
});

/**
 * Classifies a `processKaiP1IntakeFile` result. An outer `ok: true` only
 * means the operation ran; completion through P1-05 requires no `stoppedAt`
 * and a successful sensitivity-profile result. A stopped downstream stage is
 * reported by its durable recovery decision when one was recorded.
 */
export function classifyKaiP1DispatchResult(result) {
  if (result?.ok !== true) {
    return { outcome: "rejected", stage: "process_kai_p1_intake_file", code: safeToken(result?.error?.code) };
  }
  const entry = result.data;
  if (entry?.stoppedAt === undefined && entry?.sensitivityProfile?.ok === true) {
    return { outcome: "completed_through_p1_05", stage: null, code: null };
  }
  const stage = entry?.stoppedAt;
  let code;
  let outcome = "stopped";
  if (stage === "parser_profile_activation") {
    code = entry.result?.error?.code || entry.result?.data?.reason || entry.result?.data?.run?.run?.parser_status;
  } else if (stage === "draft_data_dictionary" || stage === "persist_intake_sensitivity_profile") {
    const recovery = Array.isArray(entry.recovery) ? entry.recovery.at(-1) : null;
    outcome = RECOVERY_DECISION_OUTCOMES[recovery?.decision] || "stopped";
    code = recovery?.code
      || (stage === "draft_data_dictionary" ? entry.dataDictionary?.error?.code : entry.sensitivityProfile?.error?.code)
      || recovery?.decision;
  }
  return { outcome, stage: safeToken(stage), code: safeToken(code) };
}

function outcomeLine({ outcome, stage, code }) {
  return [`${LOG_PREFIX} outcome=${outcome}`, stage ? `stage=${stage}` : null, code ? `code=${code}` : null]
    .filter(Boolean)
    .join(" ");
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

export function createKaiP1FileDispatcher({
  processFile = processKaiP1IntakeFile,
  maxConcurrent = KAI_P1_DISPATCH_MAX_CONCURRENT,
  maxWaiting = KAI_P1_DISPATCH_MAX_WAITING,
  schedule = (callback) => setImmediate(callback),
  log = (line) => console.log(line),
} = {}) {
  const waiting = [];
  const activeKeys = new Set();
  const idleWaiters = [];
  const counters = {
    scheduled: 0,
    coalesced: 0,
    saturated: 0,
    disabled: 0,
    invalid: 0,
    started: 0,
    settled: 0,
  };
  let running = 0;

  function safeLog(line) {
    try {
      log(line);
    } catch {
      // Logging can never affect dispatch state.
    }
  }

  function notifyIdle() {
    if (running !== 0 || waiting.length !== 0) return;
    while (idleWaiters.length > 0) idleWaiters.shift()();
  }

  function startWaitingJobs() {
    while (running < maxConcurrent && waiting.length > 0) {
      const job = waiting.shift();
      running += 1;
      counters.started += 1;
      Promise.resolve()
        .then(() => processFile(job.input, job.dependencies))
        .then(
          (result) => safeLog(outcomeLine(classifyKaiP1DispatchResult(result))),
          () => safeLog(`${LOG_PREFIX} outcome=error stage=process_kai_p1_intake_file`),
        )
        .finally(() => {
          running -= 1;
          counters.settled += 1;
          activeKeys.delete(job.key);
          startWaitingJobs();
          notifyIdle();
        });
    }
  }

  return Object.freeze({
    /**
     * Schedules one file-scoped P1 operation. Never throws and never awaits
     * P1 work. `expectedFileFacts` must be the trusted verified identity the
     * caller just committed; it can only narrow eligibility.
     */
    dispatch({ organizationId, intakeFileId, expectedFileFacts } = {}, dependencies = {}) {
      if (!isNonEmptyString(organizationId) || !isNonEmptyString(intakeFileId)) {
        counters.invalid += 1;
        return { scheduled: false, reason: "invalid_identity" };
      }
      if (!areKaiSprint2WorkerFeaturesEnabled(dependencies.env || process.env)) {
        counters.disabled += 1;
        return { scheduled: false, reason: "worker_disabled" };
      }
      const key = `${organizationId}/${intakeFileId}`;
      if (activeKeys.has(key)) {
        counters.coalesced += 1;
        return { scheduled: false, reason: "already_dispatched" };
      }
      if (waiting.length >= maxWaiting) {
        counters.saturated += 1;
        safeLog(`${LOG_PREFIX} outcome=deferred_to_scheduled_sweep code=dispatcher_saturated`);
        return { scheduled: false, reason: "dispatcher_saturated" };
      }

      activeKeys.add(key);
      waiting.push({
        key,
        input: {
          organizationId,
          intakeFileId,
          ...(expectedFileFacts !== undefined ? { expectedFileFacts } : {}),
        },
        dependencies: forwardedDependencies(dependencies),
      });
      counters.scheduled += 1;
      schedule(startWaitingJobs);
      return { scheduled: true, reason: null };
    },

    stats() {
      return { running, waiting: waiting.length, ...counters };
    },

    /** Resolves once nothing is running or waiting (observability/tests). */
    whenIdle() {
      if (running === 0 && waiting.length === 0) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },
  });
}

let defaultDispatcher = null;

/** The process-wide dispatcher the production confirmation path uses. */
export function getKaiP1FileDispatcher() {
  defaultDispatcher ||= createKaiP1FileDispatcher();
  return defaultDispatcher;
}

export const __testables = Object.freeze({
  FORWARDED_DEPENDENCY_KEYS,
  forwardedDependencies,
  safeToken,
});
