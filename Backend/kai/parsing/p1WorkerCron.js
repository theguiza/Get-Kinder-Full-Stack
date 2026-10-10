import cron from "node-cron";
import { areKaiSprint2WorkerFeaturesEnabled } from "../config/kaiSprint2Config.js";
import { createKaiIntakeRuntimeDependencies } from "../services/kaiIntakeRuntimeService.js";
import { runKaiP1WorkerTick } from "./p1WorkerRuntime.js";
import { classifyKaiP1DispatchResult } from "./p1FileDispatch.js";

// Recovery is checked every minute while the application scheduler runs;
// this is a polling cadence, not a completion guarantee. Immediate
// file-scoped dispatch after a committed security pass remains the primary
// path; the sweep recovers anything that path refused or lost.
const DEFAULT_SCHEDULE = "* * * * *";
const DEFAULT_TIMEZONE = "America/Vancouver";
const LOG_PREFIX = "[kai-p1-worker]";
const SUMMARY_OUTCOMES = Object.freeze([
  "completed_through_p1_05",
  "deferred",
  "busy",
  "exhausted",
  "operator_attention",
  "not_eligible",
  "stopped",
  "rejected",
  "failed",
]);

/**
 * One line per tick with work: counts by outcome only - never tenant or file
 * identifiers, storage locations, file content, or raw error text.
 */
function tickSummaryLine(entries) {
  const counts = new Map();
  for (const entry of entries) {
    // The tick records a rejected operation as `{ ..., result }` with no
    // `stoppedAt`; every other entry is the operation's own result data.
    const rejected = entry?.stoppedAt === undefined && entry?.result?.ok === false;
    const { outcome } = classifyKaiP1DispatchResult(rejected ? entry.result : { ok: true, data: entry });
    counts.set(outcome, (counts.get(outcome) || 0) + 1);
  }
  const parts = SUMMARY_OUTCOMES.filter((outcome) => counts.get(outcome)).map((outcome) => `${outcome}=${counts.get(outcome)}`);
  return [`${LOG_PREFIX} candidates=${entries.length}`, ...parts].join(" ");
}

/**
 * Registers the P1 worker tick on the repository's existing in-process
 * node-cron scheduling model. Introduces no new Render worker, Procfile,
 * queue, child process, or HTTP route.
 *
 * Registers nothing when either `KAI_SPRINT2_ENABLED` or `KAI_WORKER_ENABLED`
 * is off - the schedule itself is only created once both are enabled. The
 * tick function additionally re-checks both flags on every fire, so a flag
 * flip between registration and a later tick still fails closed.
 *
 * At most one tick runs at a time in this process: a fire that arrives while
 * the previous tick is still running is skipped, never queued. Across
 * processes, PostgreSQL parser-run and downstream-attempt claims remain the
 * authority. A failed tick is logged and never stops later fires.
 */
export function registerKaiP1WorkerCron({
  env = process.env,
  cronLib = cron,
  schedule = DEFAULT_SCHEDULE,
  timezone = DEFAULT_TIMEZONE,
  runTick = runKaiP1WorkerTick,
  createRuntimeDependencies = createKaiIntakeRuntimeDependencies,
  log = (line) => console.log(line),
} = {}) {
  if (!areKaiSprint2WorkerFeaturesEnabled(env)) {
    return { scheduled: false, task: null };
  }

  const runtimeDependencies = createRuntimeDependencies(env);
  let tickInFlight = false;

  const task = cronLib.schedule(
    schedule,
    async () => {
      if (tickInFlight) {
        log(`${LOG_PREFIX} tick skipped: previous tick still running`);
        return;
      }
      tickInFlight = true;
      try {
        const result = await runTick({
          ...runtimeDependencies,
          env,
        });

        if (result?.ok !== true) {
          log(`${LOG_PREFIX} tick failed`);
        } else if (result.data?.activated?.length) {
          log(tickSummaryLine(result.data.activated));
        }
      } catch {
        log(`${LOG_PREFIX} tick failed`);
      } finally {
        tickInFlight = false;
      }
    },
    { timezone },
  );

  return { scheduled: true, task };
}

export const __testables = Object.freeze({
  DEFAULT_SCHEDULE,
  DEFAULT_TIMEZONE,
  tickSummaryLine,
});
