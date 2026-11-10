import { createHash } from "node:crypto";
import { __evidenceCoverageAssessmentValidatorsTestables } from "./kaiEvidenceCoverageAssessmentValidators.js";
import {
  DOCUMENT_CLAIM_STATEMENT_PREFIX,
  DOCUMENT_EVIDENCE_STATEMENT_PREFIX,
  DOCUMENT_MEANING_CODES,
  documentEstimateQuantities,
  documentExcerptFromStatement,
  documentStatementMeaning,
  documentStatementMeaningCodes,
  splitDocumentSentences,
  statedQuantities,
} from "../../../shared/kaiDocumentStatementMeaning.js";

export { DOCUMENT_MEANING_CODES, documentEstimateQuantities, documentStatementMeaningCodes, splitDocumentSentences, statedQuantities };

/**
 * KAI document-statement evidence (pure; no SQL, no I/O).
 *
 * A promoted PDF or plain-text source version has no data-dictionary fields,
 * so P2-01's field-presence composition never yields evidence from it. This
 * module turns the governed text of such a document (read by
 * documentContentReader.js, never persisted by it) into candidate evidence:
 * complete, citable statements the document itself makes, each kept
 * verbatim (only line breaks and runs of whitespace are normalized) with a
 * page/block or line locator and the SHA-256 of the excerpt.
 *
 * It is deterministic: no model reads the text, and no statement is
 * paraphrased, summarized, scored or completed. A document with no complete
 * statement yields no candidate rather than an invented one. A statement is
 * what the source says, not a verified fact: every evidence item and claim
 * composed here says so, and keeps the excerpt's own qualifiers, periods,
 * populations, denominators and limitations because it is the excerpt.
 *
 * Text that reads as an instruction to a system or reviewer (prompt
 * injection) is excluded, never interpreted; nothing in a document can set a
 * review status, an approval or an allowed use - those columns are pinned by
 * the schema and written only by the existing human review paths.
 */

export const DOCUMENT_EVIDENCE_TYPE = "source_document_statement";
export const DOCUMENT_EVIDENCE_DATA_CLASS = "source_document_excerpt";
export const DOCUMENT_EVIDENCE_LOCATOR_TYPE = "document_text_span";
export const DOCUMENT_EVIDENCE_METHOD = "kai_document_statement_excerpt_v1";
export const DOCUMENT_EVIDENCE_VALIDATOR_KEY = "VAL-KAI-DOC-EVIDENCE-001";
export const DOCUMENT_EVIDENCE_OPERATION = "extract_document_statement_evidence";
export const DOCUMENT_EVIDENCE_FORMATS = Object.freeze(["pdf", "txt"]);

/**
 * A completed read of a document version that found no complete statement
 * writes no evidence, so the only committed trace of it is this required,
 * metadata-only audit (reason code bound to the extractor method). The read
 * models use it so that, after a reload, the same immutable version under
 * the same method is not offered an extraction that cannot write anything.
 * A later extractor method has a different reason code and is offered again.
 */
export const DOCUMENT_STATEMENTS_NONE_FOUND_REASON = `document_statements_none_found:${DOCUMENT_EVIDENCE_METHOD}`;

/**
 * SQL predicate (no bind parameters): a none-found audit exists for the
 * source version `versionIdSql` of organization `organizationIdSql`.
 */
export function documentStatementsNoneFoundSql(organizationIdSql, versionIdSql) {
  return `EXISTS (
    SELECT 1 FROM kai.audit_events nf
     WHERE nf.organization_id = ${organizationIdSql}
       AND nf.action = '${DOCUMENT_EVIDENCE_OPERATION}'
       AND nf.reason_code = '${DOCUMENT_STATEMENTS_NONE_FOUND_REASON}'
       AND nf.metadata->>'source_version_id' = (${versionIdSql})::text
  )`;
}

/**
 * Whether the installed schema admits document-statement evidence: the
 * evidence-type and locator-type CHECKs name it (they do once the additive
 * document-evidence migration is applied, and do not before). Read models
 * use the same predicate, so no action is offered that the schema would
 * refuse.
 */
export const DOCUMENT_EVIDENCE_SCHEMA_READY_SQL = `(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint con
     WHERE con.conrelid = to_regclass('kai.evidence_items')
       AND con.conname = 'evidence_items_p2_01_evidence_type_check'
       AND pg_catalog.pg_get_constraintdef(con.oid) LIKE '%source_document_statement%'
  )
  AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint con
     WHERE con.conrelid = to_regclass('kai.source_locators')
       AND con.conname = 'source_locators_p2_01_locator_type_check'
       AND pg_catalog.pg_get_constraintdef(con.oid) LIKE '%document_text_span%'
  )
)`;

/**
 * The extraction a promoted source version actually supports, from its
 * profiled format, its committed dictionary field count and whether the
 * schema admits document-statement evidence:
 * - `document_statements`: a PDF or plain-text document, readable for
 *   statements now;
 * - `document_statements_none_found`: such a document whose text this
 *   extractor method already read and found no complete statement in;
 * - `document_statements_not_enabled`: such a document, but the
 *   document-evidence schema change is not installed;
 * - `field_presence`: committed dictionary fields (P2-01);
 * - `none`: neither (nothing extraction could write);
 * - `unknown`: the inputs are not known (an older read without them).
 */
export function evidenceExtractionCapability({ profileFormat, dictionaryFieldCount, documentEvidenceSupported, documentStatementsNoneFound = false }) {
  if (DOCUMENT_EVIDENCE_FORMATS.includes(profileFormat)) {
    if (documentEvidenceSupported !== true) return "document_statements_not_enabled";
    return documentStatementsNoneFound === true ? "document_statements_none_found" : "document_statements";
  }
  if (Number.isSafeInteger(dictionaryFieldCount) && dictionaryFieldCount > 0) return "field_presence";
  if (dictionaryFieldCount === 0) return "none";
  return "unknown";
}

export const DOCUMENT_EXCERPT_MAX_CHARACTERS = 340;
export const DOCUMENT_STATEMENT_MIN_WORDS = 8;
export const DOCUMENT_STATEMENT_MAX_CANDIDATES = 200;

// Mirrors evidence_items_p2_01_statement_check / claims_p2_03_statement_check.
const PERSISTED_STATEMENT_FORBIDDEN = /(https?:\/\/|\/Users\/|\/private\/|\/var\/|\/etc\/|password|secret|api[_-]?key|token|credential|Bearer\s|stack ?trace|traceback|\s{2}at [A-Za-z])/i;
const PERSISTED_STATEMENT_MAX = 500;

const RESTRICTED_CONTENT_PATTERNS = Object.freeze([
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, // email address
  /\bwww\.[A-Za-z0-9-]+\./i, // web address
  /\b\d{3}[\s.-]\d{3}[\s.-]\d{4}\b/, // telephone number
  /\b\d{3}[\s-]\d{3}[\s-]\d{3}\b/, // national identifier shape
  /[A-Za-z]:\\|~\//, // file path
]);

// Instruction-like text: addressed to a system/model, asking it to disregard
// its rules, or an imperative to approve/release/publish something.
const INSTRUCTION_PATTERNS = Object.freeze([
  /\b(ignore|disregard|forget|override|bypass)\b[^.!?]{0,80}\b(instructions?|prompts?|rules?|polic(y|ies)|previous|above|guardrails?|system)\b/i,
  /\b(system prompt|language model|as an ai|you are (now )?(an?|the) (ai|assistant|model|system|reviewer))\b/i,
  /^\s*(system|assistant|user|developer)\s*:/i,
  /^\s*(please\s+)?(approve|mark|set|treat|grant|release|publish|promote|classify|record|accept)\b/i,
  /\b(you|kai|the (ai|assistant|model|system|reviewer))\s+(must|should|shall|will)\s+(now\s+)?(approve|mark|set|treat|grant|release|publish|promote|accept|ignore)\b/i,
]);

const TERMINAL_PUNCTUATION = /[.!?]["'”’)\]]*$/;

export function documentExcerptSha256(excerpt) {
  return createHash("sha256").update(excerpt, "utf8").digest("hex");
}

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

function wordCount(text) {
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
}

// A wrapped line ending in a hyphen continues its word on the next line; the
// hyphen is kept (self-\nreported -> self-reported). Otherwise lines join
// with one space.
function joinLines(lines) {
  let text = "";
  for (const raw of lines) {
    const line = normalizeWhitespace(raw);
    if (!line) continue;
    if (!text) text = line;
    else if (/[A-Za-z]-$/.test(text)) text += line;
    else text += ` ${line}`;
  }
  return text;
}

// A block continues into the next only when it stops mid-sentence: prose of
// at least the minimum length ending in a lower-case word or in a comma,
// semicolon, colon or dash. A running header, a label, a figure or a table
// cell ("62", "Assessed people", "... 2 / 4") never continues.
function continuesSentence(text) {
  return !TERMINAL_PUNCTUATION.test(text)
    && wordCount(text) >= DOCUMENT_STATEMENT_MIN_WORDS
    && /(\b\p{Ll}[\p{L}'’-]*|[,;:–-])$/u.test(text);
}

// A complete statement has a finite verb. Verbless table cells and labels
// ("An improvement rate among all 80 registered people." under a "Not
// established" heading) are not statements and, cut from their table, would
// misstate the source.
const FINITE_VERB = /\b(is|isn't|are|aren't|was|wasn't|were|weren't|be|been|has|have|had|does|doesn't|do|don't|did|didn't|can|cannot|can't|could|should|would|will|won't|may|might|must|shall|describes?|reports?|contains?|carr(?:y|ies)|includes?|shows?|indicates?|captures?|supports?|supplies|requires?|belongs?|reflects?|means?|represents?|remains?|lacked|lacks?|involved|noticed|believes?|found|sought|obtained|discussed|referred|tended|arrived|occurred|increased|decreased|declined|rose|fell|grew|served|delivered|completed|reached|received|pair|compare|resolve|preserve|confirm|review|investigate|replace|count|provides?|provided|serves?|offers?|offered|helps?|helped|runs?|operates?|delivers?|distributes?|uses?|keeps?|kept|gives?|gave|makes?|made|takes?|took|needs?|seeks?|meets?|met|attends?|attended|works?|worked|returns?|returned)\b/i;

// A past-tense verb after its subject ("The food bank distributed ...",
// "Staff recorded ..."); an -ed word after a number, a modifier or a
// capitalized label word ("all 80 registered people", "the full registered
// cohort", a table header "... Not established ...") is not counted.
const SUBJECT_THEN_PAST_TENSE = /\b(I|[Ww]e|[Tt]hey|[Hh]e|[Ss]he|[Ii]t|[Ss]taff|[Tt]eams?|[Pp]eople|[a-z]+(?:s|er|or|ee|ff|ank|ry|ty|cy|nt|ce|ge|ion))\s+(?:also\s+|then\s+|often\s+|later\s+)?[a-z]+ed\b/;

function hasFiniteVerb(sentence) {
  return FINITE_VERB.test(sentence) || SUBJECT_THEN_PAST_TENSE.test(sentence);
}

/**
 * Paragraphs of a governed document read, each with its locator:
 * - txt: runs of non-blank lines; `{ unit: "text_lines", line_start, line_end }`
 *   (the profiler's 1-based line positions).
 * - pdf: consecutive text blocks of one page that continue one sentence (a
 *   prose block not ending in terminal punctuation continues into the next);
 *   `{ unit: "pdf_page_blocks", page_number, block_start, block_end }` (the
 *   profiler's block numbering). A paragraph never spans pages.
 */
export function segmentDocumentParagraphs(document) {
  const paragraphs = [];
  if (document?.format === "txt" && Array.isArray(document.lines)) {
    let current = null;
    document.lines.forEach((line, index) => {
      if (typeof line !== "string" || line.trim().length === 0) {
        if (current) paragraphs.push(current);
        current = null;
        return;
      }
      if (!current) current = { lines: [], locator: { unit: "text_lines", line_start: index + 1, line_end: index + 1 } };
      current.lines.push(line);
      current.locator.line_end = index + 1;
    });
    if (current) paragraphs.push(current);
    return paragraphs.map((paragraph) => ({ text: joinLines(paragraph.lines), locator: paragraph.locator }));
  }
  if (document?.format === "pdf" && Array.isArray(document.pages)) {
    for (const page of document.pages) {
      let buffer = null;
      const flush = () => {
        if (buffer) paragraphs.push({ text: buffer.text, locator: buffer.locator });
        buffer = null;
      };
      for (const block of page.blocks || []) {
        const text = joinLines(block.lines || []);
        if (!text) continue;
        const continues = buffer && continuesSentence(buffer.text);
        if (continues) {
          buffer.text = /[A-Za-z]-$/.test(buffer.text) ? buffer.text + text : `${buffer.text} ${text}`;
          buffer.locator.block_end = block.block_index;
        } else {
          flush();
          buffer = { text, locator: { unit: "pdf_page_blocks", page_number: page.page_number, block_start: block.block_index, block_end: block.block_index } };
        }
        if (TERMINAL_PUNCTUATION.test(buffer.text)) flush();
      }
      flush();
    }
  }
  return paragraphs;
}

// A paragraph that fits is one excerpt (its sentences keep each other's
// context: "It is a convenience sample ..."); a longer one is split into
// consecutive sentence windows that fit. A single sentence that does not fit
// is excluded rather than cut.
function excerptWindows(paragraphText) {
  const sentences = splitDocumentSentences(paragraphText);
  if (paragraphText.length <= DOCUMENT_EXCERPT_MAX_CHARACTERS) {
    return [{ text: paragraphText, sentence_start: 1, sentence_end: sentences.length || 1 }];
  }
  const windows = [];
  let current = null;
  sentences.forEach((sentence, index) => {
    const position = index + 1;
    if (sentence.length > DOCUMENT_EXCERPT_MAX_CHARACTERS) {
      if (current) windows.push(current);
      current = null;
      windows.push({ text: sentence, sentence_start: position, sentence_end: position, too_long: true });
      return;
    }
    if (current && current.text.length + 1 + sentence.length <= DOCUMENT_EXCERPT_MAX_CHARACTERS) {
      current.text = `${current.text} ${sentence}`;
      current.sentence_end = position;
    } else {
      if (current) windows.push(current);
      current = { text: sentence, sentence_start: position, sentence_end: position };
    }
  });
  if (current) windows.push(current);
  return windows;
}

function exclusionReason(text, sentences) {
  if (!TERMINAL_PUNCTUATION.test(text) || wordCount(text) < DOCUMENT_STATEMENT_MIN_WORDS || !/^["“'(]?[\p{Lu}\p{N}]/u.test(text)
    || !sentences.some(hasFiniteVerb)) {
    return "not_a_complete_statement";
  }
  if (sentences.some((sentence) => INSTRUCTION_PATTERNS.some((pattern) => pattern.test(sentence)))) return "instruction_like_text";
  if (RESTRICTED_CONTENT_PATTERNS.some((pattern) => pattern.test(text))) return "restricted_content";
  if (PERSISTED_STATEMENT_FORBIDDEN.test(text)) return "restricted_content";
  return null;
}

export function documentLocatorLabel(coordinates) {
  if (coordinates?.unit === "pdf_page_blocks") {
    const blocks = coordinates.block_start === coordinates.block_end
      ? `block ${coordinates.block_start}`
      : `blocks ${coordinates.block_start}-${coordinates.block_end}`;
    return `page ${coordinates.page_number}, ${blocks}`;
  }
  if (coordinates?.unit === "text_lines") {
    return coordinates.line_start === coordinates.line_end
      ? `line ${coordinates.line_start}`
      : `lines ${coordinates.line_start}-${coordinates.line_end}`;
  }
  return "unknown location";
}

function sentenceLabel(coordinates) {
  return coordinates.sentence_start === coordinates.sentence_end
    ? `sentence ${coordinates.sentence_start}`
    : `sentences ${coordinates.sentence_start}-${coordinates.sentence_end}`;
}

const STATEMENT_PREFIX = DOCUMENT_EVIDENCE_STATEMENT_PREFIX;
const CLAIM_PREFIX = DOCUMENT_CLAIM_STATEMENT_PREFIX;

export function composeDocumentEvidenceStatement({ excerpt, coordinates }) {
  return `${STATEMENT_PREFIX} (${documentLocatorLabel(coordinates)}, ${sentenceLabel(coordinates)}): "${excerpt}"`;
}

export function composeDocumentClaimStatement({ excerpt, coordinates }) {
  return `${CLAIM_PREFIX} (${documentLocatorLabel(coordinates)}): "${excerpt}"`;
}

// The excerpt a composed evidence statement quotes, or null.
export function excerptFromDocumentEvidenceStatement(statement) {
  if (typeof statement !== "string" || !statement.startsWith(`${STATEMENT_PREFIX} (`)) return null;
  const open = statement.indexOf('): "');
  if (open < 0 || !statement.endsWith('"')) return null;
  return statement.slice(open + 4, -1);
}

export function documentLocatorCoordinates({ locator, sentenceStart, sentenceEnd, excerpt }) {
  const base = locator.unit === "pdf_page_blocks"
    ? { unit: "pdf_page_blocks", page_number: locator.page_number, block_start: locator.block_start, block_end: locator.block_end }
    : { unit: "text_lines", line_start: locator.line_start, line_end: locator.line_end };
  return {
    ...base,
    sentence_start: sentenceStart,
    sentence_end: sentenceEnd,
    excerpt_sha256: documentExcerptSha256(excerpt),
    method: DOCUMENT_EVIDENCE_METHOD,
  };
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

// The same shape source_locators_p2_01_coordinates_check admits for a
// document_text_span locator (see the document-evidence migration).
export function isDocumentLocatorCoordinates(coordinates) {
  if (!coordinates || typeof coordinates !== "object" || Array.isArray(coordinates)) return false;
  const common = ["sentence_start", "sentence_end", "excerpt_sha256", "method"];
  const keys = coordinates.unit === "pdf_page_blocks"
    ? ["unit", "page_number", "block_start", "block_end", ...common]
    : coordinates.unit === "text_lines" ? ["unit", "line_start", "line_end", ...common] : null;
  if (!keys) return false;
  if (Object.keys(coordinates).length !== keys.length || !keys.every((key) => Object.hasOwn(coordinates, key))) return false;
  if (coordinates.method !== DOCUMENT_EVIDENCE_METHOD || !/^[a-f0-9]{64}$/.test(coordinates.excerpt_sha256)) return false;
  if (!isPositiveInteger(coordinates.sentence_start) || !isPositiveInteger(coordinates.sentence_end) || coordinates.sentence_end < coordinates.sentence_start) return false;
  if (coordinates.unit === "pdf_page_blocks") {
    return isPositiveInteger(coordinates.page_number) && isPositiveInteger(coordinates.block_start)
      && isPositiveInteger(coordinates.block_end) && coordinates.block_end >= coordinates.block_start;
  }
  return isPositiveInteger(coordinates.line_start) && isPositiveInteger(coordinates.line_end) && coordinates.line_end >= coordinates.line_start;
}

// Qualifiers the excerpt itself carries, detected (never added) so a reader
// sees them as limitations next to the verbatim text.
const SIGNALS = Object.freeze({
  contains_quantity: /\d/,
  contains_period: /\b(19|20)\d{2}\b|\bFY\s?\d{2}|\b(January|February|March|April|May|June|July|August|September|October|November|December)\b|\b(quarter|Q[1-4]|month|year|period|autumn|spring|summer|winter)\b/i,
  contains_population_or_denominator: /\b(of|among|out of)\s+\d+|\bn\s*=\s*\d+|\b\d+\s*\/\s*\d+\b|\bdenominators?\b|\b(cohort|sample|respondents?|participants?|population)\b/i,
  contains_uncertainty: /\b(approximately|about|around|at least|at most|estimated?|preliminary|roughly|may|might|likely|possibly|uncertain|not (yet )?(confirmed|established))\b/i,
  contains_limitation: /\b(not|no|cannot|can't|without|excluded?|only|limited|missing|unknown|unverified)\b/i,
  self_reported: /\bself[- ]?(report(ed|s)?|ratings?|rated|assess(ed|ment)?)\b|\bstaff (believe|remember|noticed|recorded an impression)\b/i,
  contains_interpretation_or_guidance: /\b(believes?|impression|suggests?|appears?|interpretations?|should|recommend(s|ed)?|could|may reflect|we value)\b/i,
});

export function documentStatementSignals(excerpt) {
  return Object.fromEntries(Object.entries(SIGNALS).map(([key, pattern]) => [key, pattern.test(excerpt)]));
}

// The source fact / proposed interpretation distinction, per excerpt.
export function documentAssertionKind(signals) {
  if (signals.contains_interpretation_or_guidance) return "reported_interpretation_or_guidance";
  if (signals.contains_limitation) return "reported_limitation";
  return "reported_fact";
}

export function documentLimitationCodes(excerpt) {
  const signals = documentStatementSignals(excerpt);
  return [
    "document.source_reported_not_verified",
    ...(signals.contains_interpretation_or_guidance ? ["document.contains_interpretation_or_guidance"] : []),
    ...(signals.contains_uncertainty ? ["document.contains_uncertainty"] : []),
    ...(signals.self_reported ? ["document.self_reported"] : []),
  ];
}

// What a document statement is (owner Package 4, 2026-11-10): the shared
// meaning helpers (shared/kaiDocumentStatementMeaning.js), so the server and
// Knowledge Studio name a statement the same way.
/**
 * One label for how a reader should take a document statement, in order of
 * what would most mislead if lost: an estimate, a method or instruction, an
 * interpretation, a limitation or caveat, or a reported observation.
 */
export function documentStatementRole(excerpt) {
  const meaning = documentStatementMeaning(excerpt);
  if (meaning) return meaning;
  const signals = documentStatementSignals(String(excerpt ?? ""));
  if (signals.contains_interpretation_or_guidance) return "source_interpretation";
  if (signals.contains_limitation) return "source_limitation";
  return "source_observation";
}

// The excerpt a composed document claim statement quotes, or null.
export function excerptFromDocumentClaimStatement(statement) {
  return typeof statement === "string" && statement.startsWith(`${CLAIM_PREFIX} (`) ? documentExcerptFromStatement(statement) : null;
}

/**
 * The limitation codes a document statement claim carries into generation and
 * the internal report: its statement codes (documentLimitationCodes) and its
 * meaning codes, all from the quoted excerpt of the persisted claim. A
 * statement that is not a composed document claim still carries the
 * source-reported code, never none.
 */
export function documentGenerationLimitationCodes(claimStatement) {
  const excerpt = excerptFromDocumentClaimStatement(claimStatement);
  if (excerpt === null) return ["document.source_reported_not_verified"];
  return [...new Set([...documentLimitationCodes(excerpt), ...documentStatementMeaningCodes(excerpt)])].sort();
}

const LIMITATION_DESCRIPTIONS = Object.freeze({
  "document.source_reported_not_verified": "This is what the source document states; KAI has not verified it against the underlying records.",
  "document.contains_interpretation_or_guidance": "The statement includes the source's own interpretation or guidance, not only an observed fact.",
  "document.contains_uncertainty": "The statement carries its own uncertainty or estimate wording; keep it when the statement is used.",
  "document.self_reported": "The statement rests on self-reported ratings or staff recollection.",
  [DOCUMENT_MEANING_CODES.SOURCE_ESTIMATE]: "The figure is the source's own estimate; KAI did not calculate or verify it, and it is not a KAI measurement. Keep the source's qualifiers with it.",
  [DOCUMENT_MEANING_CODES.METHOD_OR_INSTRUCTION]: "The statement is a method, requirement or recommendation in the source; it does not show that the step was carried out.",
});

export function describeDocumentLimitationCode(code) {
  return LIMITATION_DESCRIPTIONS[code] ?? null;
}

// Owner direction 2026-11-06: content prepared for an external (funder or
// public) audience omits direct participant identifiers by default and keeps
// the rest of the finding. This generalizes the demonstrated cases only - the
// contact and identifier shapes extraction already recognizes, a personal
// name attached to a participant role noun, and a name given with an age -
// and makes no claim to detect every identifying combination. Source
// records, evidence, citations and internal drafts are unchanged.
const EXTERNAL_IDENTIFIER_REPLACEMENTS = Object.freeze([
  [new RegExp(RESTRICTED_CONTENT_PATTERNS[0].source, "g"), "[contact detail omitted]"],
  [new RegExp(RESTRICTED_CONTENT_PATTERNS[2].source, "g"), "[contact detail omitted]"],
  [new RegExp(RESTRICTED_CONTENT_PATTERNS[3].source, "g"), "[identifier omitted]"],
  [/\b([Pp]articipant|[Cc]lient|[Ss]tudent|[Rr]esident|[Yy]outh|[Mm]ember|[Pp]arent|[Cc]aregiver|[Cc]hild|[Mm]entee|[Tt]enant)\s+(?:named\s+)?\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+)?\b/gu, "$1 [name omitted]"],
  [/\b\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+)?,\s*(?:aged?\s+)?\d{1,2}(?:\s*(?:years? old|yrs?))?,\s*/gu, "[name and age omitted] "],
]);

export function omitDirectIdentifiersForExternalUse(text) {
  if (typeof text !== "string") return text;
  return EXTERNAL_IDENTIFIER_REPLACEMENTS.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), text);
}

/**
 * The candidate document-statement evidence of one governed document read.
 * Returns `{ candidates, exclusions, limited }`: each candidate has its
 * excerpt, locator coordinates, composed statement, signals and assertion
 * kind; exclusions are counted by reason only (their text is not returned).
 */
export function identifyDocumentStatementCandidates(document) {
  const candidates = [];
  const exclusions = {};
  const exclude = (reason) => { exclusions[reason] = (exclusions[reason] || 0) + 1; };
  const seenExcerpts = new Set();
  let limited = false;

  for (const paragraph of segmentDocumentParagraphs(document)) {
    if (!paragraph.text) continue;
    for (const window of excerptWindows(paragraph.text)) {
      if (window.too_long) { exclude("statement_too_long"); continue; }
      const excerpt = normalizeWhitespace(window.text);
      const reason = exclusionReason(excerpt, splitDocumentSentences(excerpt));
      if (reason) { exclude(reason); continue; }
      if (seenExcerpts.has(excerpt)) { exclude("duplicate_excerpt"); continue; }
      const coordinates = documentLocatorCoordinates({ locator: paragraph.locator, sentenceStart: window.sentence_start, sentenceEnd: window.sentence_end, excerpt });
      const statement = composeDocumentEvidenceStatement({ excerpt, coordinates });
      const claimStatement = composeDocumentClaimStatement({ excerpt, coordinates });
      if (statement.length > PERSISTED_STATEMENT_MAX || claimStatement.length > PERSISTED_STATEMENT_MAX || PERSISTED_STATEMENT_FORBIDDEN.test(statement)) {
        exclude("statement_too_long");
        continue;
      }
      if (candidates.length >= DOCUMENT_STATEMENT_MAX_CANDIDATES) { limited = true; exclude("candidate_limit_reached"); continue; }
      seenExcerpts.add(excerpt);
      const signals = documentStatementSignals(excerpt);
      candidates.push({ excerpt, coordinates, statement, signals, assertion_kind: documentAssertionKind(signals) });
    }
  }
  return { candidates, exclusions, limited };
}

/**
 * Claim basis for a document-statement evidence item: the evidence and its
 * locator are a document statement and span of the same version, and the
 * evidence statement is exactly the composition of the excerpt whose hash
 * the locator records - so a claim can only restate the excerpt the locator
 * binds, never other text placed in a statement.
 */
export function validateDocumentClaimBasis({ evidenceItemRow, locatorRow }) {
  const blocked = (reason) => ({
    ok: false,
    code: "validation_blocker",
    blockers: [{
      validator_key: DOCUMENT_EVIDENCE_VALIDATOR_KEY,
      severity: "blocker",
      object_type: "evidence_item",
      object_code: "propose_claim",
      object_id: evidenceItemRow?.evidence_item_id ?? null,
      message: "This document statement no longer matches the excerpt its locator records.",
      blocking_reason: reason,
      required_fix: "Extract evidence from the current source version again.",
      evidence: {},
    }],
  });
  if (evidenceItemRow?.evidence_type !== DOCUMENT_EVIDENCE_TYPE || locatorRow?.locator_type !== DOCUMENT_EVIDENCE_LOCATOR_TYPE) {
    return blocked("document_statement_basis_invalid");
  }
  if (evidenceItemRow.source_locator_id !== locatorRow.source_locator_id || evidenceItemRow.source_version_id !== locatorRow.source_version_id) {
    return blocked("document_statement_basis_invalid");
  }
  const coordinates = locatorRow.coordinates;
  if (!isDocumentLocatorCoordinates(coordinates)) return blocked("document_statement_basis_invalid");
  const excerpt = excerptFromDocumentEvidenceStatement(evidenceItemRow.statement);
  if (excerpt === null || documentExcerptSha256(excerpt) !== coordinates.excerpt_sha256) return blocked("document_statement_excerpt_mismatch");
  if (composeDocumentEvidenceStatement({ excerpt, coordinates }) !== evidenceItemRow.statement) return blocked("document_statement_excerpt_mismatch");
  return { ok: true, excerpt, coordinates };
}

// ---------------------------------------------------------------------------
// Coverage dimensions of a document statement (owner prompt "KAI — Finish the
// six-section Free Impact Assessment", 2026-11-04).
//
// The P2-02 field-level dimensions read a source's data-dictionary fields and
// quality findings. A document statement has neither: its evidence is one
// located excerpt quoted verbatim, so those dimensions came out "unresolved"
// for every statement, and P2-04 asked the organization four questions about
// "the unresolved field or measure" (meaning, denominator, period, entity
// level) of a field that does not exist; their completion records no answer.
// The statement's own form answers them, in the manner of a measurement's
// method: nothing is counted (missing values, duplicates and field coverage
// are clear), and what the words mean, what they count, their denominator and
// their period are the source's own, recorded as known limitations (not as
// resolved facts) and carried into every use. The source-level dimensions
// (small-cell risk, conflicting sources, requirement alignment) are kept
// exactly as assessed, so their review is unchanged.
const { dimensionResult } = __evidenceCoverageAssessmentValidatorsTestables;

export const DOCUMENT_ANSWERED_DIMENSION_KEYS = Object.freeze([
  "definition_clarity",
  "denominator_clarity",
  "time_period_clarity",
  "entity_level_clarity",
]);

// The release limitations of a document statement: its existing statement
// codes (documentLimitationCodes: source-reported, and any interpretation,
// uncertainty or self-report wording in the quoted words), plus every
// coverage dimension that is not clear (accepted or not), exactly as a
// measured claim's coverage codes are composed.
export function documentStatementLimitationCodes({ statement, dimensions }) {
  const text = String(statement ?? "");
  const first = text.indexOf("\"");
  const last = text.lastIndexOf("\"");
  const codes = [...documentLimitationCodes(first >= 0 && last > first ? text.slice(first + 1, last) : text)];
  for (const [dimensionKey, dimension] of Object.entries(dimensions && typeof dimensions === "object" ? dimensions : {})) {
    const status = dimension?.assessment_status;
    if (typeof status !== "string" || status === "resolved_clear") continue;
    codes.push(dimension.internal_limitation_accepted === true
      ? `coverage.${dimensionKey}.accepted_internal_limitation`
      : `coverage.${dimensionKey}.${status}`);
  }
  return [...new Set(codes)].sort();
}

export function applyDocumentStatementCoverageDimensions(dimensions) {
  return {
    ...dimensions,
    missingness: dimensionResult("missingness", "resolved_clear", "The claim quotes one located excerpt; it counts no record values, so none is missing from it."),
    duplicates: dimensionResult("duplicates", "resolved_clear", "The claim quotes one located excerpt; it counts no records."),
    coverage_gaps: dimensionResult("coverage_gaps", "resolved_clear", "The claim relies on no data field; it quotes one located excerpt."),
    definition_clarity: dimensionResult("definition_clarity", "resolved_risk_flagged", "The claim restates the source's own words verbatim; what they mean is the source's statement and was not independently verified."),
    denominator_clarity: dimensionResult("denominator_clarity", "resolved_risk_flagged", "Any quantity in the quoted words is the source's own; no denominator was established for it."),
    time_period_clarity: dimensionResult("time_period_clarity", "resolved_risk_flagged", "The quoted words are not tied to a checked reporting period; any period they mention is the source's own."),
    entity_level_clarity: dimensionResult("entity_level_clarity", "resolved_risk_flagged", "The quoted words name their own subject; what they describe was not established beyond them."),
  };
}

export const __documentEvidenceTestables = Object.freeze({
  INSTRUCTION_PATTERNS,
  RESTRICTED_CONTENT_PATTERNS,
  PERSISTED_STATEMENT_FORBIDDEN,
  excerptWindows,
  joinLines,
});
