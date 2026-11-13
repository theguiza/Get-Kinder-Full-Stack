import { LEGACY_STORY_LIMITATION_CODE, withoutLegacyStoryLimitations } from "../../../shared/kaiStorySourceInformation.js";
import {
  MEASUREMENT_DISCLOSURE_RULES,
  MEASUREMENT_LIMITATION_CODES,
  MEASUREMENT_UNIQUENESS_PATTERN,
  REPORTING_PERIOD_ASSERTION_PATTERNS,
  SERVICE_DELIVERY_PATTERN,
  affirmativeMatches,
  assertedClaimText,
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
import { documentEstimateQuantities, excerptFromDocumentClaimStatement, statedQuantities } from "./kaiDocumentEvidenceValidators.js";
import { citedPairedOutcomes, outcomeInterpretationViolations } from "./kaiOutcomeInterpretationValidators.js";

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

// Historical row-count composition helpers. They remain pure utilities for
// older fixture text; no generation, report or release admission calls them.
// The current VAL-GEN-010 below checks actual quotations for every source.
export const COUNT_ONLY_LIMITATION_CODE = LEGACY_STORY_LIMITATION_CODE;
const QUOTATION_PATTERN = /["\u201C\u201D\u201E\u00AB\u00BB]/;
const FIRST_PERSON_PATTERN = /\bI\b|\b(?:me|my|mine|myself)\b/i;
const STORY_PATTERN = /\b(stor(?:y|ies)|testimon(?:y|ies|ial|ials)|quot(?:e|es|ed|ing|ation|ations)|anecdot\w*|said|says|told|tells|recount\w*|shared|narrat\w*)\b/i;
const COUNT_ONLY_ASSERTION_PATTERN = /\b(participants?|people|persons?|individuals?|clients?|famil(?:y|ies)|beneficiar(?:y|ies)|attendees?|unique|distinct|outcomes?|results?|success\w*|achiev\w*|complet(?:ed|ion|ions)|benefit\w*|helped|served|lives|life|transform\w*|satisf\w*|felt|feel(?:s|ing|ings)?|experienc\w*|well-?being|changed)\b/gi;
const UNNEGATED_VERIFIED_PATTERN = /(?<!not |un|n't |not been |never )\bverified\b/i;
const SELECTED_WORKSHEET_PATTERN = /\bin selected worksheet (sheet_[1-9][0-9]{0,3})\b/;

export function countOnlyBlockViolations(text, citedStatements) {
  const blockText = String(text || "");
  // A record-count claim's attributed definition authorizes no wording.
  const citedText = citedStatements.map(assertedClaimText).join("\n").toLowerCase();
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
 * Truthful row-count model input, composed from the cited measurement for
 * every source. Human labels and definition text do not establish what a
 * counted row represents. The original claim remains the validation authority.
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
export const ASSESSMENT_SELECTION_NOTE = "Selection note: selected evidence that a recorded review found unsupported, or a measurement that no longer matches its source, was left out of the assertions. The reason is shown in Knowledge Studio.";
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

/**
 * Evidence Summary wording fallback (owner direction 2026-11-10): the model's
 * wording can never fail an Evidence Summary request on its own. Each model
 * block is checked on its own, with its server disclosure, by the same
 * validators as the whole draft (`validate`). A block whose wording is
 * refused, or a model result that is unusable as a whole, is replaced by the
 * server-composed text of the claims it cites: each claim's own governed
 * statement (as the model received it) with its disclosure - text the
 * validators accept by construction. Blocks that pass keep the model's
 * wording. Nothing is weakened: the final draft is validated whole again, and
 * a refusal that is not about wording (claim revalidation VAL-GEN-001, the
 * requested audience VAL-GEN-005) is never repaired - `ok: false` then, and
 * the caller refuses exactly as before.
 *
 * Returns { ok, blocks, validation, evidence } with evidence naming the
 * replaced block ordinals and the refused validator keys and classes.
 */
export const WORDING_FALLBACK_RESULT_KEY = "KAI-GEN-WORDING-FALLBACK-001";
const WORDING_VALIDATOR_KEYS = new Set(["VAL-GEN-002", "VAL-GEN-003", "VAL-GEN-004", "VAL-GEN-008", "VAL-GEN-010", "RESULT-CONTRACT"]);

export function composeEvidenceSummaryWithWordingFallback({
  modelBlocks, modelResultUsable = true, claims, measuredValueByClaimId = new Map(), validate,
  blockFits = () => true, resultFits = () => true,
}) {
  const claimById = generationClaimsById(claims || []);
  const fallbackBlocksFor = (claimList) => claimList.map((claim) => ({
    ordinal: 0,
    text: claim.plainReading ?? claim.modelClaimStatement ?? claim.claimStatement,
    citations: [{ claimId: claim.claimId, evidenceItemId: claim.evidenceItemId }],
  }));
  const withDisclosures = (blocks) => composeEvidenceSummaryMeasurementDisclosures({ blocks, claims, measuredValueByClaimId });
  const numbered = (blocks) => blocks.map((block, index) => ({ ...block, ordinal: index + 1 }));

  const out = [];
  const replaced = [];
  const refusedKeys = new Set();
  const refusedClasses = new Set();
  let keptModelBlocks = 0;
  const restatedClaimIds = new Set();
  const blocks = modelResultUsable && Array.isArray(modelBlocks) ? modelBlocks : [];
  for (const block of blocks) {
    const citedClaims = unique((Array.isArray(block?.citations) ? block.citations : [])
      .map((citation) => claimById.get(citation?.claimId))
      .filter((claim, index, list) => claim && block.citations[index]?.evidenceItemId === claim.evidenceItemId && list.indexOf(claim) === index));
    const composed = withDisclosures([{ ...block, ordinal: 1 }]);
    // A block that no longer fits the result contract once its disclosure
    // is added is restated, never truncated.
    const fits = composed.ok && blockFits(composed.blocks[0]);
    const check = fits ? validate(composed.blocks) : null;
    if (check?.ok) {
      out.push(composed.blocks[0]);
      keptModelBlocks += 1;
      continue;
    }
    const keys = check ? check.blockers.map((item) => item.validator_key) : [composed.ok ? "RESULT-CONTRACT" : "VAL-GEN-008"];
    // A refusal that is not about wording is never repaired.
    if (keys.some((key) => !WORDING_VALIDATOR_KEYS.has(key))) return Object.freeze({ ok: false });
    keys.forEach((key) => refusedKeys.add(key));
    for (const item of check?.blockers || []) {
      for (const kind of [...(item.evidence?.assertion_classes || []), ...(item.evidence?.violation_classes || [])]) refusedClasses.add(kind);
    }
    replaced.push(block?.ordinal ?? out.length + 1);
    // Each claim is restated once, however many refused blocks cited it.
    const fresh = citedClaims.filter((claim) => !restatedClaimIds.has(claim.claimId));
    fresh.forEach((claim) => restatedClaimIds.add(claim.claimId));
    const fallback = withDisclosures(fallbackBlocksFor(fresh));
    if (!fallback.ok) return Object.freeze({ ok: false });
    out.push(...fallback.blocks);
  }
  // Every selected claim is still represented: an unusable model result, or
  // one whose blocks were all refused, is rebuilt from the claims; a claim
  // no kept block cites is added in the claims' order.
  const cited = new Set(out.flatMap((block) => block.citations.map((citation) => citation.claimId)));
  const missing = (claims || []).filter((claim) => !cited.has(claim.claimId));
  if (missing.length > 0) {
    const fallback = withDisclosures(fallbackBlocksFor(missing));
    if (!fallback.ok) return Object.freeze({ ok: false });
    out.push(...fallback.blocks);
  }
  let final = numbered(out);
  // Too much text in all: every selected claim in its own wording (shorter).
  if (!resultFits(final)) {
    const restated = withDisclosures(fallbackBlocksFor(claims || []));
    if (!restated.ok) return Object.freeze({ ok: false });
    final = numbered(restated.blocks);
    replaced.splice(0, replaced.length, ...blocks.map((block, index) => block?.ordinal ?? index + 1));
    refusedKeys.add("RESULT-CONTRACT");
    keptModelBlocks = 0;
    out.splice(0, out.length, ...final);
    if (!resultFits(final)) return Object.freeze({ ok: false });
  }
  const validation = validate(final);
  if (!validation.ok) return Object.freeze({ ok: false });
  return Object.freeze({
    ok: true,
    blocks: final,
    validation,
    evidence: Object.freeze({
      model_result_usable: modelResultUsable === true,
      model_blocks_kept: keptModelBlocks,
      replaced_model_block_ordinals: replaced,
      fallback_block_count: out.length - keptModelBlocks,
      refused_validator_keys: [...refusedKeys].sort(),
      refused_classes: [...refusedClasses].sort(),
    }),
  });
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
    // The server's own count-only finding for a record count
    // (composeCountOnlyFindingText) is authoritative composed text, not a
    // model assertion: "2 exact-duplicate rows" in it is never a claim that
    // the measured 2 counts something else (owner direction 2026-11-11).
    if (typeof claim.modelClaimStatement === "string" && claim.modelClaimStatement.length > 0) model = model.split(claim.modelClaimStatement).join(" ");
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
  // Owner Package 1: only what a record count asserts (its number of source
  // records) authorizes wording; the organization's attributed description
  // of a record, its period and rules were not applied by the calculation.
  const citedText = citedClaims.map((claim) => assertedClaimText(claim.claimStatement)).join("\n").toLowerCase();
  for (const claim of citedClaims) {
    const measured = parseMeasuredCountStatement(claim.claimStatement);
    if (!measured) continue;
    const words = measured.unitLabel ? measured.unitLabel.split(/\s+/) : [];
    const units = words.map((_, index) => escapeRegExp(words.slice(index).join(" "))).map((unit) => `${unit}|`).join("");
    const countedUnit = new RegExp(`^(?:\\s*(?:[.,;:)]|$)|\\s+(?:${units}(?:counted\\s+)?(?:non-?blank\\s+)?(?:source\\s+|data\\s+)?(?:records?|rows?))\\b)`, "i");
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

// Free Impact Assessment disclose-once rule: the measured claims whose
// server-composed disclosure appears, exactly, in a findings-section block
// that cites them. Any other assessment section is a summary block.
const ASSESSMENT_FINDINGS_MARKER = "[[assessment:evidence_findings]]\n";
function assessmentSummaryBlock(block) {
  const text = String(block?.text ?? "");
  return /^\[\[assessment:[a-z_]+\]\]\n/.test(text) && !text.startsWith(ASSESSMENT_FINDINGS_MARKER);
}

function assessmentFindingsDisclosedClaimIds(blocks, claimById) {
  const disclosed = new Set();
  for (const block of blocks || []) {
    const text = String(block?.text ?? "");
    if (!text.startsWith(ASSESSMENT_FINDINGS_MARKER)) continue;
    for (const citation of block.citations || []) {
      const claim = claimById.get(citation.claimId);
      if (!claim || claim.evidenceItemId !== citation.evidenceItemId) continue;
      const body = (claim.limitationCodes || []).some(isMeasuredClaimCode) ? measuredClaimDisclosure(claim) : null;
      if (body && text.includes(body)) disclosed.add(claim.claimId);
    }
  }
  return disclosed;
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

// ---------------------------------------------------------------------------
// Document statement authority (owner Package 4, 2026-11-10). A cited source
// document statement licenses reporting what the SOURCE says, never that KAI
// established it. Identified by provenance: the server gives every claim from
// document-statement evidence the source-reported code, and its meaning codes
// from the persisted excerpt (documentGenerationLimitationCodes). Applied per
// sentence of a block that cites such a claim:
// - a quantity that only a cited document claim states (not a cited measured
//   or other claim) must be attributed to the source, must not be presented
//   as calculated, verified or established by KAI, and - when the source gave
//   it as an estimate - must keep estimate or uncertainty wording;
// - a completed processing step (deduplicated, reconciled, verified, ...) is
//   not asserted from a document: only a cited non-document claim's own words,
//   or a sentence stating that claim's measured number, license it; a source
//   instruction may be reported as an instruction ("must be deduplicated");
// - KAI is not said to have verified, confirmed or established anything a
//   sentence does not support with a cited non-document claim's number.
// A verbatim quotation of a cited excerpt introduced as the source's words is
// the source speaking: only its estimate qualifiers are checked.
const DOCUMENT_SOURCE_CODE = "document.source_reported_not_verified";
const DOCUMENT_ESTIMATE_CODE = "document.source_estimate";
const DOCUMENT_METHOD_CODE = "document.method_or_instruction";
// The source as the subject of a reporting verb ("the management review
// reports", "the programme notes state"), "according to", or the claim's own
// "Source-reported" wording. "As the review's estimate shows" endorses rather
// than attributes, so it is not attribution.
const SOURCE_ATTRIBUTION = new RegExp(
  "\\baccording to\\b|\\bsource[- ]reported\\b|"
  + "\\b(?:sources?|documents?|review|notes|note|report|draft|manager|management|file|pdf|coordinators?|staff)\\b(?:'s)?(?:\\s+[\\w'-]+){0,4}?\\s+"
  + "(?:states?|stated|says|said|reports?|reported|records|recorded|notes|noted|describes?|described|estimates|estimated|mentions?|mentioned|"
  + "recommends?|recommended|requires?|required|calls? for|asks?|asked|instructs?|advises?|advised|gives?|gave|cites?|refers? to|"
  + "puts?|placed|suggests?|suggested|claims?|claimed|indicates?|indicated|tallied|counted|lists?|listed|reads?)\\b",
  "i",
);
const KAI_AUTHORITY = /\b(?:KAI|we|our (?:analysis|calculation|reconciliation|measurement))\b(?:'s)?[^.!?;]{0,40}?\b(?:calculated|computed|established|verified|confirmed|validated|counted|measured|determined|deduplicated|de-duplicated|reconciled|found)\b|\bKAI[- ](?:calculated|verified|measured|established|confirmed)\b/i;
const INDEPENDENT_AUTHORITY = /\b(?:independently (?:verified|confirmed|calculated|established|reconciled|validated)|verified (?:figure|result|count|total|number|distinct))\b/i;
const UNCERTAINTY_KEPT = /\b(?:preliminary|estimate[sd]?|estimated|approximately|approximate|about|around|roughly|rough|tally|at least|at most|nearly|up to|unverified|unreconciled|unconfirmed|not (?:been )?(?:independently )?(?:verified|reconciled|confirmed|established|calculated))\b/i;
const COMPLETED_PROCESSING = /\b(?:deduplicated|de-duplicated|reconciled|cross-checked|verified|validated|confirmed|calculated|matched|corrected)\b/gi;
const GUIDED_PROCESSING = /\b(?:should|must|shall|needs? to|ought to|to)\s+(?:not\s+)?(?:be|have been|first be)\s+(?:\w+\s+)?$/i;

function isDocumentGenerationClaim(claim) {
  return (claim?.limitationCodes || []).includes(DOCUMENT_SOURCE_CODE);
}

function canonicalQuantity(literal) {
  return canonicalNumericLiteral(String(literal).replace(/^[-+]/, ""));
}

function blockSentences(text) {
  return String(text || "").split(/(?<=[.!?;])\s+(?=["“(]?[A-Z0-9])/).filter((sentence) => sentence.trim().length > 0);
}

function negatedWithin(sentence, index) {
  return /(?:\bnot|\bnever|n't|\bno)\b(?:\s+\w+){0,3}\s*$/i.test(sentence.slice(Math.max(0, index - 40), index));
}

function affirmativeAuthority(sentence) {
  for (const pattern of [KAI_AUTHORITY, INDEPENDENT_AUTHORITY]) {
    const match = new RegExp(pattern.source, "gi");
    for (const found of sentence.matchAll(match)) {
      if (!/\bnot\b|n't|\bnever\b/i.test(found[0]) && !negatedWithin(sentence, found.index)) return true;
    }
  }
  return false;
}

export function documentStatementAuthorityViolations({ blocks, generationClaims } = {}) {
  const claimById = generationClaimsById(generationClaims || []);
  const violations = [];
  for (const block of blocks || []) {
    const cited = (block.citations || []).map((citation) => claimById.get(citation.claimId)).filter(Boolean);
    const documents = cited.filter(isDocumentGenerationClaim);
    if (documents.length === 0) continue;
    const others = cited.filter((claim) => !isDocumentGenerationClaim(claim));
    const otherText = others.map((claim) => claim.claimStatement || "").join("\n");
    const otherNumbers = new Set(literals(otherText, NUMERIC_LITERAL_PATTERN).map(canonicalQuantity));
    const excerpts = documents.map((claim) => excerptFromDocumentClaimStatement(claim.claimStatement) ?? String(claim.claimStatement || ""));
    const documentQuantities = new Set(excerpts.flatMap(statedQuantities).map(canonicalQuantity).filter((value) => !otherNumbers.has(value)));
    const estimateQuantities = new Set(documents.filter((claim) => claim.limitationCodes.includes(DOCUMENT_ESTIMATE_CODE))
      .flatMap((claim) => documentEstimateQuantities(excerptFromDocumentClaimStatement(claim.claimStatement) ?? "")).map(canonicalQuantity));
    const methodCited = documents.some((claim) => claim.limitationCodes.includes(DOCUMENT_METHOD_CODE));
    // Processing words a cited excerpt itself asserts as done (not as an instruction).
    const sourceAssertedProcessing = new Set(excerpts.flatMap((excerpt) => [...excerpt.matchAll(COMPLETED_PROCESSING)]
      .filter((match) => !GUIDED_PROCESSING.test(excerpt.slice(Math.max(0, match.index - 40), match.index)) && !negatedWithin(excerpt, match.index))
      .map((match) => match[0].toLowerCase())));
    const push = (type) => violations.push({ type, block_ordinal: block.ordinal, section: ASSESSMENT_BLOCK_MARKER.exec(String(block.text ?? ""))?.[1] ?? null });

    // The server's own measurement disclosures are not the model's assertions.
    let text = modelAuthoredText(block.text, others.filter((claim) => (claim.limitationCodes || []).some(isMeasuredClaimCode)));
    // A complete, attributed source statement already preserves the exact
    // excerpt and its qualifications. Recognize the whole statement before
    // parsing shorter quotations: the excerpt may itself contain quotes
    // (for example records marked "confirmed"), which otherwise exposes a
    // source word as an apparent assertion of completed processing. Replace
    // only an exact cited statement; assertions added beside it still run
    // through every authority check below.
    for (const claim of documents) {
      if (excerptFromDocumentClaimStatement(claim.claimStatement) !== null) {
        text = text.split(claim.claimStatement).join(" [quoted source statement] ");
      }
    }
    // Verbatim quotations of a cited excerpt, introduced as the source's own words.
    text = text.replace(/"([^"\n]+)"|“([^”\n]+)”/g, (whole, straight, curly, offset, full) => {
      const quotation = straight ?? curly;
      const lead = full.slice(Math.max(0, offset - 160), offset).split(/(?<=[.!?])\s+/).at(-1) ?? "";
      if (!excerpts.some((excerpt) => excerpt.includes(quotation)) || !SOURCE_ATTRIBUTION.test(lead)) return whole;
      const quotedEstimates = statedQuantities(quotation).map(canonicalQuantity).filter((value) => estimateQuantities.has(value));
      if (quotedEstimates.length > 0 && !UNCERTAINTY_KEPT.test(quotation) && !UNCERTAINTY_KEPT.test(lead)) push("document_estimate_qualifier_dropped");
      return " [quoted source words] ";
    });

    for (const sentence of blockSentences(text)) {
      const sentenceNumbers = statedQuantities(sentence).map(canonicalQuantity);
      const measuredSentence = sentenceNumbers.some((value) => otherNumbers.has(value));
      const documentOnly = sentenceNumbers.filter((value) => documentQuantities.has(value));
      const attributed = SOURCE_ATTRIBUTION.test(sentence);
      const authority = affirmativeAuthority(sentence);
      if (documentOnly.length > 0) {
        if (!attributed || authority) push("document_value_presented_as_established");
        if (documentOnly.some((value) => estimateQuantities.has(value)) && !UNCERTAINTY_KEPT.test(sentence)) push("document_estimate_qualifier_dropped");
      } else if (authority && !measuredSentence) {
        push("document_statement_presented_as_verified");
      }
      if (measuredSentence) continue;
      for (const match of sentence.matchAll(COMPLETED_PROCESSING)) {
        const word = match[0].toLowerCase();
        if (negatedWithin(sentence, match.index) || GUIDED_PROCESSING.test(sentence.slice(Math.max(0, match.index - 40), match.index))) continue;
        if (new RegExp(`\\b${word}\\b`, "i").test(otherText)) continue;
        if (!methodCited && attributed && !authority && sourceAssertedProcessing.has(word)) continue;
        push("document_guidance_presented_as_completed");
        break;
      }
    }
  }
  return violations;
}

// A fiscal or calendar year range written short ("FY 2024-25") names its two
// years: it is read as "2024-2025" in the draft and in the cited statements,
// so it is supported exactly when those years are (owner direction
// 2026-11-10: an ordinary period label is not an unsupported number).
function expandShortYearRanges(text) {
  return String(text ?? "").replace(/\b((19|20)\d{2})([-–/])(\d{2})\b(?![-–/]\d)/g, (whole, first, century, dash, tail) => (
    Number(`${century}${tail}`) > Number(first) ? `${first}${dash}${century}${tail}` : whole));
}

export function unsupportedAssertionViolations({ blocks, generationClaims } = {}) {
  const claimById = generationClaimsById(generationClaims || []);
  const violations = [...documentStatementAuthorityViolations({ blocks, generationClaims })];
  for (const block of blocks || []) {
    // A cited derived measurement's server-composed plain reading
    // (kaiImpactFindingReading.js) is governed text from the same persisted
    // measurement and the organization's recorded interpretation, so it
    // supports a figure or term exactly as the claim statement does.
    const citedStatements = (block.citations || [])
      .flatMap((citation) => {
        const claim = claimById.get(citation.claimId);
        return [claim?.claimStatement || "", claim?.plainReading || ""].map(expandShortYearRanges);
      })
      .filter(Boolean);
    const citedText = citedStatements.join("\n");
    const text = expandShortYearRanges(block.text);
    const marker = ASSESSMENT_BLOCK_MARKER.exec(text);
    const section = marker ? marker[1] : null;
    const allowedNumbers = new Set(citedStatements.flatMap((statement) => literals(statement, NUMERIC_LITERAL_PATTERN)).map(canonicalNumericLiteral));
    // Owner direction 2026-11-12: what the block's own wording says a cited
    // paired outcome shows (share, comparison, count, direction, programme
    // causation) must agree with that outcome's governed split and recorded
    // direction. The cited claims' governed text is not the block's own
    // assertion. A count for a derived group verified here ("21 of 36 did
    // not report an increase" = unchanged + lower) is a supported number.
    const citedClaims = unique((block.citations || []).map((citation) => claimById.get(citation.claimId)).filter(Boolean));
    const outcomes = citedPairedOutcomes(citedClaims);
    let interpretation = null;
    if (outcomes.length > 0) {
      let own = marker ? text.slice(marker[0].length) : text;
      for (const claim of citedClaims) {
        for (const governed of [claim.plainReading, claim.claimStatement, claim.modelClaimStatement]) {
          if (typeof governed === "string" && governed.length > 0) own = own.split(expandShortYearRanges(governed)).join("\n");
        }
        const disclosure = (claim.limitationCodes || []).some(isMeasuredClaimCode) ? measuredClaimDisclosure(claim) : null;
        if (disclosure) own = own.split(disclosure).join("\n");
      }
      own = own.replace(DISCLOSURE_PREFIX_PATTERN, "\n");
      const otherLabels = citedClaims.filter((claim) => claim.impactReading && claim.impactReading.kind !== "paired_outcome").map((claim) => claim.impactReading.indicator).filter(Boolean);
      interpretation = outcomeInterpretationViolations({ text: own, outcomes, otherLabels });
      for (const value of interpretation.supportedLiterals) allowedNumbers.add(canonicalNumericLiteral(value));
    }
    for (const numericLiteral of unique(literals(text, NUMERIC_LITERAL_PATTERN))) {
      if (!allowedNumbers.has(canonicalNumericLiteral(numericLiteral))) {
        violations.push({ type: "numeric_literal", block_ordinal: block.ordinal, section, literal: numericLiteral });
      }
    }
    let causalText = marker ? text.replace(ASSESSMENT_REPORT_TERMINOLOGY, " ") : text;
    // A negated group phrase verified against the cited split above ("did
    // not report an increase") is a description of the numbers, not a cause.
    for (const { clause, text: phrase } of interpretation?.verifiedPhrases || []) causalText = causalText.split(clause).join(clause.split(phrase).join(" "));
    for (const causalLiteral of unique(literals(causalText, CAUSAL_PATTERN))) {
      if (!citedText.includes(causalLiteral)) violations.push({ type: "causal_language", block_ordinal: block.ordinal, section, literal: causalLiteral });
    }
    for (const violation of interpretation?.violations || []) {
      violations.push({ type: "outcome_interpretation", block_ordinal: block.ordinal, section, literal: violation.literal, reason: violation.reason });
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
  generationClaims = (generationClaims || []).map((claim) => ({
    ...claim, limitationCodes: withoutLegacyStoryLimitations(claim.limitationCodes),
  }));
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
  // In an Evidence Summary block (owner prompt,
  // 2026-11-01), a forbidden word counts only when asserted, not negated
  // ("not independently verified", "not unique"); the records are never
  // asserted to be distinct/unique unless a cited statement itself says so;
  // and every coverage dimension that is not clear must be named, not merely
  // "limitations". The model-authored text must also not contradict the
  // period, coverage or counted-unit state (evidenceSummaryContradicts).
  // Every other block keeps exactly the rules above.
  if ((generationClaims || []).some((claim) => (claim.limitationCodes || []).some(isMeasuredClaimCode))) {
    const disclosureViolations = [];
    // Free Impact Assessment (owner direction 2026-11-11): each measured
    // claim's limitations are disclosed once, in full, in the findings
    // section block that states it, instead of after every summary,
    // recommendation or next-step block that also cites it. A summary block
    // still may not contradict any limitation (the "forbids" checks below run
    // on every block); only the repeated disclosure is no longer required.
    const disclosedInFindings = assessmentFindingsDisclosedClaimIds(blocks, claimById);
    for (const block of blocks || []) {
      const cited = (block.citations || []).map((citation) => claimById.get(citation.claimId)).filter(Boolean);
      const codes = new Set(cited.flatMap((claim) => (claim.limitationCodes || []).filter(isMeasuredClaimCode)));
      const summaryBlock = assessmentSummaryBlock(block);
      const requiredCodes = new Set(cited
        .filter((claim) => !(summaryBlock && disclosedInFindings.has(claim.claimId)))
        .flatMap((claim) => (claim.limitationCodes || []).filter(isMeasuredClaimCode)));
      const text = block.text || "";
      const evidenceSummaryRules = contentType === EVIDENCE_SUMMARY_CONTENT_TYPE;
      const contradicts = (pattern) => (evidenceSummaryRules ? affirmativeMatches(text, pattern).length > 0 : pattern.test(text));
      for (const rule of [...MEASUREMENT_DISCLOSURE_RULES, ...DERIVED_DISCLOSURE_RULES]) {
        const applies = rule.code ? codes.has(rule.code) : [...codes].some((code) => code.startsWith(rule.codePrefix));
        if (!applies || (evidenceSummaryRules && rule.codePrefix === "coverage.")) continue;
        const required = rule.code ? requiredCodes.has(rule.code) : [...requiredCodes].some((code) => code.startsWith(rule.codePrefix));
        if (required && ![rule.requires].flat().every((pattern) => pattern.test(text))) disclosureViolations.push({ type: "limitation_not_disclosed", block_ordinal: block.ordinal });
        if (rule.forbids && contradicts(rule.forbids)) disclosureViolations.push({ type: "limitation_contradicted", block_ordinal: block.ordinal });
      }
      if (evidenceSummaryRules) {
        if ([...requiredCodes].some((code) => code.startsWith("coverage.") && !namesCoverageDimension(text, code))) {
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

  // VAL-GEN-010 now checks attributed output quotations, for every source and
  // content type. A source checkbox or historical limitation marker is never
  // proof of a quotation, consent, or a reason to run a different validator.
  const ungroundedQuotes = [];
  let hasQuotation = false;
  for (const block of blocks || []) {
    const cited = (block.citations || []).map((citation) => claimById.get(citation.claimId)?.claimStatement || "");
    const text = String(block.text || "");
    for (const match of text.matchAll(/"([^"\n]+)"|“([^”\n]+)”/g)) {
      // Typographic quotes and storytelling headings are presentation. A
      // statement attributed to a speaker/source is independently factual.
      const prefix = text.slice(Math.max(0, match.index - 120), match.index);
      if (!/\b(?:said|says|told|reported|wrote|writes|stated|recounted)\b[^.!?\n]{0,60}$/i.test(prefix)) continue;
      hasQuotation = true;
      const quotation = match[1] ?? match[2];
      if (!cited.some((statement) => statement.includes(quotation))) ungroundedQuotes.push(block.ordinal);
    }
  }
  if (hasQuotation) {
    results.push(ungroundedQuotes.length === 0
      ? pass("VAL-GEN-010")
      : blocker("VAL-GEN-010", "unsupported_quotation", { block_ordinals: unique(ungroundedQuotes) }));
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
