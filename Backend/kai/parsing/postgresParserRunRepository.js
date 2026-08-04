import { withTransaction } from "../db/kaiDb.js";

/**
 * KAI P1-03 persistent parser-run / file-profile repository adapter.
 *
 * This module is the only authorized location for P1-03 SQL and row locking. It
 * uses the existing frozen P1-02 substrate (`kai.intake_parser_runs`,
 * `kai.intake_file_profiles`) and the existing Gate A metadata-only audit table
 * (`kai.upload_lifecycle_audit`) with the already-installed `parser_run_recorded`
 * and `file_profile_persisted` operations and their exact required metadata keys.
 * It adds no schema, no route, no listener, no scheduler, and no production
 * composition. Raw bytes, raw rows, and raw document text never reach this module.
 */

const PARSER_RUN_RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  state_transition_denied: 422,
  conflict_current_state_changed: 409,
  not_found: 404,
  system_error: 500,
});

const PARSER_STATUSES = Object.freeze(["queued", "running", "completed", "failed", "cancelled"]);
const MAX_PARSER_RETRY_COUNT = 3;
const PARSER_RUN_AUDIT_CONTRACT = "p1_parser_run_and_file_profile_v1";
const PARSER_RUN_AUDIT_VALIDATOR_KEY = "VAL-KAI-P1-02-001";
const PARSER_RUN_AUDIT_OPERATION = "parser_run_recorded";
const FILE_PROFILE_AUDIT_OPERATION = "file_profile_persisted";

const PARSER_NAME_PATTERN = /^[a-z0-9_]{1,128}$/;
const PARSER_VERSION_PATTERN = /^[a-z0-9._-]{1,64}$/;
const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;
const ERROR_CODE_PATTERN = /^[a-z0-9_]{1,64}$/;
const UNSAFE_ERROR_MESSAGE_PATTERN =
  /(https?:\/\/|\/Users\/|\/private\/|\/var\/|\/etc\/|password|secret|api[_-]?key|token|credential|Bearer\s|stack ?trace|traceback|\s{2}at [A-Za-z])/i;

function parserRunFailure(code) {
  return {
    ok: false,
    data: null,
    error: {
      code,
      status: PARSER_RUN_RESULT_STATUS[code],
    },
  };
}

function parserRunSuccess(data) {
  return { ok: true, data, error: null };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, allowedKeys) {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isNormalizedNow(value) {
  if (!isNonEmptyString(value)) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  return new Date(parsed).toISOString() === value;
}

function isParserRunIdentity(value) {
  const allowedKeys = new Set([
    "organizationId",
    "intakeFileId",
    "parserName",
    "parserVersion",
    "checksum",
  ]);
  if (!isPlainObject(value) || !hasOnlyKeys(value, allowedKeys)) return false;
  return (
    isNonEmptyString(value.organizationId) &&
    isNonEmptyString(value.intakeFileId) &&
    typeof value.parserName === "string" &&
    PARSER_NAME_PATTERN.test(value.parserName) &&
    typeof value.parserVersion === "string" &&
    PARSER_VERSION_PATTERN.test(value.parserVersion) &&
    typeof value.checksum === "string" &&
    CHECKSUM_PATTERN.test(value.checksum)
  );
}

function isMetadataOnlyAuditDependency(value) {
  return Boolean(value) && typeof value.prepareMetadataOnlyAudit === "function";
}

function isMetadataOnlyProfile(value) {
  if (!isPlainObject(value)) return false;
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

function validateIdentityInput(input) {
  const allowedKeys = new Set(["identity", "now"]);
  if (!isPlainObject(input) || !hasOnlyKeys(input, allowedKeys)) return false;
  return isParserRunIdentity(input.identity) && isNormalizedNow(input.now);
}

function validateAuditedIdentityInput(input) {
  const allowedKeys = new Set(["identity", "now", "metadataOnlyAudit"]);
  if (!isPlainObject(input) || !hasOnlyKeys(input, allowedKeys)) return false;
  return (
    isParserRunIdentity(input.identity) &&
    isNormalizedNow(input.now) &&
    isMetadataOnlyAuditDependency(input.metadataOnlyAudit)
  );
}

function validateCompletionInput(input) {
  const allowedKeys = new Set(["identity", "parserRunId", "profile", "now", "metadataOnlyAudit"]);
  if (!isPlainObject(input) || !hasOnlyKeys(input, allowedKeys)) return false;
  return (
    isParserRunIdentity(input.identity) &&
    isNonEmptyString(input.parserRunId) &&
    isMetadataOnlyProfile(input.profile) &&
    isNormalizedNow(input.now) &&
    isMetadataOnlyAuditDependency(input.metadataOnlyAudit)
  );
}

function validateFailureInput(input) {
  const allowedKeys = new Set([
    "identity",
    "parserRunId",
    "errorCode",
    "errorMessageSafe",
    "now",
    "metadataOnlyAudit",
  ]);
  if (!isPlainObject(input) || !hasOnlyKeys(input, allowedKeys)) return false;
  return (
    isParserRunIdentity(input.identity) &&
    isNonEmptyString(input.parserRunId) &&
    typeof input.errorCode === "string" &&
    ERROR_CODE_PATTERN.test(input.errorCode) &&
    typeof input.errorMessageSafe === "string" &&
    input.errorMessageSafe.length >= 1 &&
    input.errorMessageSafe.length <= 500 &&
    !UNSAFE_ERROR_MESSAGE_PATTERN.test(input.errorMessageSafe) &&
    isNormalizedNow(input.now) &&
    isMetadataOnlyAuditDependency(input.metadataOnlyAudit)
  );
}

function asIso(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function copyMetadataOnlyValue(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(copyMetadataOnlyValue);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, copyMetadataOnlyValue(entry)]));
}

/**
 * Metadata-only parser-run projection. Contains no bytes, no raw rows, no raw
 * document text, no storage identifiers, and no signed URLs. `requires_manual_review`
 * is derived from the stored retry count and is not a stored column or record.
 */
function rowToParserRunRecord(row) {
  if (!row) return null;
  const retryCount = Number(row.retry_count);
  return {
    parser_run_id: row.parser_run_id,
    organization_id: row.organization_id,
    intake_file_id: row.intake_file_id,
    parser_name: row.parser_name,
    parser_version: row.parser_version,
    checksum: row.checksum,
    parser_status: row.parser_status,
    retry_count: retryCount,
    error_code: row.error_code,
    error_message_safe: row.error_message_safe,
    output_profile_id: row.output_profile_id,
    started_at: asIso(row.started_at),
    completed_at: asIso(row.completed_at),
    created_at: asIso(row.created_at),
    requires_manual_review: retryCount >= MAX_PARSER_RETRY_COUNT,
    profile: row.profile === null || row.profile === undefined ? null : copyMetadataOnlyValue(row.profile),
    profile_canonical_sha256: row.profile_canonical_sha256 ?? null,
  };
}

const PARSER_RUN_SELECT_COLUMNS = `
  r.parser_run_id::text AS parser_run_id,
  r.organization_id::text AS organization_id,
  r.intake_file_id::text AS intake_file_id,
  r.parser_name,
  r.parser_version,
  r.checksum,
  r.parser_status,
  r.retry_count,
  r.error_code,
  r.error_message_safe,
  r.output_profile_id::text AS output_profile_id,
  r.started_at,
  r.completed_at,
  r.created_at,
  p.profile,
  p.profile_canonical_sha256
`;

const PARSER_RUN_FROM_CLAUSE = `
  FROM kai.intake_parser_runs r
  LEFT JOIN kai.intake_file_profiles p
    ON p.file_profile_id = r.output_profile_id
   AND p.organization_id = r.organization_id
   AND p.intake_file_id = r.intake_file_id
 WHERE r.organization_id = $1::uuid
   AND r.intake_file_id = $2::uuid
   AND r.parser_name = $3
   AND r.parser_version = $4
   AND r.checksum = $5
`;

function identityParameters(identity) {
  return [
    identity.organizationId,
    identity.intakeFileId,
    identity.parserName,
    identity.parserVersion,
    identity.checksum,
  ];
}

async function readScopedUploadState(tx, identity) {
  const result = await tx.query(
    `SELECT upload_state
       FROM kai.intake_files
      WHERE organization_id = $1::uuid
        AND intake_file_id = $2::uuid`,
    [identity.organizationId, identity.intakeFileId],
  );
  return result.rows[0]?.upload_state ?? null;
}

async function lockParserRun(tx, identity, { skipLocked = false, queuedOnly = false } = {}) {
  const result = await tx.query(
    `SELECT ${PARSER_RUN_SELECT_COLUMNS}
     ${PARSER_RUN_FROM_CLAUSE}
     ${queuedOnly ? "AND r.parser_status = 'queued'" : ""}
     FOR UPDATE OF r${skipLocked ? " SKIP LOCKED" : ""}`,
    identityParameters(identity),
  );
  return rowToParserRunRecord(result.rows[0]);
}

async function readParserRun(tx, identity) {
  const result = await tx.query(
    `SELECT ${PARSER_RUN_SELECT_COLUMNS}
     ${PARSER_RUN_FROM_CLAUSE}`,
    identityParameters(identity),
  );
  return rowToParserRunRecord(result.rows[0]);
}

function buildParserRunAuditMetadata(record) {
  return {
    metadata_only: true,
    contract: PARSER_RUN_AUDIT_CONTRACT,
    parser_name: record.parser_name,
    parser_version: record.parser_version,
    checksum_bound: true,
    parser_status: record.parser_status,
    retry_count: record.retry_count,
    error_code: record.error_code,
    error_message_safe: record.error_message_safe,
    validator_key: PARSER_RUN_AUDIT_VALIDATOR_KEY,
  };
}

function buildFileProfileAuditMetadata(record) {
  return {
    metadata_only: true,
    contract: PARSER_RUN_AUDIT_CONTRACT,
    parser_name: record.parser_name,
    parser_version: record.parser_version,
    checksum_bound: true,
    profile_canonical_sha256: record.profile_canonical_sha256,
    validator_key: PARSER_RUN_AUDIT_VALIDATOR_KEY,
  };
}

function buildParserRunAuditPayload(record, attemptedOperation) {
  return {
    attempted_operation: attemptedOperation,
    actor_type: "internal_service",
    contract: PARSER_RUN_AUDIT_CONTRACT,
    object_type: "intake_file",
    parser_status: record.parser_status,
    request_scope: "organization_intake_file",
    route_contract: "unwired_synthetic_parser_profile_worker",
    sprint_phase: "kai_sprint2_p1_03",
    validator_key: PARSER_RUN_AUDIT_VALIDATOR_KEY,
  };
}

async function insertAudit(tx, { identity, operation, uploadState, metadata, now }) {
  await tx.query(
    `INSERT INTO kai.upload_lifecycle_audit (
       organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
     )
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'success', $6::jsonb, $7::timestamptz)`,
    [
      identity.organizationId,
      identity.intakeFileId,
      operation,
      uploadState,
      uploadState,
      JSON.stringify(metadata),
      now,
    ],
  );
}

/**
 * Rejection of the required metadata-only audit must roll back every domain write
 * in the same transaction, so it is raised as an error rather than returned.
 */
class RequiredAuditRejectedError extends Error {
  constructor() {
    super("required metadata-only audit was rejected");
    this.name = "RequiredAuditRejectedError";
  }
}

function prepareRequiredAudit(metadataOnlyAudit, record, attemptedOperation) {
  const prepared = metadataOnlyAudit.prepareMetadataOnlyAudit({
    payload: buildParserRunAuditPayload(record, attemptedOperation),
  });
  if (!prepared || prepared.ok !== true || typeof prepared.publish !== "function") {
    throw new RequiredAuditRejectedError();
  }
  return prepared;
}

function shapeParserRunError(error) {
  if (error instanceof RequiredAuditRejectedError) return parserRunFailure("validation_blocker");
  if (error?.code === "23505") return parserRunFailure("conflict_current_state_changed");
  if (error?.code === "23503") return parserRunFailure("not_found");
  if (error?.code === "23514" || error?.code === "P0001" || error?.code === "22P02") {
    return parserRunFailure("validation_blocker");
  }
  return parserRunFailure("system_error");
}

export function createPostgresParserRunRepository({ runInTransaction = withTransaction } = {}) {
  return Object.freeze({
    /**
     * Organization-scoped idempotent queue/ensure keyed by the accepted P1-02
     * identity. A new identity creates exactly one queued run. Any already-stored
     * run for the same identity replays without creating a second row; a stored
     * completed run replays its persisted metadata-only profile and canonical hash
     * without any re-profiling.
     */
    async ensureQueuedParserRun(input) {
      if (!validateIdentityInput(input)) return parserRunFailure("validation_blocker");
      const { identity, now } = input;
      try {
        return await runInTransaction(async (tx) => {
          const uploadState = await readScopedUploadState(tx, identity);
          if (!uploadState) return parserRunFailure("not_found");

          const existing = await lockParserRun(tx, identity);
          if (existing) return parserRunSuccess({ run: existing, replayed: true });

          const inserted = await tx.query(
            `INSERT INTO kai.intake_parser_runs (
               organization_id, intake_file_id, parser_name, parser_version, checksum,
               parser_status, retry_count, started_at, created_at
             )
             VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'queued', 0, $6::timestamptz, $6::timestamptz)
             ON CONFLICT ON CONSTRAINT intake_parser_runs_p1_identity_unique DO NOTHING`,
            [...identityParameters(identity), now],
          );
          if (inserted.rowCount !== 1) {
            const authoritative = await lockParserRun(tx, identity);
            if (!authoritative) return parserRunFailure("conflict_current_state_changed");
            return parserRunSuccess({ run: authoritative, replayed: true });
          }

          const queued = await readParserRun(tx, identity);
          await insertAudit(tx, {
            identity,
            operation: PARSER_RUN_AUDIT_OPERATION,
            uploadState,
            metadata: buildParserRunAuditMetadata(queued),
            now,
          });
          return parserRunSuccess({ run: queued, replayed: false });
        });
      } catch (error) {
        return shapeParserRunError(error);
      }
    },

    async getParserRun(input) {
      const allowedKeys = new Set(["identity"]);
      if (!isPlainObject(input) || !hasOnlyKeys(input, allowedKeys) || !isParserRunIdentity(input.identity)) {
        return parserRunFailure("validation_blocker");
      }
      try {
        return await runInTransaction(async (tx) => {
          const run = await readParserRun(tx, input.identity);
          if (!run) return parserRunFailure("not_found");
          return parserRunSuccess({ run });
        });
      } catch (error) {
        return shapeParserRunError(error);
      }
    },

    /**
     * Organization-scoped queued-run claim. `FOR UPDATE ... SKIP LOCKED` prevents a
     * second concurrent worker from claiming the same queued run, and leaves
     * independent runs claimable in parallel. Cancelled, running, completed, and
     * failed runs are never claimed.
     */
    async claimQueuedParserRun(input) {
      if (!validateAuditedIdentityInput(input)) return parserRunFailure("validation_blocker");
      const { identity, now, metadataOnlyAudit } = input;
      try {
        return await runInTransaction(async (tx) => {
          const uploadState = await readScopedUploadState(tx, identity);
          if (!uploadState) return parserRunFailure("not_found");

          const claimable = await lockParserRun(tx, identity, { skipLocked: true, queuedOnly: true });
          if (!claimable) return parserRunFailure("conflict_current_state_changed");

          const updated = await tx.query(
            `UPDATE kai.intake_parser_runs
                SET parser_status = 'running',
                    started_at = $7::timestamptz,
                    completed_at = NULL,
                    output_profile_id = NULL,
                    error_code = NULL,
                    error_message_safe = NULL
              WHERE parser_run_id = $6::uuid
                AND organization_id = $1::uuid
                AND intake_file_id = $2::uuid
                AND parser_name = $3
                AND parser_version = $4
                AND checksum = $5
                AND parser_status = 'queued'`,
            [...identityParameters(identity), claimable.parser_run_id, now],
          );
          if (updated.rowCount !== 1) return parserRunFailure("conflict_current_state_changed");

          const running = await readParserRun(tx, identity);
          const preparedAudit = prepareRequiredAudit(metadataOnlyAudit, running, "parser_run_claimed");
          await insertAudit(tx, {
            identity,
            operation: PARSER_RUN_AUDIT_OPERATION,
            uploadState,
            metadata: buildParserRunAuditMetadata(running),
            now,
          });
          preparedAudit.publish();
          return parserRunSuccess({ run: running, claimed: true });
        });
      } catch (error) {
        return shapeParserRunError(error);
      }
    },

    /**
     * Single atomic successful completion: persist the metadata-only/redacted
     * profile with its canonical hash, transition the run to completed, link
     * output_profile_id to that exact profile, write the required metadata-only
     * audit, then commit. Any audit failure rolls back every domain write here.
     */
    async completeParserRunWithProfile(input) {
      if (!validateCompletionInput(input)) return parserRunFailure("validation_blocker");
      const { identity, parserRunId, profile, now, metadataOnlyAudit } = input;
      try {
        return await runInTransaction(async (tx) => {
          const uploadState = await readScopedUploadState(tx, identity);
          if (!uploadState) return parserRunFailure("not_found");

          const locked = await lockParserRun(tx, identity);
          if (!locked) return parserRunFailure("not_found");
          if (locked.parser_run_id !== parserRunId) return parserRunFailure("conflict_current_state_changed");
          if (locked.parser_status !== "running") return parserRunFailure("conflict_current_state_changed");

          const profileInsert = await tx.query(
            `INSERT INTO kai.intake_file_profiles (
               organization_id, intake_file_id, parser_run_id, parser_name, parser_version, checksum,
               profile, profile_canonical_sha256, created_at
             )
             VALUES (
               $1::uuid, $2::uuid, $6::uuid, $3, $4, $5,
               $7::jsonb, encode(digest($7::jsonb::text, 'sha256'), 'hex'), $8::timestamptz
             )
             RETURNING file_profile_id::text AS file_profile_id, profile_canonical_sha256`,
            [...identityParameters(identity), parserRunId, JSON.stringify(profile), now],
          );
          if (profileInsert.rowCount !== 1) return parserRunFailure("conflict_current_state_changed");

          const runUpdate = await tx.query(
            `UPDATE kai.intake_parser_runs
                SET parser_status = 'completed',
                    completed_at = $8::timestamptz,
                    output_profile_id = $7::uuid,
                    error_code = NULL,
                    error_message_safe = NULL
              WHERE parser_run_id = $6::uuid
                AND organization_id = $1::uuid
                AND intake_file_id = $2::uuid
                AND parser_name = $3
                AND parser_version = $4
                AND checksum = $5
                AND parser_status = 'running'`,
            [
              ...identityParameters(identity),
              parserRunId,
              profileInsert.rows[0].file_profile_id,
              now,
            ],
          );
          if (runUpdate.rowCount !== 1) return parserRunFailure("conflict_current_state_changed");

          const completed = await readParserRun(tx, identity);
          const preparedAudit = prepareRequiredAudit(metadataOnlyAudit, completed, "parser_run_completed");
          await insertAudit(tx, {
            identity,
            operation: FILE_PROFILE_AUDIT_OPERATION,
            uploadState,
            metadata: buildFileProfileAuditMetadata(completed),
            now,
          });
          await insertAudit(tx, {
            identity,
            operation: PARSER_RUN_AUDIT_OPERATION,
            uploadState,
            metadata: buildParserRunAuditMetadata(completed),
            now,
          });
          preparedAudit.publish();
          return parserRunSuccess({ run: completed, replayed: false });
        });
      } catch (error) {
        return shapeParserRunError(error);
      }
    },

    /**
     * Single atomic safe failure: transition the run to failed, increment
     * retry_count exactly once, store only a safe error code and safe error
     * message, write the required metadata-only audit, then commit. No partial
     * profile is created. Any audit failure rolls back every domain write here.
     */
    async failParserRunSafely(input) {
      if (!validateFailureInput(input)) return parserRunFailure("validation_blocker");
      const { identity, parserRunId, errorCode, errorMessageSafe, now, metadataOnlyAudit } = input;
      try {
        return await runInTransaction(async (tx) => {
          const uploadState = await readScopedUploadState(tx, identity);
          if (!uploadState) return parserRunFailure("not_found");

          const locked = await lockParserRun(tx, identity);
          if (!locked) return parserRunFailure("not_found");
          if (locked.parser_run_id !== parserRunId) return parserRunFailure("conflict_current_state_changed");
          if (locked.parser_status !== "running") return parserRunFailure("conflict_current_state_changed");

          const updated = await tx.query(
            `UPDATE kai.intake_parser_runs
                SET parser_status = 'failed',
                    completed_at = $9::timestamptz,
                    retry_count = retry_count + 1,
                    error_code = $7,
                    error_message_safe = $8,
                    output_profile_id = NULL
              WHERE parser_run_id = $6::uuid
                AND organization_id = $1::uuid
                AND intake_file_id = $2::uuid
                AND parser_name = $3
                AND parser_version = $4
                AND checksum = $5
                AND parser_status = 'running'`,
            [...identityParameters(identity), parserRunId, errorCode, errorMessageSafe, now],
          );
          if (updated.rowCount !== 1) return parserRunFailure("conflict_current_state_changed");

          const failed = await readParserRun(tx, identity);
          const preparedAudit = prepareRequiredAudit(metadataOnlyAudit, failed, "parser_run_failed_safely");
          await insertAudit(tx, {
            identity,
            operation: PARSER_RUN_AUDIT_OPERATION,
            uploadState,
            metadata: buildParserRunAuditMetadata(failed),
            now,
          });
          preparedAudit.publish();
          return parserRunSuccess({ run: failed, replayed: false });
        });
      } catch (error) {
        return shapeParserRunError(error);
      }
    },

    /**
     * Explicit internal re-queue of one failed run. There is no scheduler,
     * listener, timer, or automatic retry loop. A run whose stored retry_count has
     * already reached the contract cap is not re-queued and is reported with the
     * derived `requires_manual_review` value only. retry_count is never reset or
     * decremented, and a cancelled run is never re-queued.
     */
    async requeueFailedParserRunForRetry(input) {
      if (!validateAuditedIdentityInput(input)) return parserRunFailure("validation_blocker");
      const { identity, now, metadataOnlyAudit } = input;
      try {
        return await runInTransaction(async (tx) => {
          const uploadState = await readScopedUploadState(tx, identity);
          if (!uploadState) return parserRunFailure("not_found");

          const locked = await lockParserRun(tx, identity);
          if (!locked) return parserRunFailure("not_found");
          if (locked.parser_status === "cancelled") return parserRunFailure("state_transition_denied");
          if (locked.parser_status !== "failed") return parserRunFailure("conflict_current_state_changed");
          if (locked.retry_count >= MAX_PARSER_RETRY_COUNT) {
            return parserRunSuccess({ run: locked, requeued: false, requires_manual_review: true });
          }

          const updated = await tx.query(
            `UPDATE kai.intake_parser_runs
                SET parser_status = 'queued',
                    started_at = $7::timestamptz,
                    completed_at = NULL,
                    output_profile_id = NULL,
                    error_code = NULL,
                    error_message_safe = NULL
              WHERE parser_run_id = $6::uuid
                AND organization_id = $1::uuid
                AND intake_file_id = $2::uuid
                AND parser_name = $3
                AND parser_version = $4
                AND checksum = $5
                AND parser_status = 'failed'
                AND retry_count < ${MAX_PARSER_RETRY_COUNT}`,
            [...identityParameters(identity), locked.parser_run_id, now],
          );
          if (updated.rowCount !== 1) return parserRunFailure("conflict_current_state_changed");

          const requeued = await readParserRun(tx, identity);
          const preparedAudit = prepareRequiredAudit(metadataOnlyAudit, requeued, "parser_run_requeued_for_retry");
          await insertAudit(tx, {
            identity,
            operation: PARSER_RUN_AUDIT_OPERATION,
            uploadState,
            metadata: buildParserRunAuditMetadata(requeued),
            now,
          });
          preparedAudit.publish();
          return parserRunSuccess({ run: requeued, requeued: true, requires_manual_review: false });
        });
      } catch (error) {
        return shapeParserRunError(error);
      }
    },
  });
}

export const __parserRunRepositoryContract = Object.freeze({
  PARSER_STATUSES,
  MAX_PARSER_RETRY_COUNT,
  PARSER_RUN_AUDIT_CONTRACT,
  PARSER_RUN_AUDIT_VALIDATOR_KEY,
  PARSER_RUN_AUDIT_OPERATION,
  FILE_PROFILE_AUDIT_OPERATION,
});
