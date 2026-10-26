import { describeMeasurementCalculationMethod, describeMeasurementLimitationCode } from "../validators/kaiSourceMeasurementValidators.js";

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
    if (fact.measurement) {
      const m = fact.measurement;
      const period = periodText(m);
      lines.push(`- The promoted source records **${m.measuredValue} ${text(m.unitLabel)}**${period ? ` for the reporting period ${period}` : ""}: `
        + `${plural(m.measuredValue, `qualifying ${text(m.countedUnit)} record`)} counted under the organization's recorded definition. ${refs(fact.citationRefs)}`);
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
  if (lines.length === 0) lines.push("- The cited evidence does not establish a reporting period.");
  return lines;
}

function methodLines(model) {
  const lines = [];
  for (const fact of measuredFacts(model)) {
    const m = fact.measurement;
    lines.push(
      `#### ${refs(fact.citationRefs)} ${text(m.unitLabel)}`,
      "",
      `- **What one record represents:** one ${text(m.countedUnit)}, as defined by a person at the organization.`,
      `- **Definition:** ${text(m.definitionText)}`,
      `- **Included:** ${text(m.inclusionRule)}`,
      `- **Excluded:** ${text(m.exclusionRule)}`,
      `- **Calculation:** ${code(m.calculationMethod)}: ${describeMeasurementCalculationMethod(m.calculationMethod)}`,
      `- **Arithmetic:** ${plural(m.totalRecordCount, "data record")} after the header, minus ${plural(m.blankRecordCount, "blank record")} excluded = **${m.measuredValue}** counted.`,
      `- **Definition recorded:** ${m.definitionRecordedAt || "time not recorded"}. The definition is fixed for this source version and reused for every report; a new source version is measured again under its own definition.`,
      "",
    );
  }
  if (lines.length === 0) lines.push("No measured value is cited; the cited claims are reproduced as recorded.", "");
  return lines;
}

function duplicateLines(model) {
  const lines = [];
  for (const fact of measuredFacts(model)) {
    const m = fact.measurement;
    lines.push(m.duplicateRecordCount > 0
      ? `- ${refs(fact.citationRefs)} The profiler reported ${plural(m.duplicateRecordCount, "exact-duplicate record")}. They are included in the count of ${m.measuredValue}, not removed or merged, because the recorded definition gives no rule that makes them invalid. The count is therefore a count of records, not of distinct sessions or events.`
      : `- ${refs(fact.citationRefs)} The profiler reported no exact-duplicate records.`);
  }
  if (lines.length === 0) lines.push("- No measured value is cited.");
  return lines;
}

function limitationLines(model) {
  const lines = [];
  for (const fact of model.facts) {
    if (fact.limitationCodes.length === 0) continue;
    lines.push(`- ${refs(fact.citationRefs)}`);
    for (const limitation of fact.limitationCodes) {
      const description = describeMeasurementLimitationCode(limitation);
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
      const m = fact.measurement;
      lines.push(`- The promoted source version ${code(fact.sourceVersionId)} contains ${plural(m.measuredValue, "non-blank data record")}, `
        + `each of which the organization's recorded definition treats as one ${text(m.countedUnit)}. ${refs(fact.citationRefs)}`);
    } else {
      lines.push(`- The recorded claim: ${text(fact.claimStatement)} ${refs(fact.citationRefs)}`);
    }
  }
  lines.push("- Every cited claim traces to its evidence item, its promoted source and the current source version listed below.");
  return lines;
}

function doesNotEstablishLines(model) {
  const measured = measuredFacts(model);
  const lines = [];
  if (measured.length > 0) {
    lines.push("- How many distinct people took part: the records are not linked to individuals, and no participant count was measured.");
    if (measured.some((fact) => fact.measurement.duplicateRecordCount > 0)) {
      lines.push("- How many distinct real-world sessions or events took place: exact-duplicate records are included in the count.");
    } else {
      lines.push("- That each record is a distinct real-world session or event: KAI counted records; it did not verify what each record represents.");
    }
    lines.push("- That the reporting period is verified: it is stated in the definition, not checked against record dates.");
  }
  lines.push(
    "- Any outcome for participants or the community, or any change over time.",
    "- That the programme caused any result: no comparison, baseline or attribution evidence is cited.",
    "- That the source is complete: activity not recorded in this source is not reflected.",
  );
  return lines;
}

function analysisLines(model) {
  const lines = [];
  for (const fact of measuredFacts(model)) {
    const m = fact.measurement;
    const share = m.totalRecordCount > 0 ? Math.round((m.measuredValue / m.totalRecordCount) * 100) : null;
    lines.push(`- ${refs(fact.citationRefs)} ${m.measuredValue} of the ${plural(m.totalRecordCount, "data record")} in the source qualified`
      + `${share === null ? "" : ` (${share}%)`}; ${plural(m.blankRecordCount, "blank record")} ${m.blankRecordCount === 1 ? "was" : "were"} excluded.`
      + (m.duplicateRecordCount > 0
        ? ` ${plural(m.duplicateRecordCount, "exact-duplicate record")} ${m.duplicateRecordCount === 1 ? "is" : "are"} included, so the figure should be reported as records, not as distinct sessions.`
        : ""));
  }
  if (lines.length === 0) lines.push("- The cited claims are reported as recorded; no measured value is available for further analysis.");
  lines.push("- This is a volume-of-activity figure from one source. Interpreting it as reach or results would need further evidence (for example attendance linked to people, or outcome measures).");
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
  }
  return lines;
}

function authorityLines(model) {
  const lines = [
    "- **Source authority:** every cited source has a completed sensitivity and allowed-use decision that permits this internal use and AI processing, and records none of the high-risk categories.",
  ];
  for (const fact of model.facts) {
    const basis = fact.evidenceReviewOutcome || fact.claimReviewOutcome
      ? `recorded review decisions (evidence: ${fact.evidenceReviewOutcome ? code(fact.evidenceReviewOutcome) : "none"}; claim: ${fact.claimReviewOutcome ? code(fact.claimReviewOutcome) : "none"})`
      : "an ordinary measured fact restated from its source; no further approval is required for internal use";
    lines.push(`- ${refs(fact.citationRefs)} Currently eligible for internal use: ${fact.currentlyEligible ? "yes" : "no"}; basis: ${basis}.`);
  }
  lines.push(`- **Automated validation of the generated text:** ${model.report.validatorKeys.length > 0 ? model.report.validatorKeys.map(code).join(", ") : "none recorded"} passed when the draft was generated; this report is re-checked against current eligibility each time it is opened.`);
  return lines;
}

function conclusionLines(model) {
  const measured = measuredFacts(model);
  if (measured.length === 0) {
    return ["The cited claims are reported for internal use exactly as recorded, with the limitations above."];
  }
  const parts = measured.map((fact) => {
    const m = fact.measurement;
    const period = periodText(m);
    return `${m.measuredValue} ${text(m.unitLabel)}${period ? ` for ${period}` : ""}`;
  });
  return [
    `On the available evidence, the organization's promoted source records ${parts.join("; ")}. `
      + "This is a count of qualifying records under the organization's own recorded definition. It is a sound basis for internal reporting of activity volume, "
      + "provided it is described as records and its limitations are kept with it. It is not evidence of the number of people reached, of distinct sessions, of outcomes, or of impact.",
  ];
}

function referenceLines(model) {
  return model.facts.map((fact) => `- [${fact.citationRefs.join("] [")}] Claim ${code(fact.claimId)}: "${text(fact.claimStatement)}" `
    + `Evidence ${code(fact.evidenceItemId)}: "${text(fact.evidenceStatement)}" Source ${fact.sourceCode ? code(fact.sourceCode) : code(fact.sourceId)}, version ${code(fact.sourceVersionId)}.`);
}

export function serializeInternalReportToMarkdown(model) {
  if (!model || model.available !== true || !Array.isArray(model.blocks) || !Array.isArray(model.facts) || model.facts.length === 0) {
    throw new TypeError("An available internal report model is required.");
  }
  const lines = [
    `# ${REPORT_TITLES[model.report.contentType] || "Internal Report"}`,
    "",
    `Markdown contract: ${MARKDOWN_CONTRACT_VERSION}`,
    "",
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
    "The text below was drafted by KAI from the cited claims only, and passed the automated checks for citations, numbers, causal language and limitation disclosure.",
  ];
  for (const block of [...model.blocks].sort((a, b) => a.ordinal - b.ordinal)) {
    lines.push("", `${text(block.text)} ${refs(block.citationRefs)}`);
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
