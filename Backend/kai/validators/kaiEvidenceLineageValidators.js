/**
 * KAI P2-01 deterministic evidence-lineage validator: a pure predicate over
 * already-read rows. No SQL, no database access - every row this function
 * inspects must already have been read, fresh and authoritative, by the caller
 * (the P2-01 repository, inside its own transaction). Returns `{ ok: true }` when
 * every check below passes, or `{ ok: false, code }` on the first failing check,
 * fail-closed, in the exact disclosed order below.
 *
 * `rows` shape: `{ sourceVersionRow, sourceRow, candidateRow, decisionRow,
 * profileRow, dictionaryRow }`, each either the row object or null/undefined if
 * missing.
 */

const PROFILE_CANONICAL_SHA256_PATTERN = /^[a-f0-9]{64}$/;

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

/**
 * VAL-KAI-P2-01-002 (permission predicate): this package reapplies, verbatim, the
 * exact fail-closed predicate P1-05/P1-06/P1-07/P1-08 already enforce against the
 * same `kai.intake_sensitivity_profiles` row (VAL-KAI-P1-08-002), rather than
 * inventing a new permission representation. No currently authorized package
 * changes these columns, so internal evidence processing is only ever reachable
 * when this identical predicate already holds.
 */
function satisfiesPermissionPredicate(profileRow) {
  return (
    profileRow.human_review_required === true &&
    profileRow.public_use_allowed === false &&
    profileRow.funder_use_allowed === false &&
    profileRow.llm_processing_allowed === false &&
    profileRow.product_learning_allowed === false &&
    profileRow.retention_posture === "restricted_pending_review"
  );
}

export function validateEvidenceHasSourceLineage(rows) {
  const { sourceVersionRow, sourceRow, candidateRow, decisionRow, profileRow, dictionaryRow } = rows || {};

  // 1. Any of the six rows missing.
  if (!sourceVersionRow || !sourceRow || !candidateRow || !decisionRow || !profileRow || !dictionaryRow) {
    return { ok: false, code: "not_found" };
  }

  // 2. Must be the CURRENT source_version, not a superseded one.
  if (sourceVersionRow.is_current !== true) {
    return { ok: false, code: "conflict_current_state_changed" };
  }

  // 3. The source_version must belong to the exact source row read.
  if (sourceVersionRow.source_id !== sourceRow.source_id) {
    return { ok: false, code: "conflict_current_state_changed" };
  }

  // 4. The candidate must have reached its terminal promoted status.
  if (candidateRow.candidate_status !== "promoted") {
    return { ok: false, code: "validation_blocker" };
  }

  // 5. The promotion decision must have reached its terminal promoted status.
  if (decisionRow.decision_status !== "promoted") {
    return { ok: false, code: "validation_blocker" };
  }

  // 6. The promoted decision must be bound to exactly this source/version.
  if (decisionRow.source_id !== sourceRow.source_id || decisionRow.source_version_id !== sourceVersionRow.source_version_id) {
    return { ok: false, code: "conflict_current_state_changed" };
  }

  // 7. Cross-row lineage-field equality: never trusts any single row alone.
  const organizationIds = [sourceVersionRow.organization_id, candidateRow.organization_id, profileRow.organization_id, dictionaryRow.organization_id];
  if (new Set(organizationIds).size !== 1) {
    return { ok: false, code: "conflict_current_state_changed" };
  }

  const sensitivityProfileIds = [
    sourceVersionRow.intake_sensitivity_profile_id,
    candidateRow.intake_sensitivity_profile_id,
    profileRow.intake_sensitivity_profile_id,
  ];
  if (new Set(sensitivityProfileIds).size !== 1) {
    return { ok: false, code: "conflict_current_state_changed" };
  }

  const fileProfileIds = [candidateRow.file_profile_id, profileRow.file_profile_id, dictionaryRow.file_profile_id];
  if (new Set(fileProfileIds).size !== 1) {
    return { ok: false, code: "conflict_current_state_changed" };
  }

  const dataDictionaryIds = [candidateRow.data_dictionary_id, profileRow.data_dictionary_id, dictionaryRow.data_dictionary_id];
  if (new Set(dataDictionaryIds).size !== 1) {
    return { ok: false, code: "conflict_current_state_changed" };
  }

  const canonicalShas = [
    sourceVersionRow.profile_canonical_sha256,
    candidateRow.profile_canonical_sha256,
    profileRow.profile_canonical_sha256,
    dictionaryRow.profile_canonical_sha256,
  ];
  if (new Set(canonicalShas).size !== 1) {
    return { ok: false, code: "conflict_current_state_changed" };
  }

  // 8. Checksum completeness: every one of those checksum fields must itself be a
  // well-formed sha256 hex digest, never a placeholder or malformed value.
  if (!canonicalShas.every((value) => isNonEmptyString(value) && PROFILE_CANONICAL_SHA256_PATTERN.test(value))) {
    return { ok: false, code: "validation_blocker" };
  }

  // 9. Permission-for-internal-evidence-processing gate (VAL-KAI-P2-01-002).
  if (!satisfiesPermissionPredicate(profileRow)) {
    return { ok: false, code: "validation_blocker" };
  }

  return { ok: true };
}

export const __evidenceLineageValidatorsTestables = Object.freeze({
  satisfiesPermissionPredicate,
});
