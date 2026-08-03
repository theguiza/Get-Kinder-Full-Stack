import { KAI_SPRINT2_P0_PATTERNS, KAI_SPRINT2_P0_UPLOAD_STATES, KAI_SPRINT2_P0_UPLOAD_TIMING } from "../config/kaiSprint2P0Contract.js";
import { withTransaction } from "../db/kaiDb.js";

const FILE_POLICY_STATUS = Object.freeze({
  pending: "pending",
  passed: "passed",
  blocked: "blocked",
  failed: "failed",
});

const UPLOAD_LIFECYCLE_RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  state_transition_denied: 422,
  conflict_current_state_changed: 409,
  not_found: 404,
  system_error: 500,
});

const AUTHORIZED_EDGES = Object.freeze(new Set([
  "reserved->upload_started",
  "reserved->policy_blocked",
  "reserved->abandoned",
  "reserved->expired",
  "upload_started->uploaded_unconfirmed",
  "upload_started->policy_blocked",
  "upload_started->abandoned",
  "upload_started->expired",
  "uploaded_unconfirmed->confirmed",
  "uploaded_unconfirmed->policy_blocked",
  "uploaded_unconfirmed->abandoned",
  "uploaded_unconfirmed->expired",
  "confirmed->policy_blocked",
]));

const PRE_CONFIRMATION_STATES = Object.freeze(new Set(["reserved", "upload_started", "uploaded_unconfirmed"]));
const REPLAY_CONTRACT_VERSION = "in_memory_policy_replay_v1";

function uploadLifecycleFailure(code) {
  return {
    ok: false,
    data: null,
    error: {
      code,
      status: UPLOAD_LIFECYCLE_RESULT_STATUS[code],
    },
  };
}

function uploadLifecycleSuccess(data) {
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

function addReservationExpiry(now) {
  return new Date(Date.parse(now) + KAI_SPRINT2_P0_UPLOAD_TIMING.reservationExpiryMs).toISOString();
}

function isKnownUploadState(value) {
  return KAI_SPRINT2_P0_UPLOAD_STATES.includes(value);
}

function validateCreateInput(input) {
  const allowedKeys = new Set(["organizationId", "intakeBatchId", "intakeFileId", "now"]);
  if (!isPlainObject(input) || !hasOnlyKeys(input, allowedKeys)) return false;
  return (
    isNonEmptyString(input.organizationId) &&
    isNonEmptyString(input.intakeBatchId) &&
    isNonEmptyString(input.intakeFileId) &&
    isNormalizedNow(input.now)
  );
}

function validateGetInput(input) {
  const allowedKeys = new Set(["organizationId", "intakeFileId"]);
  if (!isPlainObject(input) || !hasOnlyKeys(input, allowedKeys)) return false;
  return isNonEmptyString(input.organizationId) && isNonEmptyString(input.intakeFileId);
}

function validateTransitionInput(input) {
  const allowedKeys = new Set([
    "organizationId",
    "intakeFileId",
    "expectedUploadState",
    "newUploadState",
    "now",
    "objectVersionId",
    "verifiedChecksum",
    "verifiedSizeBytes",
  ]);
  if (!isPlainObject(input) || !hasOnlyKeys(input, allowedKeys)) return false;
  if (
    !isNonEmptyString(input.organizationId) ||
    !isNonEmptyString(input.intakeFileId) ||
    !isKnownUploadState(input.expectedUploadState) ||
    !isKnownUploadState(input.newUploadState) ||
    !isNormalizedNow(input.now)
  ) {
    return false;
  }
  if (input.newUploadState === "uploaded_unconfirmed") return isNonEmptyString(input.objectVersionId);
  if (input.newUploadState === "confirmed") {
    return (
      isNonEmptyString(input.objectVersionId) &&
      typeof input.verifiedChecksum === "string" &&
      KAI_SPRINT2_P0_PATTERNS.checksumSha256.test(input.verifiedChecksum) &&
      input.verifiedChecksum.toLowerCase() === input.verifiedChecksum &&
      Number.isSafeInteger(input.verifiedSizeBytes) &&
      input.verifiedSizeBytes >= 1
    );
  }
  return (
    input.objectVersionId === undefined &&
    input.verifiedChecksum === undefined &&
    input.verifiedSizeBytes === undefined
  );
}

const POLICY_DECISION_OUTCOMES = Object.freeze({
  passed: Object.freeze({ filePolicyStatus: FILE_POLICY_STATUS.passed, uploadState: "confirmed" }),
  blocked: Object.freeze({ filePolicyStatus: FILE_POLICY_STATUS.blocked, uploadState: "policy_blocked" }),
  failed: Object.freeze({ filePolicyStatus: FILE_POLICY_STATUS.failed, uploadState: "confirmed" }),
});

function isTrustedConfirmedFacts(value) {
  const allowedKeys = new Set([
    "organizationId",
    "intakeFileId",
    "objectVersionId",
    "verifiedChecksum",
    "verifiedSizeBytes",
    "declaredMime",
    "extension",
  ]);
  if (!isPlainObject(value) || !hasOnlyKeys(value, allowedKeys)) return false;
  return (
    isNonEmptyString(value.organizationId) &&
    isNonEmptyString(value.intakeFileId) &&
    isNonEmptyString(value.objectVersionId) &&
    typeof value.verifiedChecksum === "string" &&
    KAI_SPRINT2_P0_PATTERNS.checksumSha256.test(value.verifiedChecksum) &&
    value.verifiedChecksum.toLowerCase() === value.verifiedChecksum &&
    Number.isSafeInteger(value.verifiedSizeBytes) &&
    value.verifiedSizeBytes >= 1 &&
    isNonEmptyString(value.declaredMime) &&
    value.declaredMime.trim().toLowerCase() === value.declaredMime &&
    isNonEmptyString(value.extension) &&
    value.extension.startsWith(".") &&
    value.extension.toLowerCase() === value.extension
  );
}

function isSanitizedResult(value) {
  if (!isPlainObject(value)) return false;
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

function validatePolicyDecisionInput(input) {
  const allowedKeys = new Set([
    "confirmedFileFacts",
    "expectedFilePolicyStatus",
    "policyDecisionOutcome",
    "sanitizedResult",
    "metadataOnlyAudit",
    "now",
  ]);
  if (!isPlainObject(input) || !hasOnlyKeys(input, allowedKeys)) return false;
  return (
    isTrustedConfirmedFacts(input.confirmedFileFacts) &&
    input.expectedFilePolicyStatus === FILE_POLICY_STATUS.pending &&
    Object.hasOwn(POLICY_DECISION_OUTCOMES, input.policyDecisionOutcome) &&
    isSanitizedResult(input.sanitizedResult) &&
    isNormalizedNow(input.now) &&
    input.metadataOnlyAudit &&
    typeof input.metadataOnlyAudit.prepareMetadataOnlyAudit === "function"
  );
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function copySanitizedResult(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(copySanitizedResult);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, copySanitizedResult(entry)]));
}

function policyReplayFromInput(input) {
  const { confirmedFileFacts: facts } = input;
  return {
    organization_id: facts.organizationId,
    intake_file_id: facts.intakeFileId,
    object_version_id: facts.objectVersionId,
    verified_checksum: facts.verifiedChecksum,
    verified_size_bytes: facts.verifiedSizeBytes,
    declared_mime: facts.declaredMime,
    extension: facts.extension,
    file_policy_status: POLICY_DECISION_OUTCOMES[input.policyDecisionOutcome].filePolicyStatus,
    sanitized_result: copySanitizedResult(input.sanitizedResult),
  };
}

function samePolicyReplay(left, right) {
  return (
    left?.organization_id === right.organization_id &&
    left?.intake_file_id === right.intake_file_id &&
    left?.object_version_id === right.object_version_id &&
    left?.verified_checksum === right.verified_checksum &&
    left?.verified_size_bytes === right.verified_size_bytes &&
    left?.declared_mime === right.declared_mime &&
    left?.extension === right.extension &&
    left?.file_policy_status === right.file_policy_status &&
    stableJson(left?.sanitized_result) === stableJson(right.sanitized_result)
  );
}

function replayFactsMatch(record, input) {
  if (input.newUploadState === "uploaded_unconfirmed") return record.object_version_id === input.objectVersionId;
  if (input.newUploadState === "confirmed") {
    return (
      record.object_version_id === input.objectVersionId &&
      record.verified_checksum === input.verifiedChecksum &&
      record.verified_size_bytes === input.verifiedSizeBytes
    );
  }
  return true;
}

function isExpired(record, now) {
  return Date.parse(now) >= Date.parse(record.upload_expires_at);
}

function edgeKey(from, to) {
  return `${from}->${to}`;
}

function asIso(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function copyPolicyDecisionReplay(replay) {
  if (!replay) return null;
  return {
    organization_id: replay.organization_id,
    intake_file_id: replay.intake_file_id,
    object_version_id: replay.object_version_id,
    verified_checksum: replay.verified_checksum,
    verified_size_bytes: Number(replay.verified_size_bytes),
    declared_mime: replay.declared_mime,
    extension: replay.extension,
    file_policy_status: replay.file_policy_status,
    sanitized_result: copySanitizedResult(replay.sanitized_result),
  };
}

function rowToRecord(row) {
  if (!row) return null;
  const record = {
    organization_id: row.organization_id,
    intake_batch_id: row.intake_batch_id,
    intake_file_id: row.intake_file_id,
    upload_state: row.upload_state,
    file_policy_status: row.file_policy_status,
    upload_state_changed_at: asIso(row.upload_state_changed_at),
    upload_expires_at: asIso(row.upload_expires_at),
    object_version_id: row.object_version_id,
    verified_checksum: row.verified_checksum,
    verified_size_bytes: row.verified_size_bytes === null ? null : Number(row.verified_size_bytes),
    verified_at: asIso(row.verified_at),
    policy_decision_replay: copyPolicyDecisionReplay(row.policy_decision_replay),
    created_at: asIso(row.created_at),
  };
  return Object.defineProperty(record, "checksum", {
    enumerable: false,
    value: row.checksum,
  });
}

async function readRecord(tx, input) {
  const result = await tx.query(
	    `SELECT f.organization_id::text AS organization_id,
	            f.intake_batch_id::text AS intake_batch_id,
	            f.intake_file_id::text AS intake_file_id,
	            f.checksum,
	            f.upload_state,
            f.file_policy_status,
            f.upload_state_changed_at,
            f.upload_expires_at,
            f.object_version_id,
            f.verified_checksum,
            f.verified_size_bytes,
            f.verified_at,
            f.created_at,
            CASE WHEN r.organization_id IS NULL THEN NULL ELSE jsonb_build_object(
              'organization_id', r.organization_id::text,
              'intake_file_id', r.intake_file_id::text,
              'object_version_id', r.object_version_id,
              'verified_checksum', r.verified_checksum,
              'verified_size_bytes', r.verified_size_bytes,
              'declared_mime', r.declared_mime,
              'extension', r.extension,
              'file_policy_status', r.file_policy_status,
              'sanitized_result', r.sanitized_result
            ) END AS policy_decision_replay
       FROM kai.intake_files f
       LEFT JOIN kai.upload_policy_decision_replay r
         ON r.organization_id = f.organization_id
        AND r.intake_file_id = f.intake_file_id
      WHERE f.organization_id = $1::uuid
        AND f.intake_file_id = $2::uuid`,
    [input.organizationId, input.intakeFileId],
  );
  return rowToRecord(result.rows[0]);
}

function operationForTransition(toState) {
  return {
    reserved: "reserve_upload",
    upload_started: "start_upload",
    uploaded_unconfirmed: "complete_object_version",
    confirmed: "confirm_upload",
    policy_blocked: "block_upload",
    abandoned: "abandon_upload",
    expired: "expire_upload",
  }[toState];
}

async function insertAudit(tx, { organizationId, intakeFileId, operation, fromState, toState, outcome, metadata, now }) {
  await tx.query(
    `INSERT INTO kai.upload_lifecycle_audit (
       organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
     )
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb, $8::timestamptz)`,
    [organizationId, intakeFileId, operation, fromState, toState, outcome, JSON.stringify(metadata), now],
  );
}

async function hasSuccessfulReservationAudit(tx, input) {
  const result = await tx.query(
    `SELECT 1
       FROM kai.upload_lifecycle_audit
      WHERE organization_id = $1::uuid
        AND intake_file_id = $2::uuid
        AND operation = 'reserve_upload'
        AND outcome = 'success'
      LIMIT 1`,
    [input.organizationId, input.intakeFileId],
  );
  return result.rowCount > 0;
}

function buildPolicyDecisionAuditMetadata(input) {
  const outcome = POLICY_DECISION_OUTCOMES[input.policyDecisionOutcome];
  return {
    metadata_only: true,
    contract: "owner_decision_post_b_policy_transition_v1",
    file_policy_status: outcome.filePolicyStatus,
    policy_decision_outcome: input.policyDecisionOutcome,
    object_version_bound: true,
    verified_checksum_bound: true,
    verified_size_bytes_bound: true,
    declared_mime: input.confirmedFileFacts.declaredMime,
    extension: input.confirmedFileFacts.extension,
    replay_contract_version: REPLAY_CONTRACT_VERSION,
    validator_key: "VAL-KAI-POLICY-C1-001",
  };
}

function buildPolicyDecisionAuditPayload(input) {
  const outcome = POLICY_DECISION_OUTCOMES[input.policyDecisionOutcome];
  return {
    attempted_operation: "policy_decision_compare_and_set",
    actor_type: "internal_service",
    blocked_reason_code: input.policyDecisionOutcome,
    contract: "owner_decision_post_b_policy_transition_v1",
    file_policy_status: outcome.filePolicyStatus,
    object_type: "intake_file",
    request_scope: "organization_intake_file",
    route_contract: "unwired_synthetic_lifecycle_repository",
    sprint_phase: "kai_sprint2_p0_c1",
    validator_key: "VAL-KAI-POLICY-C1-001",
  };
}

function shapeLifecycleError(error) {
  if (error?.code === "23505") return uploadLifecycleFailure("conflict_current_state_changed");
  if (error?.code === "23503") return uploadLifecycleFailure("not_found");
  if (error?.code === "23514" || error?.code === "P0001" || error?.code === "22P02") {
    return uploadLifecycleFailure("validation_blocker");
  }
  return uploadLifecycleFailure("system_error");
}

export function createPostgresUploadLifecycleRepository({ runInTransaction = withTransaction } = {}) {
  return Object.freeze({
    async createReservedUploadLifecycle(input) {
      if (!validateCreateInput(input)) return uploadLifecycleFailure("validation_blocker");
      try {
        return await runInTransaction(async (tx) => {
          const existing = await readRecord(tx, input);
          if (!existing) return uploadLifecycleFailure("not_found");
          if (existing.intake_batch_id !== input.intakeBatchId) {
            return uploadLifecycleFailure("conflict_current_state_changed");
          }

          if (await hasSuccessfulReservationAudit(tx, input)) {
            return uploadLifecycleSuccess({ record: existing, replayed: true });
          }

          const result = await tx.query(
            `UPDATE kai.intake_files
                SET upload_state = 'reserved',
                    file_policy_status = 'pending',
                    upload_state_changed_at = $4::timestamptz,
                    upload_expires_at = $5::timestamptz,
                    object_version_id = NULL,
                    verified_checksum = NULL,
                    verified_size_bytes = NULL,
                    verified_at = NULL
              WHERE organization_id = $1::uuid
                AND intake_batch_id = $2::uuid
                AND intake_file_id = $3::uuid
                AND upload_state = 'reserved'
                AND file_policy_status = 'pending'
                AND object_version_id IS NULL
                AND verified_checksum IS NULL
                AND verified_size_bytes IS NULL
                AND verified_at IS NULL`,
            [
              input.organizationId,
              input.intakeBatchId,
              input.intakeFileId,
              input.now,
              addReservationExpiry(input.now),
            ],
          );
          if (result.rowCount !== 1) return uploadLifecycleFailure("conflict_current_state_changed");
          await insertAudit(tx, {
            organizationId: input.organizationId,
            intakeFileId: input.intakeFileId,
            operation: "reserve_upload",
            fromState: null,
            toState: "reserved",
            outcome: "success",
            metadata: { metadata_only: true },
            now: input.now,
          });
          return uploadLifecycleSuccess({ record: await readRecord(tx, input), replayed: false });
        });
      } catch (error) {
        return shapeLifecycleError(error);
      }
    },

    async getUploadLifecycle(input) {
      if (!validateGetInput(input)) return uploadLifecycleFailure("validation_blocker");
      try {
        return await runInTransaction(async (tx) => {
          const record = await readRecord(tx, input);
          if (!record) return uploadLifecycleFailure("not_found");
          return uploadLifecycleSuccess({ record });
        });
      } catch (error) {
        return shapeLifecycleError(error);
      }
    },

    async transitionUploadLifecycle(input) {
      if (!validateTransitionInput(input)) return uploadLifecycleFailure("validation_blocker");
      try {
        return await runInTransaction(async (tx) => {
          const record = await readRecord(tx, input);
          if (!record) return uploadLifecycleFailure("not_found");

          if (record.upload_state === input.newUploadState) {
            if (replayFactsMatch(record, input)) {
              return uploadLifecycleSuccess({ record, replayed: true });
            }
            return uploadLifecycleFailure("conflict_current_state_changed");
          }

          if (PRE_CONFIRMATION_STATES.has(record.upload_state)) {
            const expired = isExpired(record, input.now);
            if (input.newUploadState === "expired" && !expired) return uploadLifecycleFailure("state_transition_denied");
            if (input.newUploadState !== "expired" && expired) return uploadLifecycleFailure("state_transition_denied");
          }

          if (record.upload_state !== input.expectedUploadState) {
            return uploadLifecycleFailure("conflict_current_state_changed");
          }

          if (!AUTHORIZED_EDGES.has(edgeKey(input.expectedUploadState, input.newUploadState))) {
            return uploadLifecycleFailure("state_transition_denied");
          }

          if (input.newUploadState === "confirmed" && record.object_version_id !== input.objectVersionId) {
            return uploadLifecycleFailure("conflict_current_state_changed");
          }
          if (input.newUploadState === "confirmed" && record.checksum !== input.verifiedChecksum) {
            return uploadLifecycleFailure("conflict_current_state_changed");
          }

          const result = await tx.query(
            `UPDATE kai.intake_files
                SET upload_state = $4,
                    file_policy_status = CASE WHEN $4 = 'policy_blocked' THEN 'blocked' ELSE file_policy_status END,
                    upload_state_changed_at = $5::timestamptz,
                    object_version_id = CASE WHEN $4 = 'uploaded_unconfirmed' THEN $6 ELSE object_version_id END,
                    verified_checksum = CASE WHEN $4 = 'confirmed' THEN $7 ELSE verified_checksum END,
                    verified_size_bytes = CASE WHEN $4 = 'confirmed' THEN $8::bigint ELSE verified_size_bytes END,
                    verified_at = CASE WHEN $4 = 'confirmed' THEN $5::timestamptz ELSE verified_at END
              WHERE organization_id = $1::uuid
                AND intake_file_id = $2::uuid
                AND upload_state = $3
                AND ($4 <> 'confirmed' OR checksum = $7)`,
            [
              input.organizationId,
              input.intakeFileId,
              input.expectedUploadState,
              input.newUploadState,
              input.now,
              input.objectVersionId ?? null,
              input.verifiedChecksum ?? null,
              input.verifiedSizeBytes ?? null,
            ],
          );
          if (result.rowCount !== 1) return uploadLifecycleFailure("conflict_current_state_changed");
          await insertAudit(tx, {
            organizationId: input.organizationId,
            intakeFileId: input.intakeFileId,
            operation: operationForTransition(input.newUploadState),
            fromState: input.expectedUploadState,
            toState: input.newUploadState,
            outcome: "success",
            metadata: { metadata_only: true },
            now: input.now,
          });
          return uploadLifecycleSuccess({ record: await readRecord(tx, input), replayed: false });
        });
      } catch (error) {
        return shapeLifecycleError(error);
      }
    },

    async compareAndSetPolicyDecision(input) {
      if (!validatePolicyDecisionInput(input)) return uploadLifecycleFailure("validation_blocker");
      try {
        return await runInTransaction(async (tx) => {
          const requestedReplay = policyReplayFromInput(input);
          const record = await readRecord(tx, input.confirmedFileFacts);
          if (!record) return uploadLifecycleFailure("not_found");
          if (record.policy_decision_replay) {
            if (samePolicyReplay(record.policy_decision_replay, requestedReplay)) {
              return uploadLifecycleSuccess({ record, replayed: true });
            }
            return uploadLifecycleFailure("conflict_current_state_changed");
          }
          if (
            record.upload_state !== "confirmed" ||
            record.object_version_id !== input.confirmedFileFacts.objectVersionId ||
            record.verified_checksum !== input.confirmedFileFacts.verifiedChecksum ||
            record.verified_size_bytes !== input.confirmedFileFacts.verifiedSizeBytes ||
            record.file_policy_status !== input.expectedFilePolicyStatus
          ) {
            return uploadLifecycleFailure("conflict_current_state_changed");
          }

          const preparedAudit = input.metadataOnlyAudit.prepareMetadataOnlyAudit({
            payload: buildPolicyDecisionAuditPayload(input),
          });
          if (!preparedAudit || preparedAudit.ok !== true || typeof preparedAudit.publish !== "function") {
            return uploadLifecycleFailure("validation_blocker");
          }

          const outcome = POLICY_DECISION_OUTCOMES[input.policyDecisionOutcome];
          const updateResult = await tx.query(
            `UPDATE kai.intake_files
                SET upload_state = $4,
                    file_policy_status = $5,
                    upload_state_changed_at = $6::timestamptz
              WHERE organization_id = $1::uuid
                AND intake_file_id = $2::uuid
                AND upload_state = 'confirmed'
                AND file_policy_status = 'pending'
                AND object_version_id = $3
                AND verified_checksum = $7
                AND verified_size_bytes = $8::bigint`,
            [
              input.confirmedFileFacts.organizationId,
              input.confirmedFileFacts.intakeFileId,
              input.confirmedFileFacts.objectVersionId,
              outcome.uploadState,
              outcome.filePolicyStatus,
              input.now,
              input.confirmedFileFacts.verifiedChecksum,
              input.confirmedFileFacts.verifiedSizeBytes,
            ],
          );
          if (updateResult.rowCount !== 1) return uploadLifecycleFailure("conflict_current_state_changed");

          const insertReplay = await tx.query(
            `INSERT INTO kai.upload_policy_decision_replay (
               organization_id, intake_file_id, object_version_id, verified_checksum, verified_size_bytes,
               declared_mime, extension, file_policy_status, sanitized_result,
               sanitized_result_canonical_sha256, replay_contract_version, created_at
             )
             VALUES (
               $1::uuid, $2::uuid, $3, $4, $5::bigint,
               $6, $7, $8, $9::jsonb,
               encode(digest($9::jsonb::text, 'sha256'), 'hex'), $10, $11::timestamptz
             )
             ON CONFLICT (organization_id, intake_file_id) DO NOTHING`,
            [
              requestedReplay.organization_id,
              requestedReplay.intake_file_id,
              requestedReplay.object_version_id,
              requestedReplay.verified_checksum,
              requestedReplay.verified_size_bytes,
              requestedReplay.declared_mime,
              requestedReplay.extension,
              requestedReplay.file_policy_status,
              JSON.stringify(requestedReplay.sanitized_result),
              REPLAY_CONTRACT_VERSION,
              input.now,
            ],
          );
          if (insertReplay.rowCount !== 1) return uploadLifecycleFailure("conflict_current_state_changed");

          await insertAudit(tx, {
            organizationId: input.confirmedFileFacts.organizationId,
            intakeFileId: input.confirmedFileFacts.intakeFileId,
            operation: "policy_decision_compare_and_set",
            fromState: "confirmed",
            toState: outcome.uploadState,
            outcome: "success",
            metadata: buildPolicyDecisionAuditMetadata(input),
            now: input.now,
          });
          preparedAudit.publish();
          return uploadLifecycleSuccess({ record: await readRecord(tx, input.confirmedFileFacts), replayed: false });
        });
      } catch (error) {
        return shapeLifecycleError(error);
      }
    },
  });
}
