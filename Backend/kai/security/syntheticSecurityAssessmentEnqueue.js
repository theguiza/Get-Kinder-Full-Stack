import { KAI_SPRINT2_P0_PATTERNS } from "../config/kaiSprint2P0Contract.js";
import {
  uploadLifecycleFailure,
  uploadLifecycleSuccess,
} from "../upload/inMemoryUploadLifecycleRepository.js";

const ALLOWED_FACT_KEYS = Object.freeze(new Set([
  "organizationId",
  "intakeFileId",
  "objectVersionId",
  "verifiedChecksum",
  "verifiedSizeBytes",
  "declaredMime",
  "extension",
]));

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, allowedKeys) {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isTrustedAssessmentFacts(input) {
  if (!isPlainObject(input) || !hasOnlyKeys(input, ALLOWED_FACT_KEYS)) return false;
  return (
    isNonEmptyString(input.organizationId) &&
    isNonEmptyString(input.intakeFileId) &&
    isNonEmptyString(input.objectVersionId) &&
    typeof input.verifiedChecksum === "string" &&
    KAI_SPRINT2_P0_PATTERNS.checksumSha256.test(input.verifiedChecksum) &&
    input.verifiedChecksum.toLowerCase() === input.verifiedChecksum &&
    Number.isSafeInteger(input.verifiedSizeBytes) &&
    input.verifiedSizeBytes >= 1 &&
    isNonEmptyString(input.declaredMime) &&
    input.declaredMime.trim().toLowerCase() === input.declaredMime &&
    isNonEmptyString(input.extension) &&
    input.extension.startsWith(".") &&
    input.extension.toLowerCase() === input.extension
  );
}

function scopedFileKey({ organizationId, intakeFileId }) {
  return `${organizationId}\u0000${intakeFileId}`;
}

function assessmentIdentityKey({
  organizationId,
  intakeFileId,
  objectVersionId,
  verifiedChecksum,
}) {
  return `${organizationId}\u0000${intakeFileId}\u0000${objectVersionId}\u0000${verifiedChecksum}`;
}

function copyRecord(record) {
  return {
    security_assessment_enqueue_id: record.security_assessment_enqueue_id,
    organization_id: record.organization_id,
    intake_file_id: record.intake_file_id,
    object_version_id: record.object_version_id,
    verified_checksum: record.verified_checksum,
    verified_size_bytes: record.verified_size_bytes,
    declared_mime: record.declared_mime,
    extension: record.extension,
  };
}

function createRecord(id, input) {
  return {
    security_assessment_enqueue_id: id,
    organization_id: input.organizationId,
    intake_file_id: input.intakeFileId,
    object_version_id: input.objectVersionId,
    verified_checksum: input.verifiedChecksum,
    verified_size_bytes: input.verifiedSizeBytes,
    declared_mime: input.declaredMime,
    extension: input.extension,
  };
}

export function createSyntheticSecurityAssessmentEnqueue() {
  const recordsByIdentity = new Map();
  const identityByScopedFile = new Map();
  let nextId = 1;

  return Object.freeze({
    enqueueSecurityAssessment(input = {}) {
      if (!isTrustedAssessmentFacts(input)) {
        return uploadLifecycleFailure("validation_blocker");
      }

      const identityKey = assessmentIdentityKey(input);
      const existingRecord = recordsByIdentity.get(identityKey);
      if (existingRecord) {
        return uploadLifecycleSuccess({
          record: copyRecord(existingRecord),
          replayed: true,
        });
      }

      const fileKey = scopedFileKey(input);
      if (identityByScopedFile.has(fileKey)) {
        return uploadLifecycleFailure("conflict_current_state_changed");
      }

      const record = createRecord(
        `synthetic-security-assessment-${String(nextId).padStart(6, "0")}`,
        input,
      );
      nextId += 1;

      recordsByIdentity.set(identityKey, record);
      identityByScopedFile.set(fileKey, identityKey);

      return uploadLifecycleSuccess({
        record: copyRecord(record),
        replayed: false,
      });
    },

    listSecurityAssessmentEnqueueRecords() {
      return Array.from(recordsByIdentity.values(), copyRecord);
    },
  });
}

export const __testables = Object.freeze({
  ALLOWED_FACT_KEYS,
  assessmentIdentityKey,
  isTrustedAssessmentFacts,
});
