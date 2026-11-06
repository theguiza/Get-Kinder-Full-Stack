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
 * - the missing participant-story statement, when no story evidence is cited;
 * - the documented gaps, each grounded in the claims that carry it;
 * - up to three recommendations, each a proposed change (never an outcome)
 *   tied to one documented gap and citing the claims that ground it;
 * - the next steps, from the draft's governance state (internal only).
 *
 * Gap detection reads only structural signals: limitation codes on measured
 * claims, the document-statement evidence type, and, for a document
 * statement, whether its quoted words name the gap's subject. Nothing here
 * is specific to one organization. The composed text contains no digits and
 * none of the causal or verification words VAL-GEN-004/-008 refuse, so it
 * passes the same validators as model text.
 */

export const FREE_IMPACT_ASSESSMENT_COMPOSITION = "free_impact_assessment";

export const ASSESSMENT_SECTIONS = Object.freeze([
  Object.freeze({ key: "executive_snapshot", title: "Executive Impact Snapshot" }),
  Object.freeze({ key: "evidence_findings", title: "What Your Evidence Tells Us" }),
  Object.freeze({ key: "impact_stories", title: "Impact Stories" }),
  Object.freeze({ key: "gaps_opportunities", title: "Gaps and Opportunities" }),
  Object.freeze({ key: "recommended_improvements", title: "Three Recommended Improvements" }),
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
  const improvements = sections[SECTION_INDEX.get("recommended_improvements")];
  if (improvements.blocks.filter((block) => block.body.startsWith("Proposed change:")).length < RECOMMENDATION_COUNT) {
    improvements.title = "Recommended Improvements";
  }
  return sections;
}

export function isFreeImpactAssessmentBlocks(blocks) {
  return parseFreeImpactAssessment(blocks) !== null;
}

// ---------------------------------------------------------------------------
// Documented gaps.

const STORY_PATTERN = /\b(?:stor(?:y|ies)|quotes?|quotations?|testimon\w*|permission|consent)\b/i;

// P2-06 limitation codes that mean only that a review or acceptance has not
// happened yet (never that a review found the claim unsupported).
const PROVISIONAL_REVIEW_CODES = Object.freeze([
  "claim_not_approved_for_requested_audience",
  "claim_review_unresolved",
  "evidence_review_unresolved",
  "support_strength_unassessed",
  "coverage_dimension_unresolved",
  "client_followup_unresolved",
  "potential_conflict_review_unresolved",
]);

const GAP_CATALOGUE = Object.freeze([
  Object.freeze({
    key: "recorded_duration_incomplete",
    codes: ["derived.known_recorded_minutes_subtotal"],
    documentPattern: /\b(?:duration|minutes)\b/i,
    gap: "Session duration is not recorded for each service event, so delivered service time is known only as a subtotal of the events that carry a valid duration.",
    recommendation: "Make session duration a required entry for each completed service event, with a short monthly check for events saved without it, so delivered service time can be reported in full rather than as a subtotal.",
    nextStep: "agree who will add the duration check to the service-event record",
  }),
  Object.freeze({
    key: "follow_up_evidence_limited",
    codes: ["derived.matched_subset_only", "derived.measured_population_only", "derived.self_reported", "derived.direction_not_established"],
    documentPattern: /\b(?:outcomes?|follow-?ups?|check-ins?|sample|census|employment)\b/i,
    gap: "Follow-up information describes only the people who were reached or who have comparable observations, and it is the organization's own or self-reported information, so it describes a subset rather than the whole group served.",
    recommendation: "Set one follow-up point for each person served (for example, a fixed interval after their last session), use the same outcome choices each time, and record who could not be reached, so follow-up information describes a defined group rather than whoever happened to be contacted.",
    nextStep: "choose the follow-up interval and the outcome choices to use from the next period",
  }),
  Object.freeze({
    key: "duplicate_records",
    codes: ["derived.duplicate_event_copies_counted_once", "derived.duplicate_rows_counted", "measurement.duplicate_records_included"],
    codePrefixes: ["coverage.duplicates."],
    documentPattern: /\b(?:duplicates?|duplicated|repeated (?:entries|records))\b/i,
    gap: "Some service records were entered more than once. The measurements state how repeats were treated, but the repeats remain in the source records.",
    recommendation: "Add a duplicate check where service events are entered or exported, so each event is recorded once and the figures no longer depend on removing repeats afterwards.",
    nextStep: "ask whoever exports the service records to add a duplicate check",
  }),
  Object.freeze({
    key: "participant_story_missing",
    story: true,
    documentPattern: STORY_PATTERN,
    gap: "No consented participant story or quotation is among the cited evidence, so the assessment cannot show a participant's own account.",
    recommendation: "Invite a small number of participants to share a short account of their experience, and record their written permission with it before it is used.",
    nextStep: "decide who will ask for consented participant accounts and how permission will be recorded",
  }),
  Object.freeze({
    key: "records_excluded",
    codes: ["derived.unmatched_identifiers_excluded", "derived.records_without_date_excluded", "derived.conflicting_event_identities_excluded",
      "derived.records_without_identifier_excluded", "derived.observations_excluded", "measurement.blank_records_excluded"],
    gap: "Some records could not be used (for example, records without a date, without a matching identifier, or without a comparable observation); they were excluded and counted.",
    recommendation: "Review the excluded records each month and correct missing dates or identifiers at the source, so fewer records fall outside the measurements.",
    nextStep: "set a monthly review of excluded records",
  }),
  Object.freeze({
    key: "external_use_alignment",
    codePrefixes: ["coverage.requirement_alignment.", "coverage.conflicting_source_indicators."],
    gap: "Alignment with funder requirements and conflicting-source checks are recorded as limitations for internal use only.",
    recommendation: "Before any funder or public use, map each indicator to the funder's stated requirements and work through the alignment and conflicting-source limitations with Get Kinder.",
    nextStep: "list the funders whose requirements these indicators should be mapped to",
  }),
  Object.freeze({
    key: "source_reported_statements",
    documents: true,
    gap: "The document statements are source-reported: they are quoted exactly from the organization's documents and were not independently verified.",
    recommendation: "Corroborate the most important source-reported statements with records the organization already keeps (for example, referral or attendance records) before relying on them beyond internal planning.",
    nextStep: "pick the source-reported statements that matter most and the records that could corroborate them",
  }),
  // Owner direction 2026-11-06 (draft first): review state is information.
  // A cited claim without a completed review is a provisional finding; it is
  // stated as such and never turned into a request or recommendation.
  Object.freeze({
    key: "provisional_findings",
    informational: true,
    reviewCodes: PROVISIONAL_REVIEW_CODES,
    gap: "Some cited findings have not yet had a review for final use. They are presented as provisional interpretations for internal planning and drafting, and the applicable review comes before any funder or public use.",
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
  return (entry.codes || []).some((code) => codes.includes(code))
    || (entry.codePrefixes || []).some((prefix) => codes.some((code) => code.startsWith(prefix)));
}

function citationOf(claim) {
  return { claimId: claim.claimId, evidenceItemId: claim.evidenceItemId };
}

/**
 * Every documented gap among the cited claims, in catalogue order. A gap's
 * grounding is the document statements whose quoted words name its subject
 * and the measured claims that carry its limitation codes. Only grounded gaps
 * are returned, so every composed block can cite its basis.
 */
export function detectAssessmentGaps(claims) {
  const list = [...(claims || [])].sort(byClaimId);
  const documents = list.filter(isDocumentClaim);
  const measured = list.filter(isMeasuredClaim);
  const gaps = [];
  for (const entry of GAP_CATALOGUE) {
    if (entry.reviewCodes) {
      const pending = list.filter((claim) => (claim.limitationCodes || []).some((code) => entry.reviewCodes.includes(code)));
      if (pending.length === 0) continue;
      gaps.push({ key: entry.key, entry, documentGrounding: pending.filter(isDocumentClaim), measuredGrounding: pending.filter((claim) => !isDocumentClaim(claim)) });
      continue;
    }
    const documentGrounding = entry.documents
      ? documents
      : entry.documentPattern
        ? documents.filter((claim) => entry.documentPattern.test(claim.claimStatement || ""))
        : [];
    const measuredGrounding = entry.codes || entry.codePrefixes ? measured.filter((claim) => carriesGap(claim, entry)) : [];
    if (entry.story && documentGrounding.length === 0) continue;
    if (documentGrounding.length === 0 && measuredGrounding.length === 0) continue;
    gaps.push({ key: entry.key, entry, documentGrounding, measuredGrounding });
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
      gap: gap.entry.gap,
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
    const cited = (block.citations || []).map((citation) => claimById.get(citation.claimId)?.claimStatement || "");
    if (!quotesOnlyCitedText(parsed.body, cited)) return { ok: false, reason: "assessment_quotation_not_in_cited_evidence" };
    bySection.get(parsed.sectionKey).push(block);
  }
  if (REQUIRED_MODEL_SECTION_KEYS.some((key) => bySection.get(key).length === 0)) {
    return { ok: false, reason: "assessment_model_section_missing" };
  }

  const gaps = detectAssessmentGaps(claims);
  const story = gaps.find((gap) => gap.key === "participant_story_missing");
  if (!storyEvidenceCited(claims)) {
    const fallback = bySection.get("impact_stories")[0].citations;
    bySection.get("impact_stories").push({
      text: withAssessmentSection("impact_stories",
        "Participant story evidence: none is available. No consented participant story or quotation is among the cited evidence, so this section gives only a source-backed account of the programme. "
        + "A participant story would need the participant's recorded permission before it could be used."),
      citations: story ? gapCitations(story) : fallback.map((citation) => ({ ...citation })),
    });
  }

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
      text: withAssessmentSection("gaps_opportunities", `Documented gaps in the cited evidence:\n${sentenceList(documented.map((gap) => gap.entry.gap))}`),
      citations,
    });
  }

  const chosen = gaps.filter((gap) => !gap.entry.informational && (!gap.entry.story || gap.documentGrounding.length > 0)).slice(0, RECOMMENDATION_COUNT);
  const fallbackCitations = modelBlocks[0].citations.map((citation) => ({ ...citation }));
  if (documented.length === 0) {
    bySection.get("gaps_opportunities").push({
      text: withAssessmentSection("gaps_opportunities", "No specific improvement gap is established by the cited evidence. This does not establish that no gaps exist; the assessment is limited to the selected evidence."),
      citations: fallbackCitations,
    });
  }
  if (chosen.length === 0) {
    bySection.get("recommended_improvements").push({
      text: withAssessmentSection("recommended_improvements", "The cited evidence does not support a specific improvement proposal. No recommendations have been invented to fill this section. Identify what further evidence would show where a change is needed."),
      citations: fallbackCitations,
    });
  }
  for (const gap of chosen) {
    bySection.get("recommended_improvements").push({
      text: withAssessmentSection("recommended_improvements",
        `Proposed change: ${gap.entry.recommendation} Basis: ${gap.entry.gap} This is a proposal for the organization to consider; it is not a measured or confirmed result.`),
      citations: gapCitations(gap),
    });
  }

  if (chosen.length > 0 && chosen.length < RECOMMENDATION_COUNT) {
    const first = bySection.get("recommended_improvements")[0];
    first.text += " The cited evidence supports fewer than three specific proposals; no further recommendations have been invented.";
  }

  const nextSteps = [
    "Use this provisional internal draft for planning and drafting now. Complete the applicable review and release before final use; none of its findings is cleared for funder or public use.",
    chosen.length > 0
      ? `Decide which proposed change to try first, then ${chosen.map((gap) => gap.entry.nextStep).join("; ")}.`
      : "Identify what further evidence would be needed before proposing changes.",
    "Keep the limitations named in this assessment with any figure you reuse, and address them before external use.",
    ...(storyEvidenceCited(claims) ? [] : ["If a future assessment should include a participant story, collect it with the participant's recorded permission first."]),
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
