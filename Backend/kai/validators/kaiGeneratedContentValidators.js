const VALIDATOR_KEYS = Object.freeze([
  "VAL-GEN-001",
  "VAL-GEN-002",
  "VAL-GEN-003",
  "VAL-GEN-004",
  "VAL-GEN-005",
]);

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
      if (!allowedNumbers.has(numericLiteral)) assertionViolations.push({ type: "numeric_literal", value: numericLiteral });
    }
    for (const causalLiteral of unique(literals(block.text, CAUSAL_PATTERN))) {
      if (!citedText.includes(causalLiteral)) assertionViolations.push({ type: "causal_language", value: causalLiteral });
    }
  }
  results.push(
    assertionViolations.length === 0
      ? pass("VAL-GEN-004")
      : blocker("VAL-GEN-004", "unsupported_numeric_or_causal_assertion", {
          violation_count: assertionViolations.length,
        }),
  );

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

  return Object.freeze({
    ok: results.every((result) => result.severity === "pass"),
    results: Object.freeze(results),
    blockers: Object.freeze(results.filter((result) => result.severity === "blocker")),
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
});
