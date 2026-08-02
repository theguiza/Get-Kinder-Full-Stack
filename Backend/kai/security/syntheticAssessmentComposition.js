import { KAI_SPRINT2_P0_PATTERNS } from "../config/kaiSprint2P0Contract.js";
import { uploadLifecycleFailure } from "../upload/inMemoryUploadLifecycleRepository.js";
import { readVerifiedAssessmentBytes } from "./assessmentReadIntegrityBridge.js";
import {
  createInternalSecurityAssessmentExecutor,
  executeInjectedInternalSecurityAssessment,
} from "./internalSecurityAssessmentExecutor.js";

const ALLOWED_SELECTION_KEYS = Object.freeze(new Set([
  "organizationId",
  "intakeFileId",
  "objectVersionId",
  "verifiedChecksum",
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

function isValidSelectionIdentity(input) {
  if (!isPlainObject(input) || !hasOnlyKeys(input, ALLOWED_SELECTION_KEYS)) return false;
  return (
    isNonEmptyString(input.organizationId) &&
    isNonEmptyString(input.intakeFileId) &&
    isNonEmptyString(input.objectVersionId) &&
    typeof input.verifiedChecksum === "string" &&
    KAI_SPRINT2_P0_PATTERNS.checksumSha256.test(input.verifiedChecksum) &&
    input.verifiedChecksum.toLowerCase() === input.verifiedChecksum
  );
}

function getImmutableSnapshot(securityAssessmentEnqueue) {
  if (
    !securityAssessmentEnqueue ||
    typeof securityAssessmentEnqueue.listSecurityAssessmentEnqueueRecords !== "function"
  ) {
    return null;
  }
  const snapshot = securityAssessmentEnqueue.listSecurityAssessmentEnqueueRecords();
  return Array.isArray(snapshot) ? snapshot : null;
}

function recordMatchesSelection(record, selectionIdentity) {
  return (
    record?.organization_id === selectionIdentity.organizationId &&
    record?.intake_file_id === selectionIdentity.intakeFileId &&
    record?.object_version_id === selectionIdentity.objectVersionId &&
    record?.verified_checksum === selectionIdentity.verifiedChecksum
  );
}

function selectedTrustedFacts(record) {
  return {
    organizationId: record.organization_id,
    intakeFileId: record.intake_file_id,
    objectVersionId: record.object_version_id,
    verifiedChecksum: record.verified_checksum,
    verifiedSizeBytes: record.verified_size_bytes,
    declaredMime: record.declared_mime,
    extension: record.extension,
  };
}

function executorInputFromFacts(facts, bytes) {
  return {
    extension: facts.extension,
    declaredMime: facts.declaredMime,
    bytes,
    sha256: facts.verifiedChecksum,
  };
}

export async function executeSyntheticAssessmentFromEnqueueRecord(
  selectionIdentity = {},
  {
    securityAssessmentEnqueue,
    storageAdapter,
    signal,
    internalSecurityAssessmentExecutor,
  } = {},
) {
  if (!isValidSelectionIdentity(selectionIdentity)) {
    return uploadLifecycleFailure("validation_blocker");
  }

  const snapshot = getImmutableSnapshot(securityAssessmentEnqueue);
  if (!snapshot) return uploadLifecycleFailure("validation_blocker");
  if (snapshot.length === 0) return uploadLifecycleFailure("not_found");

  const matches = snapshot.filter((record) => recordMatchesSelection(record, selectionIdentity));
  if (matches.length === 0) return uploadLifecycleFailure("not_found");
  if (matches.length > 1) return uploadLifecycleFailure("conflict_current_state_changed");

  const facts = selectedTrustedFacts(matches[0]);
  const readResult = await readVerifiedAssessmentBytes({
    objectVersionId: facts.objectVersionId,
    expectedChecksum: facts.verifiedChecksum,
    expectedSize: facts.verifiedSizeBytes,
    storageAdapter,
    ...(signal ? { signal } : {}),
  });

  if (readResult?.ok !== true) return readResult;

  const executor = internalSecurityAssessmentExecutor || createInternalSecurityAssessmentExecutor();
  const execution = await executeInjectedInternalSecurityAssessment(
    executorInputFromFacts(facts, readResult.data.bytes),
    { internalSecurityAssessmentExecutor: executor },
  );

  if (execution?.ok !== true) return execution;
  return execution.data.result;
}

export const __testables = Object.freeze({
  executorInputFromFacts,
  isValidSelectionIdentity,
  selectedTrustedFacts,
});
