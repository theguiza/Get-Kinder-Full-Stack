/**
 * Shared declared-checksum duplicate resolution for intake-file reservations.
 *
 * One classification serves every supported file type: nothing here reads
 * the file extension, MIME type, or parser. File-type controls stay where
 * they already run (reservation MIME/extension pairing, confirm-time byte
 * verification, the post-confirm security assessment, and the parser), and a
 * new intake version passes through all of them again.
 *
 * Contract basis: Backend/Storage/Validator Implementation Contract Section 20
 * ("Intake file checksum duplicate") and the repository contract's
 * organization-scoped preliminary duplicate rule. VAL-IDEMP-006 still blocks
 * every reservation whose declared checksum matches an existing
 * organization record; this module only decides which follow-up actions the
 * backend can actually execute for that match.
 */

export const DUPLICATE_RESOLUTION_CONTRACT = "kai_intake_duplicate_resolution_v1";

export const DUPLICATE_RESOLUTION_ACTIONS = Object.freeze({
  useExistingFile: "use_existing_file",
  continueUpload: "continue_upload",
  uploadNewIntakeVersion: "upload_new_intake_version",
  cancel: "cancel",
});

export const DUPLICATE_STATUSES = Object.freeze({
  inBatch: "duplicate_in_batch",
  inOtherBatch: "duplicate_in_other_batch",
  inOtherEngagement: "duplicate_in_other_engagement",
});

export const EXISTING_FILE_STATES = Object.freeze({
  confirmed: "confirmed",
  uploadInProgress: "upload_in_progress",
  uploadNotCompleted: "upload_not_completed",
  blockedByPolicy: "blocked_by_policy",
  securityCheckFailed: "security_check_failed",
  unknown: "unknown",
});

export const DUPLICATE_RESTRICTION_CODES = Object.freeze({
  blockedByPolicy: "blocked_by_policy",
  securityCheckFailed: "security_check_failed",
  uploadInProgress: "upload_in_progress",
  declaredSizeMismatch: "declared_size_mismatch",
  stateUnknown: "state_unknown",
});

const INCOMPLETE_UPLOAD_STATES = new Set(["reserved", "upload_started", "uploaded_unconfirmed"]);
const USABLE_CONFIRMED_POLICY_STATUSES = new Set(["pending", "passed"]);

function toTime(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" && value.length > 0) return new Date(value).getTime();
  return Number.NaN;
}

function sameId(left, right) {
  return typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();
}

/**
 * Maps one existing intake-file row to the repository's actual status
 * semantics (the same split the client evidence pipeline uses):
 * policy block, security check that failed to run, upload that never
 * completed, upload still in progress, or a confirmed file.
 */
export function classifyExistingIntakeFileState(row, nowMs) {
  if (!row || typeof row !== "object") return EXISTING_FILE_STATES.unknown;
  if (row.upload_state === "policy_blocked" || row.file_policy_status === "blocked") {
    return EXISTING_FILE_STATES.blockedByPolicy;
  }
  if (row.file_policy_status === "failed") return EXISTING_FILE_STATES.securityCheckFailed;
  if (row.upload_state === "abandoned" || row.upload_state === "expired") {
    return EXISTING_FILE_STATES.uploadNotCompleted;
  }
  if (INCOMPLETE_UPLOAD_STATES.has(row.upload_state)) {
    const expiresAt = toTime(row.upload_expires_at);
    if (!Number.isFinite(expiresAt) || !Number.isFinite(nowMs)) return EXISTING_FILE_STATES.unknown;
    // The lifecycle trigger denies every non-expiry transition at or after
    // upload_expires_at, so an unexpired-looking row past its expiry can
    // never be continued.
    return expiresAt > nowMs ? EXISTING_FILE_STATES.uploadInProgress : EXISTING_FILE_STATES.uploadNotCompleted;
  }
  if (row.upload_state === "confirmed" && USABLE_CONFIRMED_POLICY_STATUSES.has(row.file_policy_status)) {
    return EXISTING_FILE_STATES.confirmed;
  }
  return EXISTING_FILE_STATES.unknown;
}

// Within the requesting batch an unfinished upload comes first: it must be
// completed (or lapse) before anything else happens to that content there,
// which also makes a second, concurrent new-version request see the first
// one and be refused. Elsewhere the confirmed record is the one to show.
const SAME_BATCH_SUBJECT_PREFERENCE = [
  EXISTING_FILE_STATES.uploadInProgress,
  EXISTING_FILE_STATES.confirmed,
];
const OTHER_BATCH_SUBJECT_PREFERENCE = [
  EXISTING_FILE_STATES.confirmed,
  EXISTING_FILE_STATES.uploadInProgress,
];

function preferredSubject(rows, nowMs, preference) {
  for (const state of preference) {
    const match = rows.find((row) => classifyExistingIntakeFileState(row, nowMs) === state);
    if (match) return match;
  }
  return rows[0] || null;
}

function declaredSizeMatches(row, declaredSizeBytes) {
  if (!Number.isSafeInteger(declaredSizeBytes) || declaredSizeBytes <= 0) return true;
  const existing = typeof row.file_size_bytes === "string" ? Number(row.file_size_bytes) : row.file_size_bytes;
  if (!Number.isSafeInteger(existing) || existing <= 0) return true;
  return existing === declaredSizeBytes;
}

/**
 * Classifies a declared-checksum match for one reservation request.
 *
 * `matches` are this organization's intake-file rows with the same declared
 * checksum (the repository query is organization-scoped; rows from any other
 * organization are dropped here as a second guard, so another tenant's file
 * can never shape the result). Returns null when nothing matches.
 */
export function classifyIntakeFileDuplicate({
  matches,
  organizationId,
  intakeBatchId,
  engagementId,
  safeFilename,
  fileExtension,
  declaredSizeBytes,
  now,
} = {}) {
  const rows = (Array.isArray(matches) ? matches : [])
    .filter((row) => row && sameId(row.organization_id, organizationId) && typeof row.intake_file_id === "string")
    .sort((left, right) => toTime(right.created_at) - toTime(left.created_at));
  if (rows.length === 0) return null;

  const nowMs = toTime(now);
  const sameBatchRows = rows.filter((row) => sameId(row.intake_batch_id, intakeBatchId));
  const sameEngagementRows = rows.filter((row) => sameId(row.engagement_id, engagementId));

  let duplicateStatus;
  let subject;
  if (sameBatchRows.length > 0) {
    duplicateStatus = DUPLICATE_STATUSES.inBatch;
    subject = preferredSubject(sameBatchRows, nowMs, SAME_BATCH_SUBJECT_PREFERENCE);
  } else if (sameEngagementRows.length > 0) {
    duplicateStatus = DUPLICATE_STATUSES.inOtherBatch;
    subject = preferredSubject(sameEngagementRows, nowMs, OTHER_BATCH_SUBJECT_PREFERENCE);
  } else {
    duplicateStatus = DUPLICATE_STATUSES.inOtherEngagement;
    subject = preferredSubject(rows, nowMs, OTHER_BATCH_SUBJECT_PREFERENCE);
  }

  // Identical bytes that any record in this organization was blocked for, or
  // whose security check failed to run, stay unavailable: no override turns
  // them into a usable or re-attemptable file.
  const blockedRow = rows.find((row) => classifyExistingIntakeFileState(row, nowMs) === EXISTING_FILE_STATES.blockedByPolicy);
  const securityFailedRow = rows.find(
    (row) => classifyExistingIntakeFileState(row, nowMs) === EXISTING_FILE_STATES.securityCheckFailed,
  );
  if (blockedRow) subject = blockedRow;
  else if (securityFailedRow) subject = securityFailedRow;

  const existingState = classifyExistingIntakeFileState(subject, nowMs);
  const sameBatch = duplicateStatus === DUPLICATE_STATUSES.inBatch;

  let availableActions = [];
  let restrictionCode = null;
  if (blockedRow) {
    restrictionCode = DUPLICATE_RESTRICTION_CODES.blockedByPolicy;
  } else if (securityFailedRow) {
    restrictionCode = DUPLICATE_RESTRICTION_CODES.securityCheckFailed;
  } else if (!declaredSizeMatches(subject, declaredSizeBytes)) {
    // One SHA-256 digest cannot describe two sizes: the declaration does not
    // describe the selected bytes, so nothing may be reused on its strength.
    restrictionCode = DUPLICATE_RESTRICTION_CODES.declaredSizeMismatch;
  } else if (existingState === EXISTING_FILE_STATES.unknown) {
    restrictionCode = DUPLICATE_RESTRICTION_CODES.stateUnknown;
  } else if (sameBatch && existingState === EXISTING_FILE_STATES.confirmed) {
    availableActions = [
      DUPLICATE_RESOLUTION_ACTIONS.useExistingFile,
      DUPLICATE_RESOLUTION_ACTIONS.uploadNewIntakeVersion,
    ];
  } else if (sameBatch && existingState === EXISTING_FILE_STATES.uploadInProgress) {
    availableActions = [DUPLICATE_RESOLUTION_ACTIONS.continueUpload];
    restrictionCode = DUPLICATE_RESTRICTION_CODES.uploadInProgress;
  } else {
    // Same batch after an upload that never completed, or a different
    // batch/engagement: only an explicit new intake record is executable.
    availableActions = [DUPLICATE_RESOLUTION_ACTIONS.uploadNewIntakeVersion];
  }

  return {
    duplicateStatus,
    subject,
    existingState,
    availableActions,
    restrictionCode,
    sameFilename: typeof safeFilename === "string" && subject.safe_filename === safeFilename,
    sameFileExtension:
      typeof fileExtension === "string"
      && typeof subject.file_extension === "string"
      && subject.file_extension.toLowerCase() === fileExtension.trim().toLowerCase(),
  };
}

/**
 * Lineage for an explicitly requested new intake record. The original is the
 * organization's first-received record for this content (the one row the
 * declared-checksum unique index still covers); a same-batch new version also
 * supersedes the record the actor chose to replace. A different-batch or
 * different-engagement record is a duplicate candidate only: it links to the
 * original and supersedes nothing.
 */
export function newIntakeVersionLineage(classification, originalIntakeFileId) {
  return {
    originalIntakeFileId,
    supersedesIntakeFileId:
      classification.duplicateStatus === DUPLICATE_STATUSES.inBatch ? classification.subject.intake_file_id : null,
  };
}

/** Restricted response projection: authorized same-organization facts only. */
export function duplicateResolutionResponse(classification) {
  const subject = classification.subject;
  return {
    contract: DUPLICATE_RESOLUTION_CONTRACT,
    duplicate_status: classification.duplicateStatus,
    existing_file: {
      intake_file_id: subject.intake_file_id,
      intake_batch_id: subject.intake_batch_id,
      engagement_id: subject.engagement_id || null,
      safe_filename: subject.safe_filename,
      file_extension: subject.file_extension || null,
      upload_state: subject.upload_state,
      file_policy_status: subject.file_policy_status,
      processing_status: subject.processing_status,
      existing_state: classification.existingState,
    },
    same_filename: classification.sameFilename,
    same_file_extension: classification.sameFileExtension,
    available_actions: [...classification.availableActions, DUPLICATE_RESOLUTION_ACTIONS.cancel],
    restriction_code: classification.restrictionCode,
  };
}

/** Success warning for an explicitly created new intake record. */
export function newIntakeVersionWarning(duplicateStatus) {
  return duplicateStatus === DUPLICATE_STATUSES.inBatch
    ? { code: "duplicate_in_batch", message: "A new intake version of a file already in this batch was created." }
    : { code: "duplicate_candidate_recorded", message: "A new intake record linked to an existing identical file was created." };
}
