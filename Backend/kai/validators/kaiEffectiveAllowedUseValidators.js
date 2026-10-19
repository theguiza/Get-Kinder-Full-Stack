/**
 * VAL-KAI-B1A-02-003 (effective allowed-use gate): a pure predicate over the
 * prohibition reason postgresEffectiveAllowedUseResolver.js read inside the
 * caller's transaction (see sensitivityEffectiveAllowedUseProhibition for the
 * precedence). Like VAL-KAI-B1A-02-001/002 it is an implementation key, not
 * quoted from a governing source.
 *
 * A prohibited file keeps `blocking_reason: "allowed_use_not_allowed"`, the
 * reason P2-02/P2-04 and the source-preparation continuation already return,
 * and names its basis in the evidence. Metadata only: no file, profile, or
 * decision content.
 */

export const EFFECTIVE_ALLOWED_USE_VALIDATOR_KEY = "VAL-KAI-B1A-02-003";

const PROHIBITION_OUTCOMES = Object.freeze({
  reviewed_allowed_use_not_allowed: { code: "validation_blocker", blockingReason: "allowed_use_not_allowed" },
  intake_allowed_use_not_allowed: { code: "validation_blocker", blockingReason: "allowed_use_not_allowed" },
  sensitivity_decision_lineage_ambiguous: {
    code: "conflict_current_state_changed",
    blockingReason: "sensitivity_decision_lineage_ambiguous",
  },
});

const MESSAGES = Object.freeze({
  allowed_use_not_allowed: "The file's effective allowed use is not_allowed, so its content may not be used for this operation.",
  sensitivity_decision_lineage_ambiguous: "The file's sensitivity decision history has no single current decision.",
});

const REQUIRED_FIXES = Object.freeze({
  allowed_use_not_allowed: "Only a new human sensitivity and allowed-use decision can change this file's allowed use.",
  sensitivity_decision_lineage_ambiguous: "Get Kinder must resolve the file's sensitivity decision lineage.",
});

export function validateEffectiveAllowedUsePermitsOperation(prohibition, { operation, objectType, objectId = null }) {
  if (prohibition === null) return { ok: true };
  const outcome = PROHIBITION_OUTCOMES[prohibition];
  // A missing profile or claim lineage is a missing row, never a permission.
  if (!outcome) return { ok: false, code: "not_found", blockers: [] };
  return {
    ok: false,
    code: outcome.code,
    blockers: [{
      validator_key: EFFECTIVE_ALLOWED_USE_VALIDATOR_KEY,
      severity: "blocker",
      object_type: objectType,
      object_code: operation,
      object_id: objectId,
      message: MESSAGES[outcome.blockingReason],
      blocking_reason: outcome.blockingReason,
      required_fix: REQUIRED_FIXES[outcome.blockingReason],
      evidence: { basis: prohibition, bypass_allowed: false },
    }],
  };
}
