import {
  CROSS_SOURCE_METRICS,
  DERIVED_MEASUREMENT_FAMILIES,
  interpretationOf,
} from "../validators/kaiDerivedMeasurementValidators.js";

/**
 * Plain-language reading of one derived measurement (owner direction
 * 2026-11-11, "Complete and prove the impact measurement-to-intelligence
 * workflow").
 *
 * A derived measurement's governed statement is exact but technical ("numeric
 * outcome field_6 (column G) ... numerically higher follow-up value"), and
 * the organization's own description of the measure (`meaning_text`) never
 * left the interpretation row. This module composes, from the persisted
 * measurement row and the interpretation its evidence is stated under only,
 * what a nonprofit reader needs:
 * - what is measured, in the organization's own words where it gave them;
 * - who is included;
 * - what changed (or what was counted);
 * - what that indicates under the direction the organization stated, and
 *   only then (an unstated direction stays a numerical change);
 * - a practical implication, and the one clarification still needed.
 *
 * Responsibilities stay separate: the organization supplies the meaning,
 * direction and evidence basis; KAI supplies the arithmetic and a proposed
 * reading. Nothing here invents a definition, goal or cause. Every number is
 * one the governed claim statement already states (or the organization's own
 * meaning text), and the text avoids the causal and verification wording the
 * generated-content validators refuse, so it is accepted by the same
 * validators as any other draft text.
 *
 * Returns null when there is nothing more meaningful to say than the governed
 * statement (for example an unlabelled count).
 */

// The causal wording VAL-GEN-004 refuses (kept in step with CAUSAL_PATTERN in
// kaiGeneratedContentValidators.js). The organization's meaning text is
// quoted only when it contains none of it.
const CAUSAL_WORDING = /\b(causes?|caused|causing|because|due to|drives?|driven by|leads? to|led to|results? in|resulted in|attribut(?:e|ed|able) to|impact(?:s|ed)?|increases?|decreases?|reduces?|improves?|worsens?)\b/i;
const QUOTE = /["“”„«»]/;
const DIRECTIONS = Object.freeze(["higher_is_better", "lower_is_better"]);

function sentence(text) {
  const trimmed = String(text ?? "").trim();
  if (trimmed.length === 0) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function lowerFirst(text) {
  return text.length > 1 && /^[A-Z][a-z]/.test(text) ? `${text[0].toLowerCase()}${text.slice(1)}` : text;
}

// The organization's description of the measure, when it can be quoted
// safely (no causal wording, no quotation marks, a single short passage).
function organizationMeaning(interpretation) {
  const text = String(interpretation?.meaning_text ?? "").replace(/\s+/g, " ").trim();
  if (!text || CAUSAL_WORDING.test(text) || QUOTE.test(text) || text.length > 300) return null;
  return text.replace(/[.\s]+$/, "");
}

function basisSentence(interpretation) {
  if (interpretation?.evidence_basis === "self_reported") {
    return "These are participants' own answers (self-reported), not an independent assessment.";
  }
  if (interpretation?.evidence_basis === "organization_record") {
    return "The values come from the organization's own records.";
  }
  return "";
}

function meaningSentence(label, interpretation) {
  const meaning = organizationMeaning(interpretation);
  return meaning ? `The organization describes ${label ? `${label} as` : "this measure as"}: ${lowerFirst(meaning)}.` : "";
}

function proportionWord(part, whole) {
  if (!(whole > 0)) return null;
  if (part * 2 > whole) return "more than half";
  if (part * 2 === whole) return "half";
  return "fewer than half";
}

// ---------------------------------------------------------------------------
// Paired baseline/follow-up outcome.

function pairedReading(row, interpretation) {
  const c = row.component_counts || {};
  const d = row.definition || {};
  const label = interpretation?.indicator_label || null;
  const name = label || `the numeric outcome in column ${d.outcome_column}`;
  const pairs = row.denominator;
  const higher = c.increased_count;
  const same = c.unchanged_count;
  const lower = c.decreased_count;
  const direction = DIRECTIONS.includes(interpretation?.score_direction) ? interpretation.score_direction : null;
  const result = `Among the ${pairs} participants with a comparable baseline and follow-up value, ${higher} (${row.percentage}%) had a higher value at follow-up, ${same} had the same value and ${lower} had a lower value.`;
  const coverage = `${c.excluded_participant_count} of ${c.participant_count} participants had no comparable pair and are not included, and no reporting period is applied.`;
  const measured = label
    ? sentence(`${label}: ${meaningSentence(label, interpretation) ? meaningSentence(label, interpretation).replace(/^The organization describes .*? as: /, "") : "an outcome measure recorded at baseline and follow-up"}`)
    : `${name[0].toUpperCase()}${name.slice(1)}, recorded at baseline and at follow-up. What it measures has not yet been stated by the organization.`;

  if (!direction) {
    const clarification = label
      ? `Clarification needed: confirm whether a higher ${label} value is better. Once that is recorded, this change can be read as progress or decline; the rest of this assessment does not depend on it.`
      : `Clarification needed: state what the value in column ${d.outcome_column} measures and whether a higher value is better. The rest of this assessment does not depend on it.`;
    const text = [
      measured,
      result,
      "Whether a higher value is better has not been stated, so this is reported as an observed numerical change, not as progress or decline.",
      basisSentence(interpretation),
      coverage,
      clarification,
    ].filter(Boolean).join(" ");
    return Object.freeze({
      kind: "paired_outcome", indicator: name, directionKnown: false, signal: "unresolved",
      headline: `${label || `The numeric outcome in column ${d.outcome_column}`}: values changed between baseline and follow-up for some comparable participants, but whether a higher value is better has not been stated yet`,
      clarification, text,
    });
  }

  const better = direction === "higher_is_better" ? higher : lower;
  const worse = direction === "higher_is_better" ? lower : higher;
  const directionWord = direction === "higher_is_better" ? "higher" : "lower";
  const share = proportionWord(better, pairs);
  let reading;
  let signal;
  if (better > worse && better * 2 > pairs) {
    signal = "favourable";
    reading = `The organization states that a ${directionWord} value is better, so ${better} participants moved in the better direction and ${worse} in the worse direction: ${share} of the comparable participants had a better value at follow-up, a favourable observed change on this outcome.`;
  } else if (better > worse) {
    signal = "favourable_minority";
    reading = `The organization states that a ${directionWord} value is better, so more participants moved in the better direction (${better}) than in the worse direction (${worse}), although ${share} of the comparable participants did so.`;
  } else if (better === worse) {
    signal = "mixed";
    reading = `The organization states that a ${directionWord} value is better; as many participants moved in the better direction as in the worse direction (${better}), so no overall direction is evident.`;
  } else {
    signal = "unfavourable";
    reading = `The organization states that a ${directionWord} value is better, so more participants moved in the worse direction (${worse}) than in the better direction (${better}): an unfavourable observed change that needs attention.`;
  }
  const implication = signal === "favourable" || signal === "favourable_minority"
    ? `What this suggests: this is an encouraging signal for ${label || "this outcome"}, consistent with what the organization is working towards. It is worth continuing to collect baseline and follow-up values the same way, and asking what was different for the ${worse} participants whose value moved the other way.`
    : signal === "mixed"
      ? `What this suggests: the result does not yet show a clear direction for ${label || "this outcome"}; collecting comparable follow-up values for more participants would show whether a pattern emerges.`
      : `What this suggests: ${label || "this outcome"} needs a closer look; review what participants whose value moved in the worse direction experienced, and whether the follow-up timing or questions changed.`;
  const text = [
    measured,
    result,
    reading,
    basisSentence(interpretation),
    coverage,
    "No comparison group is cited, so this observed change does not by itself show that the programme was responsible for it.",
    implication,
  ].filter(Boolean).join(" ");
  const headline = signal === "favourable"
    ? `${name}: ${share} of participants with comparable values had a better value at follow-up, in the direction the organization states is better`
    : signal === "favourable_minority"
      ? `${name}: more participants moved in the better direction than the worse, though ${share} of comparable participants did so`
      : signal === "mixed"
        ? `${name}: no overall direction is evident between baseline and follow-up`
        : `${name}: more participants moved in the worse direction than the better, which needs attention`;
  return Object.freeze({ kind: "paired_outcome", indicator: name, directionKnown: true, signal, headline, clarification: null, text });
}

// ---------------------------------------------------------------------------
// Tabular rate and count, read only when the organization stated a meaning.

function tabularRateReading(row, interpretation) {
  if (!interpretation) return null;
  const c = row.component_counts || {};
  const label = interpretation.indicator_label;
  const selfReported = interpretation.evidence_basis === "self_reported";
  const text = [
    `${label}: ${row.numerator} of ${row.denominator} (${row.percentage}%) in the measured population; ${c.other_population_record_count} of the ${row.denominator} do not.`,
    meaningSentence(label, interpretation),
    basisSentence(interpretation),
    "It describes only the measured population named in the measurement, not everyone the organization served.",
    selfReported
      ? "What this suggests: it is a useful early indication, resting on what respondents chose to report; asking a defined group at a fixed point, and recording who could not be reached, would make it more dependable."
      : "What this suggests: this rate can be tracked from period to period with the same definition.",
  ].filter(Boolean).join(" ");
  return Object.freeze({
    kind: "rate", indicator: label, directionKnown: null, signal: "descriptive", clarification: null, text,
    headline: `${label}: ${proportionWord(row.numerator, row.denominator)} of the measured population${selfReported ? " (self-reported)" : ""}`,
  });
}

function tabularCountReading(row, interpretation) {
  if (!interpretation) return null;
  const label = interpretation.indicator_label;
  const text = [
    `${label}: ${row.measured_value} ${row.measured_value === 1 ? "record" : "records"}.`,
    meaningSentence(label, interpretation),
    basisSentence(interpretation),
  ].filter(Boolean).join(" ");
  return Object.freeze({ kind: "count", indicator: label, directionKnown: null, signal: "descriptive", clarification: null, text, headline: null });
}

// ---------------------------------------------------------------------------
// Cross-source linked reach.

function crossSourceReading(row, interpretation) {
  const c = row.component_counts || {};
  const d = row.definition || {};
  const period = d.period ? `the reporting period ${d.period.period_start} to ${d.period.period_end}` : "the reporting period";
  const group = d.group ? ` in programme group ${d.group.value_label}` : "";
  const label = interpretation?.indicator_label || null;
  const lead = label ? `${label}: ` : "";
  switch (d.metric) {
    case CROSS_SOURCE_METRICS.ELIGIBLE_ENCOUNTERS:
    case CROSS_SOURCE_METRICS.GROUP_ENCOUNTERS:
      return Object.freeze({
        kind: "activity", indicator: label || "Service encounters", directionKnown: null, signal: "descriptive", clarification: null, headline: null,
        text: `${lead}${row.measured_value} completed service encounters${group} in ${period}, linked to people on the participant register. These are encounters, not people: one person can have several.`,
      });
    case CROSS_SOURCE_METRICS.MULTI_GROUP_PEOPLE:
      return Object.freeze({
        kind: "reach", indicator: label || "People in more than one programme", directionKnown: null, signal: "descriptive", clarification: null, headline: null,
        text: `${lead}${row.measured_value} people on the participant register took part in more than one programme group in ${period}, each counted once.`,
      });
    case CROSS_SOURCE_METRICS.MONTHLY_ACTIVITY:
    case CROSS_SOURCE_METRICS.RECORDED_DURATION:
      return null;
    default: {
      const among = d.group ? c.group_encounter_count : c.eligible_encounter_count;
      const overlap = d.group ? "" : ` ${c.multi_group_person_count} of them took part in more than one programme group and are counted once.`;
      const wide = !d.group;
      const text = `${lead}${row.measured_value} distinct people on the participant register received at least one completed service${group} in ${period}, across ${among} eligible service encounters.${overlap}`
        + (wide ? " This shows who the organization reached; it does not by itself show what changed for them, which needs outcome evidence such as baseline and follow-up measures." : "");
      return Object.freeze({
        kind: "reach", indicator: label || "People reached", directionKnown: null, signal: "descriptive", clarification: null, text,
        headline: wide ? `${label || "People reached"}: ${row.measured_value} distinct people received at least one completed service in ${period}` : null,
      });
    }
  }
}

/**
 * The reading of a derived measurement row (as read with its evidence's
 * interpretation), or null.
 */
export function composeImpactFindingReading(measurementRow) {
  if (!measurementRow || typeof measurementRow !== "object") return null;
  const interpretation = interpretationOf(measurementRow);
  switch (measurementRow.measurement_family) {
    case DERIVED_MEASUREMENT_FAMILIES.PAIRED_OUTCOME:
      return pairedReading(measurementRow, interpretation);
    case DERIVED_MEASUREMENT_FAMILIES.TABULAR_RATE:
      return tabularRateReading(measurementRow, interpretation);
    case DERIVED_MEASUREMENT_FAMILIES.CROSS_SOURCE_REACH:
      return crossSourceReading(measurementRow, interpretation);
    default:
      return tabularCountReading(measurementRow, interpretation);
  }
}

export const __impactFindingReadingTestables = Object.freeze({ organizationMeaning, CAUSAL_WORDING });
