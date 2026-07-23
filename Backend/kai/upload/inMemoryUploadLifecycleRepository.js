import {
  KAI_SPRINT2_P0_PATTERNS,
  KAI_SPRINT2_P0_UPLOAD_STATES,
  KAI_SPRINT2_P0_UPLOAD_TIMING,
} from "../config/kaiSprint2P0Contract.js";
import { createUploadLifecycleRepository } from "./uploadLifecycleRepository.js";

const FILE_POLICY_STATUS = Object.freeze({
  pending: "pending",
  blocked: "blocked",
});

const RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  state_transition_denied: 422,
  conflict_current_state_changed: 409,
  not_found: 404,
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

function failure(code) {
  return {
    ok: false,
    data: null,
    error: {
      code,
      status: RESULT_STATUS[code],
    },
  };
}

function success(data) {
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
    created_at: record.created_at,
  };
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
      input.verifiedSizeBytes >= 0
    );
  }
  return (
    input.objectVersionId === undefined &&
    input.verifiedChecksum === undefined &&
    input.verifiedSizeBytes === undefined
  );
}

function isExpired(record, now) {
  return Date.parse(now) >= Date.parse(record.upload_expires_at);
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

function applyTransition(record, input) {
  const next = copyRecord(record);
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
  const records = new Map();

  return createUploadLifecycleRepository({
    createReservedUploadLifecycle(input) {
      if (!validateCreateInput(input)) return failure("validation_blocker");

      const key = keyFor(input);
      const existing = records.get(key);

      if (existing) {
        if (existing.intake_batch_id === input.intakeBatchId) {
          return success({ record: copyRecord(existing), replayed: true });
        }
        return failure("conflict_current_state_changed");
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
        created_at: input.now,
      };

      records.set(key, record);
      return success({ record: copyRecord(record), replayed: false });
    },

    getUploadLifecycle(input) {
      if (!validateGetInput(input)) return failure("validation_blocker");
      const record = records.get(keyFor(input));
      if (!record) return failure("not_found");
      return success({ record: copyRecord(record) });
    },

    transitionUploadLifecycle(input) {
      if (!validateTransitionInput(input)) return failure("validation_blocker");

      const key = keyFor(input);
      const record = records.get(key);
      if (!record) return failure("not_found");

      if (record.upload_state === input.newUploadState) {
        if (replayFactsMatch(record, input)) {
          return success({ record: copyRecord(record), replayed: true });
        }
        return failure("conflict_current_state_changed");
      }

      if (PRE_CONFIRMATION_STATES.has(record.upload_state)) {
        const expired = isExpired(record, input.now);
        if (input.newUploadState === "expired" && !expired) {
          return failure("state_transition_denied");
        }
        if (input.newUploadState !== "expired" && expired) {
          return failure("state_transition_denied");
        }
      }

      if (record.upload_state !== input.expectedUploadState) {
        return failure("conflict_current_state_changed");
      }

      if (!AUTHORIZED_EDGES.has(edgeKey(input.expectedUploadState, input.newUploadState))) {
        return failure("state_transition_denied");
      }

      if (input.newUploadState === "confirmed" && record.object_version_id !== input.objectVersionId) {
        return failure("conflict_current_state_changed");
      }

      const next = applyTransition(record, input);
      records.set(key, next);
      return success({ record: copyRecord(next), replayed: false });
    },
  });
}
