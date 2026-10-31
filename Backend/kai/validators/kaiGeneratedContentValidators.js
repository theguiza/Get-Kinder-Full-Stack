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
  "VAL-GEN-010",
]);

const NUMERIC_LITERAL_PATTERN = /(?<![A-Za-z0-9_])[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:%|\b)/g;
const CAUSAL_PATTERN = /\b(causes?|caused|causing|because|due to|drives?|driven by|leads? to|led to|results? in|resulted in|attribut(?:e|ed|able) to|impact(?:s|ed)?|increases?|decreases?|reduces?|improves?|worsens?)\b/gi;

/**
 * VAL-GEN-010: the output boundary of the count-only internal authority for
 * a story-present source (postgresOrdinaryInternalFactAuthority.js). Its
 * claims reach the model only as the composed record-count restatement, so
 * no story or testimonial text can be copied from the input; this checks
 * that a block citing such a claim adds none either. It is a closed lexical
 * boundary, in the manner of VAL-GEN-004: no quotation, no story, testimony
 * or first-person wording, no participant, outcome or completion assertion
 * that the cited statements do not themselves contain (the human-defined
 * unit label is part of the statement), and, for a selected-worksheet
 * count, the worksheet the rows were counted in. It does not interpret
 * meaning; it bounds what a count-only block may say.
 */
export const COUNT_ONLY_LIMITATION_CODE = "source.story_testimonial_present_count_only";
const QUOTATION_PATTERN = /["\u201C\u201D\u201E\u00AB\u00BB]/;
const FIRST_PERSON_PATTERN = /\bI\b|\b(?:me|my|mine|myself)\b/i;
const STORY_PATTERN = /\b(stor(?:y|ies)|testimon(?:y|ies|ial|ials)|quot(?:e|es|ed|ing|ation|ations)|anecdot\w*|said|says|told|tells|recount\w*|shared|narrat\w*)\b/i;
const COUNT_ONLY_ASSERTION_PATTERN = /\b(participants?|people|persons?|individuals?|clients?|famil(?:y|ies)|beneficiar(?:y|ies)|attendees?|unique|distinct|outcomes?|results?|success\w*|achiev\w*|complet(?:ed|ion|ions)|benefit\w*|helped|served|lives|life|transform\w*|satisf\w*|felt|feel(?:s|ing|ings)?|experienc\w*|well-?being|changed)\b/gi;
const UNNEGATED_VERIFIED_PATTERN = /(?<!not |un|n't |not been |never )\bverified\b/i;
const SELECTED_WORKSHEET_PATTERN = /\bin selected worksheet (sheet_[1-9][0-9]{0,3})\b/;

export function countOnlyBlockViolations(text, citedStatements) {
  const blockText = String(text || "");
  const citedText = citedStatements.join("\n").toLowerCase();
  const violations = [];
  if (QUOTATION_PATTERN.test(blockText)) violations.push("quotation");
  if (FIRST_PERSON_PATTERN.test(blockText)) violations.push("first_person");
  if (STORY_PATTERN.test(blockText)) violations.push("story_or_testimonial_wording");
  if (literals(blockText, COUNT_ONLY_ASSERTION_PATTERN).some((word) => !new RegExp(`\\b${word.toLowerCase()}\\b`).test(citedText))) {
    violations.push("participant_or_outcome_assertion");
  }
  if (UNNEGATED_VERIFIED_PATTERN.test(blockText)) violations.push("meaning_presented_as_verified");
  for (const statement of citedStatements) {
    const worksheet = SELECTED_WORKSHEET_PATTERN.exec(statement)?.[1];
    if (worksheet && !new RegExp(`\\b${worksheet}\\b`).test(blockText)) violations.push("counted_worksheet_not_named");
  }
  return unique(violations).sort();
}

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

  // VAL-GEN-010: evaluated only when a generation claim is used under the
  // count-only basis, so every other draft's validator set is unchanged.
  if ((generationClaims || []).some((claim) => (claim.limitationCodes || []).includes(COUNT_ONLY_LIMITATION_CODE))) {
    const countOnlyViolations = [];
    for (const block of blocks || []) {
      const cited = (block.citations || []).map((citation) => claimById.get(citation.claimId)).filter(Boolean);
      if (!cited.some((claim) => (claim.limitationCodes || []).includes(COUNT_ONLY_LIMITATION_CODE))) continue;
      for (const type of countOnlyBlockViolations(block.text, cited.map((claim) => claim.claimStatement || ""))) {
        countOnlyViolations.push({ type, block_ordinal: block.ordinal });
      }
    }
    results.push(
      countOnlyViolations.length === 0
        ? pass("VAL-GEN-010")
        : blocker("VAL-GEN-010", "count_only_content_boundary_exceeded", {
            violation_count: countOnlyViolations.length,
            violation_classes: unique(countOnlyViolations.map((violation) => violation.type)).sort(),
            block_ordinals: unique(countOnlyViolations.map((violation) => violation.block_ordinal).filter((ordinal) => Number.isInteger(ordinal))).sort((a, b) => a - b),
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
});
