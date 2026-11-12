/**
 * Outcome interpretation check (owner direction 2026-11-12, "Close the
 * remaining impact-interpretation integrity gap").
 *
 * VAL-GEN-004 checks that every number in a block is one a cited claim states
 * and that causal words are not added. It never compared the WORDS a model
 * uses to interpret a paired baseline/follow-up outcome with that outcome's
 * counts, so "Most comparable participants did not report a change" (18 of
 * 36, exactly half) or "A majority of participants improved" (15 of 36) was
 * accepted because the block cited a claim with correct figures.
 *
 * This module is that one missing check, used by VAL-GEN-004 for a block that
 * cites a paired outcome whose server reading (kaiImpactFindingReading.js)
 * carries the governed split and the organization's recorded direction. It
 * reads model text sentence by sentence and refuses only what the counts
 * contradict:
 * - a share word for a group: "most" / "a majority" / "more than half" only
 *   for more than half, "half" only for exactly half, "fewer than half" /
 *   "a minority" only for fewer, "all" / "none" exactly, "the largest group"
 *   only for a group larger than each other group;
 * - a stated count for a group ("21 of 36 did not report an increase"), which
 *   must equal that group's count; unchanged is not the same group as not
 *   increased (unchanged + lower);
 * - a comparison ("more ... higher than lower");
 * - progress, improvement or decline wording for an outcome whose better
 *   direction the organization has not stated;
 * - an overall favourable reading (or an unquantified "participants
 *   improved") when no more than half of the comparable participants moved in
 *   the better direction, or no more moved that way than the other;
 * - the programme presented as producing the change (no comparison group is
 *   cited by any paired outcome).
 * Words are never banned on their own: "most", "improved", "majority" and
 * "favourable" are accepted whenever the counts and direction support them.
 *
 * Returns { violations, supportedLiterals }: supportedLiterals are counts the
 * text states for a derived group (for example not increased = unchanged +
 * lower) that were verified against the split here, so VAL-GEN-004's number
 * rule accepts exactly those values in that block.
 */

const NEGATION_BEFORE = /(?:\bnot|\bnever|n't|\bno|\brather than|\binstead of|\bwithout|\bnor|\bneither|\bcannot)\b(?:\s+[\w-]+){0,3}\s*$/i;

function negated(text, index) {
  return NEGATION_BEFORE.test(text.slice(Math.max(0, index - 48), index));
}

// Direction meta-statements ("a higher value is better", "the better
// direction") describe the scale, not what participants did.
const DIRECTION_META = [
  /\b(?:a\s+)?(?:higher|lower)\s+(?:[\w-]+\s+){0,3}?(?:is|are|was|counts as|means|as)\s+(?:better|worse)\b/gi,
  /\bwhich\s+(?:end|direction|value)\s+(?:[\w-]+\s+){0,2}?is\s+(?:better|worse)\b/gi,
  /\bthe direction (?:the organization|it)\s+(?:[\w-]+\s+){0,3}/gi,
];

// Ordered: the negated and derived groups are taken out of the clause before
// the simple groups are looked for, so "did not report an increase" is never
// also read as "increase".
const GROUP_PATTERNS = [
  ["not_improved", /\b(?:did not|didn't|do not|does not|not)\s+(?:report\s+|show\s+|have\s+|see\s+|record\s+)?(?:an?\s+|any\s+)?improv\w*/gi],
  ["not_increased", /\b(?:did not|didn't|do not|does not|not)\s+(?:report\s+|show\s+|have\s+|see\s+|record\s+|give\s+)?(?:an?\s+|any\s+)?(?:increase\w*|higher\b|rise\b|gain\w*)/gi],
  ["not_decreased", /\b(?:did not|didn't|do not|does not|not)\s+(?:report\s+|show\s+|have\s+|see\s+|record\s+|give\s+)?(?:an?\s+|any\s+)?(?:decrease\w*|declin\w*|lower\b|drop\w*|fall\b|fell\b)/gi],
  ["unchanged", /\b(?:did not|didn't|do not|does not)\s+(?:report\s+|show\s+|have\s+|see\s+|record\s+)?(?:a\s+|any\s+)?change\w*|\bno change\b|\bunchanged\b|\bno movement\b|\b(?:the\s+)?same\s+(?:[\w-]+\s+){0,3}?(?:value|score|rating|level|response|answer)s?\b|\b(?:the\s+)?same\s+(?:at|between)\b|\b(?:stayed|remained|stay|remain|was|were)\s+(?:the\s+)?(?:same|unchanged|stable|steady|constant)\b/gi],
  ["better", /\bmoved in the better direction\b|\bimprov\w*|\bbetter\b|\bprogress\w*|\bgain\w*/gi],
  ["worse", /\bmoved in the worse direction\b|\bworse\b|\bdeclin\w*|\bdeteriorat\w*/gi],
  ["higher", /\bhigher\b|\bincreas\w*|\brose\b|\brais\w*/gi],
  ["lower", /\blower\b|\bdecreas\w*|\bdropped\b|\bfell\b/gi],
  ["changed", /\bchanged\b|\b(?:reported|showed|had|recorded|saw)\s+(?:a\s+|any\s+)?change\b/gi],
];

// "Moved in the direction the organization states is better" is the better
// group, said in the organization's terms.
const STATED_BETTER_DIRECTION = /\b(?:moved|movement|moving|move)\s+in\s+the\s+direction\s+(?:that\s+)?(?:the organization|it)\s+(?:[\w-]+\s+){0,3}?(?:is\s+)?(?:better|working towards)\b/gi;

function groupsIn(clause) {
  let rest = clause.replace(STATED_BETTER_DIRECTION, " moved in the better direction ");
  for (const pattern of DIRECTION_META) rest = rest.replace(pattern, " ");
  const found = [];
  for (const [group, pattern] of GROUP_PATTERNS) {
    rest = rest.replace(pattern, (match, ...args) => {
      const offset = args.at(-2);
      const whole = args.at(-1);
      // "not as progress or decline" denies the reading; a negated simple
      // group is not a group the clause assigns anyone to.
      if (!group.startsWith("not_") && group !== "unchanged" && negated(whole, offset)) return " ";
      found.push(group);
      return " ";
    });
  }
  return [...new Set(found)];
}

// The text of a negated-group phrase ("did not report an increase") in a
// clause, so that phrase - verified against the split - is not read as a
// causal claim by VAL-GEN-004.
function negatedGroupPhrases(clause, group) {
  const pattern = GROUP_PATTERNS.find(([key]) => key === group)?.[1];
  return pattern ? [...clause.matchAll(new RegExp(pattern.source, "gi"))].map((match) => match[0]) : [];
}

function groupCount(group, outcome) {
  const { higher, same, lower } = outcome;
  const better = outcome.direction === "higher_is_better" ? higher : outcome.direction === "lower_is_better" ? lower : null;
  const worse = outcome.direction === "higher_is_better" ? lower : outcome.direction === "lower_is_better" ? higher : null;
  switch (group) {
    case "higher": return higher;
    case "lower": return lower;
    case "unchanged": return same;
    case "not_increased": return same + lower;
    case "not_decreased": return same + higher;
    case "changed": return higher + lower;
    case "better": return better;
    case "worse": return worse;
    case "not_improved": return better === null ? null : outcome.pairs - better;
    default: return null;
  }
}

const PRIMARY_GROUPS = new Set(["higher", "lower", "unchanged", "better", "worse"]);
const DERIVED_GROUPS = new Set(["not_increased", "not_decreased", "changed", "not_improved"]);

// The share a clause claims for its group. Approximate words ("about half",
// "nearly half") are not checked; exact ones are.
const QUANTIFIERS = [
  ["approximate", /\b(?:about|around|roughly|nearly|almost|approximately|close to|just under|just over)\s+(?:a\s+)?half\b/i],
  ["at_most_half", /\bno more than half\b|\bnot (?:a )?majority\b|\bnot most\b/i],
  ["minority", /\b(?:fewer|less)\s+than\s+half\b|\bunder\s+half\b|\ba minority\b/i],
  ["majority", /\b(?:more\s+than|over)\s+half\b|\b(?:a|the)\s+majority\b|(?<!\bat\s)\bmost\b(?!\s+(?:common|frequent|important|often|likely))/i],
  ["largest", /\b(?:the\s+)?(?:largest|biggest)\b|\bthe most (?:common|frequent)\b/i],
  ["half", /\bhalf\b/i],
  ["all", /\b(?:all|every)\s+(?:of\s+)?(?:the\s+)?(?:\d+\s+)?(?:comparable\s+)?(?:participants|respondents|people)\b|\beveryone\b/i],
  ["none", /\bnone of the\b|\bno (?:comparable )?participants?\b(?!\s+(?:account|story|stories|quotation))|\bnobody\b|\bno one\b/i],
  ["some", /\bsome\b|\bseveral\b|\ba (?:number|few) of\b|\bmany\b|\bfew\b|\bthose\b|\bwho\b/i],
];

function quantifierOf(clause) {
  for (const [kind, pattern] of QUANTIFIERS) if (pattern.test(clause)) return kind;
  return null;
}

function shareHolds(kind, count, group, outcome) {
  const pairs = outcome.pairs;
  switch (kind) {
    case "majority": return count * 2 > pairs;
    case "half": return count * 2 === pairs;
    case "minority": return count * 2 < pairs;
    case "at_most_half": return count * 2 <= pairs;
    case "all": return count === pairs;
    case "none": return count === 0;
    case "largest": {
      if (!PRIMARY_GROUPS.has(group)) return true;
      const others = [outcome.higher, outcome.same, outcome.lower];
      const index = { higher: 0, unchanged: 1, lower: 2 }[group]
        ?? (group === "better" ? (outcome.direction === "lower_is_better" ? 2 : 0) : (outcome.direction === "lower_is_better" ? 0 : 2));
      return others.every((value, position) => position === index || count > value);
    }
    default: return true;
  }
}

// Counts a clause states: whole numbers that are not a percentage, a decimal
// or the comparable denominator.
function statedCounts(clause, outcome) {
  const values = [];
  for (const match of clause.matchAll(/(?<![\w.,])(\d+(?:\.\d+)?)(%?)(?![\w.,]?\d)/g)) {
    if (match[2] || match[1].includes(".")) continue;
    const value = Number(match[1]);
    if (value === outcome.pairs) continue;
    values.push(value);
  }
  return [...new Set(values)];
}

const COMPARATIVE = /\b(more|fewer|less)\b(?!\s+than\s+half)(.+?)\bthan\b(.+)$/i;

// The programme (or service) presented as producing the observed change.
const PROGRAMME_CAUSATION = /\b(?:the\s+|this\s+|our\s+)?(?:programme|program|project|service|intervention|initiative)(?:'s)?\s+(?:[\w-]+\s+){0,2}?(?:produc(?:es|ed|e)|deliver(?:s|ed)?|achiev(?:es|ed|e)|generat(?:es|ed|e)|brings? about|brought about|creat(?:es|ed|e)|makes?|made|help(?:s|ed)?|improv(?:es|ed|e)|increas(?:es|ed|e)|rais(?:es|ed|e)|boost(?:s|ed)?|caus(?:es|ed|e)|drives?|drove|transform(?:s|ed)?|strengthen(?:s|ed)?|builds?|built|result(?:s|ed)? in|leads? to|led to)\b|\b(?:thanks to|as a result of|because of|owing to|attributable to)\s+(?:the\s+|this\s+|our\s+)?(?:programme|program|project|service|intervention|initiative)\b/gi;

const FAVOURABLE_OVERALL = /\b(?:overall|clear(?:ly)?|strong(?:ly)?|significant(?:ly)?|broad(?:ly)?|general(?:ly)?|substantial(?:ly)?)\s+(?:favourabl\w*|favorabl\w*|positive|improve\w*|better|progress)\b|\b(?:favourable|favorable|positive)\s+(?:[\w-]+\s+)?(?:change|result|outcome|improvement|trend|shift|effect|picture|movement|finding|direction)s?\b|\bworking well\b|\bsuccess(?:ful(?:ly)?)?\b/gi;

const FAVOURABLE_OR_DECLINE = /\bimprov\w*|\bprogress\w*|\bfavourab\w*|\bfavorab\w*|\bunfavourab\w*|\bpositive\b|\bnegative\b|\bbetter\b|\bworse\b|\bgain\w*|\bsuccess\w*|\bbenefit\w*|\bdeclin\w*|\bdeteriorat\w*|\bworking well\b/gi;

// "For at least one outcome measure, ..." holds when any one cited outcome
// supports it.
const EXISTENTIAL = /\bat least one\b|\bone of the (?:outcomes?|measures?)\b/i;

const DIRECTION_UNSTATED_CONTEXT = /\bwhether\b|\b(?:can|could|would) (?:then )?be read as\b|\bonce (?:that|it|this|the direction) is (?:recorded|stated|confirmed)\b|\bnot (?:yet )?(?:been )?(?:stated|established|known|recorded|confirmed|said|clear|defined)\b|\bunresolved\b|\bunknown\b|\bunclear\b/i;

function sentencesOf(text) {
  return String(text || "").split(/(?<=[.!?])\s+(?=["“(]?[A-Z0-9])|\n+/).map((sentence) => sentence.trim()).filter(Boolean);
}

function clausesOf(sentence) {
  return sentence.split(/\s*(?:;|:|\s[-–—]\s|,?\s+but\s+|,?\s+although\s+|,?\s+though\s+|,?\s+while\s+|,?\s+whereas\s+|,?\s+yet\s+|,\s+and\s+)\s*/i).filter((clause) => clause.trim().length > 0);
}

function normalized(text) {
  return String(text || "").toLowerCase().replace(/[-–]/g, " ").replace(/\s+/g, " ");
}

function labelKeys(label) {
  const words = normalized(label).split(" ").filter(Boolean);
  const generic = new Set(["confidence", "score", "scores", "rating", "ratings", "level", "levels"]);
  const keys = [words.join(" ")];
  if (words.length >= 2 && generic.has(words.at(-1))) keys.push(words.slice(0, -1).join(" "));
  return keys.filter((key) => key.length >= 4);
}

const ALL_OUTCOMES = /\b(?:both|each|all|every)\s+(?:of\s+the\s+)?(?:\w+\s+)?(?:outcomes?|measures?|ratings?|results?|self-ratings?)\b/i;

// Which cited outcomes a sentence is about: those it names (by label, or by
// the comparable denominator it states); every one when it speaks of both or
// each; otherwise, when it names none, the single cited outcome or all of
// them (an unnamed statement in a block about several must hold for each).
function outcomesOf(sentence, outcomes, otherLabels) {
  if (ALL_OUTCOMES.test(sentence)) return outcomes;
  const text = normalized(sentence);
  const named = outcomes.filter((outcome) => labelKeys(outcome.label).some((key) => text.includes(key)));
  if (named.length > 0) return named;
  const byDenominator = outcomes.filter((outcome) => new RegExp(`(?<![\\d.])${outcome.pairs}(?![\\d.])`).test(sentence));
  if (byDenominator.length > 0) return byDenominator;
  if (otherLabels.some((label) => labelKeys(label).some((key) => text.includes(key)))) return [];
  return outcomes;
}

function signalFavourable(outcome) {
  const better = groupCount("better", outcome);
  const worse = groupCount("worse", outcome);
  return better !== null && better > worse && better * 2 > outcome.pairs;
}

function phrase(text) {
  return String(text).replace(/\s+/g, " ").trim().slice(0, 40);
}

/**
 * The paired outcomes a block cites, from the server readings on its cited
 * claims: [{ label, direction, pairs, higher, same, lower }].
 */
export function citedPairedOutcomes(citedClaims) {
  const outcomes = [];
  for (const claim of citedClaims || []) {
    const reading = claim?.impactReading;
    const split = reading?.split;
    if (reading?.kind !== "paired_outcome" || !split) continue;
    if (![split.pairs, split.higher, split.same, split.lower].every((value) => Number.isSafeInteger(value) && value >= 0)) continue;
    if (outcomes.some((outcome) => outcome.claimId === claim.claimId)) continue;
    outcomes.push(Object.freeze({
      claimId: claim.claimId,
      label: reading.indicator,
      direction: reading.directionKnown ? reading.direction ?? null : null,
      pairs: split.pairs, higher: split.higher, same: split.same, lower: split.lower,
    }));
  }
  return outcomes;
}

export function outcomeInterpretationViolations({ text, outcomes, otherLabels = [] }) {
  const violations = [];
  const supportedLiterals = new Set();
  const verifiedPhrases = new Set();
  if (!outcomes || outcomes.length === 0) return { violations, supportedLiterals, verifiedPhrases: [] };
  for (const sentence of sentencesOf(text)) {
    for (const match of sentence.matchAll(PROGRAMME_CAUSATION)) {
      if (!negated(sentence, match.index)) violations.push({ reason: "programme_causation", literal: phrase(match[0]) });
    }
    const about = outcomesOf(sentence, outcomes, otherLabels);
    if (about.length === 0) continue;
    const directionStatedHere = !DIRECTION_UNSTATED_CONTEXT.test(sentence);
    const perOutcome = [];

    for (const outcome of about) {
      const found = [];
      perOutcome.push(found);
      const refuse = (reason, literal) => found.push({ reason, literal: phrase(literal) });
      // Progress or decline wording for an outcome whose better direction
      // the organization has not stated.
      if (outcome.direction === null && directionStatedHere) {
        let meta = sentence;
        for (const pattern of DIRECTION_META) meta = meta.replace(pattern, (match) => " ".repeat(match.length));
        for (const match of meta.matchAll(FAVOURABLE_OR_DECLINE)) {
          if (!negated(meta, match.index)) { refuse("direction_unresolved", match[0]); break; }
        }
      }
      // An overall favourable reading the split does not support.
      if (outcome.direction !== null && !signalFavourable(outcome)) {
        for (const match of sentence.matchAll(FAVOURABLE_OVERALL)) {
          if (!negated(sentence, match.index)) { refuse("overall_favourable_not_supported", match[0]); break; }
        }
      }

      for (const clause of clausesOf(sentence)) {
        const comparative = COMPARATIVE.exec(clause);
        if (comparative) {
          const left = groupsIn(comparative[2]);
          const right = groupsIn(comparative[3]);
          if (left.length === 1 && right.length === 1) {
            const a = groupCount(left[0], outcome);
            const b = groupCount(right[0], outcome);
            if (a !== null && b !== null && (comparative[1].toLowerCase() === "more" ? !(a > b) : !(a < b))) refuse("comparison_not_supported", clause);
            continue;
          }
        }
        const groups = groupsIn(clause);
        if (groups.length === 0) continue;
        const quantifier = quantifierOf(clause);
        const counts = statedCounts(clause, outcome);
        if (groups.length === 1) {
          const group = groups[0];
          const count = groupCount(group, outcome);
          if (count === null) continue; // better/worse with no stated direction: refused above.
          const before = found.length;
          if (quantifier && !shareHolds(quantifier, count, group, outcome)) refuse("share_not_supported", clause);
          if (counts.length === 1) {
            if (counts[0] !== count) refuse("count_not_supported", clause);
            else if (DERIVED_GROUPS.has(group)) supportedLiterals.add(String(count));
          }
          // "A majority, 21 of 36, did not report an increase": a negated
          // group whose share or count the split confirms describes the
          // numbers, not a cause.
          if ((group === "not_increased" || group === "not_decreased") && found.length === before
            && ((quantifier && quantifier !== "some" && quantifier !== "approximate") || counts.length === 1)) {
            for (const text of negatedGroupPhrases(clause, group)) verifiedPhrases.add(JSON.stringify([clause, text]));
          }
          // "Participants improved" with no share or count, when the split
          // does not show a favourable change overall.
          if (group === "better" && !quantifier && counts.length === 0 && !signalFavourable(outcome)) {
            const at = clause.search(/\bimprov\w*|\bbetter\b|\bprogress\w*|\bgain\w*/i);
            if (at >= 0 && !negated(clause, at)) refuse("overall_favourable_not_supported", clause);
          }
          continue;
        }
        // Several groups in one clause ("15 rated higher, 18 the same and 3
        // lower"): each part that names one group and one count is checked.
        for (const part of clause.split(/,\s*|\s+and\s+/)) {
          const partGroups = groupsIn(part);
          const partCounts = statedCounts(part, outcome);
          if (partGroups.length !== 1 || partCounts.length !== 1) continue;
          const count = groupCount(partGroups[0], outcome);
          if (count === null) continue;
          if (partCounts[0] !== count) refuse("count_not_supported", part);
          else if (DERIVED_GROUPS.has(partGroups[0])) supportedLiterals.add(String(count));
        }
      }
    }
    // An existential statement fails only when no cited outcome supports it.
    if (EXISTENTIAL.test(sentence) && perOutcome.some((found) => found.length === 0)) continue;
    for (const found of perOutcome) violations.push(...found);
  }
  // A phrase is exempt only when no violation was found anywhere in the text.
  // Each verified phrase is returned with the clause it was verified in, so
  // only that occurrence is exempt.
  return { violations, supportedLiterals, verifiedPhrases: violations.length === 0 ? [...verifiedPhrases].map((entry) => JSON.parse(entry)).map(([clause, text]) => ({ clause, text })) : [] };
}

export const __outcomeInterpretationTestables = Object.freeze({ groupsIn, quantifierOf, clausesOf, outcomesOf });
