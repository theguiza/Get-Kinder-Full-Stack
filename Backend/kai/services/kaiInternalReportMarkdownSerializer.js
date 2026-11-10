import { STORY_SOURCE_NOTE } from "../../../shared/kaiStorySourceInformation.js";
import { PROVISIONAL_REPORT_STATUS, reportInformationNotes } from "../../../shared/kaiReportInformation.js";
import { COUNT_ONLY_LIMITATION_CODE, WORDING_FALLBACK_RESULT_KEY } from "../validators/kaiGeneratedContentValidators.js";
import { ASSESSMENT_SECTIONS, parseAssessmentBlockText } from "./kaiFreeImpactAssessmentComposition.js";
import { describeMeasurementCalculationMethod } from "../validators/kaiSourceMeasurementValidators.js";
import {
  DERIVED_LIMITATION_CODES,
  DERIVED_MEASUREMENT_EVIDENCE_TYPE,
  DERIVED_MEASUREMENT_FAMILIES,
  describeDerivedLimitationCode,
} from "../validators/kaiDerivedMeasurementValidators.js";
import { DOCUMENT_EVIDENCE_TYPE, documentStatementRole, excerptFromDocumentClaimStatement } from "../validators/kaiDocumentEvidenceValidators.js";

const COUNT_ONLY_LIMITATION_TEXT = STORY_SOURCE_NOTE;

/**
 * Markdown for the organization's internal report (owner decision
 * 2026-10-25), composed only from the internal report model
 * (postgresClientInternalReportRepository.js): the persisted, validated draft
 * text with its citations, and the source-backed facts behind every cited
 * claim. Every factual sentence the serializer writes itself restates a
 * persisted value; it adds no outcome, cause, participant or rate.
 */
const MARKDOWN_CONTRACT_VERSION = "kai-sprint2-internal-report-markdown-v1";

const REPORT_TITLES = Object.freeze({
  evidence_summary: "Internal Evidence Summary",
  impact_narrative: "Internal Impact Narrative",
});

const REPORT_PURPOSES = Object.freeze({
  evidence_summary: "states what the organization's authorized evidence shows, how it was measured, and its limits.",
  impact_narrative: "describes the programme activity the evidence records, for internal planning and board discussion, within the same evidence and limits.",
});

function text(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n");
}

function code(value) {
  return `\`${text(value).replaceAll("`", "\\`")}\``;
}

function refs(citationRefs) {
  return (citationRefs || []).map((ref) => `[${ref}]`).join(" ");
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function periodText(measurement) {
  return measurement.periodStart
    ? `${measurement.periodStart} to ${measurement.periodEnd}`
    : null;
}

function measuredFacts(model) {
  return model.facts.filter((fact) => fact.measurement);
}

// Each cited fact is described as the kind of evidence it is: a source row
// count (fact.measurement), a source-reported document statement, or a
// derived measurement. A fact without a row count is not therefore without
// evidence: a paired outcome or an observation is reported on its own terms.
function citedRefs(facts) {
  return refs(facts.flatMap((fact) => fact.citationRefs));
}

function isDocumentFact(fact) {
  return !fact.measurement && fact.evidenceType === DOCUMENT_EVIDENCE_TYPE;
}

// Owner Package 4: what a cited document statement is, from its persisted
// words (documentStatementRole). A source's estimate or its method guidance is
// not an observation of what happened, and is never described as one.
function documentRole(fact) {
  return documentStatementRole(excerptFromDocumentClaimStatement(text(fact.claimStatement)) ?? observationText(fact));
}

function isDocumentObservation(fact) {
  return isDocumentFact(fact) && !["source_estimate", "source_method_or_instruction"].includes(documentRole(fact));
}

function isDocumentEstimate(fact) {
  return isDocumentFact(fact) && documentRole(fact) === "source_estimate";
}

function isDocumentMethod(fact) {
  return isDocumentFact(fact) && documentRole(fact) === "source_method_or_instruction";
}

const DOCUMENT_ROLE_LABELS = Object.freeze({
  source_estimate: "Source-reported preliminary estimate (not calculated or verified by KAI)",
  source_method_or_instruction: "Source-reported method or guidance (not evidence that it was carried out)",
});

function isDerivedFact(fact) {
  return !fact.measurement && (Boolean(fact.derivedMeasurement) || fact.evidenceType === DERIVED_MEASUREMENT_EVIDENCE_TYPE);
}

const PAIRED_COUNT_KEYS = Object.freeze(["participant_count", "comparable_pair_count", "increased_count", "unchanged_count", "decreased_count", "excluded_participant_count"]);

// A paired baseline/follow-up outcome with every persisted count present, or
// null (then it is reported by its recorded statement as another derived fact).
function pairedOutcomeOf(fact) {
  const derived = fact.derivedMeasurement;
  if (!isDerivedFact(fact) || derived?.family !== DERIVED_MEASUREMENT_FAMILIES.PAIRED_OUTCOME) return null;
  const counts = derived.componentCounts || {};
  if (!PAIRED_COUNT_KEYS.every((key) => Number.isSafeInteger(counts[key]))) return null;
  return { ...counts, percentage: derived.percentage ?? null };
}

function evidenceKinds(model) {
  return {
    counts: measuredFacts(model),
    documents: model.facts.filter(isDocumentObservation),
    estimates: model.facts.filter(isDocumentEstimate),
    methods: model.facts.filter(isDocumentMethod),
    paired: model.facts.filter((fact) => pairedOutcomeOf(fact)),
    otherDerived: model.facts.filter((fact) => isDerivedFact(fact) && !pairedOutcomeOf(fact)),
  };
}

function directionNotEstablished(fact) {
  return !(fact.limitationCodes || []).includes(DERIVED_LIMITATION_CODES.DIRECTION_HUMAN_STATED);
}

function pairedResult(p) {
  return `${p.increased_count} of ${p.comparable_pair_count} comparable participant pairs${p.percentage === null ? "" : ` (${text(p.percentage)}%)`} `
    + `recorded a numerically higher follow-up value than baseline, ${p.unchanged_count} the same and ${p.decreased_count} lower`;
}

function pairedCoverage(p) {
  return `${p.excluded_participant_count} of ${p.participant_count} participants lacked comparable baseline and follow-up observations and are not included`;
}

function directionText(fact) {
  return directionNotEstablished(fact)
    ? "Whether a higher value is better has not been established, so this is an observed numerical change, not an established improvement."
    : "The organization states which direction of the value is better; KAI did not verify that.";
}

// The quoted source text of a document statement claim, or the whole claim.
function observationText(fact) {
  const quoted = /"(.*)"/s.exec(text(fact.claimStatement));
  return quoted ? quoted[1] : text(fact.claimStatement);
}

// A source-record-count measurement establishes rows. Apply the same honest
// rendering to every such measurement, independently of source metadata.
function worksheetOf(m) {
  return m.worksheetKey ? `${text(m.worksheetName || "Worksheet")} (${code(m.worksheetKey)})` : "the source version's CSV data records";
}

function countedRows(m) {
  return `${plural(m.measuredValue, "nonblank data row")} in ${worksheetOf(m)}`;
}

// Duplicates as the committed profile states them: the records that belong
// to groups of identical records, and (when recorded) how many of those are
// copies beyond the first of their group. A record count removes neither.
function duplicateGroupText(m) {
  const counted = m.countedDuplicates;
  if (counted && Number.isSafeInteger(counted.memberRecordCount) && Number.isSafeInteger(counted.excessCopyCount)) {
    return `${plural(counted.memberRecordCount, "counted record")} in exact-duplicate groups (${plural(counted.excessCopyCount, "excess copy", "excess copies")})`;
  }
  return `${plural(m.duplicateRecordCount, "data record")} in exact-duplicate groups (the number of excess copies is not recorded for this profile)`;
}

// Whether the counted records include any exact duplicate.
function hasCountedDuplicates(m) {
  return m.countedDuplicates ? m.countedDuplicates.memberRecordCount > 0 : m.duplicateRecordCount > 0;
}

function countOnlyFinding(m) {
  const counted = `${plural(m.measuredValue, "nonblank data row")} ${m.measuredValue === 1 ? "was" : "were"} counted in ${worksheetOf(m)}`;
  return hasCountedDuplicates(m) ? `${counted}, including ${duplicateGroupText(m)}` : counted;
}

function humanLabel(value) {
  return code(value);
}

function humanMeaning(m) {
  return `A person at the organization defined each row as one ${humanLabel(m.countedUnit)}; KAI did not verify that meaning, `
    + `so this is a count of rows, not an established count of ${humanLabel(m.unitLabel)}.`;
}

function contextLines(model) {
  const context = model.context || {};
  const lines = [];
  lines.push(`- **Organization:** ${context.organizationName ? text(context.organizationName) : "not recorded"} (${code(context.organizationId)})`);
  if (context.engagementId) {
    const label = [context.engagementCode ? code(context.engagementCode) : null, context.engagementType ? `type ${code(context.engagementType)}` : null]
      .filter(Boolean)
      .join(", ");
    lines.push(`- **Project / engagement:** ${label || "not recorded"} (${code(context.engagementId)})`);
  }
  lines.push(`- **Report:** ${REPORT_TITLES[model.report.contentType] || code(model.report.contentType)}, draft ${code(model.report.generatedContentDraftId)}, generated ${model.report.createdAt || "at an unrecorded time"}`);
  if (REPORT_PURPOSES[model.report.contentType]) lines.push(`- **Purpose:** this report ${REPORT_PURPOSES[model.report.contentType]}`);
  lines.push("- **Audience:** internal use by this organization only. It is not approved for funders or the public.");
  return lines;
}

function findingLines(model) {
  const lines = [];
  for (const fact of model.facts) {
    // Owner Package 1: every record count is stated as the rows it counted;
    // the person's label, period and rules are never stated as applied.
    if (fact.measurement) {
      const m = fact.measurement;
      const period = periodText(m);
      lines.push(`- **${countOnlyFinding(m)}**; ${plural(m.blankRecordCount, "blank row")} ${m.blankRecordCount === 1 ? "was" : "were"} excluded. `
        + `${period ? `The organization states the reporting period ${period}; it was not checked against dates in the rows. ` : ""}`
        + `${humanMeaning(m)} ${refs(fact.citationRefs)}`);
    } else if (DOCUMENT_ROLE_LABELS[isDocumentFact(fact) ? documentRole(fact) : ""]) {
      lines.push(`- **${DOCUMENT_ROLE_LABELS[documentRole(fact)]}:** ${text(fact.claimStatement)} ${refs(fact.citationRefs)}`);
    } else {
      lines.push(`- ${text(fact.claimStatement)} ${refs(fact.citationRefs)}`);
    }
  }
  return lines;
}

function periodLines(model) {
  const lines = [];
  for (const fact of measuredFacts(model)) {
    const period = periodText(fact.measurement);
    lines.push(period
      ? `- ${period} ${refs(fact.citationRefs)}. The period is stated in the organization's recorded definition; it was not checked against dates in the records.`
      : `- No reporting period was defined for the count ${refs(fact.citationRefs)}; the count is not bounded to a period.`);
  }
  for (const fact of model.facts.filter(isDerivedFact)) {
    const codes = fact.limitationCodes || [];
    if (codes.includes(DERIVED_LIMITATION_CODES.NO_REPORTING_PERIOD)) lines.push(`- No reporting period was applied to the derived measurement ${refs(fact.citationRefs)}.`);
    else if (codes.includes(DERIVED_LIMITATION_CODES.ENGAGEMENT_PERIOD_APPLIED)) lines.push(`- The engagement's reporting period was applied to the derived measurement ${refs(fact.citationRefs)}.`);
  }
  if (lines.length === 0) lines.push("- The cited evidence does not establish a reporting period.");
  return lines;
}

function methodLines(model) {
  const lines = [];
  for (const fact of measuredFacts(model)) {
    const m = fact.measurement;
    lines.push(
      fact.countOnly ? `#### ${refs(fact.citationRefs)} Row count of ${worksheetOf(m)}` : `#### ${refs(fact.citationRefs)} ${text(m.unitLabel)}`,
      "",
      fact.countOnly
        ? `- **What one record represents (human-defined, not verified):** one ${humanLabel(m.countedUnit)}, as defined by a person at the organization; KAI counted rows only.`
        : `- **What one record represents:** one ${text(m.countedUnit)}, as defined by a person at the organization.`,
      ...(fact.countOnly
        ? ["- **Definition, inclusion and exclusion text:** not reproduced. This report states the measured row count; the human-defined meaning is not independently verified."]
        : [
          `- **Definition:** ${text(m.definitionText)}`,
          `- **Included:** ${text(m.inclusionRule)}`,
          `- **Excluded:** ${text(m.exclusionRule)}`,
        ]),
      `- **Calculation:** ${code(m.calculationMethod)}: ${describeMeasurementCalculationMethod(m.calculationMethod)}`,
      ...(m.worksheetKey ? [`- **Selected worksheet:** ${text(m.worksheetName || "Worksheet")} (${code(m.worksheetKey)}).`] : []),
      `- **Arithmetic:** ${plural(m.totalRecordCount, "data record")} after the header, minus ${plural(m.blankRecordCount, "blank record")} excluded = **${m.measuredValue}** counted.`,
      `- **Definition recorded:** ${m.definitionRecordedAt || "time not recorded"}. The definition is fixed for this source version and reused for every report; a new source version is measured again under its own definition.`,
      "",
    );
  }
  for (const fact of model.facts.filter(isDerivedFact)) {
    lines.push(`#### ${refs(fact.citationRefs)} Derived measurement`, "",
      "- **Method:** calculated from the cited source version's recorded values under the measurement's recorded definition. "
        + "Its result is stated under Key findings and its limitations under Data quality and limitations.", "");
  }
  if (lines.length === 0) lines.push("No measured value is cited; the cited claims are reproduced as recorded.", "");
  return lines;
}

function duplicateLines(model) {
  const lines = [];
  for (const fact of measuredFacts(model)) {
    const m = fact.measurement;
    lines.push(hasCountedDuplicates(m)
      ? `- ${refs(fact.citationRefs)} The profiler reported ${duplicateGroupText(m)}. The record count removes no duplicate: every one of them stays in the count of ${m.measuredValue}, not removed or merged. The count is therefore a count of records, not of distinct sessions or events.`
      : `- ${refs(fact.citationRefs)} The profiler reported no exact-duplicate records.`);
  }
  if (lines.length === 0) {
    lines.push(model.facts.some(isDerivedFact)
      ? "- No row-count measurement is cited. How each derived measurement treats repeated or excluded records is stated in its limitations."
      : "- No measured value is cited.");
  }
  return lines;
}

function limitationLines(model) {
  const lines = [];
  for (const fact of model.facts) {
    const provisional = fact.currentlyEligible !== true;
    if (fact.limitationCodes.length === 0 && !provisional) continue;
    lines.push(`- ${refs(fact.citationRefs)}`);
    if (provisional) lines.push("  - Review for final use is not complete; this finding is provisional and its open review items are listed under Authority for internal use.");
    for (const limitation of fact.limitationCodes) {
      const description = limitation === COUNT_ONLY_LIMITATION_CODE ? COUNT_ONLY_LIMITATION_TEXT : describeDerivedLimitationCode(limitation);
      lines.push(`  - ${description ? text(description) : "Recorded limitation."} (${code(limitation)})`);
    }
  }
  if (lines.length === 0) lines.push("- No limitation codes are recorded for the cited claims.");
  return lines;
}

function establishesLines(model) {
  const lines = [];
  for (const fact of model.facts) {
    if (fact.measurement) {
      lines.push(`- The promoted source version ${code(fact.sourceVersionId)} contains ${countedRows(fact.measurement)}. ${refs(fact.citationRefs)}`);
    } else if (isDocumentFact(fact)) {
      lines.push(`- That the cited source document states: "${observationText(fact)}" ${refs(fact.citationRefs)} (what the source says, not a fact KAI established).`);
    } else {
      lines.push(`- The recorded claim: ${text(fact.claimStatement)} ${refs(fact.citationRefs)}`);
    }
  }
  lines.push("- Every cited claim traces to its evidence item, its promoted source and the current source version listed below.");
  return lines;
}

function doesNotEstablishLines(model) {
  const { counts, documents, estimates, methods, paired, otherDerived } = evidenceKinds(model);
  const lines = [];
  for (const fact of estimates) {
    lines.push(`- That the source's estimate ${refs(fact.citationRefs)} is a KAI-calculated or verified figure: KAI did not calculate or verify it. `
      + "It is not comparable with a KAI measurement unless the same people, period, programmes and eligibility rules are established, so it neither confirms nor contradicts one.");
  }
  for (const fact of methods) {
    lines.push(`- That the method or guidance ${refs(fact.citationRefs)} was carried out: the source says what should be done; only a cited KAI measurement shows a calculation that was performed.`);
  }
  if (counts.length > 0) {
    lines.push(`- How many distinct people the counted records represent ${citedRefs(counts)}: the records are not linked to individuals, and no participant count was measured from them.`);
    if (counts.some((fact) => fact.measurement.duplicateRecordCount > 0)) {
      lines.push("- How many distinct real-world sessions or events took place: exact-duplicate records are included in the count.");
    } else {
      lines.push("- That each record is a distinct real-world session or event: KAI counted records; it did not verify what each record represents.");
    }
    if (counts.some((fact) => periodText(fact.measurement))) {
      lines.push("- That the reporting period is verified: it is stated in the definition, not checked against record dates.");
    }
  }
  for (const fact of counts) {
    lines.push(`- That each counted row is one ${humanLabel(fact.measurement.countedUnit)} ${refs(fact.citationRefs)}: a person at the organization defined that meaning, and KAI did not verify it.`);
  }
  if (counts.length > 0) {
    lines.push("- A row count does not establish a participant story or quotation.");
  }
  for (const fact of documents) {
    lines.push(`- That the source-reported observation ${refs(fact.citationRefs)} is verified or representative: it is an account recorded in the source, not a measurement; KAI did not verify it, and how many people it reflects is not recorded.`);
    if (paired.length === 0) {
      lines.push(`- That the observation ${refs(fact.citationRefs)} is a measured outcome or a measured change over time: no baseline and follow-up comparison is cited.`);
    }
  }
  for (const fact of paired) {
    const p = pairedOutcomeOf(fact);
    lines.push(directionNotEstablished(fact)
      ? `- That the numerical change ${refs(fact.citationRefs)} is an improvement: whether a higher value is better has not been established.`
      : `- That the direction the organization states as better for ${refs(fact.citationRefs)} has been verified: the organization states it; KAI did not verify it.`);
    lines.push(`- That the result ${refs(fact.citationRefs)} describes every participant: only the ${p.comparable_pair_count} comparable pairs are compared; ${pairedCoverage(p)}.`);
  }
  for (const fact of otherDerived) {
    lines.push(`- Anything about ${refs(fact.citationRefs)} beyond its recorded values: its recorded limitations are listed under Data quality and limitations.`);
  }
  if (documents.length === 0 && paired.length === 0) {
    lines.push(otherDerived.length > 0
      ? "- Any change over time: no baseline and follow-up comparison is cited."
      : "- Any outcome for participants or the community, or any change over time.");
  }
  lines.push(
    paired.length > 0
      ? `- That the programme caused any result: the baseline and follow-up comparison ${citedRefs(paired)} follows the same participants over time, with no comparison group of people who did not take part, and no other attribution evidence is cited.`
      : "- That the programme caused any result: no comparison, baseline or attribution evidence is cited.",
    counts.length === model.facts.length
      ? "- That the source is complete: activity not recorded in this source is not reflected."
      : "- That the cited sources are complete: activity, participants or outcomes not recorded in them are not reflected.",
  );
  return lines;
}

function analysisLines(model) {
  const { counts, documents, estimates, methods, paired, otherDerived } = evidenceKinds(model);
  const lines = [];
  for (const fact of counts) {
    const m = fact.measurement;
    lines.push(`- ${refs(fact.citationRefs)} ${m.measuredValue} of the ${plural(m.totalRecordCount, "data row")} after the header in ${worksheetOf(m)} `
      + `${m.measuredValue === 1 ? "was" : "were"} nonblank and counted; ${plural(m.blankRecordCount, "blank row")} ${m.blankRecordCount === 1 ? "was" : "were"} excluded`
      + `${hasCountedDuplicates(m) ? `, and ${duplicateGroupText(m)} are included` : ""}. `
      + "The figure is a number of rows in that worksheet only.");
  }
  for (const fact of documents) {
    lines.push(`- ${refs(fact.citationRefs)} **Source-reported observation (qualitative):** the source records that "${observationText(fact)}" `
      + "This is qualitative evidence as the source reports it. It is not a measurement, KAI did not verify it, and how many people it reflects is not recorded.");
  }
  for (const fact of estimates) {
    lines.push(`- ${refs(fact.citationRefs)} **${DOCUMENT_ROLE_LABELS.source_estimate}:** the source states that "${observationText(fact)}" `
      + "This is the source's own estimate, kept with its own qualifiers; KAI did not calculate or verify it, and it is not a measurement. "
      + "Whether it covers the same people, period, programmes and eligibility rules as a KAI measurement is not established.");
  }
  for (const fact of methods) {
    lines.push(`- ${refs(fact.citationRefs)} **${DOCUMENT_ROLE_LABELS.source_method_or_instruction}:** the source states that "${observationText(fact)}" `
      + "This is the source's own method, requirement or recommendation; it does not show that the step was carried out. Any calculation KAI performed is cited and described separately.");
  }
  for (const fact of paired) {
    const p = pairedOutcomeOf(fact);
    lines.push(`- ${refs(fact.citationRefs)} **Outcome measurement (derived baseline and follow-up comparison):** ${pairedResult(p)}. ${pairedCoverage(p)}. `
      + `${directionText(fact)} It is a change observed among the comparable pairs and does not by itself show that the programme caused it.`);
  }
  for (const fact of otherDerived) {
    lines.push(`- ${refs(fact.citationRefs)} **Derived measurement:** ${text(fact.claimStatement)} It is reported with its recorded limitations.`);
  }
  if (lines.length === 0) lines.push("- The cited claims are reported as recorded; no measured value is available for further analysis.");
  if (counts.some((fact) => fact.countOnly)) {
    lines.push("- A count-only figure is a number of worksheet rows. It is not a measure of activity, reach or results, and what a row represents was not verified.");
  }
  if (counts.some((fact) => !fact.countOnly)) {
    lines.push(`- ${counts.some((fact) => fact.countOnly) ? "Each other measured figure" : "This"} is a volume-of-activity figure from one source. Interpreting it as reach or results would need further evidence (for example attendance linked to people, or outcome measures).`);
  }
  if (counts.length > 0 && counts.length < model.facts.length) {
    lines.push(`- The row ${counts.length === 1 ? "count" : "counts"} ${citedRefs(counts)} ${counts.length === 1 ? "describes" : "describe"} what was recorded, not who took part or what changed; ${counts.length === 1 ? "it is" : "they are"} read separately from the other findings above.`);
  }
  if (documents.length > 0 && paired.length > 0) {
    lines.push(`- The source-reported observation ${citedRefs(documents)} and the numerical change ${citedRefs(paired)} are separate pieces of evidence about participants. `
      + `The observation is an unmeasured account${paired.some(directionNotEstablished) ? ", and the beneficial direction of the measured change is not established" : ""}; `
      + "they are relevant to the same question, but neither confirms the other.");
  }
  return lines;
}

function traceabilityLines(model) {
  const lines = [
    "| Ref | Claim | Evidence | Source | Source version | Current | Profile SHA-256 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const fact of model.facts) {
    lines.push(`| ${fact.citationRefs.join(", ")} | ${code(fact.claimId)} | ${code(fact.evidenceItemId)} | ${fact.sourceCode ? `${code(fact.sourceCode)} ` : ""}${code(fact.sourceId)} | `
      + `${code(fact.sourceVersionId)}${fact.sourceVersionCreatedAt ? ` (${fact.sourceVersionCreatedAt})` : ""} | ${fact.sourceVersionCurrent ? "yes" : "no"} | `
      + `${fact.profileCanonicalSha256 ? code(fact.profileCanonicalSha256) : "not recorded"} |`);
    for (const linked of fact.linkedSources || []) {
      lines.push(`| ${fact.citationRefs.join(", ")} | ${code(fact.claimId)} | linked source | ${code(linked.sourceId)} | ${code(linked.sourceVersionId)} | `
        + `${linked.sourceVersionCurrent ? "yes" : "no"} | ${code(linked.profileCanonicalSha256)} |`);
    }
  }
  return lines;
}

function authorityLines(model) {
  const lines = ["- **Source authority:** every cited source has a completed sensitivity and allowed-use decision that permits this internal use and AI processing. Source story presence is informational metadata."];
  for (const fact of model.facts) {
    const basis = fact.evidenceReviewOutcome || fact.claimReviewOutcome
      ? `recorded review decisions (evidence: ${fact.evidenceReviewOutcome ? code(fact.evidenceReviewOutcome) : "none"}; claim: ${fact.claimReviewOutcome ? code(fact.claimReviewOutcome) : "none"})`
      : fact.currentlyEligible
        ? "an ordinary measured fact restated from its source; no further approval is required for internal use"
        : "the cited source evidence, as a provisional finding";
    const open = !fact.currentlyEligible && (fact.blockerCodes || []).length > 0 ? `; open review items: ${fact.blockerCodes.map(code).join(", ")}` : "";
    lines.push(`- ${refs(fact.citationRefs)} Review for final use complete: ${fact.currentlyEligible ? "yes" : "no (provisional finding)"}; basis: ${basis}${open}.`);
  }
  const validatorKeys = model.report.validatorKeys.filter((key) => key !== WORDING_FALLBACK_RESULT_KEY);
  lines.push(`- **Automated validation of the generated text:** ${validatorKeys.length > 0 ? validatorKeys.map(code).join(", ") : "none recorded"} passed when the draft was generated; this report is re-checked against current eligibility each time it is opened.`);
  if (model.report.validatorKeys.includes(WORDING_FALLBACK_RESULT_KEY)) {
    lines.push("- **Restated passages:** some generated wording did not pass these checks, so those passages state the cited findings in their own recorded wording instead. Nothing the checks refused was saved.");
  }
  return lines;
}

// A conclusion that summarizes every cited evidence type with its own
// qualification: row counts as rows, observations as source-reported,
// derived measurements by their recorded values and limitations.
function substantiveConclusion(model) {
  const { counts, documents, estimates, methods, paired, otherDerived } = evidenceKinds(model);
  const parts = ["On the available evidence,"];
  if (counts.length > 0) {
    parts.push(`the promoted source contains ${counts.map((fact) => `${countedRows(fact.measurement)} ${refs(fact.citationRefs)}`).join("; ")}. `
      + `${counts.length === 1 ? "This is a count" : "These are counts"} of rows whose meaning was defined by a person at the organization and not verified by KAI; `
      + `${counts.length === 1 ? "it is" : "they are"} not a count of people reached, of distinct sessions, or of outcomes.`);
  }
  if (documents.length > 0) {
    parts.push(`${counts.length > 0 ? "The" : "the"} source reports ${documents.length === 1 ? "an observation" : "observations"}: `
      + `${documents.map((fact) => `"${observationText(fact)}" ${refs(fact.citationRefs)}`).join("; ")}. `
      + `${documents.length === 1 ? "This is" : "These are"} qualitative, source-reported evidence: not measured or verified, and how many people ${documents.length === 1 ? "it reflects" : "they reflect"} is not recorded.`);
  }
  for (const fact of paired) {
    const p = pairedOutcomeOf(fact);
    parts.push(`${parts.length > 1 ? "In" : "in"} the baseline and follow-up comparison, ${pairedResult(p)} ${refs(fact.citationRefs)}; `
      + `${pairedCoverage(p)}. ${directionText(fact)}`);
  }
  for (const fact of otherDerived) {
    parts.push(`${parts.length > 1 ? "The" : "the"} cited derived measurement records: ${text(fact.claimStatement)} ${refs(fact.citationRefs)}`);
  }
  if (estimates.length + methods.length > 0) {
    const context = [...estimates, ...methods];
    parts.push(`${parts.length > 1 ? "The" : "the"} cited source ${estimates.length > 0 ? `estimate${estimates.length === 1 ? "" : "s"} ${citedRefs(estimates)}` : ""}`
      + `${estimates.length > 0 && methods.length > 0 ? " and " : ""}${methods.length > 0 ? `method guidance ${citedRefs(methods)}` : ""} `
      + `${context.length === 1 ? "is" : "are"} reported as the source states ${context.length === 1 ? "it" : "them"}, as context: not calculated, verified or carried out by KAI.`);
  }
  const substantive = documents.length + paired.length;
  if (substantive > 0) {
    parts.push(`${substantive === 1 ? "This finding is" : "Taken together, these findings are"} relevant to the programme's potential impact and may be used internally as qualified evidence of it, `
      + `with the limitations above kept with ${substantive === 1 ? "it" : "them"}. `
      + `${substantive === 1 ? "It does" : "They do"} not establish that the programme caused any change: no comparison with people who did not take part is cited`
      + `${paired.some(directionNotEstablished) ? ", and the beneficial direction of the measured change is not established" : ""}.`);
  } else {
    parts.push("These figures may be reported internally with their recorded limitations kept with them. They do not establish that the programme caused any result.");
  }
  return [parts.join(" ")];
}

function conclusionLines(model) {
  const measured = measuredFacts(model);
  if (model.facts.some((fact) => isDocumentFact(fact) || isDerivedFact(fact))) {
    return substantiveConclusion(model);
  }
  if (measured.length === 0) {
    return ["The cited claims are reported for internal use exactly as recorded, with the limitations above."];
  }
  if (measured.every((fact) => fact.countOnly)) {
    return [
      `On the available evidence, the promoted source contains ${measured.map((fact) => countedRows(fact.measurement)).join("; ")}. `
        + "Each figure is a count of rows. What a row represents was defined by a person at the organization and was not verified by KAI, "
        + "so the figure is not an established count of what the definition names. It may be reported internally as a row count, with its limitations kept with it. "
        + "It is not evidence of the number of people reached, of distinct sessions, of outcomes, or of impact.",
    ];
  }
  const countOnly = measured.filter((fact) => fact.countOnly);
  const ordinary = measured.filter((fact) => !fact.countOnly);
  const ordinaryParts = ordinary.map((fact) => {
    const m = fact.measurement;
    const period = periodText(m);
    return `${m.measuredValue} ${text(m.unitLabel)}${period ? ` for ${period}` : ""}`;
  });
  if (countOnly.length === 0) {
    return [
      `On the available evidence, the organization's promoted source records ${ordinaryParts.join("; ")}. `
        + "This is a count of qualifying records under the organization's own recorded definition. It is a sound basis for internal reporting of activity volume, "
        + "provided it is described as records and its limitations are kept with it. It is not evidence of the number of people reached, of distinct sessions, of outcomes, or of impact.",
    ];
  }
  return [
    `On the available evidence, the organization's promoted source records ${ordinaryParts.join("; ")}. `
      + "Each of these is a count of qualifying records under the organization's own recorded definition. It is a sound basis for internal reporting of activity volume, "
      + "provided it is described as records and its limitations are kept with it. "
      + `Separately, ${countOnly.map((fact) => countedRows(fact.measurement)).join("; ")} ${countOnly.length === 1 ? "is a row count" : "are row counts"} only, whose meaning was defined by a person and not verified; `
      + "they are not activity figures. "
      + "None of this is evidence of the number of people reached, of distinct sessions, of outcomes, or of impact.",
  ];
}

function referenceLines(model) {
  return model.facts.map((fact) => {
    if (fact.measurement && fact.countOnly) {
      return `- [${fact.citationRefs.join("] [")}] Claim ${code(fact.claimId)} and evidence ${code(fact.evidenceItemId)}: authoritative measurement `
        + `${countedRows(fact.measurement)} (${plural(fact.measurement.blankRecordCount, "blank row")} excluded, ${plural(fact.measurement.duplicateRecordCount, "exact-duplicate row")} included). `
        + "Their recorded wording is not reproduced, because it uses the human-defined label as the counted unit. "
        + `Source ${fact.sourceCode ? code(fact.sourceCode) : code(fact.sourceId)}, version ${code(fact.sourceVersionId)}.`;
    }
    const worksheet = fact.measurement?.worksheetKey
      ? ` Worksheet citation: ${text(fact.measurement.worksheetName || "Worksheet")} (${code(fact.measurement.worksheetKey)}).`
      : "";
    return `- [${fact.citationRefs.join("] [")}] Claim ${code(fact.claimId)}: "${text(fact.claimStatement)}" `
      + `Evidence ${code(fact.evidenceItemId)}: "${text(fact.evidenceStatement)}" Source ${fact.sourceCode ? code(fact.sourceCode) : code(fact.sourceId)}, version ${code(fact.sourceVersionId)}.${worksheet}`
      + (fact.linkedSources || []).map((linked) => ` Linked source ${code(linked.sourceId)}, version ${code(linked.sourceVersionId)} (fields ${linked.fieldKeys.map(code).join(", ")}).`).join("");
  });
}

// Recorded sensitivity categories and provisional findings, as information.
function informationLines(model) {
  const notes = reportInformationNotes(model.informationReasons);
  if (notes.length === 0) return [];
  return ["## Information", "", ...notes.map((note) => `- ${note.heightened ? "**" : ""}${text(note.message)}${note.heightened ? "**" : ""}`), ""];
}

function narrativeIntroduction() {
  return "The text below states findings from the cited claims and measurements, with their limitations. Automated checks cover citations, numbers, causal language and limitation disclosure.";
}

export function serializeInternalReportToMarkdown(model) {
  if (!model || model.available !== true || !Array.isArray(model.blocks) || !Array.isArray(model.facts) || model.facts.length === 0) {
    throw new TypeError("An available internal report model is required.");
  }
  model = { ...model, facts: model.facts.map((fact) => ({ ...fact, countOnly: Boolean(fact.measurement) })) };
  const lines = [
    `# ${REPORT_TITLES[model.report.contentType] || "Internal Report"}`,
    "",
    `Markdown contract: ${MARKDOWN_CONTRACT_VERSION}`,
    "",
    `**Status:** ${PROVISIONAL_REPORT_STATUS}`,
    "",
    STORY_SOURCE_NOTE,
    "",
    ...informationLines(model),
    "## Context",
    "",
    ...contextLines(model),
    "",
    "## Key findings",
    "",
    ...findingLines(model),
    "",
    "## Reporting period",
    "",
    ...periodLines(model),
    "",
    "## Measurement definition and counting method",
    "",
    ...methodLines(model),
    "## Duplicate records",
    "",
    ...duplicateLines(model),
    "",
    "## Data quality and limitations",
    "",
    ...limitationLines(model),
    "",
    "## What this evidence establishes",
    "",
    ...establishesLines(model),
    "",
    "## What this evidence does not establish",
    "",
    ...doesNotEstablishLines(model),
    "",
    "## Analysis",
    "",
    ...analysisLines(model),
    "",
    "## Generated narrative",
    "",
    narrativeIntroduction(model),
  ];
  // A Free Impact Assessment's blocks carry their section marker; the section
  // title is shown once, as a heading, instead of the marker.
  let currentSection = null;
  for (const block of [...model.blocks].sort((a, b) => a.ordinal - b.ordinal)) {
    const section = parseAssessmentBlockText(block.text);
    if (section && section.sectionKey !== currentSection) {
      currentSection = section.sectionKey;
      lines.push("", `### ${ASSESSMENT_SECTIONS.find((entry) => entry.key === section.sectionKey).title}`);
    }
    lines.push("", `${text(section ? section.body : block.text)} ${refs(block.citationRefs)}`);
  }
  lines.push(
    "",
    "## Source and evidence traceability",
    "",
    ...traceabilityLines(model),
    "",
    "## Authority for internal use",
    "",
    ...authorityLines(model),
    "",
    "## Conclusion",
    "",
    ...conclusionLines(model),
    "",
    "## References",
    "",
    ...referenceLines(model),
  );
  return `${lines.join("\n")}\n`;
}

export const __internalReportMarkdownSerializerTestables = Object.freeze({ MARKDOWN_CONTRACT_VERSION, REPORT_TITLES });
