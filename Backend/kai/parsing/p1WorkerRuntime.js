import {
  areKaiSprint2WorkerFeaturesEnabled,
  getKaiP1WorkerSyntheticOrganizationId,
} from "../config/kaiSprint2Config.js";
import { activateParserProfileWorkForIntakeFile } from "./parserProfileActivation.js";
import { listKaiP1WorkerSyntheticScopedEligibleIntakeFiles } from "../db/kaiIntakeQueries.js";

/**
 * KAI P1 worker runtime tick.
 *
 * This is the small in-process runtime seam a cron/scheduling wrapper invokes.
 * It performs no persistence of its own: it discovers eligible intake files
 * inside exactly one configured synthetic organization scope and hands each
 * one to the existing, unchanged `activateParserProfileWorkForIntakeFile`
 * activation seam - reusing its existing activation, queue/idempotency,
 * locking, exact-version read, audit-transaction, and retry semantics as-is.
 *
 * Fails closed (zero work) unless both `KAI_SPRINT2_ENABLED` and
 * `KAI_WORKER_ENABLED` are enabled and a synthetic organization scope is
 * configured. Never sweeps every organization and never accepts a file-ID
 * selector: eligible files are discovered only inside the configured scope.
 * Never retries automatically - each eligible file is activated with
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

  const organizationId = getKaiP1WorkerSyntheticOrganizationId(env);
  if (!organizationId) {
    return { ok: true, data: { activated: [], reason: "synthetic_scope_not_configured" }, error: null };
  }

  const listEligibleFiles =
    dependencies.listKaiP1WorkerSyntheticScopedEligibleIntakeFiles
    || listKaiP1WorkerSyntheticScopedEligibleIntakeFiles;

  let eligibleFiles;
  try {
    eligibleFiles = await listEligibleFiles({ organizationId });
  } catch {
    return { ok: false, data: null, error: { code: "system_error" } };
  }

  const activateFn =
    dependencies.activateParserProfileWorkForIntakeFile || activateParserProfileWorkForIntakeFile;

  const activated = [];
  for (const file of Array.isArray(eligibleFiles) ? eligibleFiles : []) {
    // Defense in depth: never process a row outside the configured scope, even
    // if a supplied dependency ever returned one.
    if (file?.organization_id !== organizationId) continue;
    if (typeof file?.intake_file_id !== "string" || file.intake_file_id.length === 0) continue;

    const result = await activateFn(
      {
        organizationId,
        intakeFileId: file.intake_file_id,
        actorContext: KAI_P1_WORKER_SYNTHETIC_ACTOR_CONTEXT,
        retry: false,
      },
      dependencies,
    );
    activated.push({ intakeFileId: file.intake_file_id, result });
  }

  return { ok: true, data: { activated, organizationId }, error: null };
}

export const __testables = Object.freeze({
  KAI_P1_WORKER_SYNTHETIC_ACTOR_CONTEXT,
});
