import {
  MEASUREMENT_DISCLOSURE_RULES,
  MEASUREMENT_LIMITATION_CODES,
  MEASUREMENT_UNIQUENESS_PATTERN,
  REPORTING_PERIOD_ASSERTION_PATTERNS,
  SERVICE_DELIVERY_PATTERN,
  affirmativeMatches,
  composeMeasurementDisclosure,
  coverageStatusClearedPattern,
  isMeasurementLimitationCode,
  namesCoverageDimension,
  parseMeasuredCountStatement,
} from "./kaiSourceMeasurementValidators.js";
import {
  DERIVED_DISCLOSURE_RULES,
  DERIVED_LIMITATION_CODES,
  composeDerivedMeasurementDisclosure,
  isDerivedLimitationCode,
} from "./kaiDerivedMeasurementValidators.js";

// A record-count (measurement./coverage.) or source-derived (derived.) code:
// either makes a claim a measured claim for VAL-GEN-008.
function isMeasuredClaimCode(code) {
  return isMeasurementLimitationCode(code) || isDerivedLimitationCode(code);
}

function isDerivedMeasuredClaim(claim) {
  return (claim?.limitationCodes || []).some(isDerivedLimitationCode);
}

// The server-composed disclosure body of one measured claim's codes, or null.
function measuredClaimDisclosure(claim) {
  const codes = (claim.limitationCodes || []).filter(isMeasuredClaimCode);
  return isDerivedMeasuredClaim(claim) ? composeDerivedMeasurementDisclosure(codes) : composeMeasurementDisclosure(codes);
}

const EVIDENCE_SUMMARY_CONTENT_TYPE = "evidence_summary";

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

/**
 * The count-only finding, composed by the server from the exact cited
 * measurement (owner prompt "KAI — Package 3", 2026-10-31). VAL-GEN-010 is
 * lexical: a word the cited statement uses, such as the human-defined unit
 * label, is not an added assertion, so model prose could state "37 service
 * events" for 37 rows of a data dictionary. Instead a count-only claim's
 * block is this text: the parser-established numbers, the worksheet key of
 * the measurement's own locator, and the reporting period as attested.
 * It never contains the human label, the definition text, a worksheet or
 * file name, or any other free text, and it depends only on immutable
 * measurement and definition values, so the same measurement always
 * composes the same text. It satisfies VAL-GEN-004, -008 and -010 on their
 * own terms; they still run on it.
 */
const CSV_COUNT_ONLY_METHOD = "p1_csv_profile_data_records_excluding_blank_v1";

export function composeCountOnlyFindingText(measurementRow) {
  const where = measurementRow.calculation_method === CSV_COUNT_ONLY_METHOD || !measurementRow.worksheet_key
    ? "in the CSV data records of the cited source version"
    : `in worksheet ${measurementRow.worksheet_key}`;
  const scope = measurementRow.calculation_method === CSV_COUNT_ONLY_METHOD || !measurementRow.worksheet_key ? "that source version" : "that one worksheet";
  const period = measurementRow.period_start
    ? `The reporting period ${measurementRow.period_start} to ${measurementRow.period_end} is attested in that definition and was not verified against dates in the rows.`
    : "No reporting period was defined for the count.";
  return `${measurementRow.measured_value} nonblank data rows were counted ${where}, `
    + `with ${measurementRow.blank_record_count} blank rows excluded and ${measurementRow.duplicate_record_count} exact-duplicate rows included in the count. `
    + `This is a count of data records in ${scope} only: what one record represents is human-defined by the organization and was not verified by KAI, `
    + "so the number is a row count and nothing more. "
    + `${period} Any coverage limitations recorded for the claim apply and are listed with the report's limitations.`;
}

// Closed server projections for the assessment. No free-text definition,
// source content or model prose enters a count-only block.
export const ASSESSMENT_SELECTION_NOTE = "Selection note: selected evidence with unresolved limitations was excluded from assertions. Its current-use explanation is shown in Knowledge Studio.";
const COUNT_ONLY_ASSESSMENT_PREFIXES = Object.freeze({
  executive_snapshot: "This assessment is limited to the cited row count. ",
  evidence_findings: "",
  impact_stories: "No personal account is included; only the row count is available. ",
  gaps_opportunities: "The row count does not establish record meaning or external-use alignment. ",
  recommended_improvements: "No specific improvement proposal is established by the row count. ",
  next_steps: "Keep the definition, cited source and limitations with the row count before reusing it. ",
});

export function composeCountOnlyAssessmentText(measurementRow, sectionKey) {
  if (!Object.hasOwn(COUNT_ONLY_ASSESSMENT_PREFIXES, sectionKey)) return null;
  return `[[assessment:${sectionKey}]]\n${COUNT_ONLY_ASSESSMENT_PREFIXES[sectionKey]}${composeCountOnlyFindingText(measurementRow)}`;
}

// A persisted block citing a count-only claim is accepted only when it cites
// exactly that claim's evidence item and is exactly the composed finding of
// the measurement now recorded for it.
export function countOnlyBlockMatchesMeasurement(block, measurementRow) {
  return Boolean(measurementRow)
    && Array.isArray(block?.citations)
    && block.citations.length === 1
    && block.citations[0].evidenceItemId === measurementRow.evidence_item_id
    && (block.text === composeCountOnlyFindingText(measurementRow)
      || Object.keys(COUNT_ONLY_ASSESSMENT_PREFIXES).some((key) => {
        const exact = composeCountOnlyAssessmentText(measurementRow, key);
        return block.text === exact || (key === "gaps_opportunities" && block.text === `${exact} ${ASSESSMENT_SELECTION_NOTE}`);
      }));
}

/**
 * Evidence Summary blocks citing ordinary measured claims (owner prompt
 * "KAI — Reproduce and repair Evidence Summary VAL-GEN-008", 2026-11-01):
 * the server appends each cited measured claim's composed disclosure
 * (composeMeasurementDisclosure) to the model's text, which is kept verbatim,
 * so a truthful draft never depends on the model choosing wording VAL-GEN-008
 * accepts. Every validator still runs on the combined text, so a model
 * contradiction or unsupported assertion is never hidden. One cited measured
 * claim, or several with the same disclosure, get one disclosure; several
 * with different disclosures are each attributed by their measured value,
 * which their own statements carry. A count-only claim keeps the exact
 * composed block (composeCountOnlyFindingText). Idempotent: an existing
 * trailing disclosure is not appended again. Returns { ok: false } when a
 * disclosure cannot be composed or attributed.
 */
export function composeEvidenceSummaryMeasurementDisclosures({ blocks, claims, measuredValueByClaimId = new Map() }) {
  const claimById = generationClaimsById(claims || []);
  const composed = [];
  for (const block of blocks || []) {
    // Only an exact projected claim/evidence pair is attributed a disclosure.
    const measured = unique((block.citations || [])
      .filter((citation) => claimById.get(citation.claimId)?.evidenceItemId === citation.evidenceItemId)
      .map((citation) => claimById.get(citation.claimId)))
      .filter((claim) => claim
        && !(claim.limitationCodes || []).includes(COUNT_ONLY_LIMITATION_CODE)
        && (claim.limitationCodes || []).some(isMeasuredClaimCode));
    if (measured.length === 0) {
      composed.push(block);
      continue;
    }
    const bodies = measured.map(measuredClaimDisclosure);
    if (bodies.includes(null)) return Object.freeze({ ok: false });
    // A source-derived measurement is named as a measurement, not a count.
    const noun = measured.some(isDerivedMeasuredClaim) ? "measurement" : "count";
    let disclosure;
    if (bodies.every((body) => body === bodies[0])) {
      disclosure = `Measurement disclosure for ${measured.length === 1 ? `the cited ${noun}` : `each cited ${noun}`}: ${bodies[0]}`;
    } else {
      const values = measured.map((claim) => measuredValueByClaimId.get(claim.claimId));
      const attributable = new Set(values).size === values.length
        && values.every((value, index) => Number.isSafeInteger(value)
          && literals(measured[index].claimStatement, NUMERIC_LITERAL_PATTERN).includes(String(value)));
      if (!attributable) return Object.freeze({ ok: false });
      disclosure = measured.map((claim, index) => `Measurement disclosure for the cited ${isDerivedMeasuredClaim(claim) ? "measurement" : "count"} of ${values[index]}: ${bodies[index]}`).join(" ");
    }
    const text = String(block.text ?? "");
    composed.push({
      ...block,
      text: text.endsWith(disclosure) ? text : `${text}${text.length === 0 || /\s$/.test(text) ? "" : " "}${disclosure}`,
    });
  }
  return Object.freeze({ ok: true, blocks: composed });
}

// The model-authored text of an Evidence Summary block: the block without the
// server's exact composed disclosure (composeEvidenceSummaryMeasurementDisclosures).
// Removing only that authoritative text can hide nothing the model wrote, and
// the disclosure can then neither satisfy nor mask a contradiction check.
const DISCLOSURE_PREFIX_PATTERN = /Measurement disclosure for (?:the cited (?:count|measurement)|each cited (?:count|measurement)|the cited (?:count|measurement) of \d+): /g;

function modelAuthoredText(text, citedClaims) {
  let model = String(text || "");
  for (const claim of citedClaims) {
    const body = measuredClaimDisclosure(claim);
    if (body) model = model.split(body).join(" ");
  }
  return model.replace(DISCLOSURE_PREFIX_PATTERN, " ");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Evidence Summary (owner prompt "KAI VAL-GEN-008 — Final local safety
 * acceptance", 2026-11-01): whether the model-authored text contradicts a
 * cited measured claim. A reporting period is asserted for a claim with none;
 * a coverage concern that is not clear is asserted resolved or cleared; or,
 * for a human-defined record meaning, the measured value is stated as a count
 * of anything other than the claim's own counted unit or records ("112
 * participants"), or the sentence stating it asserts a service or outcome the
 * cited statement does not. The literal value appearing in the claim never
 * authorizes a different counted entity.
 */
function evidenceSummaryContradicts(modelText, codes, citedClaims) {
  if ((codes.has(MEASUREMENT_LIMITATION_CODES.NO_REPORTING_PERIOD) || codes.has(DERIVED_LIMITATION_CODES.NO_REPORTING_PERIOD))
    && REPORTING_PERIOD_ASSERTION_PATTERNS.some((pattern) => pattern.test(modelText))) {
    return true;
  }
  if ([...codes].some((code) => code.startsWith("coverage.") && coverageStatusClearedPattern(code).test(modelText))) return true;
  if (!codes.has(MEASUREMENT_LIMITATION_CODES.RECORD_MEANING_HUMAN_DEFINED)) return false;
  const citedText = citedClaims.map((claim) => claim.claimStatement || "").join("\n").toLowerCase();
  for (const claim of citedClaims) {
    const measured = parseMeasuredCountStatement(claim.claimStatement);
    if (!measured) continue;
    const words = measured.unitLabel.split(/\s+/);
    const units = words.map((_, index) => escapeRegExp(words.slice(index).join(" "))).join("|");
    const countedUnit = new RegExp(`^(?:\\s*(?:[.,;:)]|$)|\\s+(?:${units}|(?:counted\\s+)?(?:non-?blank\\s+)?(?:source\\s+|data\\s+)?(?:records?|rows?))\\b)`, "i");
    // "The source does not establish that 112 participants were served" denies
    // that statement rather than making it, so the clause it governs (to the
    // next clause break) is not read as an assertion of the value; any other
    // statement of the value is still checked.
    const denied = new RegExp(`\\b(?:does|do|did)(?:\\s+not|n't)\\s+establish\\s+(?:that|whether)\\s+${measured.value}\\b[^.!?;,]*`, "gi");
    const asserted = modelText.replace(denied, " ");
    const sentences = asserted.split(/(?<=[.!?;])\s+/);
    const statesValue = (text) => [...text.matchAll(NUMERIC_LITERAL_PATTERN)].filter((match) => match[0] === measured.value);
    if (statesValue(asserted).some((match) => !countedUnit.test(asserted.slice(match.index + match[0].length)))) return true;
    if (sentences.some((sentence) => statesValue(sentence).length > 0
      && affirmativeMatches(sentence, SERVICE_DELIVERY_PATTERN).some((word) => !new RegExp(`\\b${word.toLowerCase()}\\b`).test(citedText)))) {
      return true;
    }
  }
  return false;
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

// VAL-GEN-004 (one implementation, also used to check model-authored text on
// its own before the server composes a Free Impact Assessment). A block may
// state a number only when a claim the block itself cites states the same
// value with the same unit form: grouping commas and trailing decimal zeros
// are presentation ("1,200" = "1200", "57.50%" = "57.5%"), while rounding,
// a dropped or added percent sign, or a changed sign is a different number.
// A causal term is allowed only when the cited text contains it. In a block
// marked as a Free Impact Assessment section, the report's own section and
// product names ("Impact Stories", "Impact Assessment", ...) are labels, not
// a claim of effect; every other use of "impact" is still causal language.
const ASSESSMENT_BLOCK_MARKER = /^\[\[assessment:([a-z_]+)\]\]\n/;
const ASSESSMENT_REPORT_TERMINOLOGY = /\b(?:free\s+)?impact\s+(?:assessments?|stor(?:y|ies)|snapshots?|evidence(?:\s+library)?)\b/gi;

function canonicalNumericLiteral(literal) {
  const percent = literal.endsWith("%");
  const value = Number(literal.replace(/[,%]/g, ""));
  return Number.isFinite(value) ? `${value}${percent ? "%" : ""}` : literal;
}

export function unsupportedAssertionViolations({ blocks, generationClaims } = {}) {
  const claimById = generationClaimsById(generationClaims || []);
  const violations = [];
  for (const block of blocks || []) {
    const citedStatements = (block.citations || [])
      .map((citation) => claimById.get(citation.claimId)?.claimStatement || "")
      .filter(Boolean);
    const citedText = citedStatements.join("\n");
    const text = String(block.text ?? "");
    const marker = ASSESSMENT_BLOCK_MARKER.exec(text);
    const section = marker ? marker[1] : null;
    const allowedNumbers = new Set(citedStatements.flatMap((statement) => literals(statement, NUMERIC_LITERAL_PATTERN)).map(canonicalNumericLiteral));
    for (const numericLiteral of unique(literals(text, NUMERIC_LITERAL_PATTERN))) {
      if (!allowedNumbers.has(canonicalNumericLiteral(numericLiteral))) {
        violations.push({ type: "numeric_literal", block_ordinal: block.ordinal, section, literal: numericLiteral });
      }
    }
    const causalText = marker ? text.replace(ASSESSMENT_REPORT_TERMINOLOGY, " ") : text;
    for (const causalLiteral of unique(literals(causalText, CAUSAL_PATTERN))) {
      if (!citedText.includes(causalLiteral)) violations.push({ type: "causal_language", block_ordinal: block.ordinal, section, literal: causalLiteral });
    }
  }
  return violations;
}

// The VAL-GEN-004 blocker evidence: classes, ordinals and section keys only,
// never the generated wording.
export function unsupportedAssertionEvidence(violations) {
  const sections = unique(violations.map((violation) => violation.section).filter(Boolean)).sort();
  return {
    violation_count: violations.length,
    assertion_classes: unique(violations.map((violation) => violation.type)).sort(),
    block_ordinals: unique(violations.map((violation) => violation.block_ordinal).filter((ordinal) => Number.isInteger(ordinal))).sort((a, b) => a - b),
    ...(sections.length > 0 ? { block_sections: sections } : {}),
  };
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

  const assertionViolations = unsupportedAssertionViolations({ blocks, generationClaims });
  results.push(
    assertionViolations.length === 0
      ? pass("VAL-GEN-004")
      : blocker("VAL-GEN-004", "unsupported_numeric_or_causal_assertion", unsupportedAssertionEvidence(assertionViolations)),
  );

  // VAL-GEN-008 (Plan A Prompt 6): a block citing a measured claim must
  // disclose every material limitation that claim carries (human-defined
  // record meaning, attested or absent period, excluded blanks, included
  // duplicates, every coverage dimension that is not clear) and must not
  // present the period as verified or the records as distinct. Evaluated
  // only when a generation claim carries measurement limitation codes, so
  // every other draft's validator set is unchanged.
  // In an Evidence Summary block that cites no count-only claim (owner prompt,
  // 2026-11-01), a forbidden word counts only when asserted, not negated
  // ("not independently verified", "not unique"); the records are never
  // asserted to be distinct/unique unless a cited statement itself says so;
  // and every coverage dimension that is not clear must be named, not merely
  // "limitations". The model-authored text must also not contradict the
  // period, coverage or counted-unit state (evidenceSummaryContradicts).
  // Every other block keeps exactly the rules above.
  if ((generationClaims || []).some((claim) => (claim.limitationCodes || []).some(isMeasuredClaimCode))) {
    const disclosureViolations = [];
    for (const block of blocks || []) {
      const cited = (block.citations || []).map((citation) => claimById.get(citation.claimId)).filter(Boolean);
      const codes = new Set(cited.flatMap((claim) => (claim.limitationCodes || []).filter(isMeasuredClaimCode)));
      const text = block.text || "";
      const evidenceSummaryRules = contentType === EVIDENCE_SUMMARY_CONTENT_TYPE
        && !cited.some((claim) => (claim.limitationCodes || []).includes(COUNT_ONLY_LIMITATION_CODE));
      const contradicts = (pattern) => (evidenceSummaryRules ? affirmativeMatches(text, pattern).length > 0 : pattern.test(text));
      for (const rule of [...MEASUREMENT_DISCLOSURE_RULES, ...DERIVED_DISCLOSURE_RULES]) {
        const applies = rule.code ? codes.has(rule.code) : [...codes].some((code) => code.startsWith(rule.codePrefix));
        if (!applies || (evidenceSummaryRules && rule.codePrefix === "coverage.")) continue;
        if (![rule.requires].flat().every((pattern) => pattern.test(text))) disclosureViolations.push({ type: "limitation_not_disclosed", block_ordinal: block.ordinal });
        if (rule.forbids && contradicts(rule.forbids)) disclosureViolations.push({ type: "limitation_contradicted", block_ordinal: block.ordinal });
      }
      if (evidenceSummaryRules) {
        if ([...codes].some((code) => code.startsWith("coverage.") && !namesCoverageDimension(text, code))) {
          disclosureViolations.push({ type: "limitation_not_disclosed", block_ordinal: block.ordinal });
        }
        const citedText = cited.map((claim) => claim.claimStatement || "").join("\n").toLowerCase();
        if (codes.has(MEASUREMENT_LIMITATION_CODES.RECORD_MEANING_HUMAN_DEFINED)
          && affirmativeMatches(text, MEASUREMENT_UNIQUENESS_PATTERN).some((word) => !new RegExp(`\\b${word.toLowerCase()}\\b`).test(citedText))) {
          disclosureViolations.push({ type: "limitation_contradicted", block_ordinal: block.ordinal });
        }
        if (evidenceSummaryContradicts(modelAuthoredText(text, cited), codes, cited)) {
          disclosureViolations.push({ type: "limitation_contradicted", block_ordinal: block.ordinal });
        }
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
