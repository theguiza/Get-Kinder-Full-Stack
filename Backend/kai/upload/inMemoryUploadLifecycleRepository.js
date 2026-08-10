import {
  KAI_SPRINT2_P0_PATTERNS,
  KAI_SPRINT2_P0_UPLOAD_STATES,
  KAI_SPRINT2_P0_UPLOAD_TIMING,
} from "../config/kaiSprint2P0Contract.js";
import { createUploadLifecycleRepository } from "./uploadLifecycleRepository.js";

const FILE_POLICY_STATUS = Object.freeze({
  pending: "pending",
  passed: "passed",
  blocked: "blocked",
  failed: "failed",
});

export const UPLOAD_LIFECYCLE_RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  state_transition_denied: 422,
  conflict_current_state_changed: 409,
  not_found: 404,
  system_error: 500,
});

const AUTHORIZED_EDGES = Object.freeze(
  new Set([
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
  ]),
);

const PRE_CONFIRMATION_STATES = Object.freeze(new Set(["reserved", "upload_started", "uploaded_unconfirmed"]));

export function uploadLifecycleFailure(code) {
  return {
    ok: false,
    data: null,
    error: {
      code,
      status: UPLOAD_LIFECYCLE_RESULT_STATUS[code],
    },
  };
}

export function uploadLifecycleSuccess(data) {
  return {
    ok: true,
    data,
    error: null,
  };
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

function keyFor({ organizationId, intakeFileId }) {
  return `${organizationId}\u0000${intakeFileId}`;
}

function copyRecord(record) {
  return {
    organization_id: record.organization_id,
    intake_batch_id: record.intake_batch_id,
    intake_file_id: record.intake_file_id,
    upload_state: record.upload_state,
    file_policy_status: record.file_policy_status,
    upload_state_changed_at: record.upload_state_changed_at,
    upload_expires_at: record.upload_expires_at,
    object_version_id: record.object_version_id,
    verified_checksum: record.verified_checksum,
    verified_size_bytes: record.verified_size_bytes,
    verified_at: record.verified_at,
    policy_decision_replay: copyPolicyDecisionReplay(record.policy_decision_replay),
    created_at: record.created_at,
  };
}

function copySanitizedResult(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(copySanitizedResult);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, copySanitizedResult(entry)]));
}

function copyPolicyDecisionReplay(replay) {
  if (!replay) return null;
  return {
    organization_id: replay.organization_id,
    intake_file_id: replay.intake_file_id,
    object_version_id: replay.object_version_id,
    verified_checksum: replay.verified_checksum,
    verified_size_bytes: replay.verified_size_bytes,
    declared_mime: replay.declared_mime,
    extension: replay.extension,
    file_policy_status: replay.file_policy_status,
    sanitized_result: copySanitizedResult(replay.sanitized_result),
  };
}

function copyRecordsSnapshot(records) {
  return Array.from(records.entries(), ([key, record]) => [key, copyRecord(record)]);
}

function edgeKey(from, to) {
  return `${from}->${to}`;
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
  if (input.newUploadState === "uploaded_unconfirmed") {
    return isNonEmptyString(input.objectVersionId);
  }
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
  passed: Object.freeze({
    filePolicyStatus: FILE_POLICY_STATUS.passed,
    uploadState: "confirmed",
  }),
  blocked: Object.freeze({
    filePolicyStatus: FILE_POLICY_STATUS.blocked,
    uploadState: "policy_blocked",
  }),
  failed: Object.freeze({
    filePolicyStatus: FILE_POLICY_STATUS.failed,
    uploadState: "confirmed",
  }),
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

function isExpired(record, now) {
  return Date.parse(now) >= Date.parse(record.upload_expires_at);
}

const GCS_GENERATION_PATTERN = /^[1-9][0-9]{0,19}$/;

// Mirrors postgresUploadLifecycleRepository.js: the GCS SDK's own generation
// option is passed through Number(...) internally, so a digit string that
// would lose precision under that conversion could bind to the wrong
// generation. Fail closed rather than persist such a value.
function isPrecisionSafeGcsGeneration(value) {
  return (
    typeof value === "string" &&
    GCS_GENERATION_PATTERN.test(value) &&
    Number.isSafeInteger(Number(value))
  );
}

function validateBindGcsGenerationInput(input) {
  const allowedKeys = new Set(["organizationId", "intakeFileId", "objectVersionId", "gcsGeneration", "now"]);
  if (!isPlainObject(input) || !hasOnlyKeys(input, allowedKeys)) return false;
  return (
    isNonEmptyString(input.organizationId) &&
    isNonEmptyString(input.intakeFileId) &&
    isNonEmptyString(input.objectVersionId) &&
    isPrecisionSafeGcsGeneration(input.gcsGeneration) &&
    isNormalizedNow(input.now)
  );
}

function validateResolveGcsGenerationBindingInput(input) {
  const allowedKeys = new Set(["organizationId", "intakeFileId"]);
  if (!isPlainObject(input) || !hasOnlyKeys(input, allowedKeys)) return false;
  return isNonEmptyString(input.organizationId) && isNonEmptyString(input.intakeFileId);
}

function replayFactsMatch(record, input) {
  if (input.newUploadState === "uploaded_unconfirmed") {
    return record.object_version_id === input.objectVersionId;
  }
  if (input.newUploadState === "confirmed") {
    return (
      record.object_version_id === input.objectVersionId &&
      record.verified_checksum === input.verifiedChecksum &&
      record.verified_size_bytes === input.verifiedSizeBytes
    );
  }
  return true;
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

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
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

function confirmedFactsMatch(record, facts) {
  return (
    record.organization_id === facts.organizationId &&
    record.intake_file_id === facts.intakeFileId &&
    record.upload_state === "confirmed" &&
    record.object_version_id === facts.objectVersionId &&
    record.verified_checksum === facts.verifiedChecksum &&
    record.verified_size_bytes === facts.verifiedSizeBytes
  );
}

function validatePreparedPolicyState(next, input) {
  const outcome = POLICY_DECISION_OUTCOMES[input.policyDecisionOutcome];
  return (
    next.organization_id === input.confirmedFileFacts.organizationId &&
    next.intake_file_id === input.confirmedFileFacts.intakeFileId &&
    next.upload_state === outcome.uploadState &&
    next.file_policy_status === outcome.filePolicyStatus &&
    next.object_version_id === input.confirmedFileFacts.objectVersionId &&
    next.verified_checksum === input.confirmedFileFacts.verifiedChecksum &&
    next.verified_size_bytes === input.confirmedFileFacts.verifiedSizeBytes &&
    next.policy_decision_replay &&
    samePolicyReplay(next.policy_decision_replay, policyReplayFromInput(input))
  );
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

function applyTransition(record, input) {
  const next = copyRecord(record);
  // copyRecord() intentionally omits gcs_generation (Gate C-1 private
  // storage binding) from the public record shape; preserve it on the
  // internal map entry so a later transition does not erase an existing
  // binding.
  next.gcs_generation = record.gcs_generation;
  next.upload_state = input.newUploadState;
  next.upload_state_changed_at = input.now;

  if (input.newUploadState === "uploaded_unconfirmed") {
    next.object_version_id = input.objectVersionId;
  }

  if (input.newUploadState === "confirmed") {
    next.verified_checksum = input.verifiedChecksum;
    next.verified_size_bytes = input.verifiedSizeBytes;
    next.verified_at = input.now;
  }

  if (input.newUploadState === "policy_blocked") {
    next.file_policy_status = FILE_POLICY_STATUS.blocked;
  }

  return next;
}

export function createInMemoryUploadLifecycleRepository() {
  const stateHolder = {
    state: {
      records: new Map(),
    },
  };

  const repository = createUploadLifecycleRepository({
    createReservedUploadLifecycle(input) {
      if (!validateCreateInput(input)) return uploadLifecycleFailure("validation_blocker");

      const key = keyFor(input);
      const existing = stateHolder.state.records.get(key);

      if (existing) {
        if (existing.intake_batch_id === input.intakeBatchId) {
          return uploadLifecycleSuccess({ record: copyRecord(existing), replayed: true });
        }
        return uploadLifecycleFailure("conflict_current_state_changed");
      }

      const record = {
        organization_id: input.organizationId,
        intake_batch_id: input.intakeBatchId,
        intake_file_id: input.intakeFileId,
        upload_state: "reserved",
        file_policy_status: FILE_POLICY_STATUS.pending,
        upload_state_changed_at: input.now,
        upload_expires_at: addReservationExpiry(input.now),
        object_version_id: null,
        verified_checksum: null,
        verified_size_bytes: null,
        verified_at: null,
        policy_decision_replay: null,
        gcs_generation: null,
        created_at: input.now,
      };

      stateHolder.state.records.set(key, record);
      return uploadLifecycleSuccess({ record: copyRecord(record), replayed: false });
    },

    getUploadLifecycle(input) {
      if (!validateGetInput(input)) return uploadLifecycleFailure("validation_blocker");
      const record = stateHolder.state.records.get(keyFor(input));
      if (!record) return uploadLifecycleFailure("not_found");
      return uploadLifecycleSuccess({ record: copyRecord(record) });
    },

    transitionUploadLifecycle(input) {
      if (!validateTransitionInput(input)) return uploadLifecycleFailure("validation_blocker");

      const key = keyFor(input);
      const record = stateHolder.state.records.get(key);
      if (!record) return uploadLifecycleFailure("not_found");

      if (record.upload_state === input.newUploadState) {
        if (replayFactsMatch(record, input)) {
          return uploadLifecycleSuccess({ record: copyRecord(record), replayed: true });
        }
        return uploadLifecycleFailure("conflict_current_state_changed");
      }

      if (PRE_CONFIRMATION_STATES.has(record.upload_state)) {
        const expired = isExpired(record, input.now);
        if (input.newUploadState === "expired" && !expired) {
          return uploadLifecycleFailure("state_transition_denied");
        }
        if (input.newUploadState !== "expired" && expired) {
          return uploadLifecycleFailure("state_transition_denied");
        }
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

      const next = applyTransition(record, input);
      stateHolder.state.records.set(key, next);
      return uploadLifecycleSuccess({ record: copyRecord(next), replayed: false });
    },
  });

  return Object.freeze(Object.defineProperty(
    {
      ...repository,
      compareAndSetPolicyDecision(input) {
        if (!validatePolicyDecisionInput(input)) return uploadLifecycleFailure("validation_blocker");

        const key = keyFor(input.confirmedFileFacts);
        const record = stateHolder.state.records.get(key);
        if (!record) return uploadLifecycleFailure("not_found");

        const requestedReplay = policyReplayFromInput(input);
        if (record.policy_decision_replay) {
          if (samePolicyReplay(record.policy_decision_replay, requestedReplay)) {
            return uploadLifecycleSuccess({ record: copyRecord(record), replayed: true });
          }
          return uploadLifecycleFailure("conflict_current_state_changed");
        }

        if (!confirmedFactsMatch(record, input.confirmedFileFacts)) {
          return uploadLifecycleFailure("conflict_current_state_changed");
        }

        if (record.file_policy_status !== input.expectedFilePolicyStatus) {
          return uploadLifecycleFailure("conflict_current_state_changed");
        }

        const outcome = POLICY_DECISION_OUTCOMES[input.policyDecisionOutcome];
        const next = copyRecord(record);
        next.gcs_generation = record.gcs_generation;
        next.upload_state = outcome.uploadState;
        next.file_policy_status = outcome.filePolicyStatus;
        next.upload_state_changed_at = input.now;
        next.policy_decision_replay = requestedReplay;

        if (!validatePreparedPolicyState(next, input)) {
          return uploadLifecycleFailure("validation_blocker");
        }

        const preparedAudit = input.metadataOnlyAudit.prepareMetadataOnlyAudit({
          payload: buildPolicyDecisionAuditPayload(input),
        });
        if (!preparedAudit || preparedAudit.ok !== true || typeof preparedAudit.publish !== "function") {
          return uploadLifecycleFailure("validation_blocker");
        }

        stateHolder.state.records.set(key, next);
        preparedAudit.publish();
        return uploadLifecycleSuccess({ record: copyRecord(next), replayed: false });
      },

      // Gate C-1: mirrors postgresUploadLifecycleRepository.bindGcsGeneration.
      bindGcsGeneration(input) {
        if (!validateBindGcsGenerationInput(input)) return uploadLifecycleFailure("validation_blocker");

        const key = keyFor(input);
        const record = stateHolder.state.records.get(key);
        if (!record) return uploadLifecycleFailure("not_found");
        if (record.object_version_id !== input.objectVersionId) {
          return uploadLifecycleFailure("conflict_current_state_changed");
        }
        if (record.gcs_generation !== null) {
          if (record.gcs_generation === input.gcsGeneration) {
            return uploadLifecycleSuccess({ bound: true, replayed: true });
          }
          return uploadLifecycleFailure("conflict_current_state_changed");
        }

        const next = copyRecord(record);
        next.gcs_generation = input.gcsGeneration;
        stateHolder.state.records.set(key, next);
        return uploadLifecycleSuccess({ bound: true, replayed: false });
      },

      // Gate C-1: the sole read path for the private storage binding.
      resolveGcsGenerationBinding(input) {
        if (!validateResolveGcsGenerationBindingInput(input)) return uploadLifecycleFailure("validation_blocker");

        const record = stateHolder.state.records.get(keyFor(input));
        if (!record) return uploadLifecycleFailure("not_found");
        return uploadLifecycleSuccess({
          object_version_id: record.object_version_id,
          gcs_generation: record.gcs_generation,
        });
      },
    },
    IN_MEMORY_UPLOAD_LIFECYCLE_TRANSACTION_PARTICIPANT,
    {
      enumerable: false,
      value: Object.freeze({
        createTransactionParticipant() {
          const participantRepository = createInMemoryUploadLifecycleRepository();
          participantRepository[IN_MEMORY_UPLOAD_LIFECYCLE_TRANSACTION_PARTICIPANT]
            .replaceSnapshot(copyRecordsSnapshot(stateHolder.state.records));
          return Object.freeze({
            repository: participantRepository,
            prepareCommit() {
              return {
                target: stateHolder,
                preparedState: {
                  records: new Map(
                    participantRepository[IN_MEMORY_UPLOAD_LIFECYCLE_TRANSACTION_PARTICIPANT]
                      .snapshot(),
                  ),
                },
              };
            },
          });
        },
        replaceSnapshot(snapshot) {
          stateHolder.state = {
            records: new Map(snapshot.map(([key, record]) => [key, copyRecord(record)])),
          };
        },
        snapshot() {
          return copyRecordsSnapshot(stateHolder.state.records);
        },
      }),
    },
  ));
}

export const IN_MEMORY_UPLOAD_LIFECYCLE_TRANSACTION_PARTICIPANT = Symbol.for(
  "kai.inMemoryUploadLifecycleRepository.transactionParticipant",
);
