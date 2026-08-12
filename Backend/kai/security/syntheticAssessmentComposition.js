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

function isGcsExactGenerationProvider(provider) {
  return (
    provider &&
    provider.enabled === true &&
    typeof provider.openExactGenerationReadStream === "function"
  );
}

function isGcsBindingRepository(repository) {
  return (
    repository &&
    typeof repository.resolveGcsGenerationBinding === "function"
  );
}

function createBoundGcsAssessmentStorageAdapter({
  facts,
  gcsProvider,
  uploadLifecycleRepository,
  getIntakeFileMetadata,
}) {
  if (
    !isGcsExactGenerationProvider(gcsProvider) ||
    !isGcsBindingRepository(uploadLifecycleRepository) ||
    typeof getIntakeFileMetadata !== "function"
  ) {
    return null;
  }

  return {
    async openObjectVersionReadStream({ objectVersionId, signal } = {}) {
      if (objectVersionId !== facts.objectVersionId) return { ok: false };

      const binding = await uploadLifecycleRepository.resolveGcsGenerationBinding({
        organizationId: facts.organizationId,
        intakeFileId: facts.intakeFileId,
      });
      if (
        binding?.ok !== true ||
        binding.data?.object_version_id !== facts.objectVersionId ||
        typeof binding.data?.gcs_generation !== "string"
      ) {
        return { ok: false };
      }

      const metadata = await getIntakeFileMetadata(facts.organizationId, facts.intakeFileId);
      if (
        metadata?.organization_id !== facts.organizationId ||
        metadata?.intake_file_id !== facts.intakeFileId ||
        metadata?.storage_provider !== "gcs" ||
        typeof metadata?.storage_object_key !== "string" ||
        metadata.storage_object_key.length === 0
      ) {
        return { ok: false };
      }

      const opened = await gcsProvider.openExactGenerationReadStream({
        objectKey: metadata.storage_object_key,
        gcsGeneration: binding.data.gcs_generation,
        ...(signal ? { signal } : {}),
      });
      if (opened?.ok !== true) return opened;
      return {
        ok: true,
        data: {
          object_version_id: facts.objectVersionId,
          size_bytes: opened.data?.size_bytes,
          byte_source: opened.data?.byte_source,
        },
      };
    },
  };
}

export async function executeSyntheticAssessmentFromEnqueueRecord(
  selectionIdentity = {},
  {
    securityAssessmentEnqueue,
    storageAdapter,
    gcsProvider,
    gcsParserReaderProvider,
    uploadLifecycleRepository,
    getIntakeFileMetadata,
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
  const exactGenerationReadProvider = gcsParserReaderProvider || gcsProvider;
  const effectiveStorageAdapter = storageAdapter || createBoundGcsAssessmentStorageAdapter({
    facts,
    gcsProvider: exactGenerationReadProvider,
    uploadLifecycleRepository,
    getIntakeFileMetadata,
  });
  const readResult = await readVerifiedAssessmentBytes({
    objectVersionId: facts.objectVersionId,
    expectedChecksum: facts.verifiedChecksum,
    expectedSize: facts.verifiedSizeBytes,
    storageAdapter: effectiveStorageAdapter,
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
  createBoundGcsAssessmentStorageAdapter,
  executorInputFromFacts,
  isValidSelectionIdentity,
  selectedTrustedFacts,
});
