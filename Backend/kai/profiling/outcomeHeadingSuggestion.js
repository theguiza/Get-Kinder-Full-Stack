/**
 * A suggested short name for a numeric outcome column, derived from the
 * column's spreadsheet heading while the P1 profiler holds the worksheet in
 * memory (Measurement Intelligence: source-attributed meaning suggestions).
 *
 * What is retained is never the heading itself: only a normalized
 * description, and only when the heading passes a screen written for
 * outcome-column headings. Anything the screen cannot positively admit gives
 * no suggestion (fail closed), so the existing neutral clarification stays.
 *
 * The suggestion is not a meaning. It grants nothing, opens no gate and is
 * never a claim, evidence statement, report text or model input (Storage
 * contract VAL-INT-004/005; P0 dictionary rule: no machine-generated business
 * meaning as approved text). A person may insert it into the existing
 * indicator-label field; only their submission through the existing
 * interpretation route records anything.
 *
 * Screen (lexical, deterministic):
 * - Characters: ASCII letters, digits and the separators space, _ - . / and
 *   parentheses only. Anything else (@, :, =, quotes, angle brackets, other
 *   scripts, control or formatting characters) refuses the heading, so an
 *   email address, URL, markup or instruction punctuation never passes.
 * - The committed profile's metadata-only CHECK words and the statement
 *   unsafe-text words (credentials, secrets, contact details, links, paths)
 *   refuse it.
 * - Digits are admitted only as one trailing range ("1_to_5", "(1-5)"),
 *   which is kept as something the heading states, not as a verified scale.
 *   Any other number (a participant or record code, a phone number) refuses.
 * - Words: 2-24 ASCII letters, one consistent heading style (snake/lower,
 *   sentence case, Title Case, UPPER, or one camelCase word). A capitalized
 *   word inside an otherwise lower-case heading is treated as a possible
 *   proper name and refuses it.
 * - Controlled vocabulary (closes the name leak found at 2353499c, where
 *   "Jane Doe Readiness Score" or "jane_doe_readiness_score" was kept as
 *   "Jane doe readiness score"): every word must be a listed
 *   measurement-description word, score word or connector. Casing cannot
 *   tell a name from a concept, so any unlisted word (a name, a code, an
 *   unfamiliar term) gives no suggestion. Listed words exclude common given
 *   names and surnames that are also ordinary words (hope, grace, joy,
 *   young, king, price ...), so such a heading also fails closed.
 *   Social-impact topics (housing, mental wellbeing, income, substance use
 *   ...) are listed: a measurement category is not personal identifying
 *   data, and the suggestion is shown only to the organization that uploaded
 *   the file. Person, contact, identifier, free-text, secret and instruction
 *   words are also refused explicitly.
 * - At least one score word and one other descriptive word are required;
 *   "score_2" or "rating" alone says nothing about what is measured.
 * Nothing infers a score direction, evidence basis, period or causation.
 */

export const OUTCOME_HEADING_SUGGESTION_SOURCE = "spreadsheet_column_heading";
export const MAX_OUTCOME_HEADING_CHARACTERS = 80;
export const MAX_OUTCOME_HEADING_SUGGESTION_CHARACTERS = 60;
const MAX_WORDS = 8;

const ALLOWED_CHARACTERS_RE = /^[A-Za-z0-9 _.\/()–-]+$/;
// kai.gate_a_p0_jsonb_metadata_only (the committed profile CHECK) and the
// evidence/claim statement unsafe-text pattern.
const REFUSED_TEXT_RE = /(raw_bytes|raw_text|raw_content|prompt|signed_url|credential|secret|token|password|private_path|pii|email|phone|address|https?|www|api[_ -]?key|bearer|stack ?trace|traceback)/i;
const TRAILING_RANGE_RE = /[\s_.\/-]*\(?\s*(\d{1,3})(?:[\s_]*to[\s_]*|\s*[-–]\s*)(\d{1,3})\s*\)?\s*$/i;
const OUTPUT_RE = /^[A-Z][a-z]+(?: [a-z]+){1,7}(?: \(\d{1,3}-\d{1,3}\))?$/;

const SCORE_WORDS = new Set(["score", "scores", "rating", "rated", "scale", "index", "points", "level"]);
const CONNECTOR_WORDS = new Set(["a", "of", "to", "and", "the", "for", "in", "on", "at", "per", "out", "or", "with"]);
// Words that describe what an outcome measures. Deliberately closed: a word
// that is not listed (including any personal name) gives no suggestion.
// Words that are also common given names or surnames are left out.
const DESCRIPTION_WORDS = new Set([
  // Employment, skills and learning.
  "employment", "employability", "job", "jobs", "work", "workplace", "career", "careers", "readiness", "ready", "training",
  "interview", "search", "skills", "skill", "knowledge", "learning", "education", "educational", "school", "academic",
  "attendance", "achievement", "progress", "literacy", "numeracy", "reading", "writing", "math", "maths", "language",
  "communication", "digital", "computer", "technology", "online", "leadership", "teamwork", "problem", "solving",
  "decision", "making", "goal", "goals", "attainment", "motivation", "aspiration", "aspirations",
  // Wellbeing and health.
  "confidence", "self", "esteem", "efficacy", "wellbeing", "wellness", "mental", "emotional", "physical", "health",
  "healthy", "resilience", "coping", "stress", "anxiety", "depression", "distress", "mood", "sleep", "pain", "mobility",
  "activity", "fitness", "exercise", "functioning", "optimism", "hopefulness", "satisfaction", "quality", "life",
  "substance", "use", "recovery", "sobriety", "harm", "reduction", "symptom", "symptoms", "severity",
  // Housing, food and money.
  "housing", "tenancy", "stability", "stable", "homelessness", "food", "security", "insecurity", "nutrition",
  "income", "financial", "finances", "adequacy", "budgeting", "savings", "money", "debt", "poverty",
  // Social connection, family and community.
  "social", "connection", "connectedness", "isolation", "loneliness", "belonging", "community", "engagement",
  "participation", "inclusion", "family", "parenting", "relationship", "relationships", "support", "supports",
  "civic", "volunteering", "trust", "safety", "safe", "independence", "independent", "living", "autonomy", "agency",
  "empowerment", "access", "service", "services", "need", "needs", "risk", "protective", "factors", "behaviour",
  "behavior", "conduct", "functional",
  // Neutral qualifiers.
  "overall", "total", "general", "personal", "perceived", "reported", "change",
]);
const REFUSED_WORDS = new Set([
  // A person or how to reach them.
  "name", "names", "firstname", "lastname", "surname", "fullname", "nickname", "initials", "signature",
  "dob", "birth", "birthdate", "birthday", "mobile", "cell", "postal", "postcode", "zip", "street", "contact",
  "sin", "ssn", "passport", "licence", "license", "account",
  "staff", "worker", "caseworker", "coach", "facilitator", "assessor", "interviewer", "recorded", "entered", "by",
  // Identifier and free-text fields, which are not measurements.
  "id", "identifier", "code", "number", "no", "ref", "reference", "key", "uuid",
  "note", "notes", "comment", "comments", "remark", "remarks", "story", "quote", "narrative", "text",
  // Secrets.
  "passwd", "passcode", "pin", "login", "username", "private", "confidential", "ssh",
  // Instructions to a system or a reader.
  "ignore", "disregard", "forget", "instruction", "instructions", "system", "assistant", "approve", "approved",
  "approval", "export", "delete", "drop", "execute", "run", "override", "bypass", "jailbreak", "admin",
  "select", "insert", "update", "script", "click", "you", "your", "must", "should", "please", "reveal",
  "send", "print", "output", "respond", "reply", "pretend", "previous", "all",
]);

function wordStyle(word) {
  if (/^[a-z]+$/.test(word)) return "lower";
  if (/^[A-Z][a-z]+$/.test(word)) return "capitalized";
  if (/^[A-Z]{2,}$/.test(word)) return "upper";
  if (/^[a-z]+(?:[A-Z][a-z]+)+$/.test(word)) return "camel";
  if (/^(?:[A-Z][a-z]+){2,}$/.test(word)) return "pascal";
  return null;
}

// The heading's words in lower case, or null when the heading mixes styles
// in a way that may hide a proper name.
function headingWords(body) {
  const parts = body.split(/[\s_.\/-]+/).filter(Boolean);
  if (parts.length === 0) return null;
  const styles = parts.map(wordStyle);
  if (styles.some((style) => style === null)) return null;
  if (parts.length === 1) {
    if (styles[0] === "camel" || styles[0] === "pascal") return parts[0].split(/(?=[A-Z])/).map((word) => word.toLowerCase());
    return [parts[0].toLowerCase()];
  }
  if (styles.some((style) => style === "camel" || style === "pascal")) return null;
  const lower = (index) => styles[index] === "lower";
  const consistent = styles.every((style) => style === "lower")
    || styles.every((style) => style === "upper")
    || (styles[0] === "capitalized" && styles.slice(1).every((style) => style === "lower"))
    || (styles[0] === "capitalized" && styles.every((style, index) => style === "capitalized"
      || (lower(index) && CONNECTOR_WORDS.has(parts[index]))));
  return consistent ? parts.map((word) => word.toLowerCase()) : null;
}

/**
 * The suggested short name for an outcome column heading, or null when no
 * safe, useful suggestion can be derived. Pure; the heading is not retained.
 */
export function suggestOutcomeHeading(heading) {
  if (typeof heading !== "string") return null;
  const raw = heading.normalize("NFKC").trim();
  if (raw.length === 0 || raw.length > MAX_OUTCOME_HEADING_CHARACTERS) return null;
  if (!ALLOWED_CHARACTERS_RE.test(raw) || REFUSED_TEXT_RE.test(raw)) return null;
  const range = TRAILING_RANGE_RE.exec(raw);
  let rangeText = "";
  let body = raw;
  if (range) {
    const [low, high] = [Number(range[1]), Number(range[2])];
    if (!(low < high)) return null;
    rangeText = ` (${low}-${high})`;
    body = raw.slice(0, range.index);
  }
  if (/[\d()–]/.test(body)) return null;
  const words = headingWords(body);
  if (!words || words.length < 2 || words.length > MAX_WORDS) return null;
  if (words.some((word) => REFUSED_WORDS.has(word))) return null;
  if (words.some((word) => !DESCRIPTION_WORDS.has(word) && !SCORE_WORDS.has(word) && !CONNECTOR_WORDS.has(word))) return null;
  if (words.some((word) => !CONNECTOR_WORDS.has(word) && (word.length < 2 || word.length > 24))) return null;
  if (!words.some((word) => SCORE_WORDS.has(word))) return null;
  if (!words.some((word) => !SCORE_WORDS.has(word) && !CONNECTOR_WORDS.has(word))) return null;
  if (CONNECTOR_WORDS.has(words[0])) return null;
  const text = `${words[0][0].toUpperCase()}${words[0].slice(1)}${words.length > 1 ? ` ${words.slice(1).join(" ")}` : ""}${rangeText}`;
  if (text.length > MAX_OUTCOME_HEADING_SUGGESTION_CHARACTERS || !OUTPUT_RE.test(text) || REFUSED_TEXT_RE.test(text)) return null;
  return text;
}

/**
 * Whether a stored value is exactly a suggestion this screen produces (the
 * screen is idempotent on its own output). Every reader applies it, so a
 * value the current screen would not produce is never served.
 */
export function isAdmittedOutcomeHeadingSuggestion(value) {
  return typeof value === "string" && suggestOutcomeHeading(value) === value;
}

/**
 * The suggestions for one worksheet's numeric outcome candidates, keyed by
 * field key. Two candidates that would get the same suggestion are
 * ambiguous, so neither gets one.
 */
export function summarizeOutcomeHeadingSuggestions(outcomes) {
  const suggested = outcomes
    .map(({ fieldKey, heading }) => ({ fieldKey, text: suggestOutcomeHeading(heading) }))
    .filter((entry) => entry.text !== null);
  const counts = new Map();
  for (const entry of suggested) counts.set(entry.text.toLowerCase(), (counts.get(entry.text.toLowerCase()) ?? 0) + 1);
  return Object.freeze(Object.fromEntries(suggested
    .filter((entry) => counts.get(entry.text.toLowerCase()) === 1)
    .map((entry) => [entry.fieldKey, entry.text])));
}

/**
 * The served form of the committed suggestion for one numeric outcome field
 * of one worksheet of a committed profile, or null. Readers pass the exact
 * profile the measurement was calculated from (matched by its canonical
 * hash), so the suggestion stays bound to that source version, profile,
 * worksheet and field. The current screen is applied again here.
 */
export function committedOutcomeHeadingSuggestion(profile, { worksheetKey, outcomeFieldKey }) {
  const sheet = Array.isArray(profile?.sheets) ? profile.sheets.find((candidate) => candidate?.sheet_key === worksheetKey) : null;
  const basis = sheet?.paired_outcome_basis;
  const outcomes = basis?.candidates?.numeric_outcome;
  const suggestions = basis?.outcome_heading_suggestions;
  if (!Array.isArray(outcomes) || !outcomes.includes(outcomeFieldKey) || !suggestions || typeof suggestions !== "object") return null;
  const value = Object.hasOwn(suggestions, outcomeFieldKey) ? suggestions[outcomeFieldKey] : null;
  return isAdmittedOutcomeHeadingSuggestion(value)
    ? Object.freeze({ suggested_label: value, derived_from: OUTCOME_HEADING_SUGGESTION_SOURCE })
    : null;
}
