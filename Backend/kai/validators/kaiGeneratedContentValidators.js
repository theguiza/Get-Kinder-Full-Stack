import { MEASUREMENT_DISCLOSURE_RULES, isMeasurementLimitationCode } from "./kaiSourceMeasurementValidators.js";

const VALIDATOR_KEYS = Object.freeze([
  "VAL-GEN-001",
  "VAL-GEN-002",
  "VAL-GEN-003",
  "VAL-GEN-004",
  "VAL-GEN-005",
  "VAL-GEN-006",
  "VAL-GEN-007",
  "VAL-GEN-008",
  "VAL-GEN-009",
]);

// Each current limitation code carries the pattern VAL-GEN-009 requires and
// the server-authored statement that satisfies it, kept side by side so the
// disclosure the server writes and the disclosure the validator accepts
// cannot drift. Statements carry no numbers or causal wording (VAL-GEN-004).
const CURRENT_LIMITATION_DISCLOSURE = Object.freeze({
  evidence_gap_unresolved: Object.freeze({
    pattern: /\bevidence\b.*\b(gap|unresolved|incomplete)\b/i,
    statement: () => "An evidence gap is unresolved.",
  }),
  claim_review_unresolved: Object.freeze({
    pattern: /\bclaim review\b.*\b(unresolved|incomplete|pending|under review)\b/i,
    statement: () => "Claim review is unresolved.",
  }),
  claim_review_missing: Object.freeze({
    pattern: /\bclaim(s)?\b.*\b(needs? review|requires? review|awaiting review|not reviewed)\b/i,
    statement: () => "The claim requires review.",
  }),
  evidence_review_unresolved: Object.freeze({
    pattern: /\bevidence review\b.*\b(unresolved|incomplete|pending|under review)\b/i,
    statement: () => "Evidence review is unresolved.",
  }),
  support_strength_unassessed: Object.freeze({
    pattern: /\b(support|claim strength)\b.*\b(not yet assessed|not yet been assessed|not been assessed|unassessed|unverified)\b/i,
    statement: () => "Support strength has not yet been assessed.",
  }),
  coverage_dimension_unresolved: Object.freeze({
    pattern: /\bcoverage\b.*\b(gap|unresolved|incomplete|not cleared)\b/i,
    statement: () => "A coverage dimension is unresolved.",
  }),
  client_followup_unresolved: Object.freeze({
    pattern: /\bclient follow[- ]?ups?\b.*\b(unanswered|unresolved|pending|open)\b/i,
    statement: () => "A client follow-up is unanswered.",
  }),
  potential_conflict_review_unresolved: Object.freeze({
    pattern: /\bpotential conflict\b.*\b(unresolved|under review|pending)\b/i,
    statement: () => "A potential conflict is under review.",
  }),
  claim_not_approved_for_requested_audience: Object.freeze({
    pattern: /\bclaim\b.*\bnot approved for (the )?(internal|funder|public)\b/i,
    statement: (requestedAudience) => `The claim is not approved for the ${requestedAudience} audience.`,
  }),
  audience_gate_closed: Object.freeze({
    pattern: /\baudience\b.*\b(gate closed|not authorized|not approved)\b/i,
    statement: () => "The audience gate is closed: this audience is not authorized for current use.",
  }),
  requirement_authority_absent: Object.freeze({
    pattern: /\b(requirement|authority)\b.*\b(absent|not established|not linked)\b/i,
    statement: () => "Requirement authority is not established.",
  }),
  traceability_incomplete: Object.freeze({
    pattern: /\btraceability\b.*\b(incomplete|not established)\b/i,
    statement: () => "Traceability is incomplete.",
  }),
});
const PROVISIONAL_INTERNAL_DRAFT_LABEL = /^\s*provisional internal draft\b/i;
const PROVIDER_PROVISIONAL_LABEL_PREFIX = /^\s*provisional internal draft\b[\s:.,;\-–—]*/i;

const NUMERIC_LITERAL_PATTERN = /(?<![A-Za-z0-9_])[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:%|\b)/g;
const CAUSAL_PATTERN = /\b(causes?|caused|causing|because|due to|drives?|driven by|leads? to|led to|results? in|resulted in|attribut(?:e|ed|able) to|impact(?:s|ed)?|increases?|decreases?|reduces?|improves?|worsens?)\b/gi;

function pass(validatorKey, evidence = {}) {
  return Object.freeze({ validator_key: validatorKey, severity: "pass", evidence: Object.freeze(evidence) });
}

function blocker(validatorKey, blockingReason, evidence = {}) {
  return Object.freeze({
    validator_key: validatorKey,
    severity: "blocker",
    blocking_reason: blockingReason,
    object_type: "generated_content_draft",
    evidence: Object.freeze(evidence),
  });
}

function literals(text, pattern) {
  return [...String(text || "").matchAll(pattern)].map((match) => match[0]);
}

function unique(values) {
  return [...new Set(values)];
}

function generationClaimsById(generationClaims) {
  return new Map(generationClaims.map((claim) => [claim.claimId, claim]));
}

function requestedCitationSet(generationClaims) {
  return new Set(generationClaims.map((claim) => `${claim.claimId}:${claim.evidenceItemId}`));
}

// Package 14-05: `generationClaims` is the set of governed claims freshly
// traceability-revalidated for THIS generation transaction. It is not, and
// must not be treated as, "every claim eligible for the requested audience" —
// a governed claim may participate in INTERNAL generation while its current
// audience/use eligibility (claim.currentEligible, if present) is false.
// Use/export eligibility remains a separate, stricter downstream fact.
export function validateGeneratedContentDraft({
  requestedAudience,
  generationClaims,
  blocks,
  draftAudience = requestedAudience,
  contentType = null,
  authoritativeReadiness = null,
} = {}) {
  const claimById = generationClaimsById(generationClaims || []);
  const citationSet = requestedCitationSet(generationClaims || []);
  const results = [];

  // VAL-GEN-001 now proves truthful generation revalidation, not audience
  // eligibility: every supplied claim must have been freshly
  // traceability-revalidated for this generation transaction and belong to
  // the requested generation context (requestedAudience match).
  const allRevalidated = (generationClaims || []).length > 0
    && (generationClaims || []).every(
      (claim) => claim.revalidatedForGeneration === true && claim.requestedAudience === requestedAudience,
    );
  results.push(
    allRevalidated
      ? pass("VAL-GEN-001", { claim_count: generationClaims.length })
      : blocker("VAL-GEN-001", "claim_not_revalidated_for_generation"),
  );

  const exactCitations = Array.isArray(blocks)
    && blocks.length > 0
    && blocks.every(
      (block) =>
        Array.isArray(block.citations) &&
        block.citations.length > 0 &&
        block.citations.every((citation) => citationSet.has(`${citation.claimId}:${citation.evidenceItemId}`)),
    );
  results.push(
    exactCitations
      ? pass("VAL-GEN-002")
      : blocker("VAL-GEN-002", "missing_or_unresolved_exact_citation"),
  );

  const unauthorized = [];
  for (const block of blocks || []) {
    for (const citation of block.citations || []) {
      if (!citationSet.has(`${citation.claimId}:${citation.evidenceItemId}`)) {
        unauthorized.push({ claimId: citation.claimId, evidenceItemId: citation.evidenceItemId });
      }
    }
  }
  results.push(
    unauthorized.length === 0
      ? pass("VAL-GEN-003")
      : blocker("VAL-GEN-003", "unauthorized_claim_reference", { unauthorized_count: unauthorized.length }),
  );

  const assertionViolations = [];
  for (const block of blocks || []) {
    const citedStatements = (block.citations || [])
      .map((citation) => claimById.get(citation.claimId)?.claimStatement || "")
      .filter(Boolean);
    const citedText = citedStatements.join("\n");
    const allowedNumbers = new Set(unique(citedStatements.flatMap((statement) => literals(statement, NUMERIC_LITERAL_PATTERN))));
    for (const numericLiteral of unique(literals(block.text, NUMERIC_LITERAL_PATTERN))) {
      if (!allowedNumbers.has(numericLiteral)) assertionViolations.push({ type: "numeric_literal", block_ordinal: block.ordinal });
    }
    for (const causalLiteral of unique(literals(block.text, CAUSAL_PATTERN))) {
      if (!citedText.includes(causalLiteral)) assertionViolations.push({ type: "causal_language", block_ordinal: block.ordinal });
    }
  }
  results.push(
    assertionViolations.length === 0
      ? pass("VAL-GEN-004")
      : blocker("VAL-GEN-004", "unsupported_numeric_or_causal_assertion", {
          violation_count: assertionViolations.length,
          assertion_classes: unique(assertionViolations.map((violation) => violation.type)).sort(),
          block_ordinals: unique(assertionViolations.map((violation) => violation.block_ordinal).filter((ordinal) => Number.isInteger(ordinal))).sort((a, b) => a - b),
        }),
  );

  // VAL-GEN-008 (Plan A Prompt 6): a block citing a measured claim must
  // disclose every material limitation that claim carries (human-defined
  // record meaning, attested or absent period, excluded blanks, included
  // duplicates, every coverage dimension that is not clear) and must not
  // present the period as verified or the records as distinct. Evaluated
  // only when a generation claim carries measurement limitation codes, so
  // every other draft's validator set is unchanged.
  if ((generationClaims || []).some((claim) => (claim.limitationCodes || []).some(isMeasurementLimitationCode))) {
    const disclosureViolations = [];
    for (const block of blocks || []) {
      const codes = new Set((block.citations || []).flatMap((citation) => (
        (claimById.get(citation.claimId)?.limitationCodes || []).filter(isMeasurementLimitationCode)
      )));
      for (const rule of MEASUREMENT_DISCLOSURE_RULES) {
        const applies = rule.code ? codes.has(rule.code) : [...codes].some((code) => code.startsWith(rule.codePrefix));
        if (!applies) continue;
        if (![rule.requires].flat().every((pattern) => pattern.test(block.text || ""))) disclosureViolations.push({ type: "limitation_not_disclosed", block_ordinal: block.ordinal });
        if (rule.forbids && rule.forbids.test(block.text || "")) disclosureViolations.push({ type: "limitation_contradicted", block_ordinal: block.ordinal });
      }
    }
    results.push(
      disclosureViolations.length === 0
        ? pass("VAL-GEN-008")
        : blocker("VAL-GEN-008", "material_limitation_not_disclosed", {
            violation_count: disclosureViolations.length,
            violation_classes: unique(disclosureViolations.map((violation) => violation.type)).sort(),
            block_ordinals: unique(disclosureViolations.map((violation) => violation.block_ordinal).filter((ordinal) => Number.isInteger(ordinal))).sort((a, b) => a - b),
          }),
    );
  }

  // VAL-GEN-005 checks the draft's requested-audience authority only. It must
  // not become a substitute eligibility gate: a governed INTERNAL claim with
  // audienceAuthority.internal === true passes regardless of its current
  // audience/use eligibility.
  const audienceOk = draftAudience === requestedAudience
    && (generationClaims || []).every((claim) => audienceAllowed(claim, requestedAudience));
  results.push(
    audienceOk
      ? pass("VAL-GEN-005", { requested_audience: requestedAudience })
      : blocker("VAL-GEN-005", "draft_audience_exceeds_authority"),
  );

  // Package 14-05 allows internal drafting from a governed claim whose
  // current-use eligibility is false. The provider instruction is not an
  // output guarantee: each cited block must name every current limitation so
  // an ineligible claim is not persisted as an unconditional assertion.
  const limitationDisclosureViolations = [];
  const missingProvisionalDraftLabels = [];
  for (const block of blocks || []) {
    for (const citation of block.citations || []) {
      const claim = claimById.get(citation.claimId);
      if (!claim || claim.currentEligible !== false) continue;
      if (!PROVISIONAL_INTERNAL_DRAFT_LABEL.test(block.text || "")) {
        missingProvisionalDraftLabels.push(block.ordinal);
      }
      for (const code of claim.limitationCodes || []) {
        const disclosure = CURRENT_LIMITATION_DISCLOSURE[code];
        if (!disclosure || !disclosure.pattern.test(block.text || "")) {
          limitationDisclosureViolations.push({ block_ordinal: block.ordinal, limitation_code: code });
        }
      }
    }
  }
  results.push(
    limitationDisclosureViolations.length === 0 && missingProvisionalDraftLabels.length === 0
      ? pass("VAL-GEN-009")
      : blocker("VAL-GEN-009", "ineligible_claim_context_not_disclosed", {
          violation_count: limitationDisclosureViolations.length + missingProvisionalDraftLabels.length,
          limitation_codes: unique(limitationDisclosureViolations.map((violation) => violation.limitation_code)).sort(),
          block_ordinals: unique(limitationDisclosureViolations.map((violation) => violation.block_ordinal).filter(Number.isInteger)).sort((a, b) => a - b),
          missing_provisional_label_block_ordinals: unique(missingProvisionalDraftLabels.filter(Number.isInteger)).sort((a, b) => a - b),
        }),
  );

  if (contentType === "readiness_assessment") {
    const readinessBlocksPositive =
      blocksContainPositiveReadinessAssertion(blocks)
      && (
        generationClaimsContainBlockers(generationClaims)
        || readinessContainsGapOrUnsupportedRequirement(authoritativeReadiness)
      );
    results.push(
      readinessBlocksPositive
        ? blocker("VAL-GEN-006", "readiness_gap_or_blocker_stated_as_positive_assertion")
        : pass("VAL-GEN-006"),
    );
  }

  if (contentType === "data_gap_memo") {
    const gapMemoPositiveSupport =
      blocksContainPositiveGapInversion(blocks)
      && authoritativeDataGapsContainReturnedGap(authoritativeReadiness);
    results.push(
      gapMemoPositiveSupport
        ? blocker("VAL-GEN-007", "data_gap_or_missing_support_stated_as_positive_support")
        : pass("VAL-GEN-007"),
    );
  }

  return Object.freeze({
    ok: results.every((result) => result.severity === "pass"),
    results: Object.freeze(results),
    blockers: Object.freeze(results.filter((result) => result.severity === "blocker")),
  });
}

// VAL-GEN-009 producer side: a provider cannot be relied on to word the
// provisional designation and every current limitation the way VAL-GEN-009
// requires, so the server writes them. Each block citing a currently
// ineligible claim is prefixed with the exact designation and one statement
// per authoritative limitation code of every such cited claim. The provider's
// own text is kept as the body; only a leading designation it already wrote is
// dropped so it is not repeated. Blocks citing only eligible claims are
// returned unchanged. Fails closed, qualifying nothing, when an ineligible
// cited claim carries no limitation code or a code with no statement: there is
// then no authoritative limitation to disclose. Callers must still validate
// the provider's unqualified text, so the prefix can never mask an unsupported
// assertion in the body.
export function qualifyIneligibleClaimBlocks({ requestedAudience, generationClaims, blocks } = {}) {
  const claimById = generationClaimsById(generationClaims || []);
  const qualified = [];
  for (const block of blocks || []) {
    const codes = [];
    let citesIneligibleClaim = false;
    for (const citation of block.citations || []) {
      const claim = claimById.get(citation.claimId);
      if (!claim || claim.currentEligible !== false) continue;
      citesIneligibleClaim = true;
      const claimCodes = Array.isArray(claim.limitationCodes) ? claim.limitationCodes : [];
      if (claimCodes.length === 0) return Object.freeze({ ok: false, reason: "ineligible_claim_limitations_unavailable" });
      for (const code of claimCodes) {
        if (!Object.hasOwn(CURRENT_LIMITATION_DISCLOSURE, code)) {
          return Object.freeze({ ok: false, reason: "ineligible_claim_limitation_not_disclosable" });
        }
        if (!codes.includes(code)) codes.push(code);
      }
    }
    if (!citesIneligibleClaim) {
      qualified.push(block);
      continue;
    }
    const statements = codes.map((code) => CURRENT_LIMITATION_DISCLOSURE[code].statement(requestedAudience));
    const body = String(block.text || "").replace(PROVIDER_PROVISIONAL_LABEL_PREFIX, "");
    qualified.push({
      ordinal: block.ordinal,
      text: `Provisional internal draft: ${statements.join(" ")}${body ? ` ${body}` : ""}`,
      citations: block.citations,
    });
  }
  return Object.freeze({ ok: true, blocks: qualified });
}

function blocksContainPositiveGapInversion(blocks = []) {
  return (blocks || []).some((block) => {
    const text = block?.text || "";
    if (/\b(no gaps?|no data gaps?|resolved clear|all clear)\b/i.test(text)) return true;
    return /\b(sufficient support|fully supported|support is sufficient|complete support)\b/i.test(text)
      && !/\b(limitation|limitations|missing|unresolved|risk|insufficient|not sufficient|needs|requires|cannot|does not)\b/i.test(text);
  });
}

function authoritativeDataGapsContainReturnedGap(value) {
  return Array.isArray(value?.items) && value.items.length > 0;
}

function blocksContainPositiveReadinessAssertion(blocks = []) {
  return (blocks || []).some((block) => (
    /\b(all|every|fully|complete|ready|met|satisfied|supports?|sufficient)\b/i.test(block?.text || "")
    && !/\b(gap|gaps|limitation|limitations|blocked|missing|not yet|unresolved|unsupported|requires|needs|cannot|does not)\b/i.test(block?.text || "")
  ));
}

function generationClaimsContainBlockers(generationClaims = []) {
  return (generationClaims || []).some((claim) => Array.isArray(claim.limitationCodes) && claim.limitationCodes.length > 0);
}

function readinessContainsGapOrUnsupportedRequirement(readiness) {
  return (readiness?.requirements || []).some((requirement) => {
    if (requirement?.assessed !== true || requirement?.assessment === null) return true;
    const state = requirement.assessment?.assessment_state;
    return state !== "satisfied";
  });
}

function audienceAllowed(claim, requestedAudience) {
  if (requestedAudience === "internal") return claim.audienceAuthority?.internal === true;
  if (requestedAudience === "funder") return claim.audienceAuthority?.funder === true;
  if (requestedAudience === "public") return claim.audienceAuthority?.public === true;
  return false;
}

export const __generatedContentValidatorContract = Object.freeze({
  VALIDATOR_KEYS,
  NUMERIC_LITERAL_PATTERN,
  CAUSAL_PATTERN,
  CURRENT_LIMITATION_DISCLOSURE,
});
