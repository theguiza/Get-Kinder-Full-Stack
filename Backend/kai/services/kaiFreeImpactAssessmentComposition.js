import { DOCUMENT_EVIDENCE_TYPE } from "../validators/kaiDocumentEvidenceValidators.js";

/**
 * Free Impact Assessment composition (owner prompt "KAI — Finish the
 * six-section Free Impact Assessment", 2026-11-04).
 *
 * The assessment is an internal `evidence_summary` draft whose blocks are
 * grouped into six fixed sections. It reuses the existing persistence
 * (generated_content_blocks: ordinal 1..20, text 1..4000, one or more
 * citations per block), validators, GK review, release and export; no new
 * content type, table or migration is needed. Each block's section is the
 * marker on its first line, which every renderer that knows the assessment
 * turns into a heading and every other renderer shows as plain text.
 *
 * The model writes the first three sections (and optionally a gaps
 * narrative). The server composes, from the cited claims only:
 * - a one-line note when no participant's own account is cited;
 * - what the measured results suggest (strengths, results needing attention,
 *   the clarification an unresolved outcome needs);
 * - the documented gaps, each grounded in the claims that carry it;
 * - up to three recommendations, each a proposed action (never an outcome)
 *   tied to one documented gap, with its basis and what it could show;
 * - the next steps the organization can take now.
 *
 * Gap detection reads only established signals: a calculation's own
 * limitation codes (records excluded, duplicates counted once, a matched
 * subset, a duration subtotal, an outcome direction not stated), a recorded
 * potential conflict, and a document statement that itself reports the same
 * weakness. A review that has not happened, a source-reported statement that
 * is not independently corroborated, a story-permission flag or a validation
 * dimension that does not apply is not a programme gap (owner direction
 * 2026-11-20). Nothing here is specific to one organization. The composed
 * text contains no digits and none of the causal or verification words
 * VAL-GEN-004/-008 refuse, so it passes the same validators as model text.
 */

export const FREE_IMPACT_ASSESSMENT_COMPOSITION = "free_impact_assessment";

export const ASSESSMENT_SECTIONS = Object.freeze([
  Object.freeze({ key: "executive_snapshot", title: "Executive Impact Snapshot" }),
  Object.freeze({ key: "evidence_findings", title: "What Your Evidence Tells Us" }),
  Object.freeze({ key: "impact_stories", title: "Impact Stories" }),
  Object.freeze({ key: "gaps_opportunities", title: "Gaps and Opportunities" }),
  Object.freeze({ key: "recommended_improvements", title: "Recommended Improvements" }),
  Object.freeze({ key: "next_steps", title: "Your Next Steps" }),
]);

// The titles the model is given for the sections it writes. The customer
// titles above name the report ("Executive Impact Snapshot", "Impact
// Stories"); handing those to the model while forbidding causal "impact"
// language invited exactly the wording VAL-GEN-004 refuses. Renderers keep
// the customer titles; only the model's context uses these.
const MODEL_SECTION_TITLES = Object.freeze({
  executive_snapshot: "Executive Snapshot",
  evidence_findings: "What the Evidence Records",
  impact_stories: "Programme Account from Cited Statements",
  gaps_opportunities: "What the Evidence Does Not Yet Show",
});

const SECTION_KEYS = ASSESSMENT_SECTIONS.map((section) => section.key);
const SECTION_INDEX = new Map(SECTION_KEYS.map((key, index) => [key, index]));

// Sections the model writes; the first three are required, the gaps
// narrative is optional (the server always adds the documented gaps).
export const MODEL_SECTION_KEYS = Object.freeze(["executive_snapshot", "evidence_findings", "impact_stories", "gaps_opportunities"]);
const REQUIRED_MODEL_SECTION_KEYS = Object.freeze(["executive_snapshot", "evidence_findings", "impact_stories"]);
export const MAX_MODEL_ASSESSMENT_BLOCKS = 12;
export const RECOMMENDATION_COUNT = 3;

const MARKER_PATTERN = /^\[\[assessment:([a-z_]+)\]\]\n/;

export function assessmentSectionMarker(sectionKey) {
  return `[[assessment:${sectionKey}]]`;
}

export function withAssessmentSection(sectionKey, body) {
  return `${assessmentSectionMarker(sectionKey)}\n${body}`;
}

/** { sectionKey, body } for a marked block text, or null. */
export function parseAssessmentBlockText(text) {
  const match = MARKER_PATTERN.exec(String(text ?? ""));
  if (!match || !SECTION_INDEX.has(match[1])) return null;
  return { sectionKey: match[1], body: String(text).slice(match[0].length) };
}

/**
 * The six sections of a persisted or released assessment, or null when the
 * blocks are not one: every block marked, sections in order, all six present,
 * up to three recommendations.
 */
export function parseFreeImpactAssessment(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  const ordered = [...blocks].sort((a, b) => a.ordinal - b.ordinal);
  const sections = ASSESSMENT_SECTIONS.map((section) => ({ ...section, blocks: [] }));
  let last = -1;
  for (const block of ordered) {
    const parsed = parseAssessmentBlockText(block.text);
    if (!parsed) return null;
    const index = SECTION_INDEX.get(parsed.sectionKey);
    if (index < last) return null;
    last = index;
    sections[index].blocks.push({ ...block, body: parsed.body });
  }
  if (sections.some((section) => section.blocks.length === 0)) return null;
  if (sections[SECTION_INDEX.get("recommended_improvements")].blocks.length > RECOMMENDATION_COUNT) return null;
  return sections;
}

export function isFreeImpactAssessmentBlocks(blocks) {
  return parseFreeImpactAssessment(blocks) !== null;
}

// ---------------------------------------------------------------------------
// Documented gaps.

const STORY_PATTERN = /\b(?:stor(?:y|ies)|quotes?|quotations?|testimon\w*|permission|consent)\b/i;

// Each entry is a weakness, missing essential information, conflict or
// opportunity that a calculation or a recorded fact establishes:
// - `codes` / `readingSignals`: the measured claims that carry it (their own
//   limitation codes, or the plain reading's signal);
// - `documentPattern`: a document statement naming the same subject, cited
//   beside the measured basis (it never creates the gap on its own);
// - `documentWeakness` with `documentGap`: a document statement that itself
//   reports the weakness (subject and problem in its own words), which may
//   ground the gap when no calculation carries it.
// Each recommendation states the proposed action; `learning` states what
// the organization could learn from it. A review that has not happened, an
// attributed source statement, story permission and a check that does not
// apply to the evidence are never gaps (owner direction 2026-11-20).
const PROBLEM_WORDS = /\b(?:missing|not recorded|not always recorded|incomplete|blank|cannot|unable|inconsistent|not captured)\b/i;
const GAP_CATALOGUE = Object.freeze([
  // Owner direction 2026-11-11: outcome results come first. An outcome whose
  // direction is not stated needs one clarification; a favourable outcome is
  // something to build on. Both are grounded in the cited measurement only.
  Object.freeze({
    key: "outcome_direction_unresolved",
    codes: ["derived.direction_not_established"],
    gap: "For at least one outcome measure, the organization has not yet stated whether a higher value is better, so its change between baseline and follow-up is reported only as a numerical change.",
    recommendation: "Record, on each outcome measure that does not yet state it, whether a higher value is better (a short confirmation on the measurement in Knowledge Studio).",
    learning: "The next assessment can then describe the change for participants in the organization's own terms instead of as a numerical change only.",
    nextStep: "confirm whether a higher value is better for each outcome measure that does not yet state it",
  }),
  Object.freeze({
    key: "favourable_outcome_to_build_on",
    readingSignals: ["favourable"],
    gap: "At least one outcome measure moved in the direction the organization states is better for more than half of the comparable participants, but it describes only participants with both a baseline and a follow-up value.",
    recommendation: "Build on the outcome that is moving in the right direction: record the same baseline and follow-up rating for every new participant, at intake and at a fixed follow-up point, and review the results each quarter with programme staff.",
    learning: "The organization can see whether the favourable pattern holds for later participants and where it does not.",
    nextStep: "agree the fixed follow-up point and who will review the outcome ratings each quarter",
  }),
  Object.freeze({
    key: "outcome_movement_limited",
    readingSignals: ["favourable_minority", "mixed"],
    // Holds for every split these signals cover (a minority or exactly half
    // moving in the better direction, or no overall direction): it claims no
    // share for the unchanged group, which the finding states exactly.
    gap: "For at least one outcome measure, no more than half of the comparable participants moved in the direction the organization states is better; the others had the same value at follow-up or moved the other way.",
    recommendation: "Ask participants at the follow-up rating what would help them move further on that outcome, and review with programme staff which parts of the programme could do more for participants whose rating stayed the same or moved the other way.",
    learning: "The answers show which parts of the programme participants value and where they need something different.",
    nextStep: "add a short follow-up question asking participants what would help them move further",
  }),
  Object.freeze({
    key: "conflicting_information",
    codes: ["conflict.potential_conflict_recorded", "coverage.conflicting_source_indicators.resolved_risk_flagged"],
    gap: "Some sources may disagree about at least one cited finding; the possible conflict is recorded and has not yet been settled.",
    recommendation: "Compare the disagreeing records side by side, decide which value the organization stands behind, and record that decision with the finding.",
    learning: "The finding can then be stated once, without the disagreement.",
    nextStep: "compare the records behind the finding with a possible conflict",
  }),
  Object.freeze({
    key: "recorded_duration_incomplete",
    codes: ["derived.known_recorded_minutes_subtotal"],
    documentPattern: /\bduration\b/i,
    documentWeakness: [/\b(?:duration|session length|minutes delivered|delivered minutes)\b/i, PROBLEM_WORDS],
    gap: "Session duration is not recorded for each service event, so delivered service time is known only as a subtotal of the events that carry a valid duration.",
    documentGap: "The organization's own documents report that session duration is not always recorded, which limits how delivered service time can be reported.",
    recommendation: "Make session duration a required entry for each completed service event, with a short monthly check for events saved without it.",
    learning: "Delivered service time can then be reported in full rather than as a subtotal.",
    nextStep: "agree who will add the duration check to the service-event record",
  }),
  Object.freeze({
    key: "follow_up_evidence_limited",
    codes: ["derived.matched_subset_only", "derived.measured_population_only"],
    documentPattern: /\b(?:follow-?ups?|check-ins?|convenience sample|census)\b/i,
    documentWeakness: [/\b(?:follow-?ups?|check-ins?|sample)\b/i, /\b(?:convenience sample|not a census|not everyone|only some|could not be reached|not reached)\b/i],
    gap: "Follow-up information describes only the people who were reached or who have comparable observations, so it describes a subset rather than the whole group served.",
    documentGap: "The organization's own documents report that follow-up information covers only some of the people served, so it describes a subset rather than the whole group.",
    recommendation: "Set one follow-up point for each person served (for example, a fixed interval after their last session), use the same outcome choices each time, and record who could not be reached.",
    learning: "Follow-up information then describes a defined group rather than whoever happened to be contacted.",
    nextStep: "choose the follow-up interval and the outcome choices to use from the next period",
  }),
  Object.freeze({
    key: "duplicate_records",
    codes: ["derived.duplicate_event_copies_counted_once", "derived.duplicate_rows_counted", "measurement.duplicate_records_included"],
    documentPattern: /\b(?:duplicates?|duplicated|repeated (?:entries|records))\b/i,
    documentWeakness: [/\b(?:duplicates?|duplicated|repeated (?:entries|records))\b/i, /./],
    gap: "Some service records were entered more than once. The measurements state how repeats were treated, but the repeats remain in the source records.",
    documentGap: "The organization's own documents report repeated entries in its records.",
    recommendation: "Add a duplicate check where service events are entered or exported, so each event is recorded once.",
    learning: "The figures no longer depend on removing repeats afterwards.",
    nextStep: "ask whoever exports the service records to add a duplicate check",
  }),
  Object.freeze({
    key: "records_excluded",
    codes: ["derived.unmatched_identifiers_excluded", "derived.records_without_date_excluded", "derived.conflicting_event_identities_excluded",
      "derived.records_without_identifier_excluded", "derived.observations_excluded", "measurement.blank_records_excluded"],
    gap: "Some records could not be used (for example, records without a date, without a matching identifier, or without a comparable observation); they were excluded and counted.",
    recommendation: "Review the excluded records each month and correct missing dates or identifiers at the source.",
    learning: "Fewer records fall outside the measurements, and the organization can see whether exclusions follow a pattern.",
    nextStep: "set a monthly review of excluded records",
  }),
]);

function isDocumentClaim(claim) {
  return claim?.evidenceType === DOCUMENT_EVIDENCE_TYPE;
}

function isMeasuredClaim(claim) {
  return !isDocumentClaim(claim) && (claim?.limitationCodes || []).some((code) => /^(?:derived|measurement)\./.test(code));
}

function byClaimId(a, b) {
  return a.claimId < b.claimId ? -1 : a.claimId > b.claimId ? 1 : 0;
}

function carriesGap(claim, entry) {
  const codes = claim.limitationCodes || [];
  return (entry.codes || []).some((code) => codes.includes(code));
}

function citationOf(claim) {
  return { claimId: claim.claimId, evidenceItemId: claim.evidenceItemId };
}

function reportsWeakness(claim, entry) {
  const text = claim.claimStatement || "";
  return Array.isArray(entry.documentWeakness) && entry.documentWeakness.every((pattern) => pattern.test(text));
}

/**
 * Every documented gap among the cited claims, in catalogue order. A gap is
 * grounded in the claims that carry it (their own codes or reading signal)
 * and, beside them, the document statements naming the same subject; a
 * document statement alone grounds a gap only when it itself reports the
 * weakness. Only grounded gaps are returned, so every composed block can cite
 * its basis. `gap.text` is the wording that fits the grounding.
 */
export function detectAssessmentGaps(claims) {
  const list = [...(claims || [])].sort(byClaimId);
  const documents = list.filter(isDocumentClaim);
  const measured = list.filter((claim) => !isDocumentClaim(claim));
  const gaps = [];
  for (const entry of GAP_CATALOGUE) {
    const measuredGrounding = entry.readingSignals
      ? measured.filter((claim) => entry.readingSignals.includes(claim.impactReading?.signal))
      : entry.codes ? measured.filter((claim) => carriesGap(claim, entry)) : [];
    if (measuredGrounding.length > 0) {
      const documentGrounding = entry.documentPattern ? documents.filter((claim) => entry.documentPattern.test(claim.claimStatement || "")) : [];
      gaps.push({ key: entry.key, entry, text: entry.gap, documentGrounding, measuredGrounding });
      continue;
    }
    const reported = entry.documentGap ? documents.filter((claim) => reportsWeakness(claim, entry)) : [];
    if (reported.length > 0) gaps.push({ key: entry.key, entry, text: entry.documentGap, documentGrounding: reported, measuredGrounding: [] });
  }
  return assignMeasuredAnchors(gaps);
}

// A gap's citations: its document statements and, only when it has none, one
// measured claim that carries it (so a block repeats as few server-composed
// measurement disclosures as possible). Measured-only gaps share one anchor
// claim where a single claim carries them.
function gapCitations(gap) {
  if (gap.documentGrounding.length > 0) return gap.documentGrounding.map(citationOf);
  return [citationOf(gap.anchor || gap.measuredGrounding[0])];
}

function assignMeasuredAnchors(gaps) {
  const measuredOnly = gaps.filter((gap) => gap.documentGrounding.length === 0);
  const candidates = new Map();
  for (const gap of measuredOnly) {
    for (const claim of gap.measuredGrounding) {
      const entry = candidates.get(claim.claimId) || { claim, count: 0 };
      entry.count += 1;
      candidates.set(claim.claimId, entry);
    }
  }
  const ranked = [...candidates.values()].sort((a, b) => b.count - a.count || byClaimId(a.claim, b.claim));
  for (const gap of measuredOnly) {
    gap.anchor = ranked.find((entry) => gap.measuredGrounding.some((claim) => claim.claimId === entry.claim.claimId))?.claim ?? null;
  }
  return gaps;
}

function storyEvidenceCited(claims) {
  // No KAI evidence type carries a consented participant story; a story can
  // reach an assessment only through a future, separately reviewed type.
  return (claims || []).some((claim) => claim?.evidenceType === "participant_story");
}

/** The context the model receives beside the governed claim projection. */
export function buildAssessmentModelContext(claims) {
  return {
    composition: FREE_IMPACT_ASSESSMENT_COMPOSITION,
    modelSections: MODEL_SECTION_KEYS.map((key) => ({ key, title: MODEL_SECTION_TITLES[key], required: REQUIRED_MODEL_SECTION_KEYS.includes(key) })),
    participantStoryEvidence: storyEvidenceCited(claims) ? "cited" : "none_cited",
    documentedGaps: detectAssessmentGaps(claims).map((gap) => ({
      key: gap.key,
      gap: gap.text,
      claimIds: [...gap.documentGrounding, ...gap.measuredGrounding].map((claim) => claim.claimId),
    })),
  };
}

const QUOTED_SPAN = /"([^"]{4,})"|“([^”]{4,})”/g;

/**
 * Whether a model block quotes only words its cited claims contain: an
 * invented quotation (a participant story the evidence does not hold) is
 * refused.
 */
export function quotesOnlyCitedText(text, citedStatements) {
  const cited = citedStatements.join("\n");
  for (const match of String(text || "").matchAll(QUOTED_SPAN)) {
    const quoted = (match[1] ?? match[2]).trim();
    if (!cited.includes(quoted)) return false;
  }
  return true;
}

function sentenceList(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

// ---------------------------------------------------------------------------
// What the results suggest (owner direction 2026-11-11): a server-composed
// reading of the selected measurements' plain-language readings
// (kaiImpactFindingReading.js) - strengths, results needing attention, the
// one clarification an unresolved outcome needs, and whether any outcome
// evidence is selected at all. It restates only what those readings say.

function readingOf(claim) {
  return claim?.impactReading || null;
}

/** The headline results of the selected claims, most important first, with their citations. */
export function assessmentHeadlines(claims) {
  const list = [...(claims || [])].sort(byClaimId);
  const ranked = [
    ...list.filter((claim) => readingOf(claim)?.kind === "paired_outcome" && readingOf(claim).directionKnown),
    ...list.filter((claim) => readingOf(claim)?.kind === "reach" && readingOf(claim).headline),
    ...list.filter((claim) => readingOf(claim)?.kind === "rate"),
    ...list.filter((claim) => readingOf(claim)?.kind === "paired_outcome" && !readingOf(claim).directionKnown),
  ].filter((claim) => readingOf(claim).headline);
  return ranked.slice(0, 5).map((claim) => ({ claim, text: readingOf(claim).headline }));
}

/** The composed snapshot body when the model's own snapshot is not usable, or null. */
export function composeAssessmentSnapshot(claims) {
  const headlines = assessmentHeadlines(claims);
  if (headlines.length === 0) return null;
  return {
    body: `The most important findings from the selected evidence:\n${sentenceList(headlines.map((item) => item.text))}\nEach is explained, with its limitations, in the next section.`,
    citations: headlines.map((item) => citationOf(item.claim)),
  };
}

function resultsAnalysis(claims) {
  const list = [...(claims || [])].sort(byClaimId);
  const lines = [];
  const cited = [];
  const add = (claim, line) => { lines.push(line); if (!cited.includes(claim)) cited.push(claim); };
  const outcomes = list.filter((claim) => readingOf(claim)?.kind === "paired_outcome");
  for (const claim of outcomes) {
    const reading = readingOf(claim);
    // "Working well" only when more than half of the comparable participants
    // moved in the stated direction; a minority (or exactly half) is some
    // progress, not success.
    if (reading.signal === "favourable") add(claim, `Working well: ${reading.headline}.`);
    if (reading.signal === "favourable_minority") add(claim, `Some progress: ${reading.headline}.`);
  }
  for (const claim of outcomes) {
    const reading = readingOf(claim);
    if (reading.signal === "unfavourable" || reading.signal === "mixed") add(claim, `Needs attention: ${reading.headline}.`);
  }
  for (const claim of list.filter((item) => readingOf(item)?.kind === "rate")) {
    add(claim, `Reported result: ${readingOf(claim).headline}; it describes only those who answered or were counted, so it is an indication rather than a result for everyone served.`);
  }
  for (const claim of outcomes) {
    const reading = readingOf(claim);
    if (reading.clarification) add(claim, reading.clarification);
  }
  const reach = list.find((claim) => readingOf(claim)?.kind === "reach" && readingOf(claim).headline);
  if (outcomes.length === 0) {
    const anchor = reach || list.find((claim) => readingOf(claim) && readingOf(claim).kind !== "activity") || null;
    if (anchor) {
      add(anchor, "No baseline and follow-up outcome measure is among the selected evidence, so these results show the organization's activity and reach, not yet what changed for the people it served. "
        + "Recording a simple outcome measure at the start and at a later point would let a future assessment describe change.");
    }
  }
  if (lines.length === 0) return null;
  return { body: `What the results suggest:\n${sentenceList(lines)}`, citations: cited.map(citationOf) };
}

// Every selected measured claim is stated, with its full disclosure, in the
// findings section; a claim the model's findings did not cite is stated in
// its plain reading (or governed statement), grouped by identical
// limitations so one disclosure covers each group.
function uncitedFindings(bySection, claims) {
  const cited = new Set(bySection.get("evidence_findings").flatMap((block) => (block.citations || []).map((citation) => citation.claimId)));
  const missing = [...(claims || [])].filter((claim) => isMeasuredClaim(claim) && !cited.has(claim.claimId)).sort(byClaimId);
  const groups = new Map();
  for (const claim of missing) {
    const key = [...(claim.limitationCodes || [])].sort().join(",");
    groups.set(key, [...(groups.get(key) || []), claim]);
  }
  return [...groups.values()].map((group) => ({
    text: withAssessmentSection("evidence_findings", group.map((claim) => claim.plainReading || claim.modelClaimStatement || claim.claimStatement).join(" ")),
    citations: group.map(citationOf),
  }));
}

/**
 * The full assessment: the model's marked blocks in section order, then the
 * server-composed blocks. Returns { ok: true, blocks } (ordinals 1..n) or
 * { ok: false, reason } with a closed reason.
 */
export function composeFreeImpactAssessmentBlocks({ modelBlocks, claims }) {
  const claimById = new Map((claims || []).map((claim) => [claim.claimId, claim]));
  const bySection = new Map(SECTION_KEYS.map((key) => [key, []]));
  if (!Array.isArray(modelBlocks) || modelBlocks.length === 0 || modelBlocks.length > MAX_MODEL_ASSESSMENT_BLOCKS) {
    return { ok: false, reason: "assessment_model_block_count_invalid" };
  }
  for (const block of modelBlocks) {
    const parsed = parseAssessmentBlockText(block.text);
    if (!parsed || !MODEL_SECTION_KEYS.includes(parsed.sectionKey) || parsed.body.trim().length === 0) {
      return { ok: false, reason: "assessment_model_section_invalid" };
    }
    const cited = (block.citations || []).flatMap((citation) => [claimById.get(citation.claimId)?.claimStatement || "", claimById.get(citation.claimId)?.plainReading || ""]);
    if (!quotesOnlyCitedText(parsed.body, cited)) return { ok: false, reason: "assessment_quotation_not_in_cited_evidence" };
    bySection.get(parsed.sectionKey).push(block);
  }
  if (REQUIRED_MODEL_SECTION_KEYS.some((key) => bySection.get(key).length === 0)) {
    return { ok: false, reason: "assessment_model_section_missing" };
  }

  bySection.get("evidence_findings").push(...uncitedFindings(bySection, claims));

  const gaps = detectAssessmentGaps(claims);
  // A one-line fact, not a task: the stories section draws on the
  // organization's records and documents, and no participant's own words
  // are presented. A document statement about stories or permission is cited
  // when one is selected.
  if (!storyEvidenceCited(claims)) {
    const storyStatements = [...(claims || [])].filter((claim) => isDocumentClaim(claim) && STORY_PATTERN.test(claim.claimStatement || "")).sort(byClaimId);
    const fallback = bySection.get("impact_stories")[0].citations;
    bySection.get("impact_stories").push({
      text: withAssessmentSection("impact_stories",
        "No participant's own account is among the selected evidence, so this section draws on the organization's records and documents only."),
      citations: storyStatements.length > 0 ? storyStatements.map(citationOf) : fallback.map((citation) => ({ ...citation })),
    });
  }

  const analysis = resultsAnalysis(claims);
  if (analysis) bySection.get("gaps_opportunities").push({ text: withAssessmentSection("gaps_opportunities", analysis.body), citations: analysis.citations });

  const documented = gaps;
  if (documented.length > 0) {
    const citations = [];
    const seen = new Set();
    for (const gap of documented) {
      for (const citation of gapCitations(gap)) {
        const key = `${citation.claimId}:${citation.evidenceItemId}`;
        if (!seen.has(key)) { seen.add(key); citations.push(citation); }
      }
    }
    bySection.get("gaps_opportunities").push({
      text: withAssessmentSection("gaps_opportunities", `Documented gaps in the cited evidence:\n${sentenceList(documented.map((gap) => gap.text))}`),
      citations,
    });
  }

  // Up to three proposals, one per established gap in catalogue order; no
  // proposal is added to reach a count.
  const chosen = gaps.slice(0, RECOMMENDATION_COUNT);
  const fallbackCitations = modelBlocks[0].citations.map((citation) => ({ ...citation }));
  if (documented.length === 0) {
    bySection.get("gaps_opportunities").push({
      text: withAssessmentSection("gaps_opportunities", "The selected evidence does not establish a specific weakness or gap. That does not mean none exists; the assessment covers only the selected evidence."),
      citations: fallbackCitations,
    });
  }
  if (chosen.length === 0) {
    bySection.get("recommended_improvements").push({
      text: withAssessmentSection("recommended_improvements", "The selected evidence does not establish a specific change to propose. Choose which further information would show where a change is needed."),
      citations: fallbackCitations,
    });
  }
  for (const gap of chosen) {
    bySection.get("recommended_improvements").push({
      text: withAssessmentSection("recommended_improvements",
        `Proposed change: ${gap.entry.recommendation} Basis: ${gap.text} What it could show: ${gap.entry.learning}`),
      citations: gapCitations(gap),
    });
  }

  // Actions the organization can take now: the proposals' first steps, and
  // reuse of this assessment for its own reporting. No review, release or
  // approval step is listed; none is needed to use the assessment.
  const nextSteps = [
    chosen.length > 0
      ? `Decide which proposed change to try first, then ${chosen.map((gap) => gap.entry.nextStep).join("; ")}.`
      : "Choose which further information would help most, and add it before the next assessment.",
    "Reuse this assessment for internal planning, a board update, a funder report or an annual-report section; its figures, sources and limitations carry over.",
  ];
  const nextCitations = [];
  const nextSeen = new Set();
  for (const citation of chosen.flatMap(gapCitations)) {
    const key = `${citation.claimId}:${citation.evidenceItemId}`;
    if (nextSeen.has(key) || (nextCitations.length > 0 && isMeasuredClaim(claimById.get(citation.claimId)))) continue;
    nextSeen.add(key);
    nextCitations.push(citation);
  }
  bySection.get("next_steps").push({ text: withAssessmentSection("next_steps", sentenceList(nextSteps)), citations: nextCitations.length > 0 ? nextCitations : fallbackCitations });

  const blocks = SECTION_KEYS.flatMap((key) => bySection.get(key))
    .map((block, index) => ({ ordinal: index + 1, text: block.text, citations: block.citations.map((citation) => ({ claimId: citation.claimId, evidenceItemId: citation.evidenceItemId })) }));
  if (blocks.length > 20) return { ok: false, reason: "assessment_block_count_exceeded" };
  if (!isFreeImpactAssessmentBlocks(blocks)) return { ok: false, reason: "assessment_structure_invalid" };
  return { ok: true, blocks };
}

export const __freeImpactAssessmentCompositionTestables = Object.freeze({ GAP_CATALOGUE, STORY_PATTERN, MODEL_SECTION_TITLES });
