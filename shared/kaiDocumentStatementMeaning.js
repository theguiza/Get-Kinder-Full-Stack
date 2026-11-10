/**
 * What a source document statement is (owner Package 4, 2026-11-10), shared
 * by the server (claim, generation and report boundaries) and Knowledge
 * Studio, so both name a statement the same way. Pure; no I/O.
 *
 * The persisted excerpt is the only input, so the meaning is recomputed
 * identically after any reload and needs no new column. It is a reading of
 * the source's own words, never proof of truth, an executed measurement or a
 * review decision. Two meanings matter, because they are the two a document
 * can be mistaken for when it is drafted from:
 * - a source estimate: a sentence giving a quantity with the source's own
 *   estimate or approximation wording ("at least 90 different people", "a
 *   rough tally"); it is not a KAI calculation;
 * - a method or instruction: a requirement or recommendation about how
 *   something should be done ("must be deduplicated"); it does not show that
 *   it was done.
 * A year, a fiscal-year label or a page/line locator is not a quantity.
 */

export const DOCUMENT_EVIDENCE_STATEMENT_PREFIX = "Source document statement";
export const DOCUMENT_CLAIM_STATEMENT_PREFIX = "Source-reported, not independently verified";

export const DOCUMENT_MEANING_CODES = Object.freeze({
  SOURCE_ESTIMATE: "document.source_estimate",
  METHOD_OR_INSTRUCTION: "document.method_or_instruction",
});

const ESTIMATE_WORDING = /\b(?:estimated?|estimates|preliminary|approximately|approximate|approx|roughly|rough|tally|at least|at most|about|around|nearly|up to|or so)\b/i;
const METHOD_OR_INSTRUCTION_WORDING = /\b(?:should|must|shall|requires?|required|needs? to|ought to|recommend(?:s|ed|ation)?)\b/i;
const ABBREVIATIONS = /\b(e\.g|i\.e|etc|vs|approx|fig|dr|mr|mrs|ms|inc|ltd|cf|al)\.$/i;

/**
 * Sentences of one paragraph, split after terminal punctuation followed by
 * whitespace and an opening capital, digit or quote; common abbreviations
 * and decimals ("65.8%") never split.
 */
export function splitDocumentSentences(paragraph) {
  const sentences = [];
  let start = 0;
  const pattern = /[.!?]["'”’)\]]*(?=\s+["“'(]?[A-Z0-9])/g;
  let match;
  while ((match = pattern.exec(paragraph)) !== null) {
    const end = match.index + match[0].length;
    const candidate = paragraph.slice(start, end).trim();
    if (ABBREVIATIONS.test(paragraph.slice(start, match.index + 1))) continue;
    if (candidate) sentences.push(candidate);
    start = end;
  }
  const rest = paragraph.slice(start).trim();
  if (rest) sentences.push(rest);
  return sentences;
}

/**
 * The quantities a text states: numbers that are not a year (1900-2099), the
 * second half of a range or fiscal-year label ("2024-25"), or a locator number
 * after page/block/line/sentence. Each is returned as written.
 */
export function statedQuantities(text) {
  const source = String(text ?? "");
  const out = [];
  for (const match of source.matchAll(/(?<![\p{L}\p{N}_.,-])\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\p{L}\p{N}_.,-])\d+(?:\.\d+)?/gu)) {
    const literal = match[0];
    if (/^(?:19|20)\d{2}$/.test(literal)) continue;
    if (/\b(?:pages?|blocks?|lines?|sentences?)\s+(?:\d+\s*[-–]\s*)?$/i.test(source.slice(Math.max(0, match.index - 24), match.index))) continue;
    out.push(literal);
  }
  return out;
}

/** The quantities that one of the excerpt's sentences states with estimate wording. */
export function documentEstimateQuantities(excerpt) {
  return [...new Set(splitDocumentSentences(String(excerpt ?? ""))
    .filter((sentence) => ESTIMATE_WORDING.test(sentence))
    .flatMap(statedQuantities))];
}

export function documentStatementMeaningCodes(excerpt) {
  const text = String(excerpt ?? "");
  return [
    ...(documentEstimateQuantities(text).length > 0 ? [DOCUMENT_MEANING_CODES.SOURCE_ESTIMATE] : []),
    ...(METHOD_OR_INSTRUCTION_WORDING.test(text) ? [DOCUMENT_MEANING_CODES.METHOD_OR_INSTRUCTION] : []),
  ];
}

/** "source_estimate", "source_method_or_instruction", or null (neither). */
export function documentStatementMeaning(excerpt) {
  const codes = documentStatementMeaningCodes(excerpt);
  if (codes.includes(DOCUMENT_MEANING_CODES.SOURCE_ESTIMATE)) return "source_estimate";
  if (codes.includes(DOCUMENT_MEANING_CODES.METHOD_OR_INSTRUCTION)) return "source_method_or_instruction";
  return null;
}

/** The excerpt a composed document evidence or claim statement quotes, or null. */
export function documentExcerptFromStatement(statement) {
  if (typeof statement !== "string") return null;
  if (!statement.startsWith(`${DOCUMENT_EVIDENCE_STATEMENT_PREFIX} (`) && !statement.startsWith(`${DOCUMENT_CLAIM_STATEMENT_PREFIX} (`)) return null;
  const open = statement.indexOf('): "');
  if (open < 0 || !statement.endsWith('"')) return null;
  return statement.slice(open + 4, -1);
}

/** How Knowledge Studio names a document statement of this meaning. */
export function documentStatementTypeLabel(statement) {
  const meaning = documentStatementMeaning(documentExcerptFromStatement(statement));
  if (meaning === "source_estimate") return "From a document: the source's estimate (not calculated by KAI)";
  if (meaning === "source_method_or_instruction") return "From a document: the source's method or guidance (not a completed step)";
  return "From a document";
}
