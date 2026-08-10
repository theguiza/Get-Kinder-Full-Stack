import { __testables as boundedFileSecurityAssessorTestables } from "./boundedFileSecurityAssessor.js";
import { executeSyntheticAssessmentFromEnqueueRecord } from "./syntheticAssessmentComposition.js";

export const C2_UNCLASSIFIED_OUTCOME = "C2_UNCLASSIFIED_OUTCOME";
const { ASSESSOR_FAILED_CATEGORY_CLASSIFICATIONS } = boundedFileSecurityAssessorTestables;

const POLICY_ELIGIBLE_FAILED_CATEGORIES = Object.freeze(
  new Set(
    Object.entries(ASSESSOR_FAILED_CATEGORY_CLASSIFICATIONS)
      .filter(([, classification]) => classification.policyFailureEligible === true)
      .map(([category]) => category),
  ),
);

const ALLOWED_SELECTION_KEYS = Object.freeze(new Set([
  "organizationId",
  "intakeFileId",
  "objectVersionId",
  "verifiedChecksum",
]));

function c2UnclassifiedOutcome(result) {
  return {
    ok: false,
    data: null,
    error: {
      code: C2_UNCLASSIFIED_OUTCOME,
      status: 422,
      result,
    },
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, allowedKeys) {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function uploadLifecycleFailure(code, status) {
  return {
    ok: false,
    data: null,
    error: { code, status },
  };
}

function isValidSelectionIdentity(input) {
  return isPlainObject(input) && hasOnlyKeys(input, ALLOWED_SELECTION_KEYS);
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

function selectedConfirmedFacts(record) {
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

function selectStoredRecord(selectionIdentity, securityAssessmentEnqueue) {
  if (!isValidSelectionIdentity(selectionIdentity)) {
    return uploadLifecycleFailure("validation_blocker", 422);
  }

  const snapshot = getImmutableSnapshot(securityAssessmentEnqueue);
  if (!snapshot) return uploadLifecycleFailure("validation_blocker", 422);
  if (snapshot.length === 0) return uploadLifecycleFailure("not_found", 404);

  const matches = snapshot.filter((record) => recordMatchesSelection(record, selectionIdentity));
  if (matches.length === 0) return uploadLifecycleFailure("not_found", 404);
  if (matches.length > 1) return uploadLifecycleFailure("conflict_current_state_changed", 409);

  return {
    ok: true,
    data: {
      record: matches[0],
      confirmedFileFacts: selectedConfirmedFacts(matches[0]),
    },
    error: null,
  };
}

function policyDecisionOutcomeForAssessmentResult(result) {
  if (
    isPlainObject(result) &&
    result.ok === false &&
    result.integrity_failure?.type === "assessment_read_integrity_failure"
  ) {
    return null;
  }
  if (isPlainObject(result) && Object.keys(result).length === 1 && result.policy === "pass") {
    return "passed";
  }
  if (
    isPlainObject(result) &&
    Object.keys(result).length === 2 &&
    result.policy === "block" &&
    typeof result.category === "string"
  ) {
    return "blocked";
  }
  if (
    isPlainObject(result) &&
    Object.keys(result).length === 2 &&
    result.status === "failed" &&
    typeof result.category === "string"
  ) {
    if (POLICY_ELIGIBLE_FAILED_CATEGORIES.has(result.category)) return "failed";
    if (Object.hasOwn(ASSESSOR_FAILED_CATEGORY_CLASSIFICATIONS, result.category)) return null;
    return undefined;
  }
  return undefined;
}

export async function executeSyntheticAssessmentPolicyDecisionFromEnqueueRecord(
  selectionIdentity = {},
  {
    securityAssessmentEnqueue,
    storageAdapter,
    gcsProvider,
    signal,
    internalSecurityAssessmentExecutor,
    uploadLifecycleRepository,
    getIntakeFileMetadata,
    metadataOnlyAudit,
    now,
    executeAssessmentFromEnqueueRecord = executeSyntheticAssessmentFromEnqueueRecord,
  } = {},
) {
  const selected = selectStoredRecord(selectionIdentity, securityAssessmentEnqueue);
  if (selected.ok !== true) return selected;

  const assessmentResult = await executeAssessmentFromEnqueueRecord(selectionIdentity, {
    securityAssessmentEnqueue,
    storageAdapter,
    ...(gcsProvider ? { gcsProvider } : {}),
    ...(uploadLifecycleRepository ? { uploadLifecycleRepository } : {}),
    ...(getIntakeFileMetadata ? { getIntakeFileMetadata } : {}),
    ...(signal ? { signal } : {}),
    ...(internalSecurityAssessmentExecutor ? { internalSecurityAssessmentExecutor } : {}),
  });

  const policyDecisionOutcome = policyDecisionOutcomeForAssessmentResult(assessmentResult);
  if (policyDecisionOutcome === undefined) return c2UnclassifiedOutcome(assessmentResult);
  if (policyDecisionOutcome === null) {
    return {
      ok: true,
      data: {
        policyDecisionInvoked: false,
        assessmentResult,
      },
      error: null,
    };
  }

  if (!uploadLifecycleRepository || typeof uploadLifecycleRepository.compareAndSetPolicyDecision !== "function") {
    return uploadLifecycleFailure("validation_blocker", 422);
  }

  return uploadLifecycleRepository.compareAndSetPolicyDecision({
    confirmedFileFacts: selected.data.confirmedFileFacts,
    expectedFilePolicyStatus: "pending",
    policyDecisionOutcome,
    sanitizedResult: assessmentResult,
    metadataOnlyAudit,
    now,
  });
}

export const __testables = Object.freeze({
  POLICY_ELIGIBLE_FAILED_CATEGORIES,
  policyDecisionOutcomeForAssessmentResult,
  selectStoredRecord,
});
