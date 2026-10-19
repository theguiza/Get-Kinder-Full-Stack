/**
 * KAI B1A-2 Phase-5 sensitivity/allowed-use human-decision vocabulary. Mirrors
 * humanReviewDecisionContract.js's style exactly: frozen exports, no side
 * effects, no database access. This is the single source of truth for the
 * outcome vocabulary, the reviewed-snapshot field vocabulary, and the
 * fail-closed permission-basis rules admitted by
 * kai.intake_sensitivity_review_decisions (see
 * migrations/kai_sprint2_b1a_02_phase5_allowed_use_decision_ledger.sql) and for
 * the P1-06 'sensitivity_review' queue projections those decisions drive (see
 * Backend/kai/dictionary/postgresSensitivityAllowedUseReviewRepository.js).
 *
 * This module grants no authority of its own and describes none beyond what a
 * committed decision row explicitly stores: no permission is ever derived from
 * queue status, role possession, audit history, a missing flag, a filename, a
 * parser output, the machine-written P1-05 profile row, or an absence of
 * detected sensitivity.
 */
export const SENSITIVITY_ALLOWED_USE_DECISION_OUTCOMES = Object.freeze([
  "reviewed",
  "needs_more_information",
]);

export const SENSITIVITY_ALLOWED_USE_TERMINAL_OUTCOMES = Object.freeze(["reviewed"]);

/**
 * The eight sensitivity presence dimensions plus the consent-basis dimension,
 * each carrying 'unknown' | 'present' | 'absent'. Named with the `reviewed_`
 * prefix so a human decision fact can never be confused with the
 * machine-written kai.intake_sensitivity_profiles column of the same name.
 * `reviewed_personal_data_status` is the decision counterpart of the P1-05
 * `pii_status` column (P1-05's own repository contract already calls this
 * dimension "personal_data" for the same reason).
 */
export const SENSITIVITY_PRESENCE_DECISION_FIELDS = Object.freeze([
  "reviewed_personal_data_status",
  "reviewed_minor_data_status",
  "reviewed_health_housing_justice_immigration_status",
  "reviewed_indigenous_governance_status",
  "reviewed_staff_notes_status",
  "reviewed_story_testimonial_status",
  "reviewed_small_cell_risk_status",
  "reviewed_financial_records_status",
  "reviewed_consent_basis_status",
]);

/** The single allowed/not_allowed/unknown dimension. */
export const SENSITIVITY_ALLOWED_USE_DECISION_FIELD = "reviewed_allowed_use_status";

/**
 * The four allowed-use permission booleans that exist in the current Phase-5
 * model (kai.intake_sensitivity_profiles.llm_processing_allowed /
 * product_learning_allowed / public_use_allowed / funder_use_allowed).
 * `human_review_required` and `retention_posture` are deliberately absent: they
 * remain pinned P1-05 facts this package never restates or overrides.
 */
export const SENSITIVITY_PERMISSION_DECISION_FIELDS = Object.freeze([
  "reviewed_llm_processing_allowed",
  "reviewed_product_learning_allowed",
  "reviewed_public_use_allowed",
  "reviewed_funder_use_allowed",
]);

export const SENSITIVITY_REVIEWED_SNAPSHOT_FIELDS = Object.freeze([
  ...SENSITIVITY_PRESENCE_DECISION_FIELDS,
  SENSITIVITY_ALLOWED_USE_DECISION_FIELD,
  ...SENSITIVITY_PERMISSION_DECISION_FIELDS,
]);

export const SENSITIVITY_PRESENCE_VALUES = Object.freeze(["unknown", "present", "absent"]);
export const SENSITIVITY_ALLOWED_USE_VALUES = Object.freeze(["unknown", "allowed", "not_allowed"]);

/**
 * The authorized decider roles for this operation only. client_admin is
 * accepted here only after the sensitivity-review authorization helper proves
 * active Get Kinder admin membership and an active binding for this tenant.
 * The ledger's role check mirrors this persisted attribution vocabulary.
 */
export const SENSITIVITY_DECISION_ALLOWED_ROLES = Object.freeze([
  "gk_admin",
  "gk_operator",
  "gk_reviewer",
  "client_admin",
]);
export const SENSITIVITY_DECISION_GK_ROLES = Object.freeze(["gk_admin", "gk_operator", "gk_reviewer"]);

export function isSensitivityAllowedUseDecisionOutcome(value) {
  return SENSITIVITY_ALLOWED_USE_DECISION_OUTCOMES.includes(value);
}

export function isSensitivityAllowedUseTerminalOutcome(outcome) {
  return SENSITIVITY_ALLOWED_USE_TERMINAL_OUTCOMES.includes(outcome);
}

/**
 * A 'reviewed' decision must carry the complete snapshot; a
 * 'needs_more_information' decision must carry none of it. There is no partial
 * form.
 */
export function sensitivityReviewedSnapshotRequired(outcome) {
  return isSensitivityAllowedUseTerminalOutcome(outcome);
}

/**
 * Queue projections: a terminal ('reviewed') decision resolves the P1-06
 * 'sensitivity_review' queue item; 'needs_more_information' leaves (or returns)
 * the item to its active, unresolved state - it never resolves a review and
 * never creates authority.
 */
export function sensitivityQueueStatusForOutcome(outcome) {
  return isSensitivityAllowedUseTerminalOutcome(outcome) ? "resolved" : "open";
}

export function sensitivityQueueReviewStatusForOutcome(outcome) {
  return isSensitivityAllowedUseTerminalOutcome(outcome) ? "resolved" : "needs_gk_review";
}

function isPresenceValue(value) {
  return SENSITIVITY_PRESENCE_VALUES.includes(value);
}

function isAllowedUseValue(value) {
  return SENSITIVITY_ALLOWED_USE_VALUES.includes(value);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * VAL-KAI-B1A-02-001: the reviewed-use basis predicate, expressed only in terms
 * of fields the current Phase-5 model already has. No new consent/governance
 * field is invented.
 *
 * A restricted use (LLM processing, product learning, funder use) may only be
 * permitted when the SAME decision independently states
 * reviewed_allowed_use_status = 'allowed'. 'unknown' and 'not_allowed' can never
 * carry a permission, and 'unknown' is never coerced upward.
 */
export function sensitivityRestrictedUseBasisEstablished(snapshot) {
  return isPlainObject(snapshot) && snapshot[SENSITIVITY_ALLOWED_USE_DECISION_FIELD] === "allowed";
}

/**
 * VAL-KAI-B1A-02-002: the public-use basis predicate. Public use is the most
 * consequential permission in this model and fails closed hardest: it requires
 * ALL of reviewed_allowed_use_status = 'allowed', a positively established
 * consent basis (reviewed_consent_basis_status = 'present'), AND a positively
 * cleared Indigenous/governance-sensitive status
 * (reviewed_indigenous_governance_status = 'absent') in the same decision. An
 * 'unknown' consent basis or an 'unknown'/'present' governance status is
 * treated as no basis, never as an implicit one - governance authorization is
 * never inferred from the absence of a separate authorization fact.
 */
export function sensitivityPublicUseBasisEstablished(snapshot) {
  return (
    sensitivityRestrictedUseBasisEstablished(snapshot)
    && snapshot.reviewed_consent_basis_status === "present"
    && snapshot.reviewed_indigenous_governance_status === "absent"
  );
}

/**
 * Validates a submitted reviewed snapshot in full. Returns
 * `{ ok: true }` or `{ ok: false, reason }` where `reason` is a stable machine
 * token. Fails closed on anything it does not positively recognize.
 */
export function validateSensitivityReviewedSnapshot(snapshot) {
  if (!isPlainObject(snapshot)) return { ok: false, reason: "reviewed_snapshot_required" };

  const keys = Object.keys(snapshot);
  if (keys.length !== SENSITIVITY_REVIEWED_SNAPSHOT_FIELDS.length) {
    return { ok: false, reason: "reviewed_snapshot_incomplete" };
  }
  for (const key of keys) {
    if (!SENSITIVITY_REVIEWED_SNAPSHOT_FIELDS.includes(key)) {
      return { ok: false, reason: "reviewed_snapshot_unknown_field" };
    }
  }

  for (const field of SENSITIVITY_PRESENCE_DECISION_FIELDS) {
    if (!isPresenceValue(snapshot[field])) return { ok: false, reason: "invalid_presence_dimension" };
  }
  if (!isAllowedUseValue(snapshot[SENSITIVITY_ALLOWED_USE_DECISION_FIELD])) {
    return { ok: false, reason: "invalid_allowed_use_status" };
  }
  for (const field of SENSITIVITY_PERMISSION_DECISION_FIELDS) {
    if (typeof snapshot[field] !== "boolean") return { ok: false, reason: "invalid_permission_flag" };
  }

  if (snapshot.reviewed_llm_processing_allowed === true && !sensitivityRestrictedUseBasisEstablished(snapshot)) {
    return { ok: false, reason: "llm_processing_basis_not_established" };
  }
  if (snapshot.reviewed_product_learning_allowed === true && !sensitivityRestrictedUseBasisEstablished(snapshot)) {
    return { ok: false, reason: "product_learning_basis_not_established" };
  }
  if (snapshot.reviewed_funder_use_allowed === true && !sensitivityRestrictedUseBasisEstablished(snapshot)) {
    return { ok: false, reason: "funder_use_basis_not_established" };
  }
  if (snapshot.reviewed_public_use_allowed === true && !sensitivityPublicUseBasisEstablished(snapshot)) {
    return { ok: false, reason: "public_use_basis_not_established" };
  }

  return { ok: true, reason: null };
}

/**
 * The fail-closed authority projection of a decision-lineage head. This is the
 * ONLY authorized way to read permission out of this ledger:
 *
 *   - no head at all                  -> nothing is permitted;
 *   - a needs_more_information head   -> nothing is permitted (a request for more
 *                                        information creates no authority);
 *   - a superseded row                -> never reaches here (only the head, the row
 *                                        with no successor, is ever passed in);
 *   - a terminal 'reviewed' head      -> exactly and only the booleans stored true
 *                                        on that row are permitted. Nothing is
 *                                        inferred beyond what is stored.
 *
 * `review_complete` says only that a classification decision has been recorded -
 * never that anything is permitted.
 */
export function sensitivityAuthorityFromCurrentDecision(currentHead) {
  const denied = Object.freeze({
    review_complete: false,
    llm_processing_allowed: false,
    product_learning_allowed: false,
    public_use_allowed: false,
    funder_use_allowed: false,
  });

  if (!isPlainObject(currentHead)) return denied;
  if (!isSensitivityAllowedUseTerminalOutcome(currentHead.decision_outcome)) return denied;

  return Object.freeze({
    review_complete: true,
    llm_processing_allowed: currentHead.reviewed_llm_processing_allowed === true,
    product_learning_allowed: currentHead.reviewed_product_learning_allowed === true,
    public_use_allowed: currentHead.reviewed_public_use_allowed === true,
    funder_use_allowed: currentHead.reviewed_funder_use_allowed === true,
  });
}

/**
 * VAL-KAI-B1A-02-003: the effective allowed-use prohibition for one
 * sensitivity profile. It gates every operation that uses a file's content
 * beyond its metadata (P1-07 source preparation, P1-08 promotion, P2-01
 * extraction, P2-02 assessment, P2-03 claim proposal, P2-04 follow-ups, and
 * P2-06 eligibility, which generation re-evaluates). Reading, reviewing, or
 * re-deciding the file is never gated by it. AI processing additionally
 * applies sensitivityEffectiveAiProcessingProhibition below.
 *
 * A prohibition is never lifted by anything weaker than its source, and
 * nothing here grants a permission:
 *   - an ambiguous decision lineage has no authoritative decision, so it
 *     fails closed ('sensitivity_decision_lineage_ambiguous');
 *   - the current lineage head, when it is a terminal 'reviewed' decision,
 *     is the authoritative human allowed-use fact; 'not_allowed' prohibits
 *     ('reviewed_allowed_use_not_allowed'). A superseded decision and a
 *     'needs_more_information' head state no allowed use;
 *   - the committed P1-05 allowed_use_status 'not_allowed' also prohibits
 *     ('intake_allowed_use_not_allowed'), even under a reviewed 'allowed'
 *     head. That is the restriction P2-02/P2-04 already applied; whether a
 *     human decision may lift it is not decided by any governing source, so
 *     the safer rule is kept (P1-05 itself only writes the 'unknown' default).
 * 'unknown' and 'allowed' prohibit nothing (Operating Model section 7.1:
 * normal processing within the authorized purpose needs no per-step consent).
 * Returns null when nothing prohibits, otherwise the reason token.
 */
export function sensitivityEffectiveAllowedUseProhibition({ profileAllowedUseStatus, currentHead, lineageAmbiguous }) {
  if (lineageAmbiguous === true) return "sensitivity_decision_lineage_ambiguous";
  if (
    isPlainObject(currentHead)
    && isSensitivityAllowedUseTerminalOutcome(currentHead.decision_outcome)
    && currentHead[SENSITIVITY_ALLOWED_USE_DECISION_FIELD] === "not_allowed"
  ) {
    return "reviewed_allowed_use_not_allowed";
  }
  if (profileAllowedUseStatus === "not_allowed") return "intake_allowed_use_not_allowed";
  return null;
}

/**
 * VAL-KAI-B1A-02-004: the effective AI-processing prohibition for one
 * sensitivity profile. It gates only the operations that send a file's
 * content to an AI provider (generated-content drafting, impact evaluation);
 * an AI-only restriction never gates P1-07..P2-06, which keep
 * sensitivityEffectiveAllowedUseProhibition alone.
 *
 * The effective allowed-use prohibition applies first, unchanged. Then:
 *   - no human decision at all: nothing more is prohibited. The P1-05/P2-01/
 *     P2-03 llm_processing_allowed columns are CHECK-pinned false for every
 *     row, so they state no classification, and are never read as one;
 *     Operating Model 7.1/8.2 cover AI processing within the authorized
 *     purpose without a per-step decision;
 *   - a terminal 'reviewed' head is the authoritative human AI fact, read
 *     only through sensitivityAuthorityFromCurrentDecision: only a stored
 *     reviewed_llm_processing_allowed = true permits it
 *     ('reviewed_llm_processing_not_allowed' otherwise);
 *   - a 'needs_more_information' head reopens the review and states no
 *     permission, so AI processing is unresolved
 *     ('sensitivity_ai_processing_unresolved'); it never lifts an earlier
 *     prohibition.
 * Returns null when nothing prohibits, otherwise the reason token.
 */
export function sensitivityEffectiveAiProcessingProhibition(facts) {
  const allowedUseProhibition = sensitivityEffectiveAllowedUseProhibition(facts);
  if (allowedUseProhibition !== null) return allowedUseProhibition;
  const { currentHead } = facts;
  if (!isPlainObject(currentHead)) return null;
  if (!isSensitivityAllowedUseTerminalOutcome(currentHead.decision_outcome)) return "sensitivity_ai_processing_unresolved";
  return sensitivityAuthorityFromCurrentDecision(currentHead).llm_processing_allowed ? null : "reviewed_llm_processing_not_allowed";
}

export const __sensitivityAllowedUseDecisionContractTestables = Object.freeze({
  SENSITIVITY_ALLOWED_USE_DECISION_OUTCOMES,
  SENSITIVITY_REVIEWED_SNAPSHOT_FIELDS,
  isPresenceValue,
  isAllowedUseValue,
});
