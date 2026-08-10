import { createValidatorResult } from "./types.js";

const VALIDATOR_KEY = "VAL-EXP-001";
const OBJECT_TYPE = "generated_content_draft";
const OBJECT_CODE = "export_manifest_eligibility";
const BLOCKING_REASON = "export_manifest_not_eligible";

const INPUT_KEYS = new Set([
  "generatedContentDraftId",
  "requestedExportAudience",
  "draftAudience",
  "draftIsStillDraft",
  "reviewIsResolved",
  "currentUseEligible",
  "finalGate",
  "affirmativeHumanExportAuthority",
]);

function hasExactKeys(value, allowed) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === allowed.size
    && Object.keys(value).every((key) => allowed.has(key));
}

export function validateExportManifestEligibility(input) {
  if (!hasExactKeys(input, INPUT_KEYS)) {
    throw new TypeError("VAL-EXP-001 requires the exact export-manifest-eligibility input contract.");
  }

  const {
    generatedContentDraftId,
    requestedExportAudience,
    draftAudience,
    draftIsStillDraft,
    reviewIsResolved,
    currentUseEligible,
    finalGate,
    affirmativeHumanExportAuthority,
  } = input;

  const failedGates = [];
  if (finalGate === true && draftIsStillDraft === true) failedGates.push("final_gate_true_while_draft");
  if (draftIsStillDraft === true) failedGates.push("generated_content_still_draft");
  if (reviewIsResolved === false) failedGates.push("generated_content_review_unresolved");
  if (currentUseEligible === false) failedGates.push("current_use_ineligible");
  if (requestedExportAudience !== draftAudience) failedGates.push("export_audience_mismatch");
  if (affirmativeHumanExportAuthority === false) failedGates.push("affirmative_human_export_authority_absent");
  if (finalGate === false) failedGates.push("final_export_gate_absent");

  if (failedGates.length === 0) {
    return createValidatorResult({
      validator_key: VALIDATOR_KEY,
      severity: "pass",
      object_type: OBJECT_TYPE,
      object_code: OBJECT_CODE,
      object_id: generatedContentDraftId,
      message: "Export manifest eligibility gates passed.",
      evidence: {},
    });
  }

  return createValidatorResult({
    validator_key: VALIDATOR_KEY,
    severity: "blocker",
    object_type: OBJECT_TYPE,
    object_code: OBJECT_CODE,
    object_id: generatedContentDraftId,
    message: "Export manifest eligibility gates failed.",
    blocking_reason: BLOCKING_REASON,
    evidence: { failed_gates: failedGates },
  });
}

export const __exportManifestEligibilityValidatorContract = Object.freeze({
  VALIDATOR_KEY,
  OBJECT_TYPE,
  OBJECT_CODE,
  BLOCKING_REASON,
});
