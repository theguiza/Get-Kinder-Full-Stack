import { withTransaction } from "../db/kaiDb.js";
import { lockKaiP1EligibleIntakeFileForShare } from "../db/kaiIntakeQueries.js";

/**
 * KAI P1 downstream (P1-04 / P1-05) recovery-state repository.
 *
 * The only location for SQL against `kai.intake_p1_downstream_attempts`.
 * PostgreSQL owns every decision: a row lock serializes claims for one
 * (organization, file profile, stage), an attempt is durably reserved and
 * counted before the stage runs, and a random claim token fences the
 * acknowledgment so a worker whose claim expired and was taken over can
 * never overwrite the newer state. Persisted P1-04/P1-05 outputs are
 * reconciled before any budget decision, so a stage that committed before
 * its worker died is recorded as succeeded instead of being attempted again.
 * Every state change commits together with its required metadata-only audit
 * or not at all. No transaction is held while a stage runs.
 */

export const P1_DOWNSTREAM_STAGES = Object.freeze({
  dataDictionary: "p1_04_data_dictionary",
  sensitivityProfile: "p1_05_sensitivity_profile",
});
export const MAX_P1_DOWNSTREAM_ATTEMPTS = 3;
// Cooldown after a retryable failure of attempt N, before attempt N + 1.
export const P1_DOWNSTREAM_RETRY_COOLDOWN_SECONDS = Object.freeze({ 1: 60, 2: 300 });
export const P1_DOWNSTREAM_CLAIM_LEASE_SECONDS = 120;
export const P1_DOWNSTREAM_LEASE_EXPIRED_ERROR_CODE = "attempt_lease_expired";

const RECOVERY_AUDIT_CONTRACT = "p1_downstream_recovery_v1";
const RECOVERY_AUDIT_VALIDATOR_KEY = "VAL-KAI-P1-RECOVERY-001";
const STAGE_VALUES = new Set(Object.values(P1_DOWNSTREAM_STAGES));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SAFE_ERROR_CODE_RE = /^[a-z0-9_]{1,64}$/;
const OUTCOMES = new Set(["succeeded", "retryable_failure", "non_retryable_failure"]);

const RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  not_found: 404,
  system_error: 500,
});

function failure(code) {
  return { ok: false, data: null, error: { code, status: RESULT_STATUS[code] } };
}

function success(data) {
  return { ok: true, data, error: null };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, allowedKeys) {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isNormalizedNow(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isStageIdentity(value) {
  if (!isPlainObject(value) || !hasOnlyKeys(value, new Set(["organizationId", "intakeFileId", "fileProfileId", "stage"]))) {
    return false;
  }
  return (
    UUID_RE.test(value.organizationId)
    && UUID_RE.test(value.intakeFileId)
    && UUID_RE.test(value.fileProfileId)
    && STAGE_VALUES.has(value.stage)
  );
}

function isMetadataOnlyAuditDependency(value) {
  return Boolean(value) && typeof value.prepareMetadataOnlyAudit === "function";
}

function asIso(value) {
  if (value === null || value === undefined) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function addSeconds(iso, seconds) {
  return new Date(Date.parse(iso) + seconds * 1000).toISOString();
}

class RequiredAuditRejectedError extends Error {
  constructor() {
    super("required metadata-only audit was rejected");
    this.name = "RequiredAuditRejectedError";
  }
}

function shapeError(error) {
  if (error instanceof RequiredAuditRejectedError) return failure("validation_blocker");
  if (error?.code === "23503") return failure("not_found");
  if (error?.code === "23514" || error?.code === "22P02") return failure("validation_blocker");
  return failure("system_error");
}

const ATTEMPT_COLUMNS = `
  organization_id::text AS organization_id,
  intake_file_id::text AS intake_file_id,
  file_profile_id::text AS file_profile_id,
  stage,
  recovery_state,
  attempt_count,
  claim_token::text AS claim_token,
  claim_expires_at,
  last_attempt_at,
  next_eligible_at,
  last_error_code`;

function rowToAttempt(row) {
  if (!row) return null;
  return {
    organization_id: row.organization_id,
    intake_file_id: row.intake_file_id,
    file_profile_id: row.file_profile_id,
    stage: row.stage,
    recovery_state: row.recovery_state,
    attempt_count: Number(row.attempt_count),
    claim_token: row.claim_token,
    claim_expires_at: asIso(row.claim_expires_at),
    last_attempt_at: asIso(row.last_attempt_at),
    next_eligible_at: asIso(row.next_eligible_at),
    last_error_code: row.last_error_code,
  };
}

async function readScopedProfile(tx, identity) {
  const result = await tx.query(
    `SELECT file_profile_id::text AS file_profile_id,
            organization_id::text AS organization_id,
            intake_file_id::text AS intake_file_id,
            parser_name,
            parser_version,
            checksum
       FROM kai.intake_file_profiles
      WHERE organization_id = $1::uuid
        AND file_profile_id = $2::uuid`,
    [identity.organizationId, identity.fileProfileId],
  );
  const row = result.rows[0];
  return row && row.intake_file_id === identity.intakeFileId ? row : null;
}

async function lockAttempt(tx, identity) {
  const result = await tx.query(
    `SELECT ${ATTEMPT_COLUMNS}
       FROM kai.intake_p1_downstream_attempts
      WHERE organization_id = $1::uuid
        AND file_profile_id = $2::uuid
        AND stage = $3
      FOR UPDATE`,
    [identity.organizationId, identity.fileProfileId, identity.stage],
  );
  return rowToAttempt(result.rows[0]);
}

/** The authoritative stage output, if it has already been committed. */
async function readCommittedOutputId(tx, identity) {
  const sql = identity.stage === P1_DOWNSTREAM_STAGES.dataDictionary
    ? `SELECT data_dictionary_id::text AS output_id
         FROM kai.data_dictionaries
        WHERE organization_id = $1::uuid AND file_profile_id = $2::uuid`
    : `SELECT intake_sensitivity_profile_id::text AS output_id
         FROM kai.intake_sensitivity_profiles
        WHERE organization_id = $1::uuid AND file_profile_id = $2::uuid
        ORDER BY created_at ASC, intake_sensitivity_profile_id ASC
        LIMIT 1`;
  const result = await tx.query(sql, [identity.organizationId, identity.fileProfileId]);
  return result.rows[0]?.output_id ?? null;
}

function publishRequiredAudit(metadataOnlyAudit, tx, identity, event, attempt) {
  const prepared = metadataOnlyAudit.prepareMetadataOnlyAudit({
    payload: {
      attempted_operation: `${identity.stage}_${event}`,
      actor_type: "internal_service",
      contract: RECOVERY_AUDIT_CONTRACT,
      object_type: "intake_file",
      request_scope: "organization_intake_file",
      recovery_state: attempt.recovery_state,
      attempt_count: attempt.attempt_count,
      error_code: attempt.last_error_code,
      validator_key: RECOVERY_AUDIT_VALIDATOR_KEY,
    },
    db: tx,
  });
  const okDescriptor = isPlainObject(prepared) ? Object.getOwnPropertyDescriptor(prepared, "ok") : undefined;
  if (!(okDescriptor && Object.hasOwn(okDescriptor, "value") && okDescriptor.value === true && typeof prepared.publish === "function")) {
    throw new RequiredAuditRejectedError();
  }
  return prepared.publish();
}

const STATE_UPDATE_SQL = `
  UPDATE kai.intake_p1_downstream_attempts
     SET recovery_state = $4,
         attempt_count = $5,
         claim_token = $6::uuid,
         claim_expires_at = $7::timestamptz,
         last_attempt_at = $8::timestamptz,
         next_eligible_at = $9::timestamptz,
         last_error_code = $10,
         updated_at = $11::timestamptz
   WHERE organization_id = $1::uuid
     AND file_profile_id = $2::uuid
     AND stage = $3
     AND claim_token IS NOT DISTINCT FROM $12::uuid
     AND recovery_state = $13
  RETURNING ${ATTEMPT_COLUMNS}`;

/**
 * Applies one guarded state transition on the locked row: it only matches
 * while the row still carries the state and claim token this decision was
 * made from.
 */
async function transition(tx, identity, from, next, now) {
  const result = await tx.query(STATE_UPDATE_SQL, [
    identity.organizationId,
    identity.fileProfileId,
    identity.stage,
    next.recovery_state,
    next.attempt_count,
    next.claim_token ?? null,
    next.claim_expires_at ?? null,
    next.last_attempt_at ?? null,
    next.next_eligible_at ?? null,
    next.last_error_code ?? null,
    now,
    from.claim_token,
    from.recovery_state,
  ]);
  if (result.rowCount !== 1) throw new Error("p1 downstream recovery state changed under its row lock");
  return rowToAttempt(result.rows[0]);
}

async function insertAttempt(tx, identity, profile, next, now) {
  const result = await tx.query(
    `INSERT INTO kai.intake_p1_downstream_attempts (
       organization_id, intake_file_id, file_profile_id, parser_name, parser_version, checksum, stage,
       recovery_state, attempt_count, claim_token, claim_expires_at, last_attempt_at, next_eligible_at,
       last_error_code, created_at, updated_at
     )
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10::uuid, $11::timestamptz,
             $12::timestamptz, NULL, NULL, $13::timestamptz, $13::timestamptz)
     ON CONFLICT ON CONSTRAINT intake_p1_downstream_attempts_pkey DO NOTHING
     RETURNING ${ATTEMPT_COLUMNS}`,
    [
      identity.organizationId,
      identity.intakeFileId,
      identity.fileProfileId,
      profile.parser_name,
      profile.parser_version,
      profile.checksum,
      identity.stage,
      next.recovery_state,
      next.attempt_count,
      next.claim_token ?? null,
      next.claim_expires_at ?? null,
      next.last_attempt_at ?? null,
      now,
    ],
  );
  return rowToAttempt(result.rows[0]);
}

async function newClaimToken(tx) {
  const result = await tx.query("SELECT gen_random_uuid()::text AS token");
  return result.rows[0].token;
}

function claimedResult(attempt) {
  return {
    decision: "claimed",
    claimToken: attempt.claim_token,
    attemptNumber: attempt.attempt_count,
    claimExpiresAt: attempt.claim_expires_at,
  };
}

function blockedResult(attempt) {
  return {
    decision: attempt.recovery_state,
    attemptNumber: attempt.attempt_count,
    errorCode: attempt.last_error_code,
    nextEligibleAt: attempt.next_eligible_at,
  };
}

export function createPostgresP1DownstreamRecoveryRepository({ runInTransaction = withTransaction } = {}) {
  return Object.freeze({
    /**
     * Decide, under the attempt row's lock, whether this caller may run the
     * stage now. Decisions: `claimed` (attempt reserved and counted, claim
     * token issued), `already_succeeded` (output committed; its id returned),
     * `busy` (another live claim), `deferred` (cooldown not over),
     * `exhausted`, `operator_attention`, or `not_eligible` (the file is no
     * longer a confirmed, passed upload for this profile's checksum).
     */
    async claimDownstreamAttempt(input) {
      if (
        !isPlainObject(input)
        || !hasOnlyKeys(input, new Set(["identity", "now", "metadataOnlyAudit"]))
        || !isStageIdentity(input.identity)
        || !isNormalizedNow(input.now)
        || !isMetadataOnlyAuditDependency(input.metadataOnlyAudit)
      ) {
        return failure("validation_blocker");
      }
      const { identity, now, metadataOnlyAudit } = input;
      try {
        return await runInTransaction(async (tx) => {
          const profile = await readScopedProfile(tx, identity);
          if (!profile) return failure("not_found");

          const eligible = await lockKaiP1EligibleIntakeFileForShare(
            { organizationId: identity.organizationId, intakeFileId: identity.intakeFileId, verifiedChecksum: profile.checksum },
            tx,
          );
          if (!eligible) return success({ decision: "not_eligible" });

          // At most two passes: a concurrent first insert for the same key
          // makes ours a no-op, and the second pass then decides on that
          // committed row under its lock.
          for (let pass = 0; pass < 2; pass += 1) {
            const attempt = await lockAttempt(tx, identity);
            const outputId = await readCommittedOutputId(tx, identity);

            if (outputId) {
              if (attempt?.recovery_state === "succeeded") return success({ decision: "already_succeeded", outputId });
              const reconciled = { recovery_state: "succeeded", attempt_count: attempt?.attempt_count ?? 0, last_attempt_at: attempt?.last_attempt_at ?? null };
              const written = attempt
                ? await transition(tx, identity, attempt, reconciled, now)
                : await insertAttempt(tx, identity, profile, reconciled, now);
              if (!written) continue;
              await publishRequiredAudit(metadataOnlyAudit, tx, identity, "output_reconciled", written);
              return success({ decision: "already_succeeded", outputId });
            }

            if (!attempt) {
              const claim = {
                recovery_state: "in_progress",
                attempt_count: 1,
                claim_token: await newClaimToken(tx),
                claim_expires_at: addSeconds(now, P1_DOWNSTREAM_CLAIM_LEASE_SECONDS),
                last_attempt_at: now,
              };
              const written = await insertAttempt(tx, identity, profile, claim, now);
              if (!written) continue;
              await publishRequiredAudit(metadataOnlyAudit, tx, identity, "attempt_claimed", written);
              return success(claimedResult(written));
            }

            if (attempt.recovery_state === "succeeded") {
              // Recorded success without a committed output cannot be
              // repaired automatically.
              return success({ decision: "operator_attention", errorCode: "recovery_state_inconsistent" });
            }
            if (attempt.recovery_state === "exhausted" || attempt.recovery_state === "operator_attention") {
              return success(blockedResult(attempt));
            }

            let current = attempt;
            if (current.recovery_state === "in_progress") {
              if (Date.parse(current.claim_expires_at) > Date.parse(now)) {
                return success({ decision: "busy", attemptNumber: current.attempt_count });
              }
              // The claiming worker never acknowledged within its lease: that
              // reserved attempt counts as a retryable failure.
              if (current.attempt_count >= MAX_P1_DOWNSTREAM_ATTEMPTS) {
                const exhausted = await transition(tx, identity, current, {
                  recovery_state: "exhausted",
                  attempt_count: current.attempt_count,
                  last_attempt_at: current.last_attempt_at,
                  last_error_code: P1_DOWNSTREAM_LEASE_EXPIRED_ERROR_CODE,
                }, now);
                await publishRequiredAudit(metadataOnlyAudit, tx, identity, "attempts_exhausted", exhausted);
                return success(blockedResult(exhausted));
              }
              const eligibleAt = addSeconds(current.last_attempt_at, P1_DOWNSTREAM_RETRY_COOLDOWN_SECONDS[current.attempt_count]);
              if (Date.parse(now) < Date.parse(eligibleAt)) {
                const scheduled = await transition(tx, identity, current, {
                  recovery_state: "retry_scheduled",
                  attempt_count: current.attempt_count,
                  last_attempt_at: current.last_attempt_at,
                  next_eligible_at: eligibleAt,
                  last_error_code: P1_DOWNSTREAM_LEASE_EXPIRED_ERROR_CODE,
                }, now);
                await publishRequiredAudit(metadataOnlyAudit, tx, identity, "retry_scheduled", scheduled);
                return success({ ...blockedResult(scheduled), decision: "deferred" });
              }
              current = { ...current, last_error_code: P1_DOWNSTREAM_LEASE_EXPIRED_ERROR_CODE };
            } else if (current.recovery_state === "retry_scheduled" && Date.parse(now) < Date.parse(current.next_eligible_at)) {
              return success({ ...blockedResult(current), decision: "deferred" });
            }

            const reclaimed = await transition(tx, identity, attempt, {
              recovery_state: "in_progress",
              attempt_count: current.attempt_count + 1,
              claim_token: await newClaimToken(tx),
              claim_expires_at: addSeconds(now, P1_DOWNSTREAM_CLAIM_LEASE_SECONDS),
              last_attempt_at: now,
              last_error_code: current.last_error_code,
            }, now);
            await publishRequiredAudit(metadataOnlyAudit, tx, identity, "attempt_claimed", reclaimed);
            return success(claimedResult(reclaimed));
          }
          return failure("system_error");
        });
      } catch (error) {
        return shapeError(error);
      }
    },

    /**
     * Records the outcome of one claimed attempt, fenced by its claim token:
     * a caller whose claim was reconciled, taken over, or otherwise replaced
     * gets `acknowledged: false` and changes nothing. A retryable failure
     * schedules the next attempt after its cooldown, or exhausts the budget
     * at the third attempt; a non-retryable failure needs an operator.
     */
    async completeDownstreamAttempt(input) {
      if (
        !isPlainObject(input)
        || !hasOnlyKeys(input, new Set(["identity", "claimToken", "outcome", "errorCode", "now", "metadataOnlyAudit"]))
        || !isStageIdentity(input.identity)
        || !UUID_RE.test(input.claimToken || "")
        || !OUTCOMES.has(input.outcome)
        || (input.outcome === "succeeded" ? input.errorCode !== undefined && input.errorCode !== null : !SAFE_ERROR_CODE_RE.test(input.errorCode || ""))
        || !isNormalizedNow(input.now)
        || !isMetadataOnlyAuditDependency(input.metadataOnlyAudit)
      ) {
        return failure("validation_blocker");
      }
      const { identity, claimToken, outcome, errorCode, now, metadataOnlyAudit } = input;
      try {
        return await runInTransaction(async (tx) => {
          const attempt = await lockAttempt(tx, identity);
          if (!attempt || attempt.recovery_state !== "in_progress" || attempt.claim_token !== claimToken) {
            return success({ acknowledged: false, reason: "stale_claim", recoveryState: attempt?.recovery_state ?? null });
          }

          let next;
          let event;
          if (outcome === "succeeded") {
            next = { recovery_state: "succeeded", attempt_count: attempt.attempt_count, last_attempt_at: attempt.last_attempt_at };
            event = "attempt_succeeded";
          } else if (outcome === "retryable_failure" && attempt.attempt_count < MAX_P1_DOWNSTREAM_ATTEMPTS) {
            next = {
              recovery_state: "retry_scheduled",
              attempt_count: attempt.attempt_count,
              last_attempt_at: attempt.last_attempt_at,
              next_eligible_at: addSeconds(now, P1_DOWNSTREAM_RETRY_COOLDOWN_SECONDS[attempt.attempt_count]),
              last_error_code: errorCode,
            };
            event = "retry_scheduled";
          } else if (outcome === "retryable_failure") {
            next = { recovery_state: "exhausted", attempt_count: attempt.attempt_count, last_attempt_at: attempt.last_attempt_at, last_error_code: errorCode };
            event = "attempts_exhausted";
          } else {
            next = { recovery_state: "operator_attention", attempt_count: attempt.attempt_count, last_attempt_at: attempt.last_attempt_at, last_error_code: errorCode };
            event = "operator_attention_required";
          }

          const written = await transition(tx, identity, attempt, next, now);
          await publishRequiredAudit(metadataOnlyAudit, tx, identity, event, written);
          return success({
            acknowledged: true,
            recoveryState: written.recovery_state,
            attemptNumber: written.attempt_count,
            nextEligibleAt: written.next_eligible_at,
            errorCode: written.last_error_code,
          });
        });
      } catch (error) {
        return shapeError(error);
      }
    },

    /**
     * Read-only recovery view for one tenant-scoped intake file: every
     * downstream stage row and every parser run, as identities, states,
     * counters, timestamps, and safe codes only.
     */
    async readP1RecoveryStatus(input) {
      if (
        !isPlainObject(input)
        || !hasOnlyKeys(input, new Set(["organizationId", "intakeFileId"]))
        || !UUID_RE.test(input.organizationId || "")
        || !UUID_RE.test(input.intakeFileId || "")
      ) {
        return failure("validation_blocker");
      }
      try {
        return await runInTransaction(async (tx) => {
          const attempts = await tx.query(
            `SELECT ${ATTEMPT_COLUMNS}
               FROM kai.intake_p1_downstream_attempts
              WHERE organization_id = $1::uuid AND intake_file_id = $2::uuid
              ORDER BY file_profile_id, stage`,
            [input.organizationId, input.intakeFileId],
          );
          const parserRuns = await tx.query(
            `SELECT parser_name, parser_version, parser_status, retry_count, error_code, started_at, completed_at
               FROM kai.intake_parser_runs
              WHERE organization_id = $1::uuid AND intake_file_id = $2::uuid
              ORDER BY created_at, parser_run_id`,
            [input.organizationId, input.intakeFileId],
          );
          return success({
            downstream: attempts.rows.map((row) => {
              const attempt = rowToAttempt(row);
              return {
                file_profile_id: attempt.file_profile_id,
                stage: attempt.stage,
                recovery_state: attempt.recovery_state,
                attempt_count: attempt.attempt_count,
                last_attempt_at: attempt.last_attempt_at,
                next_eligible_at: attempt.next_eligible_at,
                last_error_code: attempt.last_error_code,
              };
            }),
            parser_runs: parserRuns.rows.map((row) => ({
              parser_name: row.parser_name,
              parser_version: row.parser_version,
              parser_status: row.parser_status,
              retry_count: Number(row.retry_count),
              error_code: row.error_code,
              requires_manual_review: Number(row.retry_count) >= 3,
              started_at: asIso(row.started_at),
              completed_at: asIso(row.completed_at),
            })),
          });
        });
      } catch (error) {
        return shapeError(error);
      }
    },
  });
}

export const __p1DownstreamRecoveryTestables = Object.freeze({
  RequiredAuditRejectedError,
  RECOVERY_AUDIT_CONTRACT,
  RECOVERY_AUDIT_VALIDATOR_KEY,
});
