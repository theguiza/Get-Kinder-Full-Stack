import cron from "node-cron";
import { areKaiSprint2WorkerFeaturesEnabled } from "../config/kaiSprint2Config.js";
import { runKaiP1WorkerTick } from "./p1WorkerRuntime.js";

const DEFAULT_SCHEDULE = "*/15 * * * *";
const DEFAULT_TIMEZONE = "America/Vancouver";

/**
 * Registers the P1 worker tick on the repository's existing in-process
 * node-cron scheduling model. Introduces no new Render worker, Procfile,
 * queue, child process, or HTTP route.
 *
 * Registers nothing when either `KAI_SPRINT2_ENABLED` or `KAI_WORKER_ENABLED`
 * is off - the schedule itself is only created once both are enabled. The
 * tick function additionally re-checks both flags and the synthetic scope on
 * every fire, so a flag flip between registration and a later tick still
 * fails closed.
 */
export function registerKaiP1WorkerCron({
  env = process.env,
  cronLib = cron,
  schedule = DEFAULT_SCHEDULE,
  timezone = DEFAULT_TIMEZONE,
  runTick = runKaiP1WorkerTick,
} = {}) {
  if (!areKaiSprint2WorkerFeaturesEnabled(env)) {
    return { scheduled: false, task: null };
  }

  const task = cronLib.schedule(
    schedule,
    async () => {
      try {
        const result = await runTick({ env });
        if (result?.data?.activated?.length) {
          console.log(`[kai-p1-worker] activated=${result.data.activated.length}`);
        }
      } catch (e) {
        console.error("[kai-p1-worker] cron tick failed:", e);
      }
    },
    { timezone },
  );

  return { scheduled: true, task };
}
